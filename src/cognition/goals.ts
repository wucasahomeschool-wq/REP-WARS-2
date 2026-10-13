import type {GameState} from '../types/GameState';
import type {StrategicGoal} from '../types';
import type {GoalObjective,GoalLifecycle,GoalProgressAssessment} from '../types/AICognition';
import type {AIConcretePlan} from '../types/AIConcretePlan';
import type {AISourceContext} from '../types/AIPressure';
import {comparePlanIds} from '../types/AIConcretePlan';
import {activeDiplomacyFaction,relationshipBetween} from '../gameplay/diplomacy/relationships';
import {tradeDemand} from '../gameplay/trade/candidates';
import {cityIdFor} from '../gameplay/cities/city';
import {availableResource,committedTradeReceipts} from '../gameplay/trade/resources';
import {activeOperations} from '../engine/operations';
import {GAMEPLAY_CONFIG} from '../gameplay/config';
import {COGNITION_TUNING} from '../constants/cognition';

/** PROVISIONAL IMPLEMENTATION POLICY — PRODUCT CONFIRMATION REQUIRED.
 * Only legacy goals with an unambiguous current predicate are promoted.
 * Vague personality objectives stay archived; no guessed economic thresholds,
 * replacement goals, random generator or automatic capacity/quest log. */
export function legacyObjective(g:StrategicGoal):GoalObjective|null {
  if(g.progress>=g.targetProgress)return null; // Do not resurrect ambiguous historical completions.
  if(g.type==='destroy_rival'&&g.targetFaction)return {kind:'ELIMINATE_FACTION',factionId:g.targetFaction};
  if(g.type==='control_region'&&g.targetRegion)return {kind:'CONTROL_REGION',regionId:g.targetRegion};
  return null;
}
export function objectiveProblem(o:GoalObjective):string|null {
  const id=(v:unknown)=>typeof v==='string'&&v.length>0;
  if(!o||typeof o!=='object')return 'Invalid objective';
  switch(o.kind){
    case 'CONTROL_TERRITORY':return id(o.territoryId)?null:'Missing territory';
    case 'CONTROL_REGION':return id(o.regionId)?null:'Missing region';
    case 'ELIMINATE_FACTION':case 'PEACE':return id(o.factionId)?null:'Missing faction';
    case 'DEVELOPMENT':return id(o.territoryId)&&['CITY','FARM','MINE','LUMBER','FORTIFICATION'].includes(o.projectType)&&
      (o.level===undefined||Number.isSafeInteger(o.level)&&o.level>0&&o.level<=(o.projectType==='FORTIFICATION'?GAMEPLAY_CONFIG.maxFortificationLevel:1))?null:'Invalid development predicate';
    case 'RESOURCE_HOLDING':return ['gold','food','wood','iron','stone'].includes(o.resource)&&Number.isSafeInteger(o.quantity)&&o.quantity>0?null:'Invalid resource predicate';
    case 'FORCE_POSITION':return id(o.armyId)&&id(o.territoryId)?null:'Missing force/site';
    default:return 'Unknown objective';
  }
}
export function goalLifecycle(g:StrategicGoal,ownerId:string):GoalLifecycle {
  return g.lifecycle??{ownerId,objective:legacyObjective(g),status:'ACTIVE',visibility:'PRIVATE',createdAtTick:null,resolvedAtTick:null,reason:null};
}
function predicate(s:GameState,owner:string,o:GoalObjective):{complete:boolean;invalid:string|null;progress:number} {
  if(objectiveProblem(o))return {complete:false,invalid:objectiveProblem(o),progress:0};
  const yes=(complete:boolean,invalid:string|null=null,progress=complete?1:0)=>({complete,invalid,progress});
  switch(o.kind){
    case 'CONTROL_TERRITORY':return yes(s.territories.get(o.territoryId)?.owner===owner,s.territories.has(o.territoryId)?null:'Target disappeared');
    case 'CONTROL_REGION':{
      const ids=[...s.territories.values()].filter(t=>t.regionId===o.regionId).map(t=>t.id);
      if(!ids.length)return yes(false,'Region disappeared');
      const count=ids.filter(id=>s.territories.get(id)!.owner===owner).length;return yes(count===ids.length,null,count/ids.length);
    }
    case 'ELIMINATE_FACTION':return yes(s.factions.has(o.factionId)&&!activeDiplomacyFaction(s,o.factionId),s.factions.has(o.factionId)?null:'Target disappeared');
    case 'PEACE':return yes(relationshipBetween(s,owner,o.factionId)==='PEACE',s.factions.has(o.factionId)&&activeDiplomacyFaction(s,o.factionId)?null:'Counterparty unavailable');
    case 'DEVELOPMENT':{
      const t=s.territories.get(o.territoryId);if(!t)return yes(false,'Site disappeared');
      const infra=s.territoryInfrastructure.get(o.territoryId);
      const done=o.projectType==='CITY'?s.cities.has(cityIdFor(o.territoryId)):o.projectType==='FORTIFICATION'?t.fortification>=(o.level??1):
        o.projectType==='FARM'?infra?.farmCompletedAtTick!=null:o.projectType==='MINE'?infra?.mineCompletedAtTick!=null:infra?.lumberCompletedAtTick!=null;
      return yes(t.owner===owner&&done,null,o.projectType==='FORTIFICATION'&&t.owner===owner?Math.min(1,t.fortification/(o.level??1)):t.owner===owner&&done?1:0);
    }
    case 'RESOURCE_HOLDING':{const qty=availableResource(s,owner,o.resource);return yes(qty>=o.quantity,null,Math.min(1,qty/o.quantity));}
    case 'FORCE_POSITION':{
      const a=s.armies.get(o.armyId);if(!a||a.owner!==owner)return yes(false,'Force lost');
      return yes(a.location===o.territoryId&&!a.movement&&!a.attackIntent,s.territories.has(o.territoryId)?null:'Position disappeared');
    }
  }
}
/** Fresh factual assessment; does not mutate state or award progress on selection. */
export function currentGoal(s:GameState,owner:string,g:StrategicGoal):{status:GoalLifecycle['status'];progress:number;reason:string|null} {
  const l=goalLifecycle(g,owner);
  if(l.status!=='ACTIVE')return {status:l.status,progress:g.progress,reason:l.reason};
  if(!activeDiplomacyFaction(s,owner))return {status:'INVALIDATED',progress:g.progress,reason:'Owner is not ACTIVE'};
  if(!l.objective)return {status:'INVALIDATED',progress:g.progress,reason:'Legacy objective lacks a concrete predicate'};
  const p=predicate(s,owner,l.objective);
  if(p.invalid)return {status:'INVALIDATED',progress:g.progress,reason:p.invalid};
  if(g.deadlineTurn!==null&&s.turn>g.deadlineTurn&&!p.complete)return {status:'INVALIDATED',progress:p.progress*g.targetProgress,reason:'Objective deadline passed'};
  return {status:p.complete?'COMPLETED':'ACTIVE',progress:p.progress*g.targetProgress,reason:p.complete?'Canonical objective satisfied':null};
}
export function refreshGoals(s:GameState,owner?:string):number {
  let changes=0;
  const factions=owner?[s.factions.get(owner)].filter((x):x is NonNullable<typeof x>=>!!x):[...s.factions.values()];
  for(const f of factions)for(const g of f.goals){
    const l=goalLifecycle(g,f.id);if(g.lifecycle&&l.status!=='ACTIVE')continue;
    const fresh=currentGoal(s,f.id,g);
    if(!g.lifecycle||fresh.status!==l.status||fresh.progress!==g.progress){
      g.lifecycle={...l,status:fresh.status,reason:fresh.reason,resolvedAtTick:fresh.status==='ACTIVE'?null:s.worldTick};g.progress=fresh.progress;changes++;
    }
  }
  return changes;
}
/** Explicit authored assignment only. Stable ID supplied by the caller's
 * domain/configuration; no hidden runtime counter or automatic replenishment. */
export function assignGoal(s:GameState,owner:string,id:string,objective:GoalObjective,priority=COGNITION_TUNING.goalDefaultPriority,visibility:'PRIVATE'='PRIVATE'):StrategicGoal {
  const f=s.factions.get(owner);if(!f||!id||!Number.isFinite(priority)||priority<0||priority>100||visibility!=='PRIVATE'||objectiveProblem(objective)||
    (objective.kind==='PEACE'||objective.kind==='ELIMINATE_FACTION')&&objective.factionId===owner)throw new Error('Invalid Goal assignment');
  if(f.goals.some(g=>g.id===id))throw new Error('Goal identity already used');
  const goalTypes={CONTROL_TERRITORY:'control_territory',CONTROL_REGION:'control_region',ELIMINATE_FACTION:'destroy_rival',PEACE:'seek_peace',DEVELOPMENT:'develop_territory',RESOURCE_HOLDING:'resource_condition',FORCE_POSITION:'force_position'} as const;
  const g:StrategicGoal={id,type:goalTypes[objective.kind],priority,targetFaction:null,targetTerritory:null,targetRegion:null,targetResource:null,
    progress:0,targetProgress:1,deadlineTurn:null,createdTurn:s.turn,
    lifecycle:{ownerId:owner,objective:{...objective},status:'ACTIVE',visibility,createdAtTick:s.worldTick,resolvedAtTick:null,reason:null}};
  f.goals.push(g);refreshGoals(s,owner);return g;
}
export function activeGoals(s:GameState,owner:string):StrategicGoal[] {
  return (s.factions.get(owner)?.goals??[]).filter(g=>currentGoal(s,owner,g).status==='ACTIVE').sort((a,b)=>b.priority-a.priority||comparePlanIds(a.id,b.id));
}
/** Specific-goal support over canonical facts plus already committed physical
 * effects; neither an evaluator nor an independent desirability score. */
export function assessGoalProgress(s:GameState,owner:string,g:StrategicGoal,p:AIConcretePlan):GoalProgressAssessment {
  const base:GoalProgressAssessment={goalId:g.id,direction:'NEUTRAL',realization:'IMMEDIATE',magnitude:0,explanation:'No causal change to this active objective'};
  const canonical=s.factions.get(owner)?.goals.find(goal=>goal.id===g.id);
  if(!canonical)return base;g=canonical;
  if(p.factionId!==owner||currentGoal(s,owner,g).status!=='ACTIVE'||p.action==='WAIT')return base;
  const o=goalLifecycle(g,owner).objective!;let direction:GoalProgressAssessment['direction']='NEUTRAL';
  let realization:GoalProgressAssessment['realization']='DELAYED';let materiality=1;
  const target=p.action==='ATTACK'?p.targetTerritoryId:p.action==='BUILD'||p.action==='REINFORCE'?p.territoryId:p.action==='MOVE'?p.destinationTerritoryId:p.action==='RETREAT'?p.fallbackTerritoryId:null;
  if(o.kind==='CONTROL_TERRITORY'||o.kind==='CONTROL_REGION'){
    const relevant=o.kind==='CONTROL_TERRITORY'?target===o.territoryId:!!target&&s.territories.get(target)?.regionId===o.regionId;
    if(p.action==='ATTACK'&&relevant){direction='ADVANCE';realization='CONTINGENT';if(o.kind==='CONTROL_REGION')materiality=1/Math.max(1,[...s.territories.values()].filter(t=>t.regionId===o.regionId).length);}
  }else if(o.kind==='ELIMINATE_FACTION'){
    if(p.action==='ATTACK'&&s.territories.get(p.targetTerritoryId)?.owner===o.factionId){direction='ADVANCE';realization='CONTINGENT';}
    if(p.action==='OFFER_PEACE'&&p.counterpartyId===o.factionId){direction='HARM';realization='CONTINGENT';}
  }else if(o.kind==='PEACE'){
    if(p.action==='OFFER_PEACE'&&p.counterpartyId===o.factionId){direction='ADVANCE';realization='CONTINGENT';}
    if(p.action==='ATTACK'&&s.territories.get(p.targetTerritoryId)?.owner===o.factionId)direction='HARM';
  }else if(o.kind==='DEVELOPMENT'&&p.action==='BUILD'&&p.territoryId===o.territoryId&&p.projectType===o.projectType&&
    (o.projectType!=='FORTIFICATION'||(p.targetFortificationLevel??1)>(s.territories.get(o.territoryId)?.fortification??0))){
    direction='ADVANCE';
    if(o.projectType==='FORTIFICATION')materiality=Math.min(1,((p.targetFortificationLevel??1)-(s.territories.get(o.territoryId)?.fortification??0))/(o.level??1));
    const project=[...s.constructions.values()].find(c=>c.status==='in_progress'&&c.territoryId===o.territoryId&&c.projectType===o.projectType);
    if(project)realization='ALREADY_COMMITTED';
  }else if(o.kind==='FORCE_POSITION'&&(p.action==='MOVE'||p.action==='RETREAT')&&p.armyId===o.armyId){
    direction=target===o.territoryId?'ADVANCE':s.armies.get(o.armyId)?.location===o.territoryId?'HARM':'NEUTRAL';
    if(s.armies.get(o.armyId)?.movement?.destinationTerritoryId===target)realization='ALREADY_COMMITTED';
  }else if(o.kind==='RESOURCE_HOLDING'){
    const baseline=availableResource(s,owner,o.resource)+committedTradeReceipts(s,owner)[o.resource];
    if(p.action==='TRADE'){
      const delta=(p.requested[o.resource]??0)-(p.offered[o.resource]??0);
      direction=delta<0?'HARM':delta>0&&baseline<o.quantity?'ADVANCE':'NEUTRAL';realization='CONTINGENT';
      materiality=Math.min(1,Math.abs(delta)/Math.max(1,o.quantity-baseline));
    }else if(p.action==='BUILD'&&p.resourceSource.kind==='faction_stock'&&(p.resourceSource.resources[o.resource]??0)>0)direction='HARM';
  }
  if(p.action==='ATTACK'&&direction==='ADVANCE'){
    const committed=activeOperations(s,owner).some(op=>op.phase==='physical'&&op.objective==='valid'&&op.plan?.action==='ATTACK'&&op.plan.targetTerritoryId===p.targetTerritoryId)
      ||[...s.armies.values()].some(a=>a.owner===owner&&a.attackIntent&&['pending_movement','ready'].includes(a.attackIntent.status)&&a.attackIntent.targetTerritoryId===p.targetTerritoryId)
      ||[...s.activeInvasions.values()].some(i=>i.attackerFactionId===owner&&i.territoryId===p.targetTerritoryId);
    // The capture remains contingent, not achieved. A second commitment to the
    // same target cannot re-earn explicit Goal progress for that same branch.
    if(committed)realization='ALREADY_COMMITTED';
  }
  if(direction==='NEUTRAL'||realization==='ALREADY_COMMITTED')return {...base,realization};
  return {goalId:g.id,direction,realization,magnitude:g.priority/100*materiality,explanation:`${direction.toLowerCase()} ${o.kind} through exact ${p.action} (${realization.toLowerCase()})`};
}
export function goalPreference(s:GameState,owner:string,p:AIConcretePlan,bound:number){
  const assessments=activeGoals(s,owner).map(g=>assessGoalProgress(s,owner,g,p));
  const raw=assessments.reduce((n,a)=>n+(a.direction==='ADVANCE'?a.magnitude:a.direction==='HARM'?-a.magnitude:0),0);
  return {value:bound*raw/(1+Math.abs(raw)),assessments,goalIds:assessments.filter(a=>a.direction==='ADVANCE').map(a=>a.goalId)};
}
/** Only amplifies an existing, source-mapped problem. No plan generation or RNG. */
export function goalMatchesSource(s:GameState,source:AISourceContext):boolean {
  return (s.factions.get(source.factionId)?.goals??[]).some(g=>{
    const l=goalLifecycle(g,source.factionId),o=l.objective;
    if(l.status!=='ACTIVE'||!o)return false;
    // Cheap semantic filtering precedes factual progress assessment. An observer
    // source must not reassess every unrelated Goal (or sort the Goal list).
    const relevant=(()=>{switch(source.domain){
      case 'MILITARY_INITIATIVE':return o.kind==='ELIMINATE_FACTION'&&o.factionId===source.counterpartyId||o.kind==='CONTROL_TERRITORY'&&o.territoryId===source.subjectId||o.kind==='CONTROL_REGION'&&s.territories.get(source.subjectId)?.regionId===o.regionId;
      case 'FORCE_POSITIONING':return o.kind==='FORCE_POSITION'&&(o.territoryId===source.subjectId||o.armyId===source.subjectId);
      case 'DEVELOPMENT':return o.kind==='DEVELOPMENT'&&o.territoryId===source.subjectId&&o.projectType===source.projectType;
      case 'DIPLOMACY_PEACE':return o.kind==='PEACE'&&o.factionId===source.counterpartyId;
      case 'TRADE_ECONOMIC':return o.kind==='RESOURCE_HOLDING'&&!!source.counterpartyId&&availableResource(s,source.factionId,o.resource)+committedTradeReceipts(s,source.factionId)[o.resource]<tradeDemand(s,source.factionId)[o.resource]&&availableResource(s,source.counterpartyId,o.resource)>tradeDemand(s,source.counterpartyId)[o.resource];
    }})();
    return relevant&&currentGoal(s,source.factionId,g).status==='ACTIVE';
  });
}
