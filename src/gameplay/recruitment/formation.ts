import type { Army } from '../../types';
import type { ReinforcePlan } from '../../types/AIConcretePlan';

/** Identity follows the canonical operation sequence, not map size, time or RNG.
 * Uses the existing native newly-formed army defaults; no troop generation. */
export function formationArmyId(operationId: string): string {
  return `local-army:v1:${JSON.stringify(operationId)}`;
}
export function localFormationArmy(plan: Pick<ReinforcePlan,'factionId'|'territoryId'|'quantity'>, operationId: string): Army {
  return { id: formationArmyId(operationId), owner: plan.factionId, location: plan.territoryId,
    soldiers: plan.quantity, knights: 0, siegeEngines: 0, morale: 80, supply: 80,
    movement: null, attackIntent: null };
}
