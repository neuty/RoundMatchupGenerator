# how round generation works

this doc breaks down exactly how the app turns a player list into fair matchups every round. it's not magic — it's a backtracking search with a scoring function designed to avoid repeats and keep rest rotation fair.

---

## the big picture

generating a round is three steps:

1. **pick who sits out** — figure out which players rest this round
2. **build the matchup pool** — enumerate every valid NvN pairing from the active players
3. **find the best combination** — backtrack through the pool to fill all courts with the lowest-penalty set of matchups

---

## the seed

the seed fires exactly once — at `startGame()`, before any rounds are generated. it does not touch the round generation algorithm itself.

the pipeline:

1. the player list is sorted **alphabetically** (so entry order doesn't matter)
2. the seed string is hashed to a uint32 via FNV-1a (`hashSeed`)
3. that uint32 seeds a `mulberry32` PRNG
4. the sorted player list is shuffled with that PRNG (`seededShuffle`)
5. the shuffled order is stored in `state.players` and never touched again

from that point on, round generation is purely deterministic — it only looks at match history and rest counts. the seed's influence is indirect: `combinations` preserves the array order it receives, so the seed changes which teams appear first in the raw pool. after the pool is sorted by score, this only affects tie-breaking in round 1 when all scores are zero. by round 2, actual opponent/rest history dominates and the seed's effect is negligible.

this is also why same names + same seed = same session every time, regardless of the order you typed the names in.

---

## step 1: rest rotation

if you have more players than `courts × 2 × N`, some people sit. `selectResting` decides who.

the rules:
- **no consecutive rests** — anyone who sat last round is excluded from the candidate list first
- **fairness by net rounds** — candidates are sorted by `roundsPlayed - restCount` descending. whoever has played the most relative to their rest count sits next
- **fallback** — if there still aren't enough candidates after excluding last-round sitters (e.g. more than half the group needs to rest), the consecutive-rest rule is relaxed and the remaining spots are filled from the forced pool, again sorted by net rounds

---

## step 2: the matchup pool

`combinations(arr, k)` is the standard recursive pick-k combinator. `getValidMatchups` runs it to produce all teams of size N, then pairs every team against every other team where no player appears on both sides.

that raw list is the pool. before the search starts, it gets sorted cheapest-first using the scoring function (below), then **capped at 500 entries**. the cap keeps backtracking fast on large player counts where the combinatorial space would otherwise explode.

---

## step 3: backtracking search

`generateMatchups` runs a depth-first backtrack over the sorted pool to fill one slot per court.

```
backtrack(courtIdx, usedPlayers, current, score)
  if courtIdx == courts → save if score < bestScore
  for each matchup in pool:
    skip if any player already used this round
    skip if score + matchupCost >= bestScore  ← pruning
    recurse with courtIdx + 1
```

the pruning line is the key optimisation: because the pool is pre-sorted cheapest-first and the running score is accumulated, any branch that's already as expensive as the best complete solution found so far gets cut immediately. in practice this makes the search very fast even with several courts.

the result is the single combination of matchups with the **lowest total penalty score** across all courts.

---

## the scoring function

`scoreMatchup(t1, t2)` returns a penalty for a proposed matchup:

| condition | penalty |
|---|---|
| this exact matchup has already been played | +1000 |
| each opponent pair (p vs q) that has faced each other before | +5 per prior meeting |

the +1000 hard penalty means already-used matchups only get picked if there is genuinely no other option — i.e. every possible pairing has already been played. once the full rotation is exhausted, the used-matchup set resets and the cycle starts over.

the +5 per repeated opponent nudges the search toward fresh pairings even when full novelty isn't possible. teammates don't factor directly into the penalty (a team can repeat), but they'll naturally vary as a side effect of avoiding repeated opponent pairs.

---

## matchup identity

`matchupKey(t1, t2)` produces a canonical, order-independent string for any matchup:

- players within each team are sorted and joined with `\x00`
- the two team strings are sorted so team order doesn't matter
- teams are joined with `||`

this means `[Alice, Bob] vs [Carol, Dan]` and `[Carol, Dan] vs [Bob, Alice]` produce the same key. the key is what gets stored in `usedMatchups` and checked by the scorer.

---

## after a round is accepted

`applyRound` updates the shared state so the next round's search has accurate history:

- resting players get `restCount++` and `lastRestRound` stamped
- every active player gets `roundsPlayed++`
- the matchup key is added to `usedMatchups`
- teammate and opponent counters are incremented for use by the scorer next round
