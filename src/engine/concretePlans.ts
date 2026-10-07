import { GameStateSnapshot } from '../types';
import { AIConcretePlan, BuildPlan, concretePlanProblem, comparePlanIds, makeConcretePlan, PlanDraft } from '../types/AIConcretePlan';
import { armyHasActiveStrategicOperation, isLegalStagingTerritory, MIN_ATTACKING_TROOPS } from '../army/strategicAttack';
import { isAttackForbiddenOnSnapshot } from '../gameplay/invasion/eligibility';
import { isOpenInvasion } from '../gameplay/invasion/deadlines';
import { isPlayerAnchorProtectedOnSnapshot } from '../gameplay/anchors';
import { constructionCostEntries, getConstructionProjectDefinition, listConstructionProjectTypes } from '../gameplay/construction/definitions';

function buildAvailable(state: GameStateSnapshot, plan: BuildPlan): boolean {
  const canonical = state.canonicalState;
  if (!canonical || plan.resourceSource.kind !== 'faction_stock' || plan.resourceSource.factionId !== plan.factionId) return false;
  if (plan.projectType === 'FORTIFICATION' && state.territories.get(plan.territoryId)?.fortification !== plan.targetFortificationLevel! - 1) return false;
  const definition = getConstructionProjectDefinition(plan.projectType);
  try { definition.assertCanStart({ state: canonical, factionId: plan.factionId, territoryId: plan.territoryId }); }
  catch { return false; }
  if (canonical.constructions.has(`con_${plan.territoryId}_${canonical.worldTick}`)) return false;
  if ([...canonical.constructions.values()].some(p => p.territoryId === plan.territoryId && p.status === 'in_progress')) return false;
  const resources = state.factions.get(plan.factionId)?.resources;
  const expected = Object.fromEntries(constructionCostEntries(definition.cost).map(e => [e.resource, e.amount]));
  if (JSON.stringify(Object.entries(expected).sort()) !== JSON.stringify(Object.entries(plan.resourceSource.resources).sort())) return false;
  return !!resources && constructionCostEntries(definition.cost).every(e => resources[e.resource] >= e.amount);
}

/** Execution revalidation never searches for a substitute plan. */
export function validateConcretePlan(plan: AIConcretePlan, state: GameStateSnapshot, commitmentId?: string): { valid: boolean; reason: string } {
  const fail = (reason: string) => ({ valid: false, reason });
  const problem = concretePlanProblem(plan);
  if (problem) return fail(problem);
  if (!state.factions.has(plan.factionId)) return fail('unknown plan faction');
  if (plan.action === 'WAIT') return { valid: true, reason: '' };
  if (plan.action === 'REINFORCE' || plan.action === 'OFFER_PEACE' || plan.action === 'TRADE') return fail('final action lifecycle unavailable');
  if (plan.action === 'BUILD') return buildAvailable(state, plan) ? { valid: true, reason: '' } : fail('build site, capacity or exact funding is unavailable');
  const army = state.armies.get(plan.armyId);
  if (!army || army.owner !== plan.factionId) return fail('selected army missing or wrong ownership');
  // Existing in-flight operations may be polled, but only for their exact selected force/route.
  const moving = army.movement?.status === 'moving' && army.movement.commitmentId === commitmentId && !!commitmentId;
  const attacking = army.attackIntent?.commitmentId === commitmentId && !!commitmentId;
  if (plan.action === 'ATTACK') {
    const target = state.territories.get(plan.targetTerritoryId);
    if (!target?.owner || target.owner === plan.factionId || !state.factions.has(target.owner)) return fail('invalid attack target');
    if (isAttackForbiddenOnSnapshot(state, plan.factionId, target.owner) || isPlayerAnchorProtectedOnSnapshot(state, target.id)) return fail('attack target protected, paused or cooldown');
    const route = plan.originTerritoryId === plan.stagingTerritoryId
      ? [plan.originTerritoryId, plan.targetTerritoryId] : [plan.originTerritoryId, plan.stagingTerritoryId, plan.targetTerritoryId];
    if (JSON.stringify(route) !== JSON.stringify(plan.route)) return fail('invalid attack route');
    if (!isLegalStagingTerritory(state, plan.factionId, plan.stagingTerritoryId, target.id)) return fail('illegal selected staging site');
    if (state.canonicalState && [...state.canonicalState.activeInvasions.values()].some(inv => inv.territoryId === target.id && isOpenInvasion(inv) && inv.commitmentId !== commitmentId)) return fail('target already has an open invasion');
    if (attacking) {
      const intent = army.attackIntent!;
      return intent.targetTerritoryId === target.id && intent.stagingTerritoryId === plan.stagingTerritoryId
        && intent.onlyArmyId === army.id ? { valid: true, reason: '' } : fail('in-flight attack differs from selected plan');
    }
    if (army.soldiers + army.knights <= MIN_ATTACKING_TROOPS) return fail('selected attack force insufficient');
    if ([...state.armies.values()].some(a => a.owner === plan.factionId && a.attackIntent?.targetTerritoryId === target.id)) return fail('target already has a pending attack');
    if (plan.originTerritoryId !== plan.stagingTerritoryId && !state.territories.get(plan.originTerritoryId)?.neighboring.includes(plan.stagingTerritoryId)) return fail('staging is not one adjacent hop');
  } else {
    const destination = plan.action === 'MOVE' ? plan.destinationTerritoryId : plan.fallbackTerritoryId;
    if (!state.territories.has(destination) || destination === plan.originTerritoryId
      || !state.territories.get(plan.originTerritoryId)?.neighboring.includes(destination)
      || JSON.stringify(plan.route) !== JSON.stringify([plan.originTerritoryId, destination])) return fail('illegal movement route');
    if (plan.action === 'RETREAT' && (state.territories.get(plan.originTerritoryId)?.owner === plan.factionId
      || state.territories.get(destination)?.owner !== plan.factionId)) return fail('illegal strategic fallback');
    if (moving) return army.movement!.originTerritoryId === plan.originTerritoryId && army.movement!.destinationTerritoryId === destination
      ? { valid: true, reason: '' } : fail('in-flight march differs from selected plan');
  }
  if (army.location !== plan.originTerritoryId || armyHasActiveStrategicOperation(army)) return fail('selected force moved or is already engaged');
  return { valid: true, reason: '' };
}

/**
 * Declared finite scope: every owned idle force, each adjacent MOVE destination;
 * every immediate/one-hop owned staging ATTACK reachable by those forces;
 * every adjacent home fallback from foreign ground; every authored build type
 * on every owned site. No heuristic pruning or top-N truncation before scoring.
 * Candidate count is bounded by the graph (force * local degree squared + 5 * sites).
 * Pools and proposal lifecycles do not exist: REINFORCE/PEACE/TRADE yield zero plans.
 */
export function generateConcretePlans(state: GameStateSnapshot, factionId: string): AIConcretePlan[] {
  if (!state.factions.has(factionId)) return [];
  const plans = new Map<string, AIConcretePlan>();
  const add = (draft: PlanDraft) => {
    const plan = makeConcretePlan(draft);
    if (validateConcretePlan(plan, state).valid) plans.set(plan.id, plan);
  };
  for (const army of state.armies.values()) {
    if (army.owner !== factionId || armyHasActiveStrategicOperation(army)) continue;
    const origin = state.territories.get(army.location);
    if (!origin) continue;
    for (const destId of origin.neighboring) {
      if (!state.territories.has(destId)) continue;
      add({ action: 'MOVE', factionId, armyId: army.id, originTerritoryId: origin.id, destinationTerritoryId: destId, route: [origin.id, destId] });
      if (origin.owner !== factionId && state.territories.get(destId)?.owner === factionId)
        add({ action: 'RETREAT', factionId, armyId: army.id, originTerritoryId: origin.id, fallbackTerritoryId: destId, route: [origin.id, destId] });
    }
    for (const stagingId of [origin.id, ...origin.neighboring]) {
      const staging = state.territories.get(stagingId);
      if (staging?.owner !== factionId) continue;
      for (const targetId of staging.neighboring) {
        add({ action: 'ATTACK', factionId, armyId: army.id, originTerritoryId: origin.id, stagingTerritoryId: stagingId, targetTerritoryId: targetId,
          route: stagingId === origin.id ? [origin.id, targetId] : [origin.id, stagingId, targetId] });
      }
    }
  }
  if (state.canonicalState) for (const territory of state.territories.values()) {
    if (territory.owner !== factionId) continue;
    for (const projectType of listConstructionProjectTypes()) {
      const resources = Object.fromEntries(constructionCostEntries(getConstructionProjectDefinition(projectType).cost).map(e => [e.resource, e.amount]));
      add({ action: 'BUILD', factionId, territoryId: territory.id, projectType, ...(projectType === 'FORTIFICATION' ? { targetFortificationLevel: territory.fortification + 1 } : {}), resourceSource: { kind: 'faction_stock', factionId, resources } });
    }
  }
  add({ action: 'WAIT', factionId, opportunityTurn: state.turn });
  return [...plans.values()].sort((a, b) => comparePlanIds(a.id, b.id));
}
