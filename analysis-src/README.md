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

## Ratings

Computed in the template at render time from `rounds`, so they update themselves when a
session is added — nothing rating-related is stored in the payload.

**TrueSkill is the primary model.** It is built for team games: a side's performance is the
sum of its members', so one result is divided among four players in proportion to how
uncertain each already was. That is what distinguishes playing well from being carried.

- Defaults: μ 25, σ 25/3, β 25/6, τ 25/300, no draws (a race to 21 cannot tie — equal
  scores are treated as bad data and skipped).
- Displayed on an affine map, `1500 + (μ − 25) × 42`, chosen so an unrated player reads as
  1500 ± 350 exactly as under the old model. σ is scaled by the same factor.
- σ falls more slowly than Glicko-2's RD did. That is a correction, not a regression: the
  old doubles hack credited each player with a full independent observation from a result
  that four people shared, so its RD was overconfident.
- **Margin of victory** multiplies the mean shift by `ln(margin+1)`, normalised so a typical
  game sits near 1.0 (currently 0.65×–1.55×), with a `2.2/(2.2 + 0.001 × edge)` damper so a
  favoured side gains less for a blowout. σ is deliberately *not* scaled — how much a result
  teaches us should depend on having played, not on the winning margin.

**Glicko-2 still runs alongside, for one column only.** TrueSkill has no volatility
parameter, so the volatility figure comes from the Glicko-2 model. If that column is ever
dropped, delete `glickoRatings()` with it.

Common to both:

- **One rating period per session.**
- **Sessions without `rounds` are invisible.** Both models need individual results, so the
  three standings-only sessions contribute nothing and a player's rating can disagree
  sharply with their standings rank. That is expected.
- Neither models a genuine partnership effect — two players being better *together* than
  their individual skills imply. That needs far more games to separate from luck.

`analysis-src/ratings-check.js` verifies both. For each model it checks an independent
implementation against published reference values (Glickman's 2013 worked example; the
TrueSkill 1v1 and 2v2 reference results), then lifts the real block out of `template.html`
and diffs it against that implementation over the live payload. Run it after touching any
rating code.

## Where the prose lives

The front page carries only the latest-session recap and the `trends` cards. Anything
about an individual belongs in that player's `story`, not in `trends`.

A new session usually contradicts existing copy — a streak breaks, a "never" stops being
true. Reread all of it after adding data rather than only appending.

## Voice

**Every reader-facing string on the page is written in a dry, slightly unhinged Australian
voice.** That covers the player stories, the recap, the trend cards, section notes, the gate
copy, the footer and the rating explainers — and anything new added later. Wry, deadpan,
happy to sledge gently; Australian idiom used naturally rather than laid on with a trowel;
short punchy closers. Never neutral match reporting.

Two limits:

- **Definitions stay plain.** Explaining what skill, σ, volatility or point ratio actually
  mean is where clarity beats comedy. The voice goes in the caveats around them.
- **Accuracy is never traded for a joke.** Every figure reconciles against `payload.json`.
  If a line is funnier when wrong, the line goes.

Prose no reader sees — code comments, this file, commit messages — stays plain.

The voice drifts. Copy written alongside a technical change tends to come out flat, so read
anything new back against the existing player cards before shipping.

## Conventions carried over from the app

- Draws are placeholders and are excluded; games played is `W + L`.
- Point ratio is `F / (F + A)`. Differential is unaffected by excluded draws, but raw
  `F`/`A` totals still include their points, so per-game *scoring level* is not reliable.
- Every figure quoted in the written findings should reconcile against the data in
  `payload.json`. Check after any copy change.
