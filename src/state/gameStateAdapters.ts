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
 * A future Orchestrator will call these (or something like them) as part
 * of a real turn loop; that loop itself is intentionally not built here.
 */
import { AICommitment, Army, FactionId, GameStateSnapshot } from '../types';
import { WorldStepInput } from '../events/EventModel';
import { GameState } from '../types/GameState';
import { WarlordState, cloneCommitment } from '../engine/DecisionEngine';

/**
 * Narrow, read-only view of `GameState` shaped for `DecisionEngine`/
 * `ActionScorer`'s existing call boundary. Returns the SAME `Map`
 * references as `state` (not clones) — `DecisionEngine`/`ActionScorer`
 * are documented (and tested — see "AI decide/commitment does not mutate
 * world state" in tests/run.ts) to only read this data, never mutate it.
 * If a future caller needs an isolated view (e.g. a "what-if" preview),
 * clone `state` first with `cloneGameState()` and pass that in instead.
 */
export function toDecisionEngineSnapshot(state: GameState): GameStateSnapshot {
  return {
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
 * Point existing `WarlordState` wrappers at a draft `GameState` after clone
 * or after EventEngine replaces faction objects. Preserves `commitmentSeq`
 * on the wrapper so IDs stay unique across ticks in one ADVANCE_WORLD.
 */
export function rebindWarlordRuntime(
  state: GameState,
  existing: Map<FactionId, WarlordState>,
): Map<FactionId, WarlordState> {
  if (existing.size === 0) {
    return buildWarlordStates(state);
  }
  for (const id of state.allFactionIds) {
    const snap = state.factions.get(id);
    if (!snap) continue;
    const ws = existing.get(id);
    if (!ws) {
      const created = new WarlordState(snap);
      const c = state.commitments.get(id);
      created.activeCommitment = c ? cloneCommitment(c) : null;
      existing.set(id, created);
    } else {
      ws.snapshot = snap;
      const c = state.commitments.get(id);
      ws.activeCommitment = c ? c : null;
    }
  }
  return existing;
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
): void {
  for (const [id, ws] of warlordStates.entries()) {
    const commitment: AICommitment | null = ws.activeCommitment;
    state.commitments.set(id, commitment ? cloneCommitment(commitment) : null);
  }
}
