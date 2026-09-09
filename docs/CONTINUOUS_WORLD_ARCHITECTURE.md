# Continuous World Architecture (Phase 13)

Phase 13 adds a **simulation/runtime coordinator** that advances AI
commitments and world events over deterministic simulation time. It is
not a new AI, battle, map, or event engine.

```
GameState
   ↓
Continuous World Engine
   ↓
AI commitment lifecycle / Event Engine / world effects
   ↓
Orchestrator (ADVANCE_WORLD)
   ↓
mutated authoritative GameState
```

Player commands (`ATTACK`, `MOVE`, `BUILD`, …) remain **immediate**.
The world is **not** globally turn-based for the player. There are no
player-facing wait timers and no wall-clock (`Date.now()`) simulation.

---

## Purpose

- Advance canonical world time in small, requested simulation steps.
- Let AI factions hold and progress one commitment at a time.
- Resolve ready commitments through the **existing** Orchestrator path
  (`AI_DECIDE` / `RESOLVE_COMMITMENT` handlers) — not a second executor.
- Step the existing Event Engine and merge results onto `GameState`.
- Return an inspectable `WorldAdvanceResult`.

The Continuous World Engine **must not**:

- contain personality or action-scoring logic
- calculate battles or fitness
- generate maps
- own economy/resource rules
- punish a player for being offline

---

## World time

`GameState` now carries:

| Field | Role |
| --- | --- |
| `worldTick` | Canonical continuous simulation time. Integer, starts at `0`. Elapsed simulation time from start **is** this value. |
| `turn` | EventEngine / DecisionEngine integer clock (pre-existing). |
| `worldSeed` | Root seed for forked RNGs (pre-existing). |
| `lastAiDecisionTick` | Per-faction tick of last `AI_DECIDE` or commitment resolution (cadence). |

Advancement is deterministic: identical `GameState` + `worldSeed` +
elapsed ticks + prior commands ⇒ equivalent state and results.

`Date.now()`, `Math.random()`, and wall-clock delays are not used.

### Tick → turn adapter (temporary)

`WorldSimulator` is still **turn-based**. Conversion:

```
BALANCE.world.ticksPerEventTurn   // currently 1
every N world ticks:
  GameState.turn += 1
  WorldSimulator.simulate(toWorldStepInput(state))
  mergeEventStepOntoGameState(...)
```

**This is an adapter, not a redesign of the Event Engine.** When
`ticksPerEventTurn === 1`, one world tick equals one event turn. If that
ratio changes later, event timing still goes through this single
conversion site (`ContinuousWorldEngine` + `runEventEngineTurn`).

---

## Simulation step

`ADVANCE_WORLD` parameters:

- `elapsedTicks` (alias `ticks`): non-negative integer, default `1`
- rejected if non-integer, negative, non-finite, or `> BALANCE.world.maxElapsedTicksPerAdvance`

Zero elapsed time is a no-op (state unchanged).

Each tick, in order:

1. `worldTick += 1`
2. If the tick completes an event-turn bucket, run one EventEngine turn
3. Progress in-flight army marches (`progressArmyMovements`, army-id order);
   complete/interrupt linked MOVE/RETREAT commitments. First invalidate
   stale strategic-attack intents whose target/staging is no longer legal.
4. Stationary armies with a pending strategic attack intent (army-id
   order) resolve through `host.executePendingAttack` — not a second
   battle implementation
5. For each **non-player** AI faction, **sorted by faction id**:
   - MOVE/RETREAT with an army still in transit → **do not** `AI_DECIDE` or re-resolve
   - ATTACK with status `executing` (including a staging march) → **do not** `AI_DECIDE` or re-resolve
   - other active commitment → stamp/progress timing; resolve if ready (or unsupported)
   - else if reassessment cadence allows → `AI_DECIDE`; stamp duration; resolve immediately if duration is `0` or the action is unsupported
6. Fail orphan `executing` MOVE/RETREAT/ATTACK commitments with no remaining march or attack intent

Player factions are skipped for AI decide/resolve. Their `MOVE` commands
stay on the normal Orchestrator path; CWE still advances their armies.

---

## AI commitment lifecycle

Uses the Phase 8/12 model (`pending|committed|executing|completed|interrupted|failed`).

| Situation | Continuous engine behavior |
| --- | --- |
| No active commitment + cadence elapsed | `AI_DECIDE` (existing handler / DecisionEngine) |
| Active commitment | **Do not** call `AI_DECIDE`. Progress timing. |
| Ready to execute (`worldTick >= startedAtTick + durationTicks`) | `RESOLVE_COMMITMENT` (Phase 12 shared domain ops) |
| Completed / failed / interrupted | Terminal. Eligible to reassess after cadence |
| TRADE / OFFER_PEACE | Failed via existing handler; **cannot stay active** |

### Commitment timing (provisional)

New optional fields on `AICommitment`:

- `startedAtTick`
- `durationTicks`
- `completionCondition: 'duration_elapsed'`

Placeholder durations live in `BALANCE.world.commitmentDurationTicks`.
They are **not** army travel formulas. Adjacent-hop travel is
`calculateMovementDuration` / `BALANCE.movement` (see
`docs/ARMY_MOVEMENT_ARCHITECTURE.md`).

| Action | Duration (ticks) | Notes |
| --- | --- | --- |
| ATTACK | 0 | Immediately resolvable when execution is reached |
| BUILD, REINFORCE, EXPAND, SCOUT, NEGOTIATE, DECLARE_WAR | 0 | Immediate when ready |
| TRADE, OFFER_PEACE | 0 | Fail immediately; never left active |
| WAIT, DEFEND | 1 | Minimal duration so timing infrastructure exists |
| MOVE, RETREAT | 0 | Resolve **starts** the march immediately; arrival is army `durationTicks` |

### AI decision cadence

`BALANCE.world.reassessmentIntervalTicks` (currently `2`):

1. Faction decides (and maybe resolves) at tick T
2. `lastAiDecisionTick[faction] = T`
3. Next `AI_DECIDE` only when `worldTick >= T + interval`

This avoids ATTACK→ATTACK loops just because the sim steps often.

---

## Event integration

- Existing Event Engine remains authoritative (`WorldSimulator`,
  definitions, consequences, `eventHistory`).
- The continuous layer only **schedules** `simulate()` via the tick→turn
  adapter and merges onto `GameState` with `mergeEventStepOntoGameState`.
- Results are recorded in `WorldAdvanceResult.eventResults` and
  `GameState.eventHistory`.

No duplicated trigger/effect logic.

---

## Orchestrator relationship

`ADVANCE_WORLD` is the application command boundary:

1. Validate `elapsedTicks`
2. `runStateTransaction`: clone `GameState`
3. `ContinuousWorldEngine.advance` on the draft, calling existing
   `handleAiDecide` / `handleResolveCommitment` / EventEngine step
4. `checkGameStateInvariants`
5. Commit atomically, or discard the draft on throw

The engine does **not** nest `Orchestrator.execute()` (that would clone
again). It uses the same handlers on the transaction draft.

Response payload includes `worldAdvance` (`WorldAdvanceResult`) plus
`worldTick` / `turn`. Internal runtime (`WarlordState`, RNG objects) is
not exposed.

`WorldAdvanceResult`:

- `previousWorldTime` / `newWorldTime` (`worldTick` + `turn`)
- `aiDecisions[]`
- `commitmentProgress[]`
- `commitmentResolutions[]`
- `eventResults[]`
- `movementResults[]`
- `stateChanges[]`
- `notifications[]`
- `errors[]`

Per-faction domain failures (e.g. TRADE) are recorded on the result and
**do not** abort the whole world step. Unexpected engine absence or
invariant failure rolls back the entire `ADVANCE_WORLD`.

---

## Deterministic simulation

- Sorted faction iteration
- Seeded `DecisionEngine` / `WorldSimulator` (existing)
- Battle seeds still `deriveBattleSeed(worldSeed, turn, …)`
- No hidden mutable module state in `src/world/`
- `N` ticks in one command ≡ `N` successive 1-tick commands from the
  same Orchestrator instance (same RNG stream)

---

## Player safety / fairness

This phase only establishes **elapsed-time simulation infrastructure**.

Intentionally **not** implemented:

- Different online vs offline simulation rates (constants exist as
  `BALANCE.world.onlineSimulationRate` / `offlineSimulationRate` but
  are unused)
- Empire destruction while offline
- Offline attack spam (cadence + one commitment at a time)
- Permanent fitness loss / forced workouts
- Artificial shields
- Wall-clock catch-up (`WORLD.CATCH_UP`)

---

## What is provisional

- Non-MOVE commitment durations (placeholders, not travel math)
- `ticksPerEventTurn === 1` adapter
- Reassessment interval value (`2`)
- Online/offline rate fields (unused)
- Adjacent-only movement (no multi-hop pathfinding)

---

## Intentionally NOT implemented

- Persistence / Supabase
- Frontend
- Fitness / workout engine
- Cities
- TRADE / OFFER_PEACE gameplay (still fail closed)
- Redesign of BattleEngine, MapEngine, DecisionEngine, EventEngine
- Elaborate army travel (multi-hop pathfinding, supply, recruitment)
- Globally turn-based player game
- Artificial player wait timers

---

## Files

| File | Role |
| --- | --- |
| `src/world/ContinuousWorldEngine.ts` | Coordinator |
| `src/world/worldTime.ts` | Elapsed-tick parse, provisional durations |
| `src/world/eventTick.ts` | One EventEngine turn (adapter target) |
| `src/orchestration/handlers.ts` | `handleAdvanceWorld` |
| `src/types/GameState.ts` | `worldTick`, `lastAiDecisionTick` |

CLI: `npm run simulate -- --world --turns=8 --seed=42` drives
`ADVANCE_WORLD` through the Orchestrator. It is a demo, not a second
authority. Existing `--map` / `--battles` / default decision harness
are unchanged.
