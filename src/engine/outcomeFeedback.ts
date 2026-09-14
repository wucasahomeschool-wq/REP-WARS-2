/**
 * AI RUNTIME INTEGRATION PASS — minimal goal-progress + memory outcome
 * feedback, wired to the single existing terminal-commitment boundary
 * (`handleResolveCommitment`'s immediate completion/failure, and
 * `applyCommitmentTerminal`'s movement/attack-arrival completion/failure
 * in `src/orchestration/handlers.ts`). Both call this one function so
 * there is exactly one place goal/memory feedback happens, not two
 * slightly-different copies.
 *
 * IMPORTANT: this mutates the CANONICAL `GameState` draft directly
 * (`state.factions.get(factionId)`), the same pattern every other
 * handler already uses via `requireFactionSnapshot(state, id)` /
 * `pushMemory(snapshot, ...)`. It deliberately does NOT go through
 * `WarlordState.goals` (the `GoalSystem` instance built at
 * `buildWarlordStates`/`rebindWarlordRuntime` time): that wrapper is
 * rebound to a faction snapshot from the state *before* the current
 * transaction's clone (see `runStateTransaction` — handlers run against
 * a fresh `cloneGameState()` draft, and `WarlordState.snapshot` is only
 * re-pointed to the new draft AFTER the handler returns, in
 * `Orchestrator.execute`). Mutating `ws.goals` here would land on a
 * soon-to-be-discarded object and never reach the committed `GameState`,
 * the same class of bug `GameState.commitments`'s doc comment warns
 * about for `AICommitment` (solved there by the explicit
 * `syncCommitmentsFromWarlordStates` bridge). Goals have no such second
 * copy to begin with — `WarlordSnapshot.goals` IS the canonical store —
 * so the fix is simply to mutate it directly, not through the AI
 * engine's transient wrapper.
 *
 * Deliberately NOT a planning system: this only nudges the ALREADY
 * ASSIGNED `commitment.originatingGoalId` (set at decision time by
 * `DecisionEngine.originatingGoalId`, itself derived from
 * `GoalSystem.evaluateActionAlignment`) forward on success. It invents no
 * new goal-selection logic and does not penalize goal progress on
 * failure — a failed attempt should not count as movement toward OR away
 * from a goal, it just didn't happen.
 */
import { AICommitment, ActionType, FactionId } from '../types';
import { GameState } from '../types/GameState';
import { pushMemory } from '../orchestration/helpers';

/**
 * How much a successful commitment of this action type advances its
 * `originatingGoalId`. Deliberately coarse/flat — this is bookkeeping so
 * goals are not purely decorative, not a scored planning system. Actions
 * with no entry (WAIT/RETREAT/etc.) simply do not move goal
 * progress; that is a documented, intentional omission, not a gap — see
 * `GoalSystem.checkAlignment` for which actions each goal type can even
 * align with.
 */
const GOAL_PROGRESS_ON_SUCCESS: Partial<Record<ActionType, number>> = {
  ATTACK: 15,
  DECLARE_WAR: 8,
  NEGOTIATE: 6,
  DEFEND: 5,
  REINFORCE: 4,
  BUILD: 4,
};

/** Failed actions worth a lightweight, self-referential memory entry. */
const MEMORY_ON_FAILURE: ReadonlySet<ActionType> = new Set(['ATTACK', 'MOVE', 'RETREAT']);

export type CommitmentOutcomeKind = 'completed' | 'failed' | 'interrupted';

/**
 * Call once per commitment reaching a terminal state, against the
 * CURRENT transaction draft (`state`) and the commitment as it was at
 * termination (action/targetId/originatingGoalId do not change during
 * termination, so callers may pass either the pre- or post-transition
 * object). No-ops quietly if the faction no longer exists (e.g. it was
 * removed by an event in the same tick) — this is best-effort feedback,
 * not a source of new failures.
 */
export function applyCommitmentOutcomeFeedback(
  state: GameState,
  factionId: FactionId,
  commitment: AICommitment,
  outcome: CommitmentOutcomeKind,
): void {
  const snapshot = state.factions.get(factionId);
  if (!snapshot) return;
  if (outcome === 'completed' && commitment.originatingGoalId) {
    const delta = GOAL_PROGRESS_ON_SUCCESS[commitment.action];
    if (delta) {
      const goal = snapshot.goals.find((g) => g.id === commitment.originatingGoalId);
      if (goal) {
        goal.progress = Math.max(0, Math.min(goal.targetProgress, goal.progress + delta));
      }
    }
  }
  if (outcome !== 'completed' && MEMORY_ON_FAILURE.has(commitment.action)) {
    pushMemory(snapshot, state.turn, 'action_failed', null, commitment.targetId, 3, {
      action: commitment.action,
      outcome,
      statusReason: commitment.statusReason,
    });
  }
}
