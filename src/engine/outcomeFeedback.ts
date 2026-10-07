/** Canonical outcome feedback called only by the idempotent operation terminal reducer.
 * Existing goal/memory algorithms and amounts remain unchanged. */
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
