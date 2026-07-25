# how round generation works

this doc breaks down exactly how the app turns a player list into fair matchups every round.

---

## the big picture

the core idea is a **matchup pool** plus **rest-urgency scoring**. at game start, every unique NvN pairing across all players is computed and shuffled with the session seed. each round scores the remaining pool against live rest statistics and takes the matchup(s) whose players are least due for a break. whoever isn't selected sits out.

once the pool is exhausted, a new shuffled cycle begins. this guarantees:
- every unique matchup is played exactly once before anything repeats
- rest counts are perfectly balanced at every cycle boundary
- rests are evenly *spaced*, not just evenly counted — a player who rests every K rounds keeps resting every K rounds

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

## rest urgency — balancing and spacing rests

each round, every player gets an urgency score saying how overdue they are for a break:

```
urgency[p] = (round - lastRestRound[p]) - restCount[p] * REST_WEIGHT
```

two terms, in priority order:

- `restCount * REST_WEIGHT` — the dominant term (`REST_WEIGHT` is 1e6, far larger than any plausible round gap). a player who has rested fewer times is always more urgent than one who has rested more, so total rest counts equalize first.
- `round - lastRestRound` — the tiebreaker among players with equal rest counts. the longer since your last break, the more urgent you are. **this is what produces even spacing.**

players who have never rested are treated as though they last rested at round 0, so urgency simply grows with the round number.

---

## picking matchups each round

`nextRound` scores the pool and takes the *least* urgent matchup — the one whose players are most ready to keep playing. that leaves the most urgent players to rest:

```
urgency = restUrgency(round)
while matchups.length < courts:
    pick the pool matchup with the lowest summed urgency
    whose players are all still free this round
    remove it from the pool, mark its players active
```

ties fall back to pool order, which is seeded — so the same seed still produces the same schedule, and different seeds still produce different ones.

if no eligible matchup remains (pool empty, or everything left overlaps players already placed this round), `refillPool` starts a new cycle and the pick is retried. the players NOT in any selected matchup rest this round — no separate rest-selection step.

**result:** rest counts are exactly balanced at every cycle boundary, and gaps between rests stay tight. for 5 players in 2v2 on one court, every player rests exactly every 5 rounds. mid-cycle the rest-count delta can reach 2 in some configurations — that is a consequence of the play-every-matchup-once rule constraining what is still available, and it resolves to 0 at the end of each cycle.

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
