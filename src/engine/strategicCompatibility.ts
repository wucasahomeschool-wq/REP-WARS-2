import type { GameState } from '../types/GameState';
import type { AIConcretePlan } from '../types/AIConcretePlan';
import type { AIOperation } from '../types/AIOperation';
import { activeOperations } from './operations';
import { relationshipBetween } from '../gameplay/diplomacy/relationships';

export interface CompatibilityContext { state: GameState; activeOperations: readonly AIOperation[] }
/** Pure context-aware rules. Production rules derive facts from canonical state.
 * Rules never acquire claims, charge Attention, or change relationships.
 */
export interface StrategicCompatibilityRule {
  id: string;
  reject(plan: AIConcretePlan, context: CompatibilityContext): string | null;
}
// Pair-specific hostility, independent of physical claims and Attention.
const CURRENT_RULES: readonly StrategicCompatibilityRule[] = Object.freeze([{id:'peace:new-hostility',reject(plan,{state}) {
  if(plan.action!=='ATTACK')return null;
  const owner=state.territories.get(plan.targetTerritoryId)?.owner;
  return owner&&relationshipBetween(state,plan.factionId,owner)!=='WAR'?'Authoritative relationship blocks a new hostile operation':null;
}}]);
export function assessStrategicCompatibility(plan: AIConcretePlan, state: GameState,
  rules: readonly StrategicCompatibilityRule[] = CURRENT_RULES) {
  if (!rules.length) return { compatible: true, reasons: [] as string[] };
  const context = { state, activeOperations: activeOperations(state, plan.factionId) };
  const reasons = [...rules].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .flatMap(rule => { const reason = rule.reject(plan, context); return reason === null ? [] : [`${rule.id}: ${reason}`]; });
  return { compatible: reasons.length === 0, reasons };
}
