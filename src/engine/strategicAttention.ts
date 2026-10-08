import { STRATEGIC_ATTENTION_TUNING } from '../constants/strategicAttention';
import type { AIConcretePlan } from '../types/AIConcretePlan';
import type { GameState } from '../types/GameState';
import type { OperationAttention } from '../types/AIStrategy';
import type { AIOperation } from '../types/AIOperation';
import { activeOperations } from './operations';

export function emptyOperationAttention(factionId: string): OperationAttention {
  return { factionId, cost: 0, acquiredAtTick: null, releasedAtTick: null, grandfathered: false };
}
export function attentionCost(plan: AIConcretePlan): number { return STRATEGIC_ATTENTION_TUNING.costs[plan.action]; }
export function occupiedAttention(state: GameState, factionId: string, excludingOperationId?: string): number {
  return activeOperations(state, factionId).reduce((total, op) => total +
    (op.id !== excludingOperationId && op.attention.acquiredAtTick !== null && op.attention.releasedAtTick === null ? op.attention.cost : 0), 0);
}
export function assessAttention(state: GameState, plan: AIConcretePlan, excludingOperationId?: string) {
  // A persisted common capacity applies independently to every faction;
  // occupied budgets are never shared between factions.
  const capacity = state.strategicAttention.capacity;
  const cost = attentionCost(plan);
  const occupied = occupiedAttention(state, plan.factionId, excludingOperationId);
  return { capacity, cost, occupied, available: capacity !== undefined && (cost === 0 || occupied + cost <= capacity) };
}
/** Called only inside the atomic domain-start transaction after feasibility checks. */
export function acquireAttention(state: GameState, op: AIOperation): void {
  if (!op.plan) throw new Error('Attention acquisition requires an exact plan');
  const result = assessAttention(state, op.plan, op.id);
  if (!result.available) throw new Error('Insufficient ordinary Strategic Attention');
  op.attention = { factionId: op.warlordId, cost: result.cost,
    acquiredAtTick: result.cost ? state.worldTick : null, releasedAtTick: null, grandfathered: false };
}
