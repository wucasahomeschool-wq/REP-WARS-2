/** Test-only adapter for old singular fixtures. Production has no faction-slot store.
 * Explicit fixture authoring may choose parameters; production migration never does.
 */
import { AICommitment } from '../src/types';
import { GameState } from '../src/types/GameState';
import { makeConcretePlan, planTargetId } from '../src/types/AIConcretePlan';
import { generateConcretePlans } from '../src/engine/concretePlans';
import { toDecisionEngineSnapshot } from '../src/state/gameStateAdapters';
import { operationFromSelection, requiredClaims, sortedOperations } from '../src/engine/operations';
import { getConstructionProjectDefinition, constructionCostEntries } from '../src/gameplay/construction/definitions';

export function fixtureCommitments(state: GameState) {
  const get = (fid: string) => {
    const all = sortedOperations(state, fid);
    const live = all.filter(o => o.phase !== 'terminal');
    return live[live.length - 1] ?? all[all.length - 1] ?? null;
  };
  const set = (fid: string, c: AICommitment | null) => {
    if (!c) { for (const op of sortedOperations(state, fid)) { for (const id of op.claimIds) state.operationClaims.delete(id); state.operations.delete(op.id); } return; }
    const value = { ...c };
    if (!Object.prototype.hasOwnProperty.call(c, 'plan') && ['ATTACK','BUILD','MOVE','RETREAT','WAIT'].includes(c.action)) {
      value.plan = generateConcretePlans(toDecisionEngineSnapshot(state), fid).find(p => p.action === c.action
        && planTargetId(p) === c.targetId && (p.action !== 'BUILD' || p.projectType === 'FORTIFICATION'));
      if (!value.plan) {
        const army = [...state.armies.values()].filter(a => a.owner === fid).sort((a,b) => a.id < b.id ? -1 : 1)[0];
        const origin = army?.location ?? 'fixture_origin'; const target = c.targetId ?? 'fixture_target';
        if (c.action === 'MOVE') value.plan = makeConcretePlan({ action: 'MOVE', factionId: fid, armyId: army?.id ?? 'missing_force', originTerritoryId: origin, destinationTerritoryId: target, route: [origin,target] });
        if (c.action === 'RETREAT') {
          const fallback = state.territories.get(target)?.neighboring.find(id => state.territories.get(id)?.owner === fid) ?? 'missing_fallback';
          value.plan = makeConcretePlan({ action: 'RETREAT', factionId: fid, armyId: army?.id ?? 'missing_force', originTerritoryId: target, fallbackTerritoryId: fallback, route: [target,fallback] });
        }
        if (c.action === 'ATTACK') {
          const stage = state.territories.get(origin)?.neighboring.find(id => state.territories.get(id)?.owner === fid && state.territories.get(id)?.neighboring.includes(target)) ?? origin;
          value.plan = makeConcretePlan({ action: 'ATTACK', factionId: fid, armyId: army?.id ?? 'missing_force', originTerritoryId: origin, stagingTerritoryId: stage, targetTerritoryId: target, route: stage === origin ? [origin,target] : [origin,stage,target] });
        }
        if (c.action === 'BUILD') value.plan = makeConcretePlan({ action: 'BUILD', factionId: fid, projectType: 'FORTIFICATION', territoryId: target,
          targetFortificationLevel: (state.territories.get(target)?.fortification ?? 0)+1,
          resourceSource: { kind:'faction_stock', factionId:fid, resources:Object.fromEntries(constructionCostEntries(getConstructionProjectDefinition('FORTIFICATION').cost).map(e=>[e.resource,e.amount])) } });
        if (c.action === 'WAIT') value.plan = makeConcretePlan({ action: 'WAIT', factionId: fid, opportunityTurn: state.turn });
      }
    }
    const op = operationFromSelection(value, c.startedAtTick ?? state.worldTick);
    if (['completed','failed','interrupted'].includes(c.status)) {
      op.phase='terminal'; op.terminal={outcome:c.status as 'completed'|'failed'|'interrupted',reason:c.statusReason ?? 'fixture',atTick:state.worldTick};
    } else if(c.status==='executing' && op.plan && 'armyId' in op.plan) {
      op.phase='physical'; op.links.armyId=op.plan.armyId;
      for(const cl of requiredClaims(op.plan,op.id,state)){state.operationClaims.set(cl.id,cl);op.claimIds.push(cl.id);}
    }
    state.operations.set(op.id,op);
  };
  return { [Symbol.iterator]: () => state.allFactionIds.map(fid=>[fid,get(fid)] as const).values(), get, set, has: (fid:string)=>!!get(fid), get size(){return state.operations.size;},
    entries:()=>state.allFactionIds.map(fid=>[fid,get(fid)] as const).values(),
    values:()=>state.allFactionIds.map(get).values(),
    replaceWith:(map:Map<string,AICommitment|null>)=>{state.operations.clear();state.operationClaims.clear();for(const[f,c]of map)set(f,c);} };
}
