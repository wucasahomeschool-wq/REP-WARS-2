/** Canonical outcome feedback called only by the idempotent operation terminal reducer.
 * Memory remains history; explicit Goal predicates own completion. */
import { AICommitment, ActionType, FactionId } from '../types';
import { GameState } from '../types/GameState';
import { pushMemory } from '../orchestration/helpers';

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
  // Goals are reconciled from achieved canonical facts, never flat action rewards.
  if (outcome !== 'completed' && MEMORY_ON_FAILURE.has(commitment.action)) {
    pushMemory(snapshot, state.turn, 'action_failed', null, commitment.targetId, 3, {
      action: commitment.action,
      outcome,
      statusReason: commitment.statusReason,
    });
  }
}
