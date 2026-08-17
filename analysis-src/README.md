# analysis-src

Build pipeline for `../analysis.html` — the passphrase-gated session analysis dashboard.

## Why it is built rather than hand-edited

The page ships with its data XOR-encrypted, so no player name appears anywhere in the
published HTML. That means the readable data lives in `payload.json`, and the page is
generated from it. **Do not hand-edit `../analysis.html`** — the next build overwrites it.

## Files

| File | Tracked | Purpose |
|---|---|---|
| `template.html` | yes | The page. Contains a `__CIPHER__` placeholder the build fills in. |
| `build.js` | yes | Encrypts the payload, writes both outputs, refuses to emit a file containing a plaintext name. |
| `payload.json` | **no** | Sessions, player records and the written findings, in the clear. Gitignored on purpose. |
| `session-analysis.html` | **no** | Build output, used as the source when publishing the Claude artifact. |

`payload.json` is the only plaintext copy of the data. It is deliberately untracked —
committing it to this public repo would make the encryption pointless. Keep a backup
somewhere private.

## Build

```sh
node analysis-src/build.js
```

Writes `analysis.html` at the repo root (what GitHub Pages serves) and
`analysis-src/session-analysis.html` (same page without the doctype/head wrapper, for
publishing as an artifact). Exits non-zero if a player name reaches either output.

## Payload shape

Four top-level keys, all required — the build fails if one is missing.

| Key | What it is |
|---|---|
| `sessions` | The data. Everything numeric on the page is derived from here. |
| `latest` | `{ headline, body }` — the recap of the most recent session. |
| `trends` | `[{ chip, tone, title, body }]` — dataset-wide observations, no single-player stories. |
| `players` | `[{ name, tag, tone, story }]` — one per player, in any order. |

`tone` is one of `good` / `warn` / `info` / `neutral` and only sets the chip colour.

Every player appearing in any session needs an entry in `players`, and every entry needs
a matching player — the build checks both directions and refuses to publish otherwise.
Player cards are ordered by the standings, not by payload order.

Each session carries `players` (the Scorecard standings) and, from 15 August 2026 on, a
`rounds` array from the Rounds export:

```json
{ "r": 1, "t1": ["A", "B"], "s1": 18, "t2": ["C", "D"], "s2": 21, "rest": ["E", "F"] }
```

`rounds` drives the partner/opponent tables and match log on each player card. Sessions
without it still contribute to every standings-based figure; the player card says which
sessions have match detail. The build recomputes W/L/F/A from `rounds` and fails if it
disagrees with that session's `players` totals.

## Glicko-2 ratings

Computed in the template at render time from `rounds`, so they update themselves when a
session is added — nothing rating-related is stored in the payload.

- **One rating period per session.** Glickman suggests sizing a period so players average
  10–15 games; these run 4–7, which mostly shows up as a higher RD.
- **Sessions without `rounds` are invisible to the ratings.** The algorithm needs
  individual results, not session totals, so the three standings-only sessions contribute
  nothing. A player's rating and their standings rank can disagree, and that is expected.
- **Doubles adaptation.** Glicko-2 is a one-on-one system. Each match collapses the
  opposing pair into one virtual opponent (mean μ, standard error of that mean for φ), and
  the expected score comes from the two team averages so a win with a strong partner is
  worth less. This is a convention, not part of the published system.
- **Margin is ignored**, as the algorithm specifies — 21–19 and 21–8 move ratings equally.
- Constants are Glickman's defaults: start 1500 / RD 350 / volatility 0.06, τ = 0.5.

`analysis-src/glicko-check.js` re-implements the maths independently, verifies it against
the worked example in Glickman's paper, and diffs its output against the template's. Run it
after touching any rating code.

## Where the prose lives

The front page carries only the latest-session recap and the `trends` cards. Anything
about an individual belongs in that player's `story`, not in `trends`.

A new session usually contradicts existing copy — a streak breaks, a "never" stops being
true. Reread all of it after adding data rather than only appending.

## Conventions carried over from the app

- Draws are placeholders and are excluded; games played is `W + L`.
- Point ratio is `F / (F + A)`. Differential is unaffected by excluded draws, but raw
  `F`/`A` totals still include their points, so per-game *scoring level* is not reliable.
- Every figure quoted in the written findings should reconcile against the data in
  `payload.json`. Check after any copy change.
