import type { GameState } from '../types/GameState';
import { STRATEGIC_ATTENTION_TUNING } from '../constants/strategicAttention';
import { emptyOperationAttention, attentionCost } from '../engine/strategicAttention';
import { cloneOperation, sortedOperations } from '../engine/operations';
import { concretePlanProblem } from '../types/AIConcretePlan';

/** Schema 19 -> 20: preserve physical truth, including historically over-cap work.
 * No claims, plans, costs, movement clocks or domain links are rewritten.
 */
export function migrateStrategicState(state: GameState): void {
  state.strategicAttention = { capacity: STRATEGIC_ATTENTION_TUNING.capacity };
  state.aiDecisionOpportunities = new Map();
  for (const [factionId, tick] of state.lastAiDecisionTick) {
    if (state.factions.has(factionId) && Number.isSafeInteger(tick) && tick >= 0 && tick <= state.worldTick)
      state.aiDecisionOpportunities.set(factionId, { lastBoundaryTick: tick, primaryOperationId: null });
  }
  for (const op of sortedOperations(state)) {
    const attention = emptyOperationAttention(op.warlordId);
    if (['physical','recovery'].includes(op.phase) && op.plan && !concretePlanProblem(op.plan)) {
      attention.cost = attentionCost(op.plan);
      attention.acquiredAtTick = attention.cost ? op.createdAtTick : null;
      attention.grandfathered = attention.cost > 0;
    }
    state.operations.set(op.id, cloneOperation({ ...op, attention }));
    if (op.phase === 'selected') {
      const entry = state.aiDecisionOpportunities.get(op.warlordId) ?? { lastBoundaryTick: null, primaryOperationId: null };
      // Deterministic handling of legacy pending selections; world progression
      // still processes every selected operation, never a faction slot.
      if (entry.primaryOperationId === null) entry.primaryOperationId = op.id;
      state.aiDecisionOpportunities.set(op.warlordId, entry);
    }
  }
}
