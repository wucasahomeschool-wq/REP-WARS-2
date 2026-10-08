import type { GameState } from '../types/GameState';
import { canReassessFaction } from '../world/worldTime';

export function decisionOpportunityRejection(state: GameState, factionId: string): 'SAME_BOUNDARY' | 'PRIMARY_BUSY' | 'LEGACY_PACING' | null {
  const opportunity = state.aiDecisionOpportunities.get(factionId);
  if (opportunity?.primaryOperationId != null) return 'PRIMARY_BUSY';
  if (opportunity?.lastBoundaryTick === state.worldTick) return 'SAME_BOUNDARY';
  return canReassessFaction(state.lastAiDecisionTick.get(factionId),state.worldTick) ? null : 'LEGACY_PACING';
}
/** The Orchestrator's cloned transaction/CAS serializes this primary thread.
 * Boundary identity is [exact faction ID, canonical worldTick], never wall time.
 */
export function beginDecisionOpportunity(state: GameState, factionId: string): boolean {
  if (decisionOpportunityRejection(state, factionId)) return false;
  state.aiDecisionOpportunities.set(factionId, { lastBoundaryTick: state.worldTick, primaryOperationId: null });
  return true;
}
export function attachDecisionInitiation(state: GameState, factionId: string, operationId: string): void {
  state.aiDecisionOpportunities.get(factionId)!.primaryOperationId = operationId;
}
/** Successful initiation closes the primary thread, not physical completion.
 * Legacy tick cadence is retained until final Temporal V2 initiation/timers exist.
 */
export function finishDecisionInitiation(state: GameState, operationId: string, successful: boolean): void {
  const op = state.operations.get(operationId);
  if (!op) return;
  const opportunity = state.aiDecisionOpportunities.get(op.warlordId);
  if (opportunity?.primaryOperationId !== operationId) return;
  opportunity.primaryOperationId = null;
  if (successful) state.lastAiDecisionTick.set(op.warlordId, state.worldTick);
}
