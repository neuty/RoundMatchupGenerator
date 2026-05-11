# DoublesMatchupGenerator

no cap this is the only matchup generator you'll ever need for doubles sports. single html file, zero dependencies, just open it in a browser and go. built for badminton / pickleball / padel / whatever you're running.

**[▶ open the app](https://htmlpreview.github.io/?https://github.com/neuty/DoublesMatchupGenerator/blob/main/index.html)** — opens via htmlpreview (right-click → open in new tab)

---

## what it does

Drop in your players, hit start, and it figures out the fairest possible pairings every round. the algorithm is lowkey pretty genius:

- **no repeat matchups** — same two teams won't play each other again until every possible combo has been used up
- **rest fairness** — if someone has to sit out, it rotates evenly. no one sits two rounds in a row unless absolutely necessary
- **teammate logic** — same teammates are fine, but they have to face a fresh opposing team first before repeating

---

## features

### core
- **NvN format** — 1v1, 2v2, 3v3, whatever. You get to set N
- **multiple courts** — runs parallel games across as many courts as you like
- **bulk round gen** — generate 5, 10, however many rounds at once from the jump
- **round history** — all past matchups stay visible and collapsible

### scorecard mode
Enable it before you start and suddenly this thing becomes a full session tracker (let's you see who is sandbagging your team):

- input scores for each court after each round
- live **standings** with win/loss bars, games played, rests, and points for/against (F / A)
- edit scores from past rounds and everything recalculates automatically
- expandable **head-to-head matrix** — upper triangle only (no redundancy), colour-coded green to red on a relative gradient across all matchups. most wins = brightest green, fewest = brightest red

### session seed
Every session gets a short alphanumeric seed (or enter your own). The seed:
- shuffles the player order deterministically so pairings aren't always the same
- is **order-independent** — player entry order doesn't matter, same names + same seed = same pairings every time
- gets shown on screen and included in the export so sessions are fully reproducible

### export
Hit **Export** in the round history panel and get a clean plaintext dump of the whole session — all rounds, scores, standings table, seed, date and time. copy to clipboard in one click.

### vibes
- dark mode (green + neon) with a toggle
- mobile-first layout, works on your phone at the court
- anti-flash theme init so no white screen on load

---

## usage

1. open `index.html` in any browser — no server needed
2. add players
3. configure N, courts, scorecard, seed
4. hit **Start**
5. play, score, repeat

---

## reproduction

share the seed + player list with anyone. they open `index.html`, enter the same names and seed, and get the exact same bracket. no accounts, no cloud, no cap.
