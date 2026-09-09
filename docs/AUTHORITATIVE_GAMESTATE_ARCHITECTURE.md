# Authoritative runtime GameState (Phase 9)

This pass establishes the one authoritative runtime representation of the
current world — `GameState` (`src/types/GameState.ts`) — plus its
initialization, cloning, and structural-invariant machinery
(`src/state/`). **No Orchestrator, Command Router, persistence layer,
frontend, or continuous-time simulation was built in this pass** — see
"What was intentionally NOT done" at the bottom.

## 1. Full state audit

### 1a. Canonical data models (`src/types/index.ts`, plus `EventModel.ts`)

These already existed as single, consistently-used definitions (phase 3
audit, `docs/CANONICAL_STATE_ARCHITECTURE.md`) and are reused verbatim by
`GameState` — nothing here was duplicated or renamed:

| Concept | Type | Where |
| --- | --- | --- |
| Territory | `Territory` | `types/index.ts` |
| Army | `Army` | `types/index.ts` |
| Faction/warlord (identity, resources, diplomacy, personality, ambition, goals, memory) | `WarlordSnapshot` | `types/index.ts` |
| Resources | `Resources` | `types/index.ts` |
| AI commitment | `AICommitment` | `types/index.ts` (Phase 8) |
| Map/world metadata, regions, themes, visibility | `MapWorldState`, `Region`, `ThemeDefinition`, `PlayerVisibilityMap` | `types/index.ts`, produced by `MapEngine` |
| Active event / history | `ActiveEvent`, `HistoryEntry` | `events/EventModel.ts` (kept out of `types/index.ts` to avoid an import cycle — unchanged from phase 3) |

### 1b. Engine DTOs (input/output shapes for one engine's call boundary)

Unchanged from phase 3, still legitimate and still NOT folded into
`GameState`: `GameStateSnapshot` (`DecisionEngine`/`ActionScorer`),
`WorldStepInput`/`WorldStepOutput` (`WorldSimulator`), `BattleInput`/
`BattleResult` (`BattleEngine`), `ExpansionRequest`/`ExpansionResult`/
`ScoutResult` (`MapEngine`).

### 1c. Simulation-only / scenario-authoring structures

`MapTerritorySpec`/`WarlordSpec` (`SampleMap.ts` — turned into real
`Territory`/`WarlordSnapshot` entities exactly once, by
`SimulationBuilder.buildFromSpecs`, never treated as live state
afterward), `CliOpts` (`cli.ts`), `LabParams`/`BatchStats`/`ScenarioReport`
(`battleTests.ts`), `FactionState` (`eventSimulation.ts` — a
per-scenario-script wrapper around a `GameStateSnapshot` plus
`activeEvents`/`eventHistory`, structurally almost identical to the new
`GameState` but built ad hoc per script).

### 1d. Duplicated / drifted structures found

- **`src/orchestration/gameState.ts`'s `AuthoritativeGameState`** — a
  pre-existing WIP draft covering nearly the same ground as the new
  `GameState` (factions/territories/armies/mapWorld/visibility/
  activeEvents/eventHistory), plus session-only concerns
  (`worldTimeMs`, `aiCommitments: AICommitment[]` — its OWN, incompatible
  `AICommitment` shape with `committedAtMs`/`simulatedDurationMs` fields
  that don't exist anywhere else in the codebase, `workoutSessions:
  WorkoutSession[]` — an unrelated fitness-app leftover, `armyPosture`,
  `cosmetics`, `lastBattle`, `selectedTerritoryId`). **Not modified in
  this pass** — `src/orchestration/` is still excluded from the `tsc`
  build (`tsconfig.json`/`tsconfig.tests.json`). It is prior art for the
  future Orchestrator to reconcile with `GameState`, not something to
  merge or delete now. See §4 for how the NEW `GameState.commitments`
  differs from and does not reuse `orchestration/gameState.ts`'s
  `AICommitment`.
- **`WarlordState.activeCommitment`** (`src/engine/DecisionEngine.ts`,
  Phase 8) — the AI Engine's own runtime copy of "what am I currently
  committed to." This is a real, currently-load-bearing duplication with
  the new `GameState.commitments` — see §4/§11, it is documented as a
  transitional, explicit two-copies situation rather than hidden.
- **`FactionState`** (`eventSimulation.ts`) — same shape family as
  `GameState` (a `GameStateSnapshot` + `activeEvents`/`eventHistory` +
  `turn`/`seed`/`playerFactionId`), built independently per demo script.
  Not merged into `GameState` in this pass (that script is a standalone
  demo, out of scope to rewire — see §10), but it is now clearly a
  strict subset of what `GameState` already models.

## 2. The canonical `GameState` type

Defined in `src/types/GameState.ts`:

```
GameState
├── schemaVersion          — version marker for future persistence/replay
├── turn, worldTick, worldSeed — event-turn clock, canonical sim tick, root seed
├── lastAiDecisionTick       — per-faction AI reassessment cadence
├── factions, allFactionIds — WarlordSnapshot (identity, resources,
│                             diplomacy, personality, ambition, goals,
│                             memory) — already the canonical "faction"
├── playerFactionId          — which faction (if any) is the player
├── territories              — canonical Territory map
├── mapWorld                 — MapWorldState | null (procedural map
│                             metadata; null for hand-authored worlds)
├── visibility                — per-faction PlayerVisibilityMap
├── armies                     — canonical Army map
├── commitments                — Map<FactionId, AICommitment | null>
├── activeEvents, eventHistory — ActiveEvent[]/HistoryEntry[]
```

This intentionally does not nest `world`/`factions`/`player`/`events`
sub-objects the way the phase brief's conceptual sketch does — the
existing canonical types are already flat-ish `Map`s keyed by id, and
introducing an extra nesting layer would mean either (a) duplicating those
`Map`s inside a sub-object (two ways to reach the same data) or (b)
aliasing them (a false sense of a nested boundary that isn't real). The
conceptual domains from the brief are still all present and documented in
the type's own comments; the actual field layout minimizes duplication
instead of mirroring the sketch literally, per the brief's own
instruction ("This is conceptual guidance, NOT a command to blindly copy
this exact nesting").

## 3. Authoritative ownership

| State | Owner | Notes |
| --- | --- | --- |
| Territory ownership/garrison/fortification | `GameState.territories` | `MapEngine` only owns `MapWorldState`/`territories` while actively generating/expanding a *procedural* map; once territories are copied into `GameState` (via `SimulationBuilder`/`toTerritorySpecs`), `GameState` is authoritative. |
| Army location/count/morale | `GameState.armies` | |
| Resources / income | `GameState.factions[].resources`/`resourceIncome` | |
| Diplomacy | `GameState.factions[].diplomacy` | Per-faction, as it already was — no separate ledger. |
| AI strategic reasoning (scoring, goal alignment) | AI Engine (`DecisionEngine`/`ActionScorer`/`GoalSystem`) | Reads a `GameStateSnapshot` view, returns a `Decision`. Never mutates. |
| AI commitment *state* (the data) | `GameState.commitments` | |
| AI commitment *calculation/transitions* (create/hold/complete/fail/interrupt) | AI Engine (`DecisionEngine`) | See §11 for the transitional sync boundary. |
| Battle calculation | `BattleEngine` | Pure; never mutates its input. |
| Battle outcome application | future Orchestrator (today: `cli.ts`'s harness-local `applyBattleResult`) | See §13. |
| Event calculation | `WorldSimulator`/`EventEngine` | Clones its input before mutating; never touches the caller's originals. |
| Event outcome application | future Orchestrator (today: caller merges `WorldStepOutput.mutated*` back) | See §12. |
| Map generation/expansion | `MapEngine` | Owns/mutates the `MapWorldState` it's building in place (unchanged from phase 3 — see §6). |
| Player fitness calculation | future Fitness Engine | Does not exist. Not built here. |

**ENGINE ≠ STATE** is enforced the same way it was after phase 3: every
engine above reads canonical types or a narrow view of `GameState` and
returns a result; none of them holds a second persistent copy of the
world across calls. The one documented, intentional exception (not a
violation) is `WarlordState.activeCommitment`, discussed in §11.

## 4. Existing snapshot types — fate

| Type | Fate | Why |
| --- | --- | --- |
| `GameStateSnapshot` | **B. Read-only engine DTO — kept.** | It's the exact, narrow `{turn, factions, territories, armies, allFactionIds}` slice `DecisionEngine`/`ActionScorer` need. `src/state/gameStateAdapters.ts`'s `toDecisionEngineSnapshot(state)` derives one from `GameState` on demand. Not merged into `GameState` — it would just be `GameState` minus several fields, and `DecisionEngine`'s signature already depends on this exact shape across dozens of call sites/tests. |
| `MapWorldState` | **A. Part of `GameState`** (as `GameState.mapWorld: MapWorldState \| null`). | Procedural map/graph metadata. `null` for hand-authored worlds (the default `createGameState()` path, which never calls `MapEngine`). |
| `PlayerVisibilityMap` | **A. Part of `GameState`** (as `GameState.visibility: Map<FactionId, PlayerVisibilityMap>`). | Empty map when the world wasn't built via `MapEngine.generateInitialWorld`. |
| `WarlordSnapshot` | **A. Already IS the canonical faction representation inside `GameState.factions`.** | Unchanged since phase 3 — see §2. |
| `WorldStepInput`/`WorldStepOutput` | **B. Read-only engine DTO — kept.** | `src/state/gameStateAdapters.ts`'s `toWorldStepInput(state)` derives the input from `GameState`; the output's `mutated*` maps are the caller's job to merge back (still true — see §12). |
| `orchestration/gameState.ts`'s `AuthoritativeGameState`/`AICommitment` | **C. Deprecated relative to the new canonical types, but NOT deleted; still excluded from the build.** | Its `AICommitment` (wall-clock `committedAtMs`/`simulatedDurationMs`) is incompatible with the turn-based `AICommitment` in `types/index.ts` (Phase 8) that `GameState.commitments` actually uses. Reconciling `AuthoritativeGameState` with `GameState` is future Orchestrator work — see §17 and "Remaining migration gaps". |
| `eventSimulation.ts`'s `FactionState` | **B. Left as a self-contained demo-script type.** | Not rewired to `GameState` in this pass — that script is a standalone illustrative demo (§10), not part of the state architecture proper. |

## 5. Engine input boundaries

`src/state/gameStateAdapters.ts` adds narrow, purpose-built views instead
of ever passing the entire `GameState` into an engine that only needs part
of it:

- `toDecisionEngineSnapshot(state) → GameStateSnapshot` — for
  `DecisionEngine.decide()`/`decideAll()`. Returns the *same* `Map`
  references as `state` (not clones) because `DecisionEngine`/
  `ActionScorer` are documented and tested to only read this data (see
  "AI decide/commitment does not mutate world state", Phase 8, and the
  adapter's own doc comment for the escape hatch — clone `state` first if
  a future caller needs an isolated preview).
- `toWorldStepInput(state, armies?) → WorldStepInput` — for
  `WorldSimulator.simulate()`/`resolveChoice()`. Also safe to pass live
  references: `WorldSimulator` already deep-clones territories/factions/
  activeEvents internally before mutating anything (verified again by a
  new test, §18).
- `buildWarlordStates(state) → Map<FactionId, WarlordState>` — constructs
  fresh AI-engine runtime wrappers from `GameState.factions`, seeding each
  one's `activeCommitment` from `GameState.commitments` (§11).
- `syncCommitmentsFromWarlordStates(state, warlordStates)` — writes each
  `WarlordState.activeCommitment` back onto `GameState.commitments`
  (cloned, never aliased).

None of these functions loop over engines, sequence a turn, or decide
what happens next — that coordination is explicitly the future
Orchestrator's job and is not implemented here (see §17/§20).

`BattleEngine` and `MapEngine` already had appropriately narrow inputs
before this pass (`BattleInput`, `ExpansionRequest`/`InitialWorldParams`)
and were not changed.

## 6. Read-only vs. mutable state — mutation audit

Re-checked (not re-litigated — phase 3's audit in
`docs/CANONICAL_STATE_ARCHITECTURE.md` §8 already covered `WorldSimulator`/
`MapEngine`/`BattleEngine`/`DecisionEngine`; still true, not repeated
here) plus the new code added in this pass:

- **`createGameState()`** — pure function, allocates new `Map`s/objects
  each call via `SimulationBuilder.buildFromSpecs`. Never mutates its
  `mapSpecs`/`warlordSpecs` inputs (`SimulationBuilder` already spreads
  spec fields into new `Territory`/`WarlordSnapshot` objects).
- **`cloneGameState()`** — pure function; reads `state`, returns an
  independent deep copy. Verified by a dedicated test that mutates every
  nested collection on the clone and asserts the source is untouched
  (§18).
- **`checkGameStateInvariants()`** — pure, read-only. Never mutates
  `state`.
- **`toDecisionEngineSnapshot`/`toWorldStepInput`** — pure; return new
  wrapper objects around the SAME nested `Map` references (by design,
  §5) — categorized as (A) *required by contract*: the whole point is a
  read view, not an isolated copy, and the engines on the other end are
  read-only.
- **`buildWarlordStates`** — allocates new `WarlordState` wrapper objects;
  does not mutate `state`.
- **`syncCommitmentsFromWarlordStates`** — the one function in this pass
  that intentionally mutates `GameState` (`state.commitments.set(...)`),
  by contract, as its entire purpose. Documented in its own doc comment.
  Category (A): this is the explicit, opt-in write step a future
  Orchestrator's "apply AI results" phase will look like.

No accidental mutation was found or introduced by this pass's new code.

## 7. State initialization

`src/state/createGameState.ts`:

```ts
createGameState({ seed, mapSpecs?, warlordSpecs?, playerFactionId? }) → GameState
```

Reuses `SimulationBuilder.buildFromSpecs` (SAMPLE_MAP + WARLORD_SPECS by
default) — the exact same deterministic, seeded-RNG-only path `cli.ts`/
`eventSimulation.ts`/`tests/run.ts` already use. No new balance system,
no new starting values: territories/armies/resources/income/diplomacy/
personality/goals all come from the existing `SAMPLE_MAP`/`WARLORD_SPECS`/
`BALANCE` constants, unchanged. `mapWorld`/`visibility` start `null`/empty
(this path never calls `MapEngine`); `activeEvents`/`eventHistory` start
empty (no initial events exist for the sample scenario); `commitments`
starts as one `null` entry per faction id (no `decide()` call has
happened yet).

Determinism: `SimulationBuilder.buildFromSpecs` only draws randomness from
a `SeededRNG` constructed with the given seed — verified (not just
asserted) by a new test that calls `createGameState({ seed: 1234 })` twice
and asserts `assert.deepStrictEqual` on the two full results, plus a test
that two different seeds are allowed (and, for this fixture, do) produce
different results.

## 8. Cloning / snapshots

`src/state/cloneGameState.ts`'s `cloneGameState(state) → GameState`
rebuilds every nested `Map`/`Set`/array/object so the clone shares no
mutable reference with the source:

- `factions` (including each faction's `diplomacy` map + `treaties[]`,
  `memory[]`, `goals[]`, `lastActions[]`, `resources`/`resourceIncome`)
- `territories` (`neighboring[]`, `resourceOutput`)
- `armies`
- `mapWorld` (including `graphMeta`'s `Set`/`Map` fields, `regions`,
  `themes`)
- `visibility` (including each faction's `visibility` map, `knownThemes`/
  `knownRegions` sets)
- `commitments` (via the existing `cloneCommitment` from
  `DecisionEngine.ts` — reused, not re-implemented)
- `activeEvents` (`consequences[]`, `chainDelays[]`, `choicesPending[]`,
  `choiceTaken`)
- `eventHistory`

Verified by a test that clones a `GameState` (deliberately including a
`MapEngine`-built `mapWorld`/`visibility`, an active event with nested
consequences/choices, and a commitment), mutates every one of those
nested structures on the clone, and asserts the original `state` is
completely unaffected.

**Known, documented duplication (not fixed in this pass):**
`src/events/WorldSimulator.ts` has its own private clone helpers with
equivalent semantics (`cloneTerritory`/`cloneWarlordSnapshot`/`cloneMap`/
`cloneActiveEvent`), used to keep `WorldSimulator.simulate()` pure. This
pass deliberately does NOT refactor `WorldSimulator` to reuse
`src/state/cloneGameState.ts`'s helpers (or vice versa) — that engine is
already tested/passing and this phase's brief is to avoid rewriting
engines that don't need to change. Consolidating both sets of clone
helpers into one shared module is a real, tracked cleanup — see
"Remaining migration gaps."

## 9. State invariants

`src/state/gameStateInvariants.ts`'s
`checkGameStateInvariants(state) → GameStateInvariantViolation[]` (empty
= valid) checks, purely structurally (no new gameplay rules invented):

- Faction/territory/army map keys match their own `.id` field; no
  duplicate faction ids in `allFactionIds`.
- Territory `owner` (if non-null) references a real faction, AND that
  faction's own `territories[]` lists it back (bidirectional
  consistency — this is what "captured territory cannot simultaneously
  have two owners" reduces to, given `Territory.owner` is a single
  scalar field).
- Army `owner` references a real faction; army `location` references a
  real territory; a faction's `armies[]` references are non-dangling, not
  duplicated, and agree with each army's own `owner`.
- No army has negative `soldiers`/`knights`/`siegeEngines`/`morale`/
  `supply`.
- **Defeated armies cannot remain active**: an army with zero total
  troops/siege engines is flagged (`army.defeated_but_present`) — per the
  Phase 4 no-retreat rule, a fully-defeated army must be removed from
  `GameState.armies` entirely (as `cli.ts`'s `eliminateArmies` already
  does), never left behind at zero strength.
- Faction resources are finite, non-negative numbers; `ambition` is in
  `[0, 1]`.
- `GameState.commitments` entries reference a real faction matching the
  map key and the commitment's own `warlordId`; the commitment's *target*
  is validated by **reusing** `validateCommitmentTarget` from
  `DecisionEngine.ts` (Phase 8) rather than re-implementing target-
  validity rules.
- Active events reference a real territory/faction where set; no
  duplicate `instanceId`s.

No invented gameplay restriction — e.g. this file does not decide whether
an ATTACK is currently legal, only whether a *recorded* commitment's
target is still a coherent reference, using the AI Engine's own existing
rule for that.

## 10. No hidden second world

Re-audited every module the brief calls out:

- **`cli.ts`** — still a temporary harness (unchanged in this pass,
  except tests exercise it against `GameState`-derived inputs). It builds
  its own `GameStateSnapshot` via `SimulationBuilder` and mutates it
  directly in its turn loop; this is a **TEST/SIMULATION FIXTURE**, not
  the authoritative `GameState`. Not rewired to use `createGameState()`
  in this pass — see "Remaining migration gaps." It is not deleted, per
  the brief.
- **`WorldSimulator`** — an **ENGINE**; computes a `WorldStepOutput` from
  a `WorldStepInput` (now derivable from `GameState` via
  `toWorldStepInput`). Does not retain any state between calls.
- **`SampleMap.ts`** (`SimulationBuilder`) — a **DERIVED VIEW / builder**:
  turns scenario specs into canonical entities once. `createGameState()`
  calls it directly rather than duplicating its logic.
- **`DecisionEngine`** — an **ENGINE**, plus one **transitional runtime
  cache** (`WarlordState.activeCommitment`, §11) that mirrors a slice of
  `GameState.commitments` by design, not by accident.
- **`EventEngine`** (`WorldSimulator`/`EventDefinitions`/`EventTriggers`)
  — same categorization as `WorldSimulator` above.
- **`MapEngine`** — an **ENGINE**; owns/mutates the `MapWorldState` it is
  actively generating/expanding (unchanged, documented since phase 3),
  and is the sole producer of `MapWorldState`/`PlayerVisibilityMap` that
  `GameState.mapWorld`/`visibility` hold once generation is done.
- **`eventSimulation.ts`** — a **TEST/SIMULATION FIXTURE** (demo script);
  its `FactionState` is a `GameState`-shaped ad hoc wrapper, not rewired
  to the real `GameState` in this pass.

No module was found silently treating its own ad hoc state as if it were
the one authoritative `GameState` outside of what's already documented
above.

## 11. AI commitment integration

`GameState.commitments: Map<FactionId, AICommitment | null>` is the
canonical home for each faction's current commitment (§3/§9). The AI
Engine (`DecisionEngine`) remains solely responsible for *calculating*
and *transitioning* commitment state — `GameState` never scores actions
or decides transitions itself; `checkGameStateInvariants` only *validates*
a commitment already produced by the AI Engine.

**Transitional two-copies note (deliberate, not a bug):**
`WarlordState.activeCommitment` (Phase 8) is the AI Engine's own working
copy while `decide()` reasons turn over turn — that field was not
removed or rewritten in this pass, since doing so would mean rewriting
`DecisionEngine.decide()`'s whole hold/reassess lifecycle, which is out of
scope for an "establish the state container" phase. Instead,
`src/state/gameStateAdapters.ts` provides the explicit sync boundary:

- `buildWarlordStates(state)` seeds each new `WarlordState.activeCommitment`
  from `state.commitments`, so a `GameState` with existing commitments
  resumes correctly instead of resetting every faction to "no
  commitment."
- `syncCommitmentsFromWarlordStates(state, warlordStates)` writes the
  result back after a `decide()`/`decideAll()` call.

A full round-trip (`createGameState` → `buildWarlordStates` →
`DecisionEngine.decideAll` → `syncCommitmentsFromWarlordStates` →
`checkGameStateInvariants`) is covered by a dedicated test (§18) and
produces zero invariant violations. The future Orchestrator's job will be
to make this round-trip automatic (call the AI Engine, sync the result)
instead of something a caller must remember to do — that loop itself is
not built here.

## 12. Event integration

`GameState.activeEvents`/`eventHistory` hold exactly what `WorldSimulator`
already produces (`ActiveEvent[]`/`HistoryEntry[]`) — instance ids,
status, severity, `chainDelays`, `choicesPending`/`choiceTaken`. No new
fields (e.g. infrastructure/garrison-morale placeholders some event
definitions reference) were added; those remain future work, not
fabricated here. `toWorldStepInput(state)` is the read view;
`WorldStepOutput.mutated*` still has to be merged back onto `GameState`
by the caller (unchanged responsibility — that merge is Orchestrator
work, sketched but not built in `src/orchestration/applyEvents.ts`,
which remains untouched/excluded).

## 13. Battle integration

`GameState.armies`/`territories` already hold the authoritative *result*
of a resolved battle (surviving armies with their post-battle troop
counts/morale, territory ownership/garrison) once a caller applies a
`BattleResult` — exactly what `cli.ts`'s `applyBattleResult` already does
against its own harness-local `GameStateSnapshot`/`Army[]`/`Territory`
today. `BattleEngine` itself was not touched: it still only calculates,
never mutates. Applying a `BattleResult` onto the real `GameState` (as
opposed to `cli.ts`'s local state) is future Orchestrator work
(`src/orchestration/applyBattle.ts`, unchanged/excluded).

## 14. Map integration

`GameState.mapWorld: MapWorldState | null` + `GameState.territories`
incorporate `MapEngine`'s existing output without a second map authority:
`MapEngine` is still the only thing that generates/expands a
`MapWorldState`; `GameState.territories` is populated either from
hand-authored specs (`SimulationBuilder`, the default path) or from
`MapEngine.toTerritorySpecs()` (unchanged bridge, phase 3). No geometry,
theme, or map-mechanic changes were made.

## 15. Resource / economy integration

`GameState.factions[].resources`/`resourceIncome` use the existing
`Resources` type and existing `BALANCE` constants unchanged. No new
resource types, no rebalancing. Runtime quantities live only on
`GameState.factions[]` — `checkGameStateInvariants` additionally asserts
they stay finite and non-negative.

## 16. Determinism

Audited `src/state/*.ts` and `SimulationBuilder`/`MapEngine` (re-check)
for `Math.random()`, `Date.now()`, and unordered-iteration-affecting-
determinism issues: none found. All randomness flows through
`SeededRNG`, seeded once from the `seed` parameter. `createGameState()`
was not given its own RNG — it delegates entirely to
`SimulationBuilder.buildFromSpecs`'s existing seeded path. Verified by
the "same seed produces an equivalent GameState" / "different seeds allowed
to differ" tests (§18), and by `MapEngine`'s pre-existing determinism
tests (`npm run map`, T5/T6/T13) for the `mapWorld`/`visibility` fields
when those are populated.

## 17. Migration strategy followed

1. Defined canonical `GameState` (`src/types/GameState.ts`) — extended the
   pre-existing (phase-3, "not wired up yet") draft in place rather than
   replacing it, so the type's identity/import path didn't change.
2. Created initialization (`createGameState`) on top of the existing
   `SimulationBuilder` — no new balance/config system.
3. Connected existing structures — `mapWorld`/`visibility` slot in
   directly when a caller has built them via `MapEngine`; `commitments`
   slots in directly against the existing Phase 8 `AICommitment` type.
4. Added compatibility adapters (`src/state/gameStateAdapters.ts`) instead
   of rewriting `DecisionEngine`/`WorldSimulator`'s call signatures.
5. Migrated callers **incrementally, by addition, not by force**: `cli.ts`,
   `eventSimulation.ts`, and `tests/run.ts`'s pre-existing tests were left
   exactly as they were (still green — see §18/§20); only `tests/run.ts`
   gained NEW tests exercising `GameState` directly. Nothing that already
   worked was required to change call sites to keep working.

Old structures kept, with the specific reason each one is still needed
(no type was deleted "because it's old" — see §4 for the full table):
`GameStateSnapshot`, `WorldStepInput`/`Output`, `orchestration/gameState.ts`
(excluded, prior art), `eventSimulation.ts`'s `FactionState` (standalone
demo).

## 18. Tests added (`tests/run.ts`)

All under "Authoritative runtime GameState —" headings:

- **Shape & initialization**: `GameState` contains exactly the documented
  domains; `commitments` seeded to one `null` per faction; same seed ⇒
  `assert.deepStrictEqual`-equal `GameState`; different seeds ⇒
  `assert.notDeepStrictEqual`; custom `playerFactionId` respected.
- **Structural invariants**: a fresh `GameState` has zero violations;
  targeted mutations on a *clone* (never the source, itself exercising
  §8) each trigger exactly the expected violation code — invalid army
  owner, invalid army location, negative troop count, a defeated
  (0-troop) army left in the map, a territory owned by an unknown
  faction, a faction listing a territory it doesn't own, an active
  commitment with an invalid target (reusing `validateCommitmentTarget`),
  an active event referencing an unknown territory/faction.
- **Cloning / snapshot isolation**: cloning a `GameState` that includes a
  real `MapEngine`-built `mapWorld`/`visibility`, a nested-consequence
  active event, and a commitment produces a deep-equal copy; mutating
  every nested collection on the clone (territory `neighboring[]`/
  `resourceOutput`, army troop count, faction resources/territories/
  memory/goals/diplomacy opinion, commitment `reason[]`, a new
  commitments-map key, active-event status/causes/consequences, a new
  active event, `allFactionIds`, `mapWorld.graphMeta`/`regions`,
  `visibility.knownThemes`) leaves the source completely untouched; a
  clone still satisfies all structural invariants.
- **Engine adapters & AI commitment sync**: `toDecisionEngineSnapshot`/
  `toWorldStepInput` expose exactly the right live references; a full
  `buildWarlordStates` → `DecisionEngine.decideAll` →
  `syncCommitmentsFromWarlordStates` round-trip populates
  `GameState.commitments` with independent clones (not the same object
  `WarlordState` holds), keeps the state structurally valid, and
  rebuilding `WarlordState`s from that `GameState` resumes the same
  commitment ids instead of resetting to "no commitment"; a real
  `WorldSimulator.simulate()` call against `toWorldStepInput(state)`
  does not mutate `state`.
- **No hidden second world (spot check)**: `createGameState()`'s starting
  faction resources are identical to what `SimulationBuilder.buildFromSpecs`
  already produces for the same seed/specs — confirming no new starting
  values were invented.
- **Existing tests remain green**: all 85 pre-existing tests (phases 1–8)
  still pass unmodified.

## 19. Documentation

This file. See also `docs/CANONICAL_STATE_ARCHITECTURE.md` (phase 3, the
type audit this builds on) and `docs/AI_COMMITMENT_AMBITION.md` (phase 8,
the `AICommitment` model `GameState.commitments` stores).

### Data flow (current vs. future)

```
CURRENT (this pass and earlier — no Orchestrator):

  createGameState(seed)  ──────────────►  GameState (authoritative)
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
          toDecisionEngineSnapshot     toWorldStepInput            (mapWorld/
                    │                         │                    visibility
                    ▼                         ▼                     already
             DecisionEngine               WorldSimulator            attached
             (+ ActionScorer,             (+ EventEngine)            if built
              GoalSystem, Memory)              │                   via MapEngine)
                    │                         │
                 Decision              WorldStepOutput
             (commitment data)         (mutated* maps)
                    │                         │
                    ▼                         ▼
      syncCommitmentsFromWarlordStates   caller merges mutated*
         (writes GameState.commitments)  back onto its own state
                    │                         │
                    └───────────► GameState (still authoritative;
                                   caller-driven, not Orchestrator-driven)

FUTURE (Orchestrator — NOT implemented in this pass):

PLAYER / AI COMMAND
        ↓
FUTURE ORCHESTRATOR
        ↓
AUTHORITATIVE GAMESTATE
        ↓
ENGINE INPUT   (toDecisionEngineSnapshot / toWorldStepInput / BattleInput / …)
        ↓
ENGINE RESULT  (Decision / WorldStepOutput / BattleResult / …)
        ↓
FUTURE ORCHESTRATOR
        ↓
GAMESTATE UPDATE  (syncCommitmentsFromWarlordStates / merge mutated* / applyBattleResult)
        ↓
NEW AUTHORITATIVE STATE
```

Today, callers (`cli.ts`'s harness, tests) play the role of "the thing
that calls engines and applies results" manually and locally. The
adapters in `src/state/gameStateAdapters.ts` exist so that when the
Orchestrator is actually built, it can call the same functions instead of
each caller re-deriving its own ad hoc view/merge logic.

## 20. Verification

- `npx tsc --noEmit -p tsconfig.json` — PASS (0 errors)
- `npm run build` — PASS
- `npm test` — PASS (106/106: the pre-existing 85 phases-1–8 tests,
  unmodified, plus 21 new GameState tests from this pass)
- `npm run map` — PASS (13/13 formal validation tests, unaffected)
- `npm run dev`, `npm run simulate`, `npm run battles`, `npm run events` —
  PASS (all exit 0; no behavior change to any existing command — this
  pass only adds new, additive types/modules/tests)

## Remaining migration gaps

- `cli.ts`/`eventSimulation.ts` still build their own local
  `GameStateSnapshot`-based state instead of calling `createGameState()`.
  Rewiring them is a natural next step but was intentionally not forced
  in this pass (§17, point 5) to avoid an unrelated, risky rewrite of an
  already-passing harness.
- `WorldSimulator`'s private clone helpers and
  `src/state/cloneGameState.ts`'s clone helpers are functionally
  equivalent but separately implemented (§8). Consolidating them into one
  shared module is a safe, low-risk follow-up, not done here to avoid
  touching `WorldSimulator` in this pass.
- `WarlordState.activeCommitment` vs. `GameState.commitments` remains a
  documented two-copies-in-transition (§11) until the Orchestrator exists
  and becomes the only thing calling `DecisionEngine` + writing the
  result back — at that point the explicit sync calls in
  `gameStateAdapters.ts` are what the Orchestrator will use internally.
- `src/orchestration/` (`AuthoritativeGameState`, `applyBattle.ts`,
  `applyEvents.ts`, `commandIndex.ts`, etc.) remains excluded from the
  `tsc` build and unreconciled with the new `GameState`. That
  reconciliation is explicitly future Orchestrator-phase work.
- No persistence, serialization, or replay format was defined —
  `schemaVersion` exists only as a marker for when that work starts.

## What was intentionally NOT done in this pass

No Orchestrator, Command Router, Command Index, Supabase/persistence
integration, frontend work, continuous-world/real-time simulation, player
fitness engine, or any new gameplay/battle/event/diplomacy/map mechanic
was added. `src/orchestration/` was inspected for context (§1d, §4) but
not modified and remains excluded from the `tsc` build. `DecisionEngine`,
`ActionScorer`, `BattleEngine`, `WorldSimulator`, and `MapEngine`
themselves were not rewritten — only new, additive `src/state/` modules
and `GameState`'s type definition were added, plus adapters that let
existing engines be called from `GameState` without changing their own
signatures.
