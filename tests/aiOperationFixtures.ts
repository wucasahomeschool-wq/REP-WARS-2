import assert from 'assert';
import { createLegacySampleMapGameState } from '../src/state/createGameState';
import { authoredWorldFields } from './worldTestHelpers';
import { checkGameStateInvariants } from '../src/state/gameStateInvariants';
import { attentionCost } from '../src/engine/strategicAttention';
/** Test-only adapter for old singular fixtures. Production has no faction-slot store.
 * Explicit fixture authoring may choose parameters; production migration never does.
 */
import { AICommitment, Army, Territory, WarlordSnapshot } from '../src/types';
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
    if (!c) { for (const op of sortedOperations(state, fid)) { for (const id of op.claimIds) state.operationClaims.delete(id); state.operations.delete(op.id); } state.aiDecisionOpportunities.delete(fid); return; }
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
      op.attention={factionId:fid,cost:attentionCost(op.plan),acquiredAtTick:op.createdAtTick,releasedAtTick:null,grandfathered:true};
      for(const cl of requiredClaims(op.plan,op.id,state)){state.operationClaims.set(cl.id,cl);op.claimIds.push(cl.id);}
    }
    state.operations.set(op.id,op);
    if(op.phase==='selected')state.aiDecisionOpportunities.set(fid,{lastBoundaryTick:state.worldTick,primaryOperationId:op.id});
    else if(state.aiDecisionOpportunities.get(fid)?.primaryOperationId===op.id)state.aiDecisionOpportunities.get(fid)!.primaryOperationId=null;
  };
  return { [Symbol.iterator]: () => state.allFactionIds.map(fid=>[fid,get(fid)] as const).values(), get, set, has: (fid:string)=>!!get(fid), get size(){return state.operations.size;},
    entries:()=>state.allFactionIds.map(fid=>[fid,get(fid)] as const).values(),
    values:()=>state.allFactionIds.map(get).values(),
    replaceWith:(map:Map<string,AICommitment|null>)=>{state.operations.clear();state.operationClaims.clear();for(const[f,c]of map)set(f,c);} };
}

export function makeOperationTestWorld(
  makeSelf: (id: string, overrides?: Partial<WarlordSnapshot>) => WarlordSnapshot,
  makeTerritory: (overrides: Partial<Territory> & { id: string }) => Territory,
  armyIds: string[] = ['a','b'],
): GameState {
    const s = createLegacySampleMapGameState({ seed: 37 });
    const specs: [string, string, string[]][] = [
      ['home','me',['stage','other']], ['stage','me',['home','other','target']],
      ['other','me',['home','stage']], ['target','enemy',['stage']], ['safe','spectator',[]],
    ];
    s.territories = new Map(specs.map(([id,owner,neighboring])=>[id,makeTerritory({ id,owner,neighboring,garrison:20 })]));
    Object.assign(s,authoredWorldFields(s.territories));
    const army = (id:string): Army => ({id,location:'home',owner:'me',soldiers:600,knights:10,siegeEngines:0,morale:80,supply:80});
    s.armies = new Map(armyIds.map(id=>[id,army(id)]));
    s.factions = new Map(['me','enemy','spectator'].map(id=>[id,makeSelf(id,{
      territories:specs.filter(t=>t[1]===id).map(t=>t[0]),armies:id==='me'?[...armyIds]:[],
      knownFactions:['me','enemy','spectator'],knownTerritories:specs.map(t=>t[0]),
      resources:{gold:10000,food:10000,iron:10000,wood:10000,stone:10000}, resourceIncome:{gold:0,food:0},
      memory:[],goals:[],diplomacy:new Map(),
    })]));
    s.allFactionIds = ['me','enemy','spectator']; s.playerFactionId = 'spectator'; s.levelAnchorTerritoryIds=['safe'];
    s.operations.clear(); s.operationClaims.clear(); s.cities.clear(); s.constructions.clear(); s.activeInvasions.clear();
    s.territoryInfrastructure.clear(); s.territoryEconomy.clear(); s.attackerCooldowns.clear(); s.activeEvents=[]; s.eventHistory=[];
    assert.deepStrictEqual(checkGameStateInvariants(s),[]); return s;
}
