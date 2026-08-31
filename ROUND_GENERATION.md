# how round generation works

this doc breaks down exactly how the app turns a player list into fair matchups every round.

---

## the big picture

the core idea is a **matchup pool** plus **per-round ranking**. at game start, every unique NvN pairing across all players is computed and shuffled with the session seed. each round ranks the remaining pool against live statistics and takes the matchup(s) whose players are least due for a break. whoever isn't selected sits out.

once the pool is exhausted, a new shuffled cycle begins. this guarantees:
- every unique matchup is played exactly once before anything repeats
- rest counts are perfectly balanced at every cycle boundary
- nobody rests two rounds running
- rest partners and playing groups keep rotating rather than settling into fixed blocks

---

## the seed

the seed fires once at `startGame()`, producing a single `mulberry32` PRNG stream that is used for two things in sequence:

1. the player list is sorted **alphabetically** then shuffled with the PRNG — this makes entry order irrelevant and makes sessions reproducible
2. the full matchup pool is shuffled with the same PRNG stream (after the player shuffle has advanced it) — this is the source of variety between sessions

same names + same seed = same matchup sequence every time.

when the pool is exhausted and a new cycle begins, `refillPool` derives a new PRNG from `hashSeed(seed) XOR cycleCount`, so each cycle has a different shuffle.

---

## building the pool

`getValidMatchups(players, n)` enumerates every team of size N, then pairs every team against every other team where no player appears on both sides. for 6 players in 2v2 this gives 45 matchups; for 7 players, 105.

the resulting list is shuffled with the session seed and stored as-is. the pool is deliberately *not* pre-ordered — ordering it up front would have to guess at rest state, and that guess goes stale as soon as the session diverges from it (cycle boundaries especially). ordering is decided per round instead, from real statistics.

---

## ranking matchups — the four terms

each round, every still-eligible pool matchup gets a rank made of four numbers. they are compared in order, and the **first one that differs decides it**; later terms only ever break ties in earlier ones. lower is better.

```
matchupScore(t1, t2, round) = [
  -sum(restCount),        // 1. play whoever has sat out the most
  -count(rested last round), // 2. play whoever rested last round
   repeatScore(t1, t2),   // 3. prefer groupings with the least shared history
   sum(round - lastRestRound) // 4. play whoever rested most recently
]
```

**1. rest counts.** the dominant term. the matchup whose players have collectively rested the most gets played, which leaves the players with the fewest rests sitting out. nothing below this term can override it, so total rest counts equalize first and stay equal.

**2. rested last round.** among candidates that tie on rest count, prefer the one that puts last round's resters back on court. this is a hard guard against resting the same person twice running — a risk created by term 3, which is otherwise happy to ignore recency.

**3. repeat pairings.** `repeatScore` sums the existing teammate counts for players on the same side and the existing opponent counts for players across the net. a grouping that has already spent a lot of rounds together scores high and loses to a fresher one.

this is the term that fixes the small-group problem. with 6 players on one court, terms 1 and 4 alone are fully deterministic and lock the roster into three fixed pairs — the same two people always rest together, and no player is ever on court while their block partner is resting. rest *counts* stay perfectly fair, but rest *company* never changes. ranking shared history above recency breaks the blocks apart.

**4. rest recency.** the final tiebreaker: the longer since your last rest, the more due you are, so the least-recently-rested sit out. players who have never rested are treated as though they last rested at round 0.

ties on all four fall back to pool order, which is seeded — so the same seed still produces the same schedule, and different seeds still produce different ones.

---

## picking matchups each round

```
while matchups.length < courts:
    pick the best-ranked pool matchup
    whose players are all still free this round
    remove it from the pool, mark its players active
```

if no eligible matchup remains (pool empty, or everything left overlaps players already placed this round), `refillPool` starts a new cycle and the pick is retried. the players NOT in any selected matchup rest this round — no separate rest-selection step. rest *company* is chosen implicitly: with a fixed number of courts the resting set is the complement of the players picked to play, so ranking playing groups by shared history rotates the resting groups too.

**result** — measured over 30 rounds, 6 players, one court: all 15 possible rest pairs occur, none more than 3 times, rest counts land dead level, and no player rests twice in a row. every pair of players shares between 11 and 13 rounds out of 30. for 10 players on 2 courts the shared-round spread tightens from 0-16 to 5-10.

---

## matchup identity

`matchupKey(t1, t2)` produces a canonical, order-independent string:

- players within each team are sorted and joined with `\x00`
- the two team strings are sorted so team order doesn't matter
- teams are joined with `||`

`[Alice, Bob] vs [Carol, Dan]` and `[Carol, Dan] vs [Bob, Alice]` produce the same key. the key is stored in `usedMatchups` for tracking purposes.

---

## after a round is accepted

`applyRound` updates shared state:

- resting players: `restCount++`, `lastRestRound` stamped
- active players: `roundsPlayed++`
- matchup key added to `usedMatchups`
- teammate and opponent counters incremented (used by scorecard standings)
