import { activeOperations } from '../engine/operations';
import type { GameState } from '../types/GameState';
import { PRESSURE_DOMAINS, ProactiveTimer } from '../types/AIPressure';
import { STRATEGIC_PRESSURE_TUNING as T } from '../constants/strategicPressure';
import { concretePlanProblem, AIConcretePlan } from '../types/AIConcretePlan';
import { durationRemainingMs } from '../world/timeToTick';
import { sourceContextId } from '../engine/strategicPressure';
function sourceParts(id:unknown):unknown[] {
  if(typeof id!=='string'||!id.startsWith('source:v1:'))throw new Error();
  const parts:unknown=JSON.parse(id.slice('source:v1:'.length));
  if(!Array.isArray(parts)||parts.length!==6||id!==`source:v1:${JSON.stringify(parts)}`)throw new Error();
  const [fid,domain,kind,subject,counterparty,project]=parts;
  const domains:Record<string,string>={HOSTILE_OPPORTUNITY:'MILITARY_INITIATIVE',EXPOSED_FORCE:'FORCE_POSITIONING',COVERAGE_GAP:'FORCE_POSITIONING',PRODUCTIVE_DEVELOPMENT:'DEVELOPMENT',FRONTIER_DEVELOPMENT:'DEVELOPMENT',WAR_BURDEN:'DIPLOMACY_PEACE',RESOURCE_EXCHANGE:'TRADE_ECONOMIC'};
  if(typeof fid!=='string'||!fid||typeof kind!=='string'||domains[kind]!==domain||typeof subject!=='string'||!subject
    ||(counterparty!==null&&typeof counterparty!=='string')||(project!==null&&typeof project!=='string'))throw new Error();
  return parts;
}
/** Immutable semantic linkage only: terminal records may outlive their source.
 * Never require a live source or scan historical operations to validate this. */
export function sourcePlanBindingProblem(id:unknown,plan:AIConcretePlan):string|null {
  try {
    const [fid,,kind,subject,counterparty,project]=sourceParts(id);
    if(fid!==plan.factionId)throw new Error();
    switch(kind) {
      case 'HOSTILE_OPPORTUNITY': if(plan.action!=='REINFORCE'&&plan.action!=='MOVE'&&(plan.action!=='ATTACK'||plan.targetTerritoryId!==subject))throw new Error();break;
      case 'EXPOSED_FORCE': if(plan.action!=='RETREAT'||plan.armyId!==subject)throw new Error();break;
      case 'COVERAGE_GAP': if(plan.action==='REINFORCE'?plan.territoryId!==subject:plan.action!=='MOVE'||plan.destinationTerritoryId!==subject)throw new Error();break;
      case 'PRODUCTIVE_DEVELOPMENT': case 'FRONTIER_DEVELOPMENT': if(plan.action!=='BUILD'||plan.territoryId!==subject||plan.projectType!==project)throw new Error();break;
      case 'WAR_BURDEN': if(plan.action!=='OFFER_PEACE'||plan.counterpartyId!==counterparty)throw new Error();break;
      case 'RESOURCE_EXCHANGE': if(plan.action!=='TRADE'||plan.counterpartyId!==counterparty)throw new Error();break;
    }
    return null;
  }catch{return 'Concrete plan and semantic source binding disagree';}
}
export function pressureStateProblems(state:GameState):string[] {
  const errors:string[]=[];
  const int=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
  if(!(state.aiPressure instanceof Map)||!state.aiClock||!int(state.aiClock.nowMs))return ['Canonical pressure map/temporal cursor missing or invalid'];
  const anchor=state.aiClock.worldAnchor;
  if(anchor && (!int(anchor.accruedTargetWorldTick)||!int(anchor.subTickMicroticks)||anchor.subTickMicroticks>=1_000_000
    ||!int(anchor.accrualDivisionRemainder)||anchor.accrualDivisionRemainder>=60_000||!int(anchor.lastAccrualAtMs)
    ||state.lastAccrualAtMs===null||anchor.lastAccrualAtMs>state.lastAccrualAtMs))errors.push('Invalid rated-world AI anchor');
  const timer=(t:ProactiveTimer|null|undefined)=> {
    if(!t)return;
    const p=t.progress;
    try {
      if(!int(t.onlineDurationMs)||t.onlineDurationMs<=0||!int(t.offlineDurationMs)||t.offlineDurationMs!==t.onlineDurationMs*p.offlineDivisor!
        ||!int(p.accruedThroughMs)||p.accruedThroughMs>state.aiClock.nowMs
        ||!int(p.rationalRemainder)||p.rationalRemainder!>=p.offlineDivisor!
        ||!int(p.wholeTicks)||!int(p.subTickMicroticks)||p.subTickMicroticks>=1_000_000
        ||!int(p.accrualDivisionRemainder)||p.accrualDivisionRemainder>=60_000
        ||!['ONLINE','OFFLINE'].includes(p.achievedRate))throw new Error();
      durationRemainingMs(p,t.onlineDurationMs,p.achievedRate);
    } catch {errors.push('Invalid persisted proactive duration clock');}
  };
  for(const [id,s] of state.aiPressure) {
    if(!s||id!==s.id||id!==sourceContextId(s)||!state.factions.has(s.factionId)||!PRESSURE_DOMAINS.includes(s.domain)
      ||!int(s.pressure)||s.pressure>T.maximum||!int(s.pressureRemainder)||s.pressureRemainder>=50_000
      ||!int(s.observedAtMs)||s.observedAtMs>state.aiClock.nowMs||!int(s.revision)||typeof s.materialSignature!=='string'
      ||typeof s.blocked!=='boolean'||!Array.isArray(s.blockers)) {errors.push(`Invalid source ${id}`);continue;}
    try {sourceParts(id);}catch{errors.push(`Invalid semantic source ${id}`);}
    for(const b of s.blockers) if(!b||typeof b!=='object'||concretePlanProblem(b.plan)||b.plan.factionId!==s.factionId||b.plan.action==='WAIT'
      ||!Array.isArray(b.reasons)||!b.reasons.length||b.reasons.some(r=>!r||!['LEGALITY','CLAIM','COMPATIBILITY','ATTENTION'].includes(r.kind)))errors.push(`Invalid complete-candidate blocker ${id}`);
  }
  for(const op of activeOperations(state))if(op.initiationTimer)timer(op.initiationTimer);
  for(const [fid,o] of state.aiDecisionOpportunities??[]) {
    if(o.lastBoundaryMs!=null&&(!int(o.lastBoundaryMs)||o.lastBoundaryMs>state.aiClock.nowMs))errors.push('Invalid proactive boundary marker');
    if(o.nextTimerSequence!==undefined&&!int(o.nextTimerSequence))errors.push('Invalid persisted timer sequence');
    timer(o.spacing);timer(o.primary?.timer);
    if(o.primary) {
      if(o.spacing)errors.push('Primary initiation and reconsideration spacing overlap');
      try {if(sourceParts(o.primary.contextId)[0]!==fid)throw new Error();}catch{errors.push('Primary thread owned by another or invalid source');}
      try {
        const identity=JSON.parse(o.primary.opportunityId.slice('opportunity:v1:'.length)) as unknown;
        if(!Array.isArray(identity)||identity[0]!==fid||!int(identity[1])||identity[1]>=(o.nextTimerSequence??0)
          ||o.primary.opportunityId!==`opportunity:v1:${JSON.stringify(identity)}`)throw new Error();
      } catch {errors.push('Invalid canonical proactive opportunity identity/sequence');}
      if(!['waiting','deliberating','selected'].includes(o.primary.phase)||!int(o.primary.contextRevision))errors.push('Invalid primary proactive thread');
      if(o.primaryOperationId && o.primary.phase!=='selected')errors.push('Two primary proactive threads');
      if(o.primary.phase!=='selected'&&!o.primary.timer)errors.push('Primary timed phase missing timer');
      if(o.primary.phase==='selected') {
        const op=o.primaryOperationId?state.operations.get(o.primaryOperationId):null;
        if(!op||!(op.phase==='selected'||['REINFORCE','OFFER_PEACE','TRADE'].includes(op.action)&&op.phase==='physical')||op.sourceContextId!==o.primary.contextId||o.primary.timer!==null)
          errors.push('Selected primary thread lacks its exact source-bound operation');
      }
      // A source may disappear between canonical domain mutation and observation.
      // Completion invalidates it; hydration must not fabricate or discard it.
      if(o.primaryOperationId && state.operations.get(o.primaryOperationId)?.warlordId!==fid)errors.push('Primary plan owned by another faction');
    }
  }
  return errors;
}
