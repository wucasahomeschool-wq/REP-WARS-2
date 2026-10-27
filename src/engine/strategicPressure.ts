import { unchangedTradeDecline } from '../gameplay/trade/declinedContext';
import {goalMatchesSource} from '../cognition/goals';
import {tradeCandidates,observableTradeCounterparties} from '../gameplay/trade/candidates';
import { reinforcementQuantities, availableLocalTroops } from '../gameplay/recruitment/reinforcement';
import { factionsAreHostile } from '../gameplay/diplomacy/relationships';
import { recruitmentPoolId } from '../gameplay/recruitment/recruitment';
import type { GameState, ConstructionProjectType } from '../types/GameState';
import { AISourceContext, AIPressureMetrics } from '../types/AIPressure';
import { AIConcretePlan, comparePlanIds, makeConcretePlan, concretePlanId, concretePlanProblem, PlanDraft } from '../types/AIConcretePlan';
import { toDecisionEngineSnapshot } from '../state/gameStateAdapters';
import { assessConcretePlanFeasibility } from './concretePlans';
import { activeOperations } from './operations';
import { STRATEGIC_PRESSURE_TUNING as T, PROACTIVE_TEMPORAL_RULES as TIME } from '../constants/strategicPressure';
import { MIN_ATTACKING_TROOPS, armyHasActiveStrategicOperation } from '../army/strategicAttack';
import { constructionCostEntries, getConstructionProjectDefinition, listConstructionProjectTypes, constructionStartProblem } from '../gameplay/construction/definitions';
import { ECONOMY_CONFIG } from '../gameplay/economy/config';
import type { TemporalPresence } from '../world/timeToTick';
import { computeAttackerPower, computeDefenderPower } from '../battle/CombatPower';
import { withTerritoryCombatView } from '../gameplay/defense/territoryDefense';

export function sourceContextId(source: Pick<AISourceContext,'factionId'|'domain'|'kind'|'subjectId'|'counterpartyId'|'projectType'>): string {
  return `source:v1:${JSON.stringify([source.factionId,source.domain,source.kind,source.subjectId,source.counterpartyId ?? null,source.projectType ?? null])}`;
}
export function factionCanObserve(state: GameState, id: string): boolean {
  const f = state.factions.get(id);
  return !!f && id !== state.playerFactionId && (f.territories.length > 0 || f.armies.length > 0);
}
/** Exact, finite source scope. Military: every local force with immediate or one
 * owned staging hop to this target, plus MOVE only toward that staging site.
 * Positioning: only the exposed force / local forces adjacent to the coverage gap.
 * Development: exactly the indicated site/type. Unsupported domains have no plans. */
export function sourcePlanPredicates(state: GameState, source: AISourceContext): AIConcretePlan[] {
  const plans = new Map<string,AIConcretePlan>();
  // Dormant contexts already own exact immutable blocker predicates. Reuse a
  // predicate only when every exact parameter still matches freshly derived
  // scope; always recheck its current canonical prerequisites below. No world
  // fact, feasibility result or score is cached.
  const previous=new Map(source.blockers.map(b=>[b.plan.id,b.plan]));
  const add = (draft: PlanDraft) => {
    const id=concretePlanId(draft), prior=previous.get(id);
    const p=prior && !concretePlanProblem(prior)?prior:makeConcretePlan(draft);
    plans.set(id,p);
  };
  const fid=source.factionId;
  if(source.domain!=='TRADE_ECONOMIC'&&activeOperations(state,fid).some(op=>op.sourceContextId===source.id && op.objective==='valid' && op.phase!=='selected'))return [];
  if(source.domain==='TRADE_ECONOMIC')return source.counterpartyId?tradeCandidates(state,fid,source.counterpartyId,source.id):[];
  if(source.domain==='DIPLOMACY_PEACE') {
    if(source.counterpartyId)add({action:'OFFER_PEACE',factionId:fid,counterpartyId:source.counterpartyId});
    return [...plans.values()];
  }
  const subject=state.territories.get(source.subjectId);
  const reinforce=(territoryId:string,need:number,destination:import('../types/AIConcretePlan').ReinforcePlan['destination'])=>{
    if(!state.territoryRecruitment.has(territoryId))return;
    for(const quantity of reinforcementQuantities(need))add({action:'REINFORCE',factionId:fid,territoryId,sourcePoolId:recruitmentPoolId(territoryId),quantity,destination});
  };
  if(source.kind==='COVERAGE_GAP'&&subject?.owner===fid) {
    const need=coverageTroopShortfall(state,subject.id,fid);
    reinforce(subject.id,need,{kind:'garrison',territoryId:subject.id});
    for(const a of state.armies.values())if(a.owner===fid&&a.location===subject.id)reinforce(subject.id,need,{kind:'army',armyId:a.id,territoryId:subject.id});
  }
  if (source.domain==='DEVELOPMENT' && subject?.owner===fid && source.projectType) {
    const resources=Object.fromEntries(constructionCostEntries(getConstructionProjectDefinition(source.projectType).cost).map(x=>[x.resource,x.amount]));
    add({action:'BUILD',factionId:fid,territoryId:subject.id,projectType:source.projectType,
      ...(source.projectType==='FORTIFICATION'?{targetFortificationLevel:subject.fortification+1}:{}),
      resourceSource:{kind:'faction_stock',factionId:fid,resources}});
  }
  // Last-field-force recovery uses existing hostile objectives and local pools.
  // No new pressure, action or weight; retain finite, target-bound scope.
  if(source.kind==='HOSTILE_OPPORTUNITY'&&subject&&subject.owner===source.counterpartyId
    && ![...state.armies.values()].some(a=>a.owner===fid)) {
    const need=Math.max(MIN_ATTACKING_TROOPS+1,subject.garrison+militaryAt(state,subject.id,subject.owner!));
    for(const id of [...subject.neighboring].sort(comparePlanIds))if(state.territories.get(id)?.owner===fid) {
      for(const quantity of reinforcementQuantities(need).filter(n=>n>MIN_ATTACKING_TROOPS)) {
        if(state.territoryRecruitment.has(id))add({action:'REINFORCE',factionId:fid,territoryId:id,sourcePoolId:recruitmentPoolId(id),quantity,destination:{kind:'new_army',territoryId:id}});
      }
    }
  }
  for (const army of state.armies.values()) {
    if (army.owner!==fid) continue;
    const origin=state.territories.get(army.location);
    if (!origin) continue;
    if (source.kind==='HOSTILE_OPPORTUNITY' && subject && subject.owner===source.counterpartyId) {
      if(origin.owner===fid && [origin.id,...origin.neighboring].some(id=>{const site=state.territories.get(id);return site?.owner===fid&&site.neighboring.includes(subject.id);})) {
        const need=Math.max(MIN_ATTACKING_TROOPS+1,subject.garrison+militaryAt(state,subject.id,subject.owner!))-army.soldiers-army.knights;
        reinforce(origin.id,need,{kind:'army',armyId:army.id,territoryId:origin.id});
      }
      for (const stagingId of [origin.id,...origin.neighboring]) {
        const staging=state.territories.get(stagingId);
        if (staging?.owner!==fid || !staging.neighboring.includes(subject.id)) continue;
        add({action:'ATTACK',factionId:fid,armyId:army.id,originTerritoryId:origin.id,stagingTerritoryId:stagingId,
          targetTerritoryId:subject.id,route:stagingId===origin.id?[origin.id,subject.id]:[origin.id,stagingId,subject.id]});
        if (stagingId!==origin.id) add({action:'MOVE',factionId:fid,armyId:army.id,originTerritoryId:origin.id,
          destinationTerritoryId:stagingId,route:[origin.id,stagingId]});
      }
    } else if (source.kind==='EXPOSED_FORCE' && army.id===source.subjectId) {
      for (const dest of origin.neighboring) if (state.territories.get(dest)?.owner===fid) {
        add({action:'RETREAT',factionId:fid,armyId:army.id,originTerritoryId:origin.id,fallbackTerritoryId:dest,route:[origin.id,dest]});
      }
    } else if (source.kind==='COVERAGE_GAP' && subject && subject.owner===fid && origin.neighboring.includes(subject.id)
      && !origin.neighboring.some(id=>{const n=state.territories.get(id);return !!n&&hostile(state,fid,n.owner)&&militaryAt(state,id,n.owner!)>origin.garrison+militaryAt(state,origin.id,fid)-army.soldiers-army.knights;})) {
      add({action:'MOVE',factionId:fid,armyId:army.id,originTerritoryId:origin.id,destinationTerritoryId:subject.id,route:[origin.id,subject.id]});
    }
  }
  return [...plans.values()].sort((a,b)=>comparePlanIds(a.id,b.id));
}
export function inspectSourceActionability(state: GameState, source: AISourceContext) {
  const snapshot=toDecisionEngineSnapshot(state);
  const predicates=sourcePlanPredicates(state,source);
  const blockers: AISourceContext['blockers']=[];
  const feasible: AIConcretePlan[]=[];
  for (const plan of predicates) {
    const decline=plan.action==='TRADE'?unchangedTradeDecline(state,plan,source.blockers):null;
    if(decline){blockers.push({plan,reasons:[decline]});continue;}
    const result=assessConcretePlanFeasibility(plan,snapshot);
    if (result.feasible) feasible.push(plan);
    else blockers.push({plan,reasons:result.rejections});
  }
  return {feasible,blockers,predicates};
}
export function sourceConcretePlans(state:GameState,source:AISourceContext):AIConcretePlan[] {
  const {feasible}=inspectSourceActionability(state,source);
  if (!feasible.length) return []; // WAIT never supplies actionability.
  return [...feasible,makeConcretePlan({action:'WAIT',factionId:source.factionId,opportunityTurn:state.turn,sourceContextId:source.id,
    ...(state.aiDecisionOpportunities.get(source.factionId)?.primary?.opportunityId?{opportunityId:state.aiDecisionOpportunities.get(source.factionId)!.primary!.opportunityId}:{})})]
    .sort((a,b)=>comparePlanIds(a.id,b.id));
}
function hostile(state:GameState,fid:string,other:string|null):boolean {
  return factionsAreHostile(state,fid,other);
}
function militaryAt(state:GameState,territory:string,owner:string):number {
  let power=0;
  for(const a of state.armies.values()) if(a.owner===owner && a.location===territory) power+=a.soldiers+a.knights;
  return power;
}
/** Cheap factual coverage scope: the strongest adjacent hostile force group
 * that can currently attack, versus stationary local defenders. This is not a
 * plan score or a future battle draw. Use authoritative CombatPower so terrain,
 * City, fortifications and unit quality cannot leave a phantom raw-count gap.
 * Quantity is expressed as additional local soldier/garrison equivalents. */
function coverageTroopShortfall(state:GameState,territoryId:string,fid:string):number {
  const territory=state.territories.get(territoryId)!;
  const armies=[...state.armies.values()].sort((a,b)=>comparePlanIds(a.id,b.id));
  const engaged=new Set([...state.activeInvasions.values()].flatMap(i=>i.attackingArmyIds));
  const available=(a:typeof armies[number])=>!armyHasActiveStrategicOperation(a)&&!engaged.has(a.id);
  const defenders=armies.filter(a=>a.owner===fid&&a.location===territoryId&&available(a));
  let threat=0;
  for(const id of territory.neighboring) {
    const origin=state.territories.get(id);
    if(!origin||!hostile(state,fid,origin.owner))continue;
    const attackers=armies.filter(a=>a.owner===origin.owner&&a.location===id&&available(a)&&a.soldiers+a.knights>MIN_ATTACKING_TROOPS);
    if(attackers.length)threat=Math.max(threat,computeAttackerPower(attackers).effectivePower);
  }
  if(!threat)return 0;
  const view=withTerritoryCombatView(state,territory);
  const defense=computeDefenderPower(defenders,territory.garrison,view).effectivePower;
  if(threat<=defense)return 0;
  const perTroop=computeDefenderPower(defenders,territory.garrison+1,view).effectivePower-defense;
  return Math.ceil((threat-defense)/perTroop);
}
function usefulBuild(state:GameState,fid:string,tid:string,type:ConstructionProjectType):boolean {
  const t=state.territories.get(tid)!;const f=state.factions.get(fid)!;
  const infra=state.territoryInfrastructure.get(tid);
  if(type==='FARM') return (t.resourceOutput.food??0)>0 && infra?.farmCompletedAtTick==null
    && f.resources.food < f.territories.length*ECONOMY_CONFIG.foodPerTerritoryPerCycle;
  const resources=type==='MINE'?['iron','stone'] as const:type==='LUMBER'?['wood'] as const:[];
  if(resources.length) return resources.some(resource=> (t.resourceOutput[resource]??0)>0 && f.resources[resource]<
    Math.max(...listConstructionProjectTypes().map(p=>getConstructionProjectDefinition(p).cost[resource]??0)))
    && (type==='MINE'?infra?.mineCompletedAtTick==null:infra?.lumberCompletedAtTick==null);
  const frontier=t.neighboring.some(id=>{ const n=state.territories.get(id);return !!n&&hostile(state,fid,n.owner)&&militaryAt(state,id,n.owner!)>0; });
  if(!frontier) return false;
  if(type==='CITY') return ![...state.cities.values()].some(c=>c.territoryId===tid);
  return constructionStartProblem(type,{state,factionId:fid,territoryId:tid})===null;
}
/** Observation uses live domain facts and finite prerequisite probes, never
 * scoring, selection RNG, Memory, future battle draws, or a retained wrapper. */
export function deriveSources(state:GameState,fid:string,atMs:number):AISourceContext[] {
  if(!factionCanObserve(state,fid)) return [];
  const noFieldForce=![...state.armies.values()].some(a=>a.owner===fid);
  const out:AISourceContext[]=[];
  const add=(spec:Pick<AISourceContext,'domain'|'kind'|'subjectId'> & Partial<Pick<AISourceContext,'counterpartyId'|'projectType'>>) => {
    const s={...spec,factionId:fid};out.push({...s,id:sourceContextId(s),pressure:0,pressureRemainder:0,observedAtMs:atMs,
      materialSignature:'',revision:0,blocked:false,blockers:[]});
  };
  for(const t of state.territories.values()) {
    if(hostile(state,fid,t.owner) && (t.baseValue>0 || Object.values(t.resourceOutput).some(v=>v!>0))) {
      const defense=t.garrison+militaryAt(state,t.id,t.owner!);
      const plausible=[...state.armies.values()].some(a=>a.owner===fid && a.soldiers+a.knights>0
        && (a.soldiers+a.knights+(state.territoryRecruitment.get(a.location)?.troops??0))*T.credibleForceRatioDenominator>=defense*T.credibleForceRatioNumerator
        && [a.location,...(state.territories.get(a.location)?.neighboring??[])].some(st=>{
          const staging=state.territories.get(st);return staging?.owner===fid&&staging.neighboring.includes(t.id);
        }));
      const recovery=noFieldForce&&t.neighboring.some(id=>state.territories.get(id)?.owner===fid
        && availableLocalTroops(state,id)>MIN_ATTACKING_TROOPS
        && availableLocalTroops(state,id)*T.credibleForceRatioDenominator>=defense*T.credibleForceRatioNumerator);
      if(plausible||recovery) add({domain:'MILITARY_INITIATIVE',kind:'HOSTILE_OPPORTUNITY',subjectId:t.id,counterpartyId:t.owner!});
    }
    if(t.owner!==fid) continue;
    for(const type of listConstructionProjectTypes()) if(usefulBuild(state,fid,t.id,type)) {
      add({domain:'DEVELOPMENT',kind:type==='CITY'||type==='FORTIFICATION'?'FRONTIER_DEVELOPMENT':'PRODUCTIVE_DEVELOPMENT',subjectId:t.id,projectType:type});
    }
    const localNeed=coverageTroopShortfall(state,t.id,fid);
    if(localNeed>0 && (state.territoryRecruitment.has(t.id)||[...state.armies.values()].some(a=>a.owner===fid&&state.territories.get(a.location)?.neighboring.includes(t.id))))
      add({domain:'FORCE_POSITIONING',kind:'COVERAGE_GAP',subjectId:t.id});
  }
  for(const a of state.armies.values()) if(a.owner===fid && hostile(state,fid,state.territories.get(a.location)?.owner??null))
    add({domain:'FORCE_POSITIONING',kind:'EXPOSED_FORCE',subjectId:a.id});
  const tradeCounterparties=new Set(observableTradeCounterparties(state,fid));
  const f=state.factions.get(fid)!;
  for(const other of state.factions.values()) if(other.id!==fid && f.knownFactions.includes(other.id)) {
    if(factionsAreHostile(state,fid,other.id)&&f.stability<50 && f.territories.some(id=>state.territories.get(id)?.neighboring.some(n=>state.territories.get(n)?.owner===other.id
      &&militaryAt(state,n,other.id)>(state.territories.get(id)?.garrison??0)+militaryAt(state,id,fid))))
      add({domain:'DIPLOMACY_PEACE',kind:'WAR_BURDEN',subjectId:other.id,counterpartyId:other.id});
    if(tradeCounterparties.has(other.id)) add({domain:'TRADE_ECONOMIC',kind:'RESOURCE_EXCHANGE',subjectId:other.id,counterpartyId:other.id});
  }
  return out.sort((a,b)=>comparePlanIds(a.id,b.id));
}
export function pressureRate(state:GameState,s:AISourceContext):number {
  const matching=goalMatchesSource(state,s);
  // A committed operation reduces residual urgency but never invents completion.
  const addressed=s.domain!=='TRADE_ECONOMIC'&&activeOperations(state,s.factionId).some(op=>op.sourceContextId===s.id && op.objective==='valid' && op.phase!=='selected');
  const base=addressed?0:T.unitsPerOnlineSecond;
  return matching?Math.floor(base*T.goalAmplifierNumerator/T.goalAmplifierDenominator):base;
}
export function accrueSourcePressure(state:GameState,elapsedMs:number,presence:TemporalPresence):void {
  for(const s of state.aiPressure.values()) {
    if(!factionCanObserve(state,s.factionId))continue;
    const numerator=BigInt(s.pressureRemainder)+BigInt(elapsedMs)*BigInt(pressureRate(state,s))*(presence==='ONLINE'?BigInt(TIME.pressureOfflineDivisor):1n);
    const denominator=BigInt(1000*TIME.pressureOfflineDivisor);
    s.pressure=Math.min(T.maximum,s.pressure+Number(numerator/denominator));
    s.pressureRemainder=s.pressure===T.maximum?0:Number(numerator%denominator);
    s.observedAtMs+=elapsedMs;
  }
}
export function observeSources(state:GameState,fid:string,metrics?:AIPressureMetrics):void {
  if(metrics) metrics.observerUpdates++;
  const fresh=deriveSources(state,fid,state.aiClock.nowMs);
  const present=new Set(fresh.map(s=>s.id));
  for(const old of [...state.aiPressure.values()]) if(old.factionId===fid&&!present.has(old.id)) state.aiPressure.delete(old.id);
  for(const spec of fresh) {
    const existing=state.aiPressure.get(spec.id);const s=existing??spec;
    const probe=inspectSourceActionability(state,s);
    const parts:unknown[]=[probe.predicates.map(p=>p.id),
      s.domain==='MILITARY_INITIATIVE'?[Math.floor(((state.territories.get(s.subjectId)?.garrison??0)
        +militaryAt(state,s.subjectId,s.counterpartyId!))/Math.max(1,MIN_ATTACKING_TROOPS)),state.territories.get(s.subjectId)?.fortification]:null];
    const declined=probe.blockers.filter(b=>b.reasons.some(r=>r.kind==='CONTEXT')).map(b=>[b.plan.id,b.reasons]);
    if(declined.length)parts.push(declined); // Existing signatures stay identical without a decline.
    const signature=JSON.stringify(parts);
    if(!existing) {state.aiPressure.set(s.id,s);if(metrics)metrics.sourceCreated++;}
    else if(signature!==s.materialSignature) {s.revision++;if(metrics)metrics.materialUpdates++;}
    s.materialSignature=signature;
    const wasBlocked=s.blocked;
    s.blocked=probe.feasible.length===0;
    s.cognitionOutcome=s.blocked?'NO_ACTIONABLE_PLAN':null;
    s.blockers=probe.blockers;
    s.unavailableReason=probe.predicates.length?null:
      (activeOperations(state,fid).some(op=>op.sourceContextId===s.id&&op.objective==='valid'&&op.phase!=='selected')?'ALREADY_ADDRESSED':
      'NO_AUTHORIZED_FORCE_OR_ROUTE');
    if(s.blocked&&!wasBlocked) {
      const o=state.aiDecisionOpportunities.get(fid);
      if(o&&!o.primary)o.lastOutcome='NO_ACTIONABLE_PLAN';
    }
    if(s.blocked&&!wasBlocked) {if(metrics){metrics.blocked++;metrics.noActionablePlan++;}}
    if(!s.blocked&&wasBlocked&&metrics) metrics.rearmed++;
  }
}
export function readySource(state:GameState,fid:string):AISourceContext|null {
  return [...state.aiPressure.values()].filter(s=>s.factionId===fid&&!s.blocked&&s.pressure>=T.ready)
    .sort((a,b)=>b.pressure-a.pressure||comparePlanIds(a.id,b.id))[0]??null;
}
export function relieveSource(state:GameState,id:string,amount:number):void {
  const s=state.aiPressure.get(id);if(s) s.pressure=Math.max(0,s.pressure-amount);
}
