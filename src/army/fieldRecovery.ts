import type { GameState } from '../types/GameState';
import { comparePlanIds } from '../types/AIConcretePlan';
import { computeAttackerPower, computeDefenderPower } from '../battle/CombatPower';
import { withTerritoryCombatView } from '../gameplay/defense/territoryDefense';
import { availableLocalTroops } from '../gameplay/recruitment/reinforcement';
import { localFormationArmy } from '../gameplay/recruitment/formation';
import { calculateMovementDuration } from './movement';
import { MIN_ATTACKING_TROOPS } from './strategicAttack';
import { legalStrategicAccessTarget, ownedTravel } from './strategicAccess';

/** One current military-capability gap, never a standing army-spawn policy.
 * Formation is useful only against an actual reachable credible target. The
 * domain permits other explicit formations; optional AI recovery is bounded. */
export function fieldRecoveryOpportunity(state: GameState, owner: string) {
  if (owner === state.playerFactionId || !state.factions.has(owner)
    || [...state.armies.values()].some(a => a.owner === owner)) return null;
  const engaged = new Set([...state.activeInvasions.values()].map(i => i.territoryId));
  const candidates: {territoryId: string; targetTerritoryId: string; counterpartyId: string; quantity: number; travelTicks: number}[] = [];
  for (const site of [...state.territories.values()].sort((a,b) => comparePlanIds(a.id,b.id))) {
    const pool = state.territoryRecruitment.get(site.id);
    if (site.owner !== owner || pool?.factionId !== owner || engaged.has(site.id)
      || state.operationClaims.has(`garrison:${site.id}`)) continue;
    const available = availableLocalTroops(state,site.id);
    if (available <= MIN_ATTACKING_TROOPS) continue;
    const travel = ownedTravel(state.territories,owner,site.id,(from,to) => calculateMovementDuration({origin:from,destination:to}));
    const targets = new Set<string>();
    for (const id of travel.distance.keys()) for (const next of state.territories.get(id)!.neighboring) targets.add(next);
    for (const id of [...targets].sort(comparePlanIds)) {
      const target = state.territories.get(id)!;
      if (engaged.has(id) || !legalStrategicAccessTarget(state,owner,target)) continue;
      const defenders = [...state.armies.values()].filter(a => a.owner === target.owner && a.location === id).sort((a,b) => comparePlanIds(a.id,b.id));
      const defense = computeDefenderPower(defenders,target.garrison,withTerritoryCombatView(state,target)).effectivePower;
      const draft = {factionId:owner,territoryId:site.id,quantity:1};
      const perTroop = computeAttackerPower([localFormationArmy(draft,'assessment')]).effectivePower;
      const quantity = Math.max(MIN_ATTACKING_TROOPS+1,Math.floor(defense/perTroop)+1);
      if (!Number.isSafeInteger(quantity) || quantity > available) continue;
      const cost = Math.min(...target.neighboring.filter(n => travel.distance.has(n)).map(n => travel.distance.get(n)!));
      if (Number.isFinite(cost)) candidates.push({territoryId:site.id,targetTerritoryId:id,counterpartyId:target.owner!,quantity,travelTicks:cost});
    }
  }
  candidates.sort((a,b) => a.travelTicks-b.travelTicks || a.quantity-b.quantity
    || comparePlanIds(a.territoryId,b.territoryId) || comparePlanIds(a.targetTerritoryId,b.targetTerritoryId));
  return candidates[0] ?? null;
}
