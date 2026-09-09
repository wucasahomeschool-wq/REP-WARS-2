# Repository stabilization (phase 1)

## What changed

- TypeScript under `src/` is the only source for the existing engines.
- Stale compiled `.js` / `.d.ts` / `.js.map` files were removed from `src/` so development (`ts-node`) and production (`tsc` → `dist/`) cannot resolve different implementations.
- `src/simulation/cli.ts` is restored as the simulation CLI entry point (`npm run dev` pointed at this file when it did not exist).
- `package.json` scripts now point at files that exist. `npm test` runs `tests/run.ts` and exits nonzero on failure.
- `SeededRNG.next()` is normalized by `2^32` so the float is always in `[0, 1)`.
- Map validation tests now fail on missing neighbor refs, self-neighbors, and non-reciprocal edges (the old suite could print `UNIDIRECTIONAL EDGE DETECTED` and still report success).
- Event demos exit 1 if seeded reproducibility does not hold, instead of printing success after a review flag.
- `src/orchestration/` is excluded from `tsc` for this pass. Those files remain in the tree but are not part of the production build.

## Stale / generated files removed from `src/`

Removed compiled sidecars that duplicated TypeScript (or, for JS-only modules, duplicated the new `.ts` sources):

- `battle/BattleEngine.{js,d.ts,js.map}` (older JS battle engine without `CombatPower`)
- `constants/balance.{js,d.ts,js.map}` (JS copy lacked `BALANCE.events`)
- `engine/DecisionEngine.{js,d.ts,js.map}`
- `goals/GoalSystem.{js,d.ts,js.map}`
- `map/MapEngine.{js,d.ts,js.map}`
- `map/NamingSystem.{js,d.ts,js.map}`
- `map/Themes.{js,d.ts,js.map}`
- `memory/MemorySystem.{js,d.ts,js.map}`
- `personality/PersonalitySystem.{js,d.ts,js.map}`
- `scoring/ActionScorer.{js,d.ts,js.map}` (older JS without `CombatPower` military ratio)
- `simulation/battleTests.{js,d.ts,js.map}`
- `simulation/cli.{js,d.ts,js.map}`
- `simulation/mapDemo.{js,d.ts,js.map}`
- `simulation/SampleMap.{js,d.ts,js.map}`
- `types/index.{js,d.ts,js.map}`
- `utils/SeededRNG.{js,d.ts,js.map}`

No intentional JavaScript-only source remained after the TypeScript conversions.

## Scripts

| Script | Entry |
| --- | --- |
| `npm run build` | `tsc` → `dist/` |
| `npm run dev` | `ts-node src/simulation/cli.ts` |
| `npm run simulate` / `start` | `dist/simulation/cli.js` |
| `npm run battles` | CLI `--battles` |
| `npm run map` | CLI `--map` (nonzero if map validation tests fail) |
| `npm run events` | `dist/simulation/eventSimulation.js` |
| `npm test` | `ts-node --project tsconfig.tests.json --transpile-only tests/run.ts` |

Simulation source entry point: **`src/simulation/cli.ts`**.

## Authoritative layout

```
src/          TypeScript source
dist/         tsc output (gitignored)
tests/        automated checks for this pass
docs/         developer notes
```

## Remaining repository problems (as of phase 1)

- No in-repo “Rep Wars Game Description” file was found (searched common doc types at the repo root).
- `src/orchestration/` is incomplete/WIP and is excluded from `tsc`.
- Two factions can share a generated capital name/id in some seeds. Not fixed here.
- Event morale application, AI/battle/map geometry redesigns, and GameState orchestration are unchanged.

The map neighbor-graph reciprocity problem noted at the end of phase 1 is fixed in phase 2, below.

## Intentionally deferred

Authoritative GameState, Game Interface & Orchestration Engine, command index, AI commitment/ambition, battle/siege redesign, city/economy, map geometry, event morale, 24/7 sim, fitness, Supabase, frontend, React/Phaser/mobile, major balance changes.

---

# Map graph correctness (phase 2)

## Root cause

The neighbor graph is a doubly-linked adjacency list: each `Territory.neighboring` array is supposed to be the mirror image of every listed neighbor's own array. Two independent defects in `src/map/MapEngine.ts` broke that mirror:

1. **`computeNeighborsFor` destructively reset the list it was recomputing.** It began with `t.neighboring = []` and then rebuilt the array from hex-grid adjacency, a chance-based diagonal cross-connect, and a nearest-candidate fallback for `minNeighbors`. This is fine the *first* time it runs for a brand-new territory (its list starts empty anyway), but it was also called a *second* time on an already-connected, pre-existing territory: `expandFromFrontier` calls `computeNeighborsFor(world, fromT.id, rng)` on the frontier territory an expansion just grew outward from, after that territory already had edges to other, older territories. Wiping and rebuilding that list:
   - Silently dropped edges that other territories still pointed back at (their own arrays were never touched), immediately producing a one-directional (non-reciprocal) edge.
   - Could also fail to re-derive a previously-existing chance-based diagonal or fallback edge, because the second call draws from a different point in the RNG sequence than the first, so the same coin-flip does not necessarily repeat.
   - The same risk existed even during the *initial* world generation loop: territory `A`'s pass can probabilistically connect to not-yet-visited territory `B` (adding the edge to both `A.neighboring` and `B.neighboring`); when `B`'s own turn in the loop later called `computeNeighborsFor(B)`, the reset wiped that already-established edge from `B`'s side only.
2. **`bidirConnect` never checked `maxNeighbors`,** and `ensureNeighborsSane` repaired an over-long list by slicing it (`terr.neighboring = neigh.slice(0, maxNeighbors)`), which removed the truncated ids from `terr`'s own array only — the removed neighbors' arrays still listed `terr` back, producing the exact non-reciprocal edges `npm test`/`npm run map` were failing on (`T11`: e.g. `t_25_gol→t_34_emb`, `t_25_gol→t_30_emb`).

## Files changed

- `src/map/MapEngine.ts` — `bidirConnect`, new `bidirDisconnect`, `computeNeighborsFor`, `ensureNeighborsSane`.
- `src/map/graphInvariants.ts` — added a `duplicate_neighbor` issue kind (the checker previously covered missing/self/non-reciprocal but not duplicate ids, one of the five stated invariants).
- `src/simulation/mapDemo.ts` — strengthened `runMapValidationTests` (multi-seed, post-expansion graph checks; a real duplicate-id test; a genuine full-graph determinism test) and fixed the misleading `DEMO 5` comparison in `runMapDemo`.
- `docs/REPOSITORY_STABILIZATION.md` — this section.

No other files were touched.

## Implementation approach

**Single authoritative connect/disconnect mechanism.** `bidirConnect(a, b)` is now the *only* code path allowed to push an id into `Territory.neighboring`. It:
- No-ops (returns `true`) if `a` and `b` are already mutually connected.
- Refuses (`return false`) to add the edge if either side is already at `maxNeighbors` — capacity is checked on **both** sides, not just the caller's side, before anything is mutated.
- Otherwise adds the id to both sides in the same call, so an edge can never exist on one side without existing on the other from the moment it is created.

`bidirDisconnect(a, b)` is the mirror-image removal helper: it removes the id from both sides, so an edge can never be torn down asymmetrically either (this is what fixes the old truncation bug).

**`computeNeighborsFor` is now purely additive.** The destructive `t.neighboring = []` reset was removed. Every connection it makes (hex-direct, diagonal cross-connect, `minNeighbors` fallback) goes through `bidirConnect`, which is idempotent, so calling this function more than once for the same territory (as `expandFromFrontier` does for the frontier territory being expanded from) can only add new edges around newly-created neighbors — it can never drop a pre-existing edge. Its `minNeighbors` fallback search also now skips candidates that have no spare capacity, so it never asks `bidirConnect` to create an edge that would immediately overflow the target's cap.

**`ensureNeighborsSane` was rewritten as a defensive, idempotent 4-pass invariant guarantee** (it is no longer the primary edge-creation path, since `bidirConnect`/`computeNeighborsFor` are correct by construction; it exists to make the invariants airtight regardless):
1. Normalize — drop self-references, drop references to territories that don't exist, and drop duplicate ids.
2. Restore reciprocity — for any one-directional edge, add the missing reverse pointer if the far side has spare capacity; if it does not, drop the one-directional reference instead. Reciprocity is never left broken to preserve an edge.
3. Hard-enforce `maxNeighbors` on both sides using `bidirDisconnect` (removes the edge on both ends, not just one) — a safety net that should rarely trigger now that edges are cap-checked at creation time.
4. Top up territories below `minNeighbors` with the nearest candidate that still has spare capacity, skipping capped candidates instead of overflowing them.

None of these passes can loop indefinitely: pass 3's `while` strictly shrinks the array each iteration, and passes 2/4 make one bounded decision per territory with no retry.

**Where perfect reciprocity vs. `maxNeighbors` can conflict (documented trade-off).** With `maxNeighbors = 6` and a hex grid offering up to 6 direct neighbors plus optional diagonal/fallback edges, a territory can occasionally already be at its cap (from an earlier territory's diagonal pick, or from the `minNeighbors` fallback) by the time a normally-expected hex-direct edge would be added. In that rare case, `bidirConnect` refuses the edge rather than exceeding the cap or silently leaving a one-directional edge — i.e., **completeness of hex adjacency is sacrificed before reciprocity or the neighbor cap ever are.** This is the smallest change consistent with the existing design: `maxNeighbors`/`minNeighbors` were already soft, best-effort targets in the original code (the diagonal connector already skipped connections when capped), this pass just makes that same trade-off apply consistently everywhere an edge is created, instead of only in one of the four places edges used to be added.

## Invariants now guaranteed

For every territory `A` and every neighbor id `B` in `A.neighboring`, after `generateInitialWorld` and after every `expandFromFrontier` call:
1. `B` exists as a territory.
2. `A` never lists itself.
3. `B.neighboring` includes `A`.
4. `A.neighboring` has no duplicate ids.
5. All of the above continue to hold after any sequence of the map operations `MapEngine` currently supports (initial generation, repeated frontier expansion).

`collectNeighborGraphIssues` now also detects duplicate neighbor ids (`duplicate_neighbor`), so all five invariants are machine-checked, not just three.

## Determinism

Map generation is still fully seed-deterministic — no RNG call sites, RNG seeding, or generation order were changed; only which edges are kept/dropped when they'd otherwise violate an invariant. `T13` (new) runs 3 clean generations from the same seed for 3 different seeds and diffs the **entire sorted neighbor structure** of every territory (not just names/terrain/values), confirming identical output. `T9`–`T12` (strengthened) check all five invariants across 8 different seeds, each subjected to 3 rounds of `expandFromFrontier`, so expansion is verified not to introduce invalid or non-reciprocal edges.

## What was intentionally NOT changed

- The map-generation algorithm's overall shape/intent: hex-grid placement, region/theme selection, capital placement, fog of war, visibility, scouting, expansion budget/retry logic, and all `BALANCE.mapGen` values are unchanged.
- No polygon geometry, visual shapes, cities, economy, AI strategy, or new gameplay systems were added.
- Territory ownership rules and the battle/event engines were not touched.
- `GameState`/orchestration work was not started.
- The exact generated world for a given seed can differ in fine detail from before this pass in the rare over-capacity cases described above (an edge that used to be silently duplicated-then-truncated-then-dangling is now either kept reciprocally or never created) — this is the minimum change necessary to satisfy the stated invariants, not a redesign.

## Tests run + result

- `npm run build` — PASS
- `npm test` — PASS (14/14, including the new `duplicate_neighbor` unit case)
- `npm run map` — PASS (13/13 formal validation tests, including new `T12`/`T13`)
- `npm run dev`, `npm run simulate`, `npm run battles`, `npm run events` — PASS (all exit 0, unaffected)
- Map graph invariants verified across seeds `9001, 1, 42, 7777, 123456, 2026, 555, 31415`, each after 3 rounds of expansion, and full-graph determinism verified across seeds `4321, 9001, 555` with 3 repeated runs each.

## Remaining map issues

None known for the stated invariants (existence, no self-neighbor, reciprocity, no duplicates, validity after generation/expansion). Two pre-existing, out-of-scope items noted in phase 1 remain: `src/orchestration/` is still WIP/excluded from `tsc`, and two factions can occasionally share a generated capital name in some seeds — neither is a neighbor-graph correctness issue.
