import { operationFromSelection } from '../engine/operations';
/**
 * ENGINE INPUT / OUTPUT BOUNDARY ADAPTERS (AUTHORITATIVE RUNTIME GAMESTATE
 * PASS). See docs/AUTHORITATIVE_GAMESTATE_ARCHITECTURE.md, "Engine input
 * boundaries" and "AI commitment integration".
 *
 * These are plain, side-effect-limited functions — NOT an Orchestrator.
 * There is no coordination logic here (no "run all engines this turn",
 * no turn loop, no command routing). Each function does exactly one of:
 *  - derive a narrow, engine-specific read view from `GameState`
 *    (`toDecisionEngineSnapshot`, `toWorldStepInput`), or
 *  - construct/refresh AI-engine runtime wrappers from `GameState`
 *    (`buildWarlordStates`), or
 *  - write an engine's output back onto `GameState`
 *    (`syncCommitmentsFromWarlordStates`).
 *
 * The Orchestrator's handlers use these against their current transaction draft.
 */
import { AICommitment, Army, FactionId, GameStateSnapshot } from '../types';
import { WorldStepInput } from '../events/EventModel';
import { GameState } from '../types/GameState';
import { WarlordState, cloneCommitment } from '../engine/DecisionEngine';

/**
 * Narrow, read-only view of `GameState` shaped for `DecisionEngine`/
 * `ActionScorer`'s existing call boundary. Returns the SAME `Map`
 * references as `state` (not clones). Scoring reads these facts; decision
 * bookkeeping writes faction history and the persisted identity sequence.
 * Authoritative callers must pass their isolated transaction draft.
 * If a future caller needs an isolated view (e.g. a "what-if" preview),
 * clone `state` first with `cloneGameState()` and pass that in instead.
 */
export function toDecisionEngineSnapshot(state: GameState): GameStateSnapshot {
  return {
    canonicalState: state,
    turn: state.turn,
    factions: state.factions,
    territories: state.territories,
    armies: state.armies,
    allFactionIds: state.allFactionIds,
    levelAnchorTerritoryIds: [...state.levelAnchorTerritoryIds],
    attackRestrictions: {
      playerFactionId: state.playerFactionId,
      worldTick: state.playerEmpirePause.paused && state.playerEmpirePause.pausedAtTick !== null
        ? state.playerEmpirePause.pausedAtTick
        : state.worldTick,
      lastPlayerWorkoutCompletedAtTick: state.playerFitness.lastWorkoutCompletedAtTick,
      playerPaused: state.playerEmpirePause.paused,
      attackerRecoveryUntilTick: new Map(
        [...state.attackerCooldowns.entries()]
          .filter(([, c]) => c.recoveryUntilTick !== null)
          .map(([id, c]) => [id, c.recoveryUntilTick as number]),
      ),
      attackerContinuationUntilTick: new Map(
        [...state.attackerCooldowns.entries()]
          .filter(([, c]) => c.continuationUntilTick !== null)
          .map(([id, c]) => [id, c.continuationUntilTick as number]),
      ),
    },
  };
}

/**
 * Narrow, read-only view of `GameState` shaped for
 * `WorldSimulator.simulate()`/`resolveChoice()`'s existing call boundary.
 * Safe to pass live references — `WorldSimulator` already deep-clones
 * territories/factions/activeEvents internally before mutating anything
 * (see `docs/EVENT_ENGINE_CORRECTNESS.md`).
 */
export function toWorldStepInput(state: GameState, armies?: Map<string, Army>): WorldStepInput {
  return {
    turn: state.turn,
    territories: state.territories,
    factions: state.factions,
    armies: armies ?? state.armies,
    activeEvents: state.activeEvents,
    eventHistory: state.eventHistory,
    playerFactionId: state.playerFactionId,
    seed: state.worldSeed,
  };
}

/** Rebuild disposable cognition adapters. No wrapper owns operations or gating. */
export function buildWarlordStates(state: GameState): Map<FactionId, WarlordState> {
  const out = new Map<FactionId, WarlordState>();
  for (const [id, snapshot] of state.factions.entries()) {
    const ws = new WarlordState(snapshot);
    out.set(id, ws);
  }
  return out;
}

/**
 * Rebuild disposable wrappers from the current draft after a clone or world
 * mutation. Sequence/history live on canonical factions, so retaining wrapper
 * objects is neither necessary nor safe. The argument remains for call-site compatibility.
 */
export function rebindWarlordRuntime(
  state: GameState,
  _existing: Map<FactionId, WarlordState>,
): Map<FactionId, WarlordState> {
  return buildWarlordStates(state);
}

/** Register newly selected exact proposals by ID; never overwrite existing
 * operations or delete other faction work from a wrapper's output. */
export function syncCommitmentsFromWarlordStates(
  state: GameState,
  warlordStates: Map<FactionId, WarlordState>,
  factionIds: Iterable<FactionId> = warlordStates.keys(),
): void {
  for (const id of factionIds) {
    const ws = warlordStates.get(id);
    if (!ws) continue;
    const commitment: AICommitment | null = ws.activeCommitment;
    if (commitment && !state.operations.has(commitment.id)) {
      state.operations.set(commitment.id, operationFromSelection(commitment, state.worldTick));
    }
  }
}
