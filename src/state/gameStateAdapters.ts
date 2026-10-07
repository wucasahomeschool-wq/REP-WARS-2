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

/**
 * Builds fresh `WarlordState` runtime wrappers (memory/goals engines +
 * AI-owned `activeCommitment`) from `GameState.factions`, seeding each
 * wrapper's `activeCommitment` from `GameState.commitments` so a rebuilt
 * `WarlordState` (e.g. after a process restart, or in a fresh test) picks
 * up mid-flight where the canonical state left off, instead of starting
 * every faction back at "no commitment".
 *
 * `WarlordState` itself is an AI-engine runtime object (holds live
 * `MemorySystem`/`GoalSystem` instances), not canonical state — see
 * `GameState.commitments`'s doc comment for why this is a documented,
 * explicit sync boundary rather than `GameState` holding `WarlordState`
 * instances directly.
 */
export function buildWarlordStates(state: GameState): Map<FactionId, WarlordState> {
  const out = new Map<FactionId, WarlordState>();
  for (const [id, snapshot] of state.factions.entries()) {
    const ws = new WarlordState(snapshot);
    const commitment = state.commitments.get(id);
    ws.activeCommitment = commitment ? cloneCommitment(commitment) : null;
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

/**
 * Writes each `WarlordState.activeCommitment` back onto
 * `state.commitments`, cloning so `GameState` never shares a mutable
 * `AICommitment` reference with a `WarlordState` that keeps reasoning
 * about it turn over turn. Call this after `DecisionEngine.decide()`/
 * `decideAll()` to keep the canonical `GameState.commitments` current.
 * Mutates `state.commitments` in place; does not touch anything else on
 * `state`.
 */
export function syncCommitmentsFromWarlordStates(
  state: GameState,
  warlordStates: Map<FactionId, WarlordState>,
  factionIds: Iterable<FactionId> = warlordStates.keys(),
): void {
  for (const id of factionIds) {
    const ws = warlordStates.get(id);
    if (!ws) continue;
    const commitment: AICommitment | null = ws.activeCommitment;
    state.commitments.set(id, commitment ? cloneCommitment(commitment) : null);
  }
}
