# how round generation works

this doc breaks down exactly how the app turns a player list into fair matchups every round.

---

## the big picture

the core idea is a **pre-ordered matchup pool**. at game start, every unique NvN pairing across all players is computed, shuffled with the session seed, then reordered for fairness. each round simply pulls the next matchup(s) from the front of that pool. whoever isn't in the selected matchup sits out.

once the pool is exhausted, a new shuffled cycle begins. this guarantees:
- every unique matchup is played exactly once before anything repeats
- rest counts stay within 1 of each other across all players
- max consecutive rests is 2

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

the resulting list is shuffled with the session seed, then passed to `fairOrder`.

---

## fairOrder — balancing rest counts

a purely random shuffle would work for matchup exhaustion, but could produce runs where the same players sit out many times in a row. `fairOrder` reorders the shuffled pool to fix this.

it's a greedy algorithm that simulates the extraction one matchup at a time:

```
totalRest[p] = 0 for all players
while pool not empty:
    pick the matchup whose 4 players have the highest combined totalRest
    append it to the ordered list
    for every player NOT in that matchup: totalRest[p]++
```

by always choosing the matchup that most benefits the players who have accumulated the most rest debt, the ordering naturally distributes rests evenly. the seed shuffle acts as the tiebreaker when scores are equal, so different seeds still produce different sequences.

**result:** over any complete cycle, rest counts are perfectly balanced. over partial cycles (short sessions), the delta across players is at most 1.

---

## picking matchups each round

`nextRound` pulls from the front of `state.remainingMatchups`:

```
for i in 0..remaining.length, while matchups.length < courts:
    skip if any player in remaining[i] is already active this round
    take remaining[i], remove it from the pool
```

for a single court this always takes index 0 (the next in fair order). for multiple courts it scans forward for non-overlapping matchups, which may skip a few entries in the pool. the players NOT in any selected matchup rest this round — no separate rest-selection step.

if the pool empties mid-fill (can happen with multiple courts near end of cycle), `refillPool` is called and filling continues from the new pool.

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
