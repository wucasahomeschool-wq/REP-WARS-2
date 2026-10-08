import { successfulInitiation, timerRemaining } from './proactiveCognition';
import type { GameState } from '../types/GameState';

export function decisionOpportunityRejection(state: GameState, factionId: string): 'SAME_BOUNDARY' | 'PRIMARY_BUSY' | 'SPACING' | null {
  const opportunity = state.aiDecisionOpportunities.get(factionId);
  if (opportunity?.primaryOperationId != null || opportunity?.primary) return 'PRIMARY_BUSY';
  if (opportunity?.lastBoundaryMs === state.aiClock.nowMs) return 'SAME_BOUNDARY';
  return opportunity?.spacing && timerRemaining(state, opportunity.spacing)>0 ? 'SPACING' : null;
}
/** The Orchestrator's cloned transaction/CAS serializes this primary thread.
 * Coalescing uses the canonical processing boundary; timed opportunities also
 * carry exact faction identity and a persisted sequence, never process time.
 */
export function beginDecisionOpportunity(state: GameState, factionId: string): boolean {
  if (decisionOpportunityRejection(state, factionId)) return false;
  const existing=state.aiDecisionOpportunities.get(factionId)??{lastBoundaryTick:null,primaryOperationId:null};
  state.aiDecisionOpportunities.set(factionId,{...existing,lastBoundaryTick:state.worldTick,lastBoundaryMs:state.aiClock.nowMs});
  return true;
}
export function attachDecisionInitiation(state: GameState, factionId: string, operationId: string): void {
  state.aiDecisionOpportunities.get(factionId)!.primaryOperationId = operationId;
}
/** Successful initiation closes the primary thread, not physical completion.
 * Source-bound successful initiation earns relief and starts the persisted timer.
 */
export function finishDecisionInitiation(state: GameState, operationId: string, successful: boolean): void {
  const op = state.operations.get(operationId);
  if (!op) return;
  const opportunity = state.aiDecisionOpportunities.get(op.warlordId);
  if (opportunity?.primaryOperationId !== operationId) return;
  opportunity.primaryOperationId = null;
  if (successful && op.sourceContextId) successfulInitiation(state, op.warlordId, op.sourceContextId, false);
  else if (successful) state.lastAiDecisionTick.set(op.warlordId, state.worldTick);
  else if (opportunity.primary) opportunity.primary=null;
}
