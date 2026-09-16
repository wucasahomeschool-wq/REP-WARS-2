# Canonical types & state architecture (phase 3)

> **Phase 17P:** Production geography is `WorldDefinition` via WorldCatalog.
> `MapEngine` / `MapWorldState` / `PlayerVisibilityMap` are legacy hex-era
> types, not GameState. Runtime `Territory` has id, owner, `regionId`, terrain,
> neighbors, runtime economy fields, fortification, and garrison. No
> player-facing name, `isCapital`, or tile fog fields.
> `SAMPLE_MAP` is a legacy fixture.

Architecture / type-consistency pass. **No Orchestrator, command routing,
persistence, or new gameplay systems were built in this pass** — see
"What was intentionally NOT done" at the bottom.

## 1–3. Canonical entity types, where they live, and authoritative status

All of the following already existed as single, consistently-used
definitions before this pass, or were consolidated into one during it.
They live in **`src/types/index.ts`**, the canonical type location, and
are re-exported from the package root (`src/index.ts` → `export * from
'./types'`).

| Concept | Type | Authoritative? | Notes |
| --- | --- | --- | --- |
| Territory | `Territory` | Yes | Used unmodified by `MapEngine`, `DecisionEngine`, `ActionScorer`, `EventModel`/`WorldSimulator`, `GoalSystem`. |
| Army | `Army` | Yes | Used unmodified by `DecisionEngine`, `ActionScorer`, `SampleMap`. |
| Faction / Warlord | `WarlordSnapshot` | Yes | Already carries identity, `resources`/`resourceIncome`, `goals`, `memory`, `diplomacy` (relationships), and `personality` in one place — this **is** the canonical "Faction" shape the conceptual hierarchy in the task asks for; it was not renamed (see rule 6 below). |
| Resources | `Resources` | Yes | `{ gold, food, iron, wood, stone }`, used everywhere resources appear. |
| Diplomacy / relationship state | `DiplomaticRelationship`, `Treaty`, `RelationshipState`, `TreatyType` | Yes | Lives per-faction as `WarlordSnapshot.diplomacy: Map<FactionId, DiplomaticRelationship>`. There is no separate global diplomacy ledger — that is an intentional existing design, not a gap (see §7). |
| Active event | `ActiveEvent` (in `src/events/EventModel.ts`) | Yes, for its module | Event-system types stay in `events/EventModel.ts` rather than `types/index.ts` because `EventModel.ts` already imports canonical entity types (`Territory`, `WarlordSnapshot`, …) *from* `types/index.ts`; moving `ActiveEvent` the other way would create an import cycle. This is a deliberate, documented split, not a duplicate. |
| Game/world state (snapshot DTO) | `GameStateSnapshot` | Yes, for `DecisionEngine`'s call boundary | `{ turn, factions, territories, armies, allFactionIds }` — the narrow slice `DecisionEngine`/`ActionScorer` actually need. |
| Game/world state (canonical, forward-looking) | `GameState` (new, in `src/types/GameState.ts`) | Yes, for future use | See §6. Not constructed or consumed anywhere yet — it exists to define the target shape. |
| Map/world metadata | `MapWorldState`, `Region`, `ThemeDefinition`, `PlayerVisibilityMap` | Yes | Owned/produced by `MapEngine`. |
| IDs | `FactionId`, `TerritoryId`, `ArmyId`, `RegionId`, `ThemeId` (all `string`) | Yes | See §9 for why these stay plain `string` aliases rather than becoming branded types. |
| Map/scenario bridge spec | `MapTerritorySpec` (new home; see §4) | Yes | Consolidated in this pass — was declared twice. |

## 4. Duplicate types found, and what happened to each

### Removed: stale `Battle*` draft in `src/types/index.ts`

`types/index.ts` had its own `BattleInput`, `BattleResult`,
`BattleSideBreakdown`, `BattleEvent`, and `BattleFactor` interfaces. These
were an early draft that was **never actually used** — `BattleEngine.ts`
grew its own, incompatible versions of the same names (e.g. its
`BattleSideBreakdown` has `power`/`remaining` fields the `types/index.ts`
draft never had), and every real call site
(`applyBattle.ts`, `gameState.ts`, `battleTests.ts`, `battleStressTests.ts`,
`src/index.ts`'s explicit re-export) already imported the `BattleEngine.ts`
versions, not the `types/index.ts` ones. Because `src/index.ts` did
`export * from './types'` *and* an explicit `export { BattleInput, ... }
from './battle/BattleEngine'`, the explicit export silently won and the
`types/index.ts` versions were unreachable dead code from the package's
public surface — but still directly importable from `'../types'`, and
drifting further from the real shape every time `BattleEngine.ts` changed.
**They have been deleted.** `BattleEngine.ts`'s versions in
`src/battle/BattleEngine.ts` are now the one and only definition.

The shared string-literal vocabulary those interfaces used
(`BattleSide`, `BattleOutcomeType`, `TerritoryOutcome`, `BattleEventType`)
was genuinely useful and is **kept** in `types/index.ts` — `BattleEngine.ts`
now *imports and reuses* those instead of re-declaring the same literal
unions inline, so the two files can no longer drift on what a
`territoryOutcome` or `outcomeType` string is allowed to be.

### Consolidated: `MapTerritorySpec`

`src/simulation/SampleMap.ts` declared `MapTerritorySpec` (the
id/name/terrain/neighbors/… shape that `SimulationBuilder.buildFromSpecs`
turns into canonical `Territory` entries). `src/map/MapEngine.ts`'s
`toTerritorySpecs()` returned an **unnamed inline object type with the
exact same fields**, so a generated-map territory and a hand-authored
`SAMPLE_MAP` territory were structurally required to match without any
shared name proving it. `MapTerritorySpec` now lives in
`src/types/index.ts`; `SampleMap.ts` re-exports it (so `src/index.ts`'s
existing `export { …, MapTerritorySpec } from './simulation/SampleMap'`
still works unchanged) and `MapEngine.toTerritorySpecs()` is now typed to
return `MapTerritorySpec[]` directly.

### Investigated and intentionally kept separate (not duplicates)

These look similar to a canonical type but are legitimate,
purpose-built engine DTOs — see §5 for the general rule.

- `ArmyLike` / `TerritoryLike` (`src/battle/CombatPower.ts`) vs. `Army` /
  `Territory`. Minimal structural subsets `BattleEngine`'s math actually
  needs. A real `Army`/`Territory` satisfies them structurally, so no
  adapter/conversion step exists or is needed.
- `BattleInput.territory: TerritoryLike & { id, name, owner?,
  fortification, isCapital?, garrison? }` vs. canonical `Territory`. Same
  reasoning — a narrower structural view, not a competing definition.
- `WorldStepInput` / `WorldStepOutput` (`src/events/EventModel.ts`) vs.
  `GameStateSnapshot` / `GameState`. `WorldSimulator`'s own input/output
  shape, but built directly from canonical `Territory`/`WarlordSnapshot`
  maps (not re-declared copies of them) plus event-specific fields
  (`activeEvents`, `eventHistory`, `seed`).
- `WarlordSpec` (`src/simulation/SampleMap.ts`). A scenario-authoring spec
  (personality type + starting army/resources/relationships), not a
  runtime entity — turned into a real `WarlordSnapshot` by
  `SimulationBuilder`, never used interchangeably with one.
- `AuthoritativeGameState` (`src/orchestration/gameState.ts`). A pre-existing
  WIP draft of a canonical game state, already built out of the same
  canonical types (`Territory`, `Army`, `WarlordSnapshot`, `MapWorldState`,
  `PlayerVisibilityMap`, `ActiveEvent`, `HistoryEntry`) plus
  orchestration/session-only concerns (`worldTimeMs`, `aiCommitments`,
  `workoutSessions`, `armyPosture`, `cosmetics`, `lastBattle`,
  `selectedTerritoryId`). `src/orchestration/` is still excluded from the
  `tsc` build (per phase 1) and **was not modified in this pass** — it is
  called out here as prior art that the new `src/types/GameState.ts` (§6)
  should be reconciled with when the Orchestrator is actually built, not
  as something to merge or delete now.

## 5. Authoritative state vs. engine DTOs vs. simulation/test types

**Authoritative state types** (`src/types/index.ts`, plus `ActiveEvent`/
`HistoryEntry` in `src/events/EventModel.ts` for the reason in §1): the one
definition of what a Territory/Army/Faction/etc. *is*. Every engine reads
and writes these same object shapes — there is no per-engine copy of the
entity itself.

**Engine input/output DTOs**: shapes built *from* canonical types for one
engine's call boundary, allowed to differ from the canonical entity
because the engine doesn't need (or shouldn't be able to accidentally
mutate) the whole thing. Examples: `BattleEngine`'s `BattleInput`/
`BattleResult` (built from `ArmyLike`/`TerritoryLike`, not `Army`/
`Territory` directly), `DecisionEngine`'s `GameStateSnapshot`,
`WorldSimulator`'s `WorldStepInput`/`WorldStepOutput`, `MapEngine`'s
`ExpansionRequest`/`ExpansionResult`/`ScoutResult`. This is the accepted,
intentional pattern:

```
GameState-derived battle inputs
        |
   BattleInput
        |
   BattleResult
        |
Orchestrator applies result to GameState   (partially drafted in
                                             src/orchestration/applyBattle.ts,
                                             not built out in this pass)
```

**Temporary simulation/test types**: scenario-authoring or
test-harness-only shapes that are never treated as live game state —
`MapTerritorySpec`/`WarlordSpec` (scenario specs, turned into real entities
once by `SimulationBuilder`), `LabParams`/`BatchStats`/`ScenarioReport`
(`battleTests.ts`), `RatioScenario`/`StressReport`
(`battleStressTests.ts`), `CliOpts` (`cli.ts`).

## 6. Ownership boundaries per engine

- **Map Engine** (`src/map/MapEngine.ts`) — owns map generation, expansion,
  naming, and neighbor-graph invariants (`MapWorldState`, `Region`,
  territory placement). It mutates the `MapWorldState` it is handed
  in-place (see §8) and returns bridge specs (`toTerritorySpecs`) for
  other systems to consume. It does not own faction/army/battle/event
  state and has no notion of a global turn.
- **Battle Engine** (`src/battle/BattleEngine.ts`) — calculates one battle's
  outcome from a `BattleInput` and returns a `BattleResult`. It is pure: it
  never mutates the armies/territory it's given (see §8) and never writes
  to any persistent state. Applying a `BattleResult` to the world (troop
  counts, ownership) is the orchestrator's job — already partially drafted
  in `src/orchestration/applyBattle.ts` (out of scope here).
- **Imperial Event & World Simulation Engine**
  (`src/events/WorldSimulator.ts`) — computes one turn step of
  events/consequences from a `WorldStepInput` and returns a
  `WorldStepOutput` with cloned, mutated copies of territories/factions. It
  does not own the canonical `GameState`; merging its output back in is
  the orchestrator's job (drafted in `src/orchestration/applyEvents.ts`).
- **AI Warlord / Decision Engine** (`src/engine/DecisionEngine.ts`,
  `src/scoring/ActionScorer.ts`, `src/goals/GoalSystem.ts`,
  `src/memory/MemorySystem.ts`, `src/personality/PersonalitySystem.ts`) —
  evaluates strategic decisions for one faction from a `GameStateSnapshot`
  and returns a `Decision`. It reads canonical entities by reference
  (see §8) but does not mutate world state and does not execute the
  decision (no AI commitment/execution system exists in this repo — see
  §7).
- **Orchestrator** — not built. Its eventual job is to be the *only*
  writer of the canonical `GameState`/`AuthoritativeGameState`, calling
  into the engines above and applying their results.

## 7. Current state-flow architecture

```
                AUTHORITATIVE GAME STATE
                         |
        +----------------+----------------+
        |                |                |
     Map Engine      Battle Engine    Event Engine
        |                |                |
     Map Result      Battle Result    Event Result
        |                |                |
        +----------------+----------------+
                         |
                  future Orchestrator
```

This diagram describes the **intended** boundary, not a fully implemented
Orchestrator. Today:

- There is no single running "authoritative game state" instance. Each
  simulation entry point (`SimulationBuilder.buildFromSpecs`,
  `runMapDemo`, `runBattleTestSuite`, `eventSimulation.ts`'s scenarios)
  builds its own `GameStateSnapshot`/`MapWorldState`/territory maps ad hoc
  and calls engines directly.
- `src/types/GameState.ts` (new) defines what the box at the top of the
  diagram *should* look like once an Orchestrator exists, using only
  already-canonical types (see §6 in that file's own header comment for
  the cycle-avoidance reason it isn't re-exported from `types/index.ts`).
- `src/orchestration/` already contains a more detailed WIP draft of the
  same idea (`AuthoritativeGameState`) plus `applyBattle.ts`/
  `applyEvents.ts` sketches of the bottom arrows in the diagram. It is
  unchanged and still excluded from the build in this pass.

## 8. Mutation / copying concerns discovered during the audit

- **Fixed — `WorldSimulator` shared-state mutation bug.**
  `simulate()`/`resolveChoice()` already deep-clone `territories`/
  `factions` before mutating them (`cloneMap` + `cloneTerritory`/
  `cloneWarlordSnapshot`), which looks pure from the outside. `ActiveEvent`
  objects were the one exception: both methods did `[...input.activeEvents]`
  — a shallow copy of the *array* — and then mutated fields directly on
  the original event objects (`ev.status = 'expired'`, `cd.delayRemaining--`,
  `ev.choicesPending = []`, `ev.choiceTaken = …`, `ev.chainSuppressed =
  true`, `ev.expiresTurn -= …`). A caller holding onto the original
  `activeEvents` array (e.g. the orchestrator's `state.activeEvents`, or a
  test comparing before/after) would see those objects silently change
  even if it never applied the returned `newActiveEvents`/`updatedActive`.
  **Fix:** added `cloneActiveEvent()` and used it when building
  `newActiveEvents`/`activeEvents` in both methods, so every mutation lands
  on a copy. No computed output changed — verified by the existing 15
  passing tests plus two new regression tests
  (`tests/run.ts`: "`WorldSimulator.simulate`/`resolveChoice` does not
  mutate its input activeEvents").
- **Documented, not changed — `MapEngine` mutates its `world` argument
  in place.** `generateInitialWorld`/`expandFromFrontier` grow the
  `MapWorldState` they are given (or just built) directly — there is no
  defensive cloning. This is intentional: `MapEngine` is the sole,
  authoritative builder of a `MapWorldState`, and cloning a world with
  potentially thousands of territories on every expansion call would be
  wasteful. Callers that want an independent snapshot must clone it
  themselves before calling into `MapEngine` again.
- **Documented, not changed — `BattleEngine.resolve()` is genuinely
  pure.** It only *reads* `input.attackerArmies`/`input.territory`/etc.;
  computed remaining troops are new objects on the returned `BattleResult`,
  never written back onto the input armies. Applying the result (writing
  remaining troop counts, transferring ownership) is deliberately left to
  the caller/orchestrator (`src/orchestration/applyBattle.ts` sketches
  this).
- **Documented, not changed — `DecisionEngine`/`ActionScorer` hold live
  references, not copies.** `WarlordState.buildContext` builds
  `ActionContext.myTerritories`/`myArmies`/etc. from the *same* `Territory`/
  `Army` object references that live in the `GameStateSnapshot` maps (not
  clones) — this is fine because scoring only reads fields; nothing in
  `ActionScorer.ts` assigns to a territory/army field. Worth remembering if
  a future change adds a "simulate this action" preview feature: it would
  need to clone before mutating, the same way `WorldSimulator` now does.
- **Noted for future orchestrator work, not touched — `applyEvents.ts`
  faction aliasing.** `mergeEventWorld()` (pre-existing, excluded from the
  build) does `f.armies = runtimeArmies;` where `runtimeArmies` is the
  *old* authoritative faction's `armies` array reference, assigned by
  reference (not copied) onto the new cloned faction snapshot right before
  the old faction object is replaced in the map. Harmless today because
  the old object is discarded immediately after, but worth a real copy
  (`[...runtimeArmies]`) if `orchestration/` is ever revived and that
  assumption stops holding.

## 9. Rules for future developers adding new state

1. **One canonical shape per concept.** If you need a new field on
   Territory/Army/Faction/etc., add it to the existing interface in
   `src/types/index.ts`. Do not declare a second, similar interface
   elsewhere "for now."
2. **Engine DTOs are fine, but build them from canonical types.** If an
   engine needs a narrower or reshaped view of state, define that DTO next
   to the engine (like `BattleInput`/`WorldStepInput` do) and reference the
   canonical types inside it (`territories: Map<TerritoryId, Territory>`,
   not a hand-rolled territory shape). Don't redeclare the same fields with
   different names.
3. **Reuse shared string-literal unions.** If you need an enum-like string
   set that already exists (`BattleOutcomeType`, `TerritoryOutcome`,
   `RelationshipState`, …), import it. Don't retype the same literals in a
   new file — that's exactly how the removed `types/index.ts` `Battle*`
   draft drifted out of sync with `BattleEngine.ts`.
4. **Don't invent placeholder systems.** If the conceptual architecture
   (cities, AI commitments, continuous world time, persistence, …) isn't
   implemented yet, leave it out and add a one-line deferred comment (see
   `src/types/GameState.ts`) instead of a fake field/type just to look
   complete.
5. **Mutation:** engines that receive maps/arrays of canonical entities and
   want to compute a new state without touching the caller's copy must
   clone before mutating (`cloneMap`/`cloneTerritory`/`cloneWarlordSnapshot`/
   `cloneActiveEvent` in `WorldSimulator.ts` are reusable examples). Engines
   that are documented as owning/mutating their input in place (`MapEngine`)
   should say so clearly, as it already does.
6. **IDs stay plain `string` aliases (`FactionId`, `TerritoryId`, `ArmyId`,
   …) for now.** They are used as `Map` keys and object literal keys
   throughout the codebase (`SAMPLE_MAP`, event definitions, test
   fixtures); switching to branded types (e.g. `string & { __brand:
   'TerritoryId' }`) would require touching every literal id string in the
   repository for no behavior change and no bug found in this audit. If a
   real bug from mixing up id types ever appears, branding is
   straightforward to add later — it wasn't introduced now to avoid type
   cleverness for its own sake, per the brief for this pass.
7. **`src/orchestration/`** is still an excluded, WIP sketch. Don't extend
   it as part of an unrelated change; when the Orchestrator work actually
   starts, reconcile `AuthoritativeGameState` with `src/types/GameState.ts`
   rather than keeping both.

## What was intentionally NOT done in this pass

No Orchestrator, Command Index, GameState persistence, Supabase
integration, BattleEngine/MapEngine/EventEngine/AI redesign, AI
commitments/ambition, cities, fitness/workout systems, continuous-world
simulation, offline catch-up, frontend work, gameplay rebalancing, or new
gameplay mechanics were added. `src/orchestration/` was inspected for
context (§4, §6, §7) but not modified and remains excluded from the `tsc`
build.

## Tests run + result

- `npm run build` — PASS
- `npm test` — PASS (18/18: the original 15, plus 3 new regression tests
  for this pass — `WorldSimulator.simulate`/`resolveChoice` no longer
  mutate their input `activeEvents`, and `MapEngine.toTerritorySpecs()`
  still returns the canonical `MapTerritorySpec` shape)
- `npm run map` — PASS (13/13 formal validation tests, unaffected)
- `npm run dev`, `npm run simulate`, `npm run battles`, `npm run events` —
  PASS (all exit 0; outputs are unchanged in substance — the only runtime
  behavior change in this pass is the `WorldSimulator` clone fix, which
  does not change any computed result, only whether the caller's original
  objects survive the call unmodified)

## Remaining architecture problems (out of scope for this pass)

- `src/orchestration/` is still WIP/excluded from `tsc`; it needs a real
  Orchestrator, Command Index wiring, and reconciliation with
  `src/types/GameState.ts` before it can come back into the build.
- There is still no single running "authoritative game state" instance —
  every entry point builds its own snapshot. That is expected until the
  Orchestrator exists.
- Two factions can occasionally share a generated capital name in some map
  seeds (noted in phase 1/2, not a type/state issue).
