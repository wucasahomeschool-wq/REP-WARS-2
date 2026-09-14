# Orchestrator architecture (Phase 10)

Phase 10 introduces the first real orchestration layer on top of Phase 9
authoritative `GameState`. Phase 13 routes `ADVANCE_WORLD` through the
Continuous World Engine (see `docs/CONTINUOUS_WORLD_ARCHITECTURE.md`).
**No persistence, frontend, workout/fitness engine, or Supabase integration
was built.**

## Principle

**The Orchestrator coordinates. The engines calculate. `GameState` is authoritative.**

```
CommandRequest
      ↓
validate command + parameters
      ↓
route to handler
      ↓
handler reads GameState (or clone for mutating commands)
      ↓
engine calculation (BattleEngine / WorldSimulator / DecisionEngine / MapEngine)
      ↓
apply result onto GameState draft
      ↓
checkGameStateInvariants()
      ↓
commit draft → authoritative GameState
      ↓
CommandResponse
```

## Reconciliation with old `src/orchestration/` draft

| Artifact | Fate |
| --- | --- |
| Phase 9 `GameState` (`src/types/GameState.ts`) | **Authoritative** — sole runtime world |
| Old `AuthoritativeGameState` (`gameState.ts`) | **Deprecated** — type alias to `GameState` only; wall-clock fields removed |
| Old 100+ command frontend catalog | **Replaced** by focused Phase 10 catalog (`commandIndex.ts`, ~16 commands) |
| `applyBattle.ts` / `applyEvents.ts` / `publicView.ts` | **Adapted** to operate on `GameState`, not the old draft |
| `engineRegistry.ts` | **Reused** — registers Battle/AI/Event/Map engines |
| Workout/fitness commands | **Not implemented** — fitness port remains optional stub |

## Command contract

**Input — `CommandRequest`** (`src/orchestration/protocol.ts`):

- `commandId`, `playerId`, optional `timestamp`, `parameters`, `clientContext`, `requestId`

**Output — `CommandResponse`**:

- `success`, `commandId`, `requestId`, `playerId`
- `stateChanges`, `events`, `notifications`, `presentation`
- `resourcesChanged`, `territoriesChanged`, `armiesChanged`, `newlyAvailableActions`
- `errors`, `payload`

Acting faction resolution: `parameters.factionId` → else `GameState.playerFactionId` → else error.

## Command catalog (`COMMAND_INDEX`)

Machine-readable entries in `src/orchestration/commandIndex.ts`. Each entry includes category, description, parameters, validation notes, `routesTo`, `changesState`, sync/async classification, `status` (`implemented` | `unsupported`), and possible errors.

### Implemented in Phase 10

| Command | Routes to | Mutates state |
| --- | --- | --- |
| `GET_COMMAND_INDEX` | orchestrator | no |
| `GET_GAME_STATE` | state (cloned public view) | no |
| `GET_VISIBLE_WORLD` | state (full current-world view; no tile fog) | no |
| `ATTACK` | BattleEngine → applyBattle | yes |
| `MOVE` | state (adjacent army move) | yes |
| `BUILD` | state (fortify an existing city) | yes |
| `REINFORCE` | state (`BALANCE.economy.reinforcementCost`) | yes |
| `START_CONSTRUCTION` | state (`CITY` or `FORTIFICATION`) | yes |
| `DECLARE_WAR` | state (relationship → `at_war`) | yes |
| `NEGOTIATE` | state (small opinion bump) | yes |
| `ADVANCE_WORLD` | ContinuousWorldEngine → AI_DECIDE / RESOLVE_COMMITMENT / WorldSimulator | yes |
| `AI_DECIDE` | DecisionEngine → sync commitments | yes (commitments only) |
| `RESOLVE_COMMITMENT` | handler delegates to ATTACK/BUILD/… | yes |

### Intentionally unsupported (`FEATURE_NOT_IMPLEMENTED`)

| Command | Reason |
| --- | --- |
| `OFFER_PEACE` | Current model records offers in memory but does not transition war state |
| `TRADE` | Current model adjusts opinion/memory but does not exchange resources |

Commitment actions `RETREAT` and `MOVE` are executable through `RESOLVE_COMMITMENT` (see `docs/AI_COMMITMENT_EXECUTION.md`). `SCOUT` and `EXPAND` are not production commands. Unsupported catalog entries (`TRADE`, `OFFER_PEACE`) still fail with `FEATURE_NOT_IMPLEMENTED`.

Production geography is an authored `WorldDefinition` (`docs/WORLD_DEFINITION.md`). `SAMPLE_MAP` / MapEngine are legacy test fixtures only.

## Responsibilities

| Layer | Owns |
| --- | --- |
| **GameState** | Territories, armies, factions, resources, diplomacy, events, commitments, authored-world identity |
| **BattleEngine** | Battle math, `BattleResult` |
| **WorldSimulator** | Event step output (`WorldStepOutput`) |
| **DecisionEngine** | AI scoring, commitment lifecycle calculation |
| **WorldDefinition** | Immutable authored geometry, regions, starting owners, AI personalities |
| **Orchestrator** | Validation, routing, transaction, applying engine results, invariant gate, response packaging |
| **Handlers** | Per-command glue — no battle formulas, no event generation logic |

## State mutation boundary

Mutating commands use `runStateTransaction()` (`src/orchestration/transaction.ts`):

1. `cloneGameState(original)`
2. Handler mutates the clone and calls engines
3. `checkGameStateInvariants(clone)` — failure throws, original unchanged
4. Clone becomes the new authoritative state

Read-only commands never enter the transaction path. `GET_*` handlers serialize from `cloneGameState()` internally where needed.

No second `WorldState`, no parallel faction/territory/army collections.

## Error contract

Uses `ErrorCode` in `src/orchestration/errors.ts`, including:

`INVALID_COMMAND`, `MISSING_PARAMETER`, `INVALID_TARGET`, `INSUFFICIENT_RESOURCES`, `INSUFFICIENT_TROOPS`, `INVALID_TERRITORY`, `ACTION_NOT_ALLOWED`, `ENGINE_UNAVAILABLE`, `ENGINE_ERROR`, `INVALID_GAME_STATE`, `FEATURE_NOT_IMPLEMENTED`

Unsupported commands **never return `success: true`.**

## Determinism

- Battle seeds: `deriveBattleSeed(worldSeed, turn, attacker, defender, territory)` (same as CLI harness)
- Optional `parameters.seed` on `ATTACK`
- `AI_DECIDE` uses `GameState.worldSeed` and integer `turn`
- `ADVANCE_WORLD` advances `worldTick` (and `turn` via the EventEngine adapter); uses `worldSeed` for events/battles
- No `Math.random()` or `Date.now()` in gameplay paths (trace/debug only)

## What remains intentionally NOT implemented

- Supabase / persistence / replay save files
- Frontend / WebSocket API
- Continuous 24/7 wall-clock timers, offline catch-up rates, `WORLD.CATCH_UP`
  (Phase 13 added **simulation ticks** / `ADVANCE_WORLD` elapsed-time
  infrastructure only — see `docs/CONTINUOUS_WORLD_ARCHITECTURE.md`)
- Player fitness / workout processing
- Full old frontend command surface (100+ commands)
- `cli.ts` rewiring to Orchestrator (CLI remains a separate harness)
- New battle/event/diplomacy/map mechanics

## Entry point

```typescript
import { createGameState } from './state';
import { Orchestrator } from './orchestration';

const orch = new Orchestrator(createGameState({ seed: 42, playerFactionId: 'merchant_republic' }));
const res = orch.execute({
  commandId: 'ATTACK',
  playerId: 'player_1',
  parameters: { territoryId: 'central_plains' },
});
```

See `tests/run.ts` — "Orchestrator foundation" and "Player/AI interaction architecture".

Player and AI share domain engines (BattleEngine, WorldSimulator, MapEngine).
AI-only reasoning stays in DecisionEngine. See
`docs/PLAYER_AI_INTERACTION_ARCHITECTURE.md` and
`docs/AI_COMMITMENT_EXECUTION.md`.
