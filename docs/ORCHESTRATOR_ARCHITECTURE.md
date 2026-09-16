# Orchestrator architecture (Phase 10)

> **Current:** Production `GameState` is initialized from authored
> `WorldDefinition` via `WorldCatalog`. MapEngine is unavailable in
> `EngineRegistry`. `SCOUT` and `EXPAND` are not catalog commands.
> Workout/fitness, economy, invasions, persistence/sync, pause, and
> gameplay telemetry are routed through this same Orchestrator.

The Orchestrator is the authoritative command-routing and mutation
boundary on top of canonical `GameState`. Phase 13 routes
`ADVANCE_WORLD` through the Continuous World Engine (see
`docs/CONTINUOUS_WORLD_ARCHITECTURE.md`).

**Level 1** is `worlds/level-1.json`. A tutorial controller is not in the
command catalog. `GET_WORLD_DEFINITION` returns polygons;
`GET_FITNESS_CATALOG` returns prescribed workouts and purpose selections;
`GET_WORKOUT_SELECTION` is the authoritative purpose → workout prescription.

## Principle

**The Orchestrator coordinates. The engines calculate. `GameState` is authoritative.**
Analytics observes committed results. Analytics never decides success.

```
CommandRequest
      ↓
validate command + parameters + authorization
      ↓
route to handler (`READ_ONLY_HANDLERS` / `MUTATING_HANDLERS` / `SYNC_PLAYER_WORLD`)
      ↓
mutating: clone → handler/engine → checkGameStateInvariants → commit
      ↓
CommandResponse
      ↓
IsolatedTelemetryRecorder (best-effort; cannot fail gameplay)
```

Persistence is a **sibling** of `execute()`, not an inner step of it.
Callers persist with `commitAuthoritativePlayerWorld` / `syncPlayerWorld`
after a command. Offline catch-up uses the same `handleAdvanceWorld` path
inside `catchUpWorld`.

## Command contract

**Input — `CommandRequest`** (`src/orchestration/protocol.ts`):

- `commandId`, `playerId`, optional `timestamp`, `parameters`, `clientContext`, `requestId`
- `requestId` is a **correlation** id for responses and telemetry. It is not a global execution ledger. Domain idempotency uses `applicationId` / `sessionId` / invasion identity / construction status.

**Output — `CommandResponse`**:

- `success`, `commandId`, `requestId`, `playerId`
- `stateChanges`, `events`, `notifications`, `presentation`
- `resourcesChanged`, `territoriesChanged`, `armiesChanged`, `newlyAvailableActions`
- `errors`, `payload`

`success: false` with handler `commandSuccess: false` still **commits** the transaction. That is used for bookkeeping failures (failed AI commitment, pending workout reward). Thrown `OrchestrationError` rolls back.

Acting faction resolution: `parameters.factionId` → else `GameState.playerFactionId` → else error. Player commands cannot impersonate another faction. `AI` / `WORLD` / `SYSTEM` categories skip that gate.

## Command catalog (`COMMAND_INDEX`)

Machine-readable entries in `src/orchestration/commandIndex.ts`. Handlers live in `src/orchestration/handlers.ts` and `gameplayCommands.ts`. `SYNC_PLAYER_WORLD` is wired in `orchestrator.ts`.

### Implemented

| Command | Routes to | Mutates state |
| --- | --- | --- |
| `GET_COMMAND_INDEX` | orchestrator | no |
| `GET_GAME_STATE` | state (cloned public view; includes `worldCompletion`, `playerGameplay.activeWorkout`, anchors, invasions) | no |
| `GET_VISIBLE_WORLD` | state (full current-world view; no tile fog; no polygons) | no |
| `GET_WORLD_DEFINITION` | authored WorldDefinition including polygons | no |
| `GET_FITNESS_CATALOG` | workout/exercise catalog plus purpose → selectedWorkoutId | no |
| `GET_WORKOUT_SELECTION` | authoritative selected workout + prescribed snapshot for a purpose | no |
| `ATTACK` | BattleEngine / invasion hold / banked-troop commit | yes |
| `MOVE` | army movement | yes |
| `BUILD` | fortify an existing city | yes |
| `REINFORCE` | garrison spend | yes |
| `DECLARE_WAR` | relationship → `at_war` | yes |
| `NEGOTIATE` | opinion bump | yes |
| `SYNC_PLAYER_WORLD` | catch-up via `ADVANCE_WORLD` chunks + time authority | yes |
| `ADVANCE_WORLD` | ContinuousWorldEngine → AI / events / economy | yes |
| `AI_DECIDE` | DecisionEngine → commitments | yes |
| `RESOLVE_COMMITMENT` | shared domain ops (including strategic RETREAT) | yes |
| `START_CONSTRUCTION` | CITY or FORTIFICATION | yes |
| `APPLY_CONSTRUCTION_ACCELERATION` | consume Extra Construction Workers | yes |
| `COLLECT_RESOURCES` | territory yield; optional Golden Yield | yes |
| `SET_PLAYER_PAUSE` | player empire pause | yes |
| `START_WORKOUT` | WorkoutSession (workoutId optional; defaults to selection) | yes |
| `RECORD_EXERCISE` | session performance | yes |
| `SKIP_REST` | skip REST step | yes |
| `SUBMIT_WORKOUT_FEEDBACK` | required feedback | yes |
| `FINALIZE_WORKOUT` | fitness → PhysicalResult → GameRewardResult → applyGameReward | yes |
| `ABANDON_WORKOUT` | abandon; DEFENSE resolves invasion as failed | yes |
| `RECORD_INTEGRITY_FLAG` | integrity flag; second flag abandons | yes |

### Intentionally unsupported (`FEATURE_NOT_IMPLEMENTED`)

| Command | Reason |
| --- | --- |
| `OFFER_PEACE` | Current model does not transition war state |
| `TRADE` | Current model does not exchange resources |

Commitment `RETREAT` is **not** a catalog command. It executes only through `RESOLVE_COMMITMENT`. `SCOUT` and `EXPAND` are not production commands.

Production geography is an authored `WorldDefinition` (`docs/WORLD_DEFINITION.md`). `SAMPLE_MAP` / MapEngine are legacy test fixtures only.

## Responsibilities

| Layer | Owns |
| --- | --- |
| **GameState** | Territories, armies, factions, resources, diplomacy, events, commitments, authored-world identity, rewards, invasions, constructions, fitness compact state |
| **BattleEngine** | Battle math, `BattleResult` |
| **WorldSimulator** | Event step output (`WorldStepOutput`) |
| **DecisionEngine** | AI scoring, commitment lifecycle calculation |
| **WorldDefinition** | Immutable authored geometry, regions, starting owners, AI personalities |
| **Orchestrator** | Validation, routing, transaction, applying engine results, invariant gate, response packaging |
| **Handlers** | Per-command glue — no battle formulas, no event generation logic |
| **Persistence** | Envelope save/load/sync; not a second world authority |
| **Telemetry** | Append-only observation of committed commands |

## State mutation boundary

Mutating commands use `runStateTransaction()` (`src/orchestration/transaction.ts`):

1. `cloneGameState(original)`
2. Handler mutates the clone and calls engines
3. `checkGameStateInvariants(clone)` — failure throws, original unchanged
4. Clone becomes the new authoritative state

Read-only commands never enter the transaction path. `GET_*` handlers serialize from `cloneGameState()` internally where needed.

Intentional non-`execute()` mutations:

- `createGameState` / `initializePlayerWorld` / `ensurePlayerWorld` (boot;
  `ensurePlayerWorld` is the persisted load-or-create-once path.
  See `docs/PLAYER_IDENTITY.md`)
- `syncPlayerWorld` catch-up (clones, runs `catchUpWorld` → `handleAdvanceWorld`, then invariants + save)
- Domain helpers invoked **from** handlers (`applyGameReward` uses a nested transaction)
- CLI/MapEngine demos and tests (not production command path)

No second `WorldState`, no parallel faction/territory/army collections.

## Error contract

Uses `ErrorCode` in `src/orchestration/errors.ts`.

Unsupported commands **never return `success: true`.**

## Determinism

- Battle seeds: `deriveBattleSeed(worldSeed, turn, attacker, defender, territory)`
- Optional `parameters.seed` on `ATTACK`
- `AI_DECIDE` uses `GameState.worldSeed` and integer `turn`
- `ADVANCE_WORLD` advances `worldTick`
- No `Math.random()` or `Date.now()` in gameplay paths (session `now` is a caller-supplied session clock)

## What remains intentionally NOT implemented

- Live Supabase network adapter (DDL/mapper contract only)
- Frontend / WebSocket API
- Workout pause/resume **commands** (session domain has PAUSED; no catalog command yet)
- `OFFER_PEACE` / `TRADE` gameplay
- `requestId` as a durable exactly-once execution log

## Entry point

```typescript
import { createGameState } from './state';
import { Orchestrator } from './orchestration';

const orch = new Orchestrator(createGameState({ seed: 42 }));
const res = orch.execute({
  commandId: 'ATTACK',
  playerId: 'player_1',
  parameters: { territoryId: 't_02', commitAmount: 120 },
});
```

See `tests/run.ts` orchestrator suites and `tests/orchestratorIntegration.ts`.

Player and AI share domain engines (BattleEngine, WorldSimulator).
AI-only reasoning stays in DecisionEngine. See
`docs/PLAYER_AI_INTERACTION_ARCHITECTURE.md` and
`docs/AI_COMMITMENT_EXECUTION.md`.
