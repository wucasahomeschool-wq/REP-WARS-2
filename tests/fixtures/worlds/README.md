# Test / fixture worlds

Authored **fixture** worlds used by the TypeScript test suite.

The canonical tiny world remains:

`docs/examples/world-level1-tiny.json` (`w_ember_atoll`)

That path is shared with Map Assistant `--validate`. Do not duplicate the
file. It is listed in `FIXTURE_WORLD_REGISTRATIONS`
(`src/worldDefinition/worldConfig.ts`), not in production registrations.

Production Level 1 is `worlds/level-1.json` (`"Level 1"`), not this fixture.

When adding more test-only worlds, put JSON here and register them in
`FIXTURE_WORLD_REGISTRATIONS` (or `WorldCatalog.registerFile` inside the
test). Do not add test worlds to `PRODUCTION_WORLD_REGISTRATIONS`.

## Gate 1 vertical slice (`w_gate1_vertical_slice`)

Developer/test miniature world for Gate 1 phases. **Not** registered in
`FIXTURE_WORLD_REGISTRATIONS` or production catalogs — load only through
`tests/fixtures/gate1VerticalSliceScenario.ts`.

| API | Purpose |
| --- | --- |
| `createVerticalSliceScenario()` | Fresh authoritative `GameState` + identity constants |
| `resetVerticalSliceScenario(state?)` | Rebuild known initial state (optional in-place overwrite) |

Initial layout: player owns `t_a`; AI_1 owns `t_b`+`t_c`; AI_2 owns `t_d`.
Player banked Troops start at 0. Later Gate 1 phases (workout→Troops,
attack/conquest, persistence) should import this factory rather than
building a parallel fake world.

### Phase 1B — Workout → Troops

Tests in `tests/gate1VerticalSliceWorkout.ts` install
`scenario.workoutCatalog` for the duration of each test only:

```
createVerticalSliceScenario()
→ installAuthoredWorkoutCatalog(scenario.workoutCatalog)
→ GET_WORKOUT_SELECTION / START_WORKOUT (no workoutId) → record → feedback → FINALIZE_WORKOUT
→ installAuthoredWorkoutCatalog(null)
```

Authored selection (empty progression, STANDARD) prefers the bridge workout
`aw_bridge_1a_1b`. Completing it banks Troops through the existing reward
pipeline; no field army is created.

### Phase 1C — Troops → attack → battle → conquest

Tests in `tests/gate1VerticalSliceAttack.ts` set `playerRewards.bankedTroops`
on a fresh scenario, then send `ATTACK` through the Orchestrator. Production
start remains `bankedTroops === 0`.

`commitAmount` must exceed `MIN_ATTACKING_TROOPS` (100). Only that amount is
deducted; the rest stays banked. `t_b` and `t_c` are legal from `t_a`. `t_d`
is not, until the player owns a neighbor of `t_d`. `t_b` has AI_1's field
army, so the real Battle Engine resolves it. `t_c` is empty, so the existing
unopposed-occupation path applies. Attacking `t_a` while it is the player's
only territory fails closed (no legal staging tile) and does not spend Troops.
After `t_b` is captured, attacking it again is `INVALID_TARGET`.

Known seeds against the authored AI_1 army: commit 2000 / seed 1 captures
`t_b`; commit 101 / seed 1 is defeated and `t_b` stays `f_ai_1`. Conquest
uses `settleTerritoryOwnershipChange` (city, fortification, developments, and
in-progress construction are cleared; authored `resourceOutput` stays).

### Phase 1D — persistence / reload

Tests in `tests/gate1VerticalSlicePersistence.ts` save through
`commitAuthoritativePlayerWorld`, stringify the envelope, discard the live
`GameState`, and load it with a new `InMemoryGameStateStore`. Load runs
`hydratePersistedPayload`: schema migration, `WorldCatalog` rebind, and
invariants. That store is the repository's real persistence boundary in this
environment. It is in-memory, but the payload is encoded and decoded; it is
not `cloneGameState`. `SupabaseGameStateStore` is the durable adapter and is
not configured here.

`hydrate` requires `w_gate1_vertical_slice` to be registered. Tests call
`WorldCatalog.register` for the load only, then
`resetDefaultWorldCatalogForTests`. The world is not in
`FIXTURE_WORLD_REGISTRATIONS` or production registrations. An unregistered
load fails with `persistence.invalid_state` and does not return a state.

`syncPlayerWorld` is the application reload. The Phase 1D test asks it to
stay on the current tick, so catch-up does not advance the conquered world.
