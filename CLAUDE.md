# CLAUDE.md — RoundMatchupGenerator

## Project overview
Single-file HTML/CSS/JS web app for generating fair doubles sports matchups. No build step, no dependencies — just open `index.html` in a browser. All logic, styles, and markup live in one file.

GitHub repo: https://github.com/neuty/RoundMatchupGenerator
Live preview: https://htmlpreview.github.io/?https://github.com/neuty/RoundMatchupGenerator/blob/main/index.html

## Tech stack
- Vanilla HTML/CSS/JS only — no frameworks, no npm, no bundler
- Single file: `index.html`
- Persists theme preference via `localStorage`

## Key architecture

### State
```js
const state = {
  players: [],     // ordered after seed shuffle
  n: 2,            // players per team
  courts: 1,
  scorecard: false,
  seed: '',
  currentRound: 0,
  rounds: [],      // [{ round, matchups, resting, scores? }]
  usedMatchups: new Set(),
  stats: {}        // keyed by player name
}
```

### Stats shape (per player)
```js
{
  roundsPlayed, restCount, lastRestRound,
  teammates: {}, opponents: {}, winsAgainst: {},
  wins, losses, draws,
  pointsFor, pointsAgainst
}
```

### Core algorithms
- `combinations(arr, k)` — recursive combinator
- `getValidMatchups(players, n)` — all valid NvN matchups (no player overlap)
- `generateMatchups(active, n)` — backtracking with pre-sorted pool and `bestScore` pruning; pool capped at 500
- `scoreMatchup(t1, t2)` — +1000 for used matchup, +5 per repeated opponent pair
- `selectResting(players, n, round)` — no consecutive rests; sorts by net rounds played
- `recalculateWinLoss()` — resets and recomputes all W/L/D/winsAgainst/pointsFor/pointsAgainst from stored scores

### Seeded RNG
- `mulberry32(seed)` — 32-bit PRNG
- `hashSeed(str)` — FNV-1a string → uint32
- At `startGame()`: players sorted alphabetically then shuffled with seed (order-independent)

### Matchup key
`matchupKey(t1, t2)` — canonical, order-independent key using `\x00` separator and `||` between teams.

## Theming
- CSS custom properties on `:root` and `[data-theme="dark"]`
- `data-theme` attribute on `<html>` toggled by JS
- Anti-flash inline `<script>` in `<head>` sets theme before paint
- Theme saved to `localStorage`

## Scorecard mode
- Score inputs use `onchange` (not `oninput`) — commits on Enter or blur
- `handleScore(roundIdx, courtIdx, teamIdx, value)` — supports editing past rounds
- `recalculateWinLoss()` called after every score change
- H2H matrix: upper triangle only, relative gradient (most wins = brightest green)

## Easter egg
Hex-encoded, XOR-encrypted with key derived from user input at runtime. No plaintext names in source. Do not add plaintext names to source, commits, or descriptions.

## Conventions
- `esc(str)` for all user-supplied strings rendered into HTML
- Player name removal uses `data-name` attribute + `this.dataset.name` (avoids quote-nesting in onclick)
- No comments unless the WHY is non-obvious
- No TypeScript, no linting setup
