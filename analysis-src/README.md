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

## Conventions carried over from the app

- Draws are placeholders and are excluded; games played is `W + L`.
- Point ratio is `F / (F + A)`. Differential is unaffected by excluded draws, but raw
  `F`/`A` totals still include their points, so per-game *scoring level* is not reliable.
- Every figure quoted in the written findings should reconcile against the data in
  `payload.json`. Check after any copy change.
