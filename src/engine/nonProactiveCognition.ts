import { isLevel1TutorialAiSuppressed } from '../gameplay/tutorial/level1';
import type { GameState } from '../types/GameState';
import type { AIResponseContext, ResponseMetrics, ResponseSubject } from '../types/AIResponse';
import type { AIConcretePlan } from '../types/AIConcretePlan';
import { makeConcretePlan, comparePlanIds } from '../types/AIConcretePlan';
import { RESPONSE_POLICY as P, RESPONSE_TIMING } from '../constants/aiResponse';
import { activeOperations } from './operations';
import { liveTradeShipments, tradePlanProblem } from '../gameplay/trade/trade';
import { activeDiplomacyFaction, relationshipBetween } from '../gameplay/diplomacy/relationships';
import { reinforcementQuantities } from '../gameplay/recruitment/reinforcement';
import { recruitmentPoolId } from '../gameplay/recruitment/recruitment';
import { armyHasActiveStrategicOperation } from '../army/strategicAttack';
import { assessConcretePlanFeasibility } from './concretePlans';
import { toDecisionEngineSnapshot } from '../state/gameStateAdapters';
import { startProactiveTimer, timerRemaining } from './proactiveCognition';
import { accrueDurationProgress, durationRemainingMs, TemporalPresence } from '../world/timeToTick';
import { ContextPlanComparator, selectInterventionComparison } from '../scoring/contextPlanComparison';
import { assessRequiredPeaceResponse } from '../scoring/peaceAssessment';
import { assessRequiredTradeResponse } from '../scoring/tradeAssessment';
import { settlePeaceProposal } from '../gameplay/diplomacy/peace';
import { settleTradeProposal } from '../gameplay/trade/trade';
import { SeededRNG } from '../utils/SeededRNG';
import { closeResponseContext, responseContextId, liveResponseContexts, readyResponseContexts, responseContextLive } from './responseRecords';

const canThink=(s:GameState,fid:string)=>fid!==s.playerFactionId&&activeDiplomacyFaction(s,fid)&&!isLevel1TutorialAiSuppressed(s,fid);
const bucket=(n:number)=>Math.floor(n/P.materialTroopBatch);
function upsert(s:GameState,fid:string,subject:ResponseSubject,lane:AIResponseContext['lane'],severity:AIResponseContext['severity'],signature:string,m?:ResponseMetrics):AIResponseContext {
  const id=responseContextId(fid,subject),old=s.aiResponses.get(id);
  if(old&&responseContextLive(old)) {
    if(old.materialSignature!==signature) {
      old.revision++;old.materialSignature=signature;old.severity=severity;
      // Material change invalidates unfinished reasoning. Blocked recovery has
      // no authorized intervention policy; changed quantities cannot invent one.
      if(lane!=='OPERATION_RECOVERY') {
        old.status='queued';old.timer=null;old.selectedPlan=null;old.outcome=null;old.blockers=[];
        if(s.aiResponseScheduler.primaryByFaction.get(fid)===id)s.aiResponseScheduler.primaryByFaction.delete(fid);
        if(m)m.materialRearms++;
      }
    }
    s.aiResponses.set(id,old);return old;
  }
  // A resolved unchanged threat cannot repeatedly trigger. A real material
  // transformation reuses semantic identity with a persisted new revision.
  if(old&&old.materialSignature===signature)return old;
  const c:AIResponseContext={id,factionId:fid,lane,subject,severity,irreversibility:lane==='REACTIVE_EMERGENCY'?P.irreversibility.incoming:P.irreversibility.routine,
    createdAtMs:s.aiClock.nowMs,revision:old?old.revision+1:0,materialSignature:signature,status:'queued',timer:null,
    outcome:null,selectedPlan:null,operationId:null,blockers:[]};
  s.aiResponses.set(id,c);if(m)m.contextsCreated++;return c;
}
/** Publication is the event. No all-pairs scan or pressure trigger. Domain
 * response windows remain the sole timing authority for required responses. */
export function registerRequiredResponse(s:GameState,kind:'peace'|'trade',id:string,m?:ResponseMetrics):void {
  const p=kind==='peace'?s.peaceProposals.get(id):s.tradeProposals.get(id);
  if(!p||p.status!=='pending'||!canThink(s,p.recipient))return;
  upsert(s,p.recipient,{kind,id},'REQUIRED_RESPONSE','REQUIRED',JSON.stringify([p.id,p.pendingAtMs]),m);
}
export function requiredResponseTimer(s:GameState,c:AIResponseContext) {
  return c.subject.kind==='peace'?s.peaceProposals.get(c.subject.id)?.responseTimer:
    c.subject.kind==='trade'?s.tradeProposals.get(c.subject.id)?.responseTimer:null;
}
export function responseContextExists(s:GameState,c:AIResponseContext):boolean {
  if(!canThink(s,c.factionId))return false;
  const x=c.subject;
  if(x.kind==='peace'||x.kind==='trade') {
    const p=x.kind==='peace'?s.peaceProposals.get(x.id):s.tradeProposals.get(x.id);
    return !!p&&p.status==='pending'&&p.recipient===c.factionId&&activeDiplomacyFaction(s,p.proposer)&&(x.kind==='peace'?relationshipBetween(s,p.proposer,p.recipient)==='WAR':!tradePlanProblem(s,s.tradeProposals.get(x.id)!.plan,p.operationId));
  }
  if(x.kind==='operation') {
    const op=s.operations.get(x.id),army=op?.links.armyId?s.armies.get(op.links.armyId):undefined;
    return !!op&&!op.terminal&&(op.phase==='recovery'||army?.movement?.status==='blocked');
  }
  if(x.kind==='cargo')return s.tradeShipments.get(x.id)?.phase==='blocked';
  if(s.territories.get(x.territoryId)?.owner!==c.factionId)return false;
  if(x.kind==='invasion')return s.activeInvasions.get(x.id)?.defenderFactionId===c.factionId;
  const a=s.armies.get(x.id),intent=a?.attackIntent;
  return !!a&&!!intent&&intent.targetTerritoryId===x.territoryId&&(!intent.targetFactionId||intent.targetFactionId===c.factionId)&&(x.hostileCommitmentId??'legacy-unidentified')===(intent.conflictFactId??intent.commitmentId??'legacy-unidentified')&&a.soldiers+a.knights>0&&relationshipBetween(s,a.owner,c.factionId)!=='PEACE';
}
/** Declared scope: stationary friendly forces on the threatened tile and its
 * immediate owned neighbors; one adjacent support/withdrawal hop, a counterattack
 * on the actual hostile force's tile, and the existing three local-pool batches.
 * No empire enumeration, new force, battle-held allocation or strategic reroute. */
export function reactivePlans(s:GameState,c:AIResponseContext,feasibleOnly=true):AIConcretePlan[] {
  if(c.lane!=='REACTIVE_EMERGENCY'||!responseContextExists(s,c)||!('territoryId'in c.subject))return [];
  const t=s.territories.get(c.subject.territoryId)!;
  const hostile=c.subject.kind==='hostile_force'?s.armies.get(c.subject.id):undefined;
  const scope=new Set([t.id,...t.neighboring.filter(id=>s.territories.get(id)?.owner===c.factionId)]);
  const plans:AIConcretePlan[]=[];
  const forces=[...s.armies.values()].filter(a=>a.owner===c.factionId&&scope.has(a.location)&&!armyHasActiveStrategicOperation(a))
    .sort((a,b)=>comparePlanIds(a.id,b.id));
  for(const a of forces) {
    const origin=s.territories.get(a.location);if(!origin)continue;
    const destinations=a.location===t.id?origin.neighboring.filter(id=>s.territories.get(id)?.owner===c.factionId):[t.id];
    for(const id of [...destinations].sort(comparePlanIds))plans.push(makeConcretePlan({action:origin.owner===c.factionId?'MOVE':'RETREAT',factionId:c.factionId,armyId:a.id,originTerritoryId:origin.id,
      ...(origin.owner===c.factionId?{destinationTerritoryId:id}:{fallbackTerritoryId:id}),route:[origin.id,id]} as import('../types/AIConcretePlan').PlanDraft));
    if(hostile&&s.territories.get(hostile.location)?.owner===hostile.owner&&origin.neighboring.includes(hostile.location))
      plans.push(makeConcretePlan({action:'ATTACK',factionId:c.factionId,armyId:a.id,originTerritoryId:origin.id,stagingTerritoryId:origin.id,targetTerritoryId:hostile.location,route:[origin.id,hostile.location]}));
  }
  const incoming=c.subject.kind==='hostile_force'?(hostile?.soldiers??0)+(hostile?.knights??0):
    (s.activeInvasions.get(c.subject.id)?.attackingArmyIds??[]).reduce((n,id)=>n+(s.armies.get(id)?.soldiers??0)+(s.armies.get(id)?.knights??0),0);
  const local=forces.filter(a=>a.location===t.id).reduce((n,a)=>n+a.soldiers+a.knights,0);
  const need=Math.max(0,incoming-t.garrison-local);
  for(const quantity of reinforcementQuantities(need)) {
    const destinations:import('../types/AIConcretePlan').ReinforcePlan['destination'][]=[{kind:'garrison',territoryId:t.id},...forces.filter(a=>a.location===t.id).map(a=>({kind:'army' as const,armyId:a.id,territoryId:t.id}))];
    for(const destination of destinations)plans.push(makeConcretePlan({action:'REINFORCE',factionId:c.factionId,territoryId:t.id,sourcePoolId:recruitmentPoolId(t.id),quantity,destination}));
  }
  const snapshot=toDecisionEngineSnapshot(s);
  return [...new Map(plans.map(p=>[p.id,p])).values()].filter(p=>!feasibleOnly||assessConcretePlanFeasibility(p,snapshot,undefined,undefined,c.id).feasible).sort((a,b)=>comparePlanIds(a.id,b.id));
}
/** Physical/change boundaries only. All historical terminal records are excluded
 * by keyed live indexes. ETA progress is not a material revision. */
export function observeNonProactiveWork(s:GameState,m?:ResponseMetrics):void {
  const scheduler=s.aiResponseScheduler;
  if(!scheduler.dirty&&(scheduler.nextThreatBoundaryTick==null||s.worldTick<scheduler.nextThreatBoundaryTick))return;
  scheduler.dirty=false;scheduler.observedWorldTick=s.worldTick;if(m)m.observations++;
  scheduler.nextThreatBoundaryTick=null;
  const seen=new Set<string>();
  for(const inv of [...s.activeInvasions.values()].sort((a,b)=>comparePlanIds(a.id,b.id)))if(canThink(s,inv.defenderFactionId)) {
    const c=upsert(s,inv.defenderFactionId,{kind:'invasion',id:inv.id,territoryId:inv.territoryId},'REACTIVE_EMERGENCY','CRITICAL',JSON.stringify([inv.status,[...inv.attackingArmyIds].sort(comparePlanIds)]),m);seen.add(c.id);
  }
  for(const a of [...s.armies.values()].sort((a,b)=>comparePlanIds(a.id,b.id))) {
    const intent=a.attackIntent;if(!intent||a.soldiers+a.knights===0)continue;
    const t=s.territories.get(intent.targetTerritoryId),fid=t?.owner;
    if(!t||!fid||!canThink(s,fid)||fid===a.owner||intent.targetFactionId&&intent.targetFactionId!==fid||relationshipBetween(s,a.owner,fid)==='PEACE')continue;
    const remaining=a.movement?.status==='moving'?Math.max(0,a.movement.startedAtTick+a.movement.durationTicks-s.worldTick):intent.status==='ready'?0:Infinity;
    if(Number.isFinite(remaining)&&remaining>P.criticalArrivalTicks) {
      const until=remaining>P.urgentArrivalTicks?remaining-P.urgentArrivalTicks:remaining-P.criticalArrivalTicks;
      scheduler.nextThreatBoundaryTick=Math.min(scheduler.nextThreatBoundaryTick??Infinity,s.worldTick+until);
    }
    if(remaining>P.urgentArrivalTicks)continue;
    // Actual incoming commitment, not WAR, dislike, idle capability or reachability.
    const support=[...s.armies.values()].filter(f=>f.owner===fid&&f.location===t.id&&!armyHasActiveStrategicOperation(f)).reduce((n,f)=>n+f.soldiers+f.knights,0);
    if(a.soldiers+a.knights<=t.garrison+support)continue;
    const subject:ResponseSubject={kind:'hostile_force',id:a.id,territoryId:t.id,hostileCommitmentId:intent.conflictFactId??intent.commitmentId??'legacy-unidentified'};
    const shell={id:responseContextId(fid,subject),factionId:fid,lane:'REACTIVE_EMERGENCY',subject} as AIResponseContext;
    const wasMissing=!s.aiResponses.has(shell.id);
    if(wasMissing)upsert(s,fid,subject,'REACTIVE_EMERGENCY',remaining<=P.criticalArrivalTicks?'CRITICAL':'URGENT','',m);
    const candidateIds=reactivePlans(s,shell).map(p=>p.action==='REINFORCE'?JSON.stringify(['REINFORCE',p.territoryId,p.destination,bucket(p.quantity)]):p.id);
    const signature=JSON.stringify([a.owner,bucket(a.soldiers+a.knights),bucket(t.garrison+support),a.movement?.destinationTerritoryId??null,candidateIds]);
    if(wasMissing)s.aiResponses.get(shell.id)!.materialSignature=signature;
    const c=upsert(s,fid,subject,'REACTIVE_EMERGENCY',remaining<=P.criticalArrivalTicks?'CRITICAL':'URGENT',signature,m);seen.add(c.id);
    // Urgency escalation is meaningful even though ordinary ETA decrement isn't.
    if(c.severity==='URGENT'&&remaining<=P.criticalArrivalTicks&&responseContextLive(c)){c.severity='CRITICAL';c.revision++;c.status='queued';c.timer=null;c.outcome=null;c.blockers=[];s.aiResponses.set(c.id,c);scheduler.primaryByFaction.delete(fid);if(m)m.materialRearms++;}
  }
  for(const op of activeOperations(s)) {
    const army=op.links.armyId?s.armies.get(op.links.armyId):undefined;
    if(canThink(s,op.warlordId)&&(op.phase==='recovery'||army?.movement?.status==='blocked')) {
      const c=upsert(s,op.warlordId,{kind:'operation',id:op.id},'OPERATION_RECOVERY','RECOVERY',JSON.stringify([op.objective,army?.movement?.status??null,army?.movement?.interruptionReason??null]),m);seen.add(c.id);
    }
  }
  for(const sh of liveTradeShipments(s))if(sh.phase==='blocked'&&canThink(s,sh.sender)) {
    const c=upsert(s,sh.sender,{kind:'cargo',id:sh.id},'OPERATION_RECOVERY','RECOVERY',JSON.stringify([sh.blockedReason]),m);seen.add(c.id);
  }
  for(const fid of s.aiResponseScheduler.primaryByFaction.keys())if(!canThink(s,fid))s.aiResponseScheduler.primaryByFaction.delete(fid);
  for(const c of liveResponseContexts(s)) {
    if(c.lane==='REQUIRED_RESPONSE'? !responseContextExists(s,c):!seen.has(c.id)) {closeResponseContext(s,c,'CONTEXT_INVALIDATED');if(m)m.invalidations++;}
  }
}
function deadline(s:GameState,c:AIResponseContext):number {
  const t=requiredResponseTimer(s,c);return t?s.aiClock.nowMs+timerRemaining(s,t):Infinity;
}
export function orderedResponseContexts(s:GameState,fid?:string):AIResponseContext[] {
  return readyResponseContexts(s).filter(c=>(!fid||c.factionId===fid)&&c.status!=='blocked').sort((a,b)=>
    P.severityOrder[a.severity]-P.severityOrder[b.severity]||deadline(s,a)-deadline(s,b)||b.irreversibility-a.irreversibility||a.createdAtMs-b.createdAtMs||comparePlanIds(a.id,b.id));
}
export function preemptProactiveThought(s:GameState,fid:string,m?:ResponseMetrics):void {
  const o=s.aiDecisionOpportunities.get(fid);
  if(o?.primary?.phase==='deliberating'){o.primary=null;o.lastBoundaryMs=s.aiClock.nowMs;if(m)m.preemptions++;}
}
export function nonProactiveOwnsThought(s:GameState,fid:string):boolean {
  return !!s.aiResponseScheduler.primaryByFaction.get(fid)||orderedResponseContexts(s,fid).some(c=>c.status==='queued');
}
export function accrueResponseClocks(s:GameState,at:number,presence:TemporalPresence):void {
  for(const id of s.aiResponseScheduler.primaryByFaction.values()) {
    const c=s.aiResponses.get(id);if(c?.timer)c.timer.progress=accrueDurationProgress(c.timer.progress,at,presence);
  }
}
export function nextResponseBoundary(s:GameState,horizon:number,presence:TemporalPresence):number {
  let next=horizon;
  for(const id of s.aiResponseScheduler.primaryByFaction.values()) {
    const c=s.aiResponses.get(id);if(c?.timer)next=Math.min(next,s.aiClock.nowMs+Math.max(1,durationRemainingMs(c.timer.progress,c.timer.onlineDurationMs,presence)));
  }
  return next;
}
/** Server-only derived explanation. Public/Unity serializers never call this;
 * diagnostics are not persisted or fed back into selection. */
export function inspectNonProactiveWork(s:GameState,fid:string) {
  const order=orderedResponseContexts(s,fid).map(c=>c.id);
  return liveResponseContexts(s).filter(c=>c.factionId===fid).map(c=>({
    id:c.id,lane:c.lane,subject:{...c.subject},revision:c.revision,severity:c.severity,
    priority:order.indexOf(c.id),status:c.status,outcome:c.outcome,
    remainingCognitionMs:c.timer?timerRemaining(s,c.timer):null,
    remainingRequiredWindowMs:requiredResponseTimer(s,c)?timerRemaining(s,requiredResponseTimer(s,c)!):null,
    selectedPlanId:c.selectedPlan?.id??null,operationId:c.operationId,
    physicalBlock:c.subject.kind==='operation'?s.operations.get(c.subject.id)?.statusReason??null:
      c.subject.kind==='cargo'?s.tradeShipments.get(c.subject.id)?.blockedReason??null:null,
    blockers:c.blockers.map(p=>({planId:p.id,rejections:assessConcretePlanFeasibility(p,toDecisionEngineSnapshot(s),undefined,undefined,c.id).rejections})),
  }));
}
/** Required windows are earned in the domain clock; this sole response reducer
 * chooses/settles fresh actual-recipient assessment. No second selection draw. */
export function settleReadyRequiredResponses(s:GameState,kind?:'peace'|'trade',m?:ResponseMetrics):void {
  const contexts=orderedResponseContexts(s).filter(c=>c.lane==='REQUIRED_RESPONSE'&&(!kind||c.subject.kind===kind));
  for(const c of contexts) {
    if(!responseContextExists(s,c)){
      const proposal=c.subject.kind==='peace'?s.peaceProposals.get(c.subject.id):s.tradeProposals.get(c.subject.id);
      if(proposal?.status==='pending'){if(c.subject.kind==='peace')settlePeaceProposal(s,c.subject.id,'invalidated');else settleTradeProposal(s,c.subject.id,'invalidated');}
      closeResponseContext(s,c,'CONTEXT_INVALIDATED');continue;
    }
    const timer=requiredResponseTimer(s,c);if(!timer||timerRemaining(s,timer)>0)continue;
    // Deadline-ready work cannot starve behind an unrelated physical operation.
    // Deliberation/settlement is serialized on this canonical transaction.
    preemptProactiveThought(s,c.factionId,m);
    const previous=s.aiResponses.get(s.aiResponseScheduler.primaryByFaction.get(c.factionId)??'');
    if(previous&&previous.id!==c.id){previous.status='queued';s.aiResponses.set(previous.id,previous);}
    c.status='thinking';s.aiResponses.set(c.id,c);s.aiResponseScheduler.primaryByFaction.set(c.factionId,c.id);
    if(m){m.deliberations++;m.requiredResponses++;}
    const outcome=c.subject.kind==='peace'?assessRequiredPeaceResponse(s,c.factionId,s.peaceProposals.get(c.subject.id)!.proposer).outcome:
      assessRequiredTradeResponse(s,s.tradeProposals.get(c.subject.id)!).outcome;
    const accepted=outcome==='ACCEPT_PEACE'||outcome==='ACCEPT_TRADE';
    if(c.subject.kind==='peace')settlePeaceProposal(s,c.subject.id,accepted?'accepted':'declined');
    else settleTradeProposal(s,c.subject.id,accepted?'accepted':'declined');
    // Domain terminal hook may already have invalidated the queue reference.
    c.status='resolved';c.outcome='RESPONSE_SETTLED';c.timer=null;s.aiResponses.set(c.id,c);
    if(s.aiResponseScheduler.primaryByFaction.get(c.factionId)===c.id)s.aiResponseScheduler.primaryByFaction.delete(c.factionId);
    if(previous&&previous.id!==c.id&&responseContextExists(s,previous)) {
      previous.status='thinking';s.aiResponses.set(previous.id,previous);s.aiResponseScheduler.primaryByFaction.set(previous.factionId,previous.id);
    }
  }
}
export type StartResponseIntervention=(plan:AIConcretePlan,context:AIResponseContext)=>string|null;
function activateResponse(s:GameState,c:AIResponseContext,m?:ResponseMetrics):void {
  if(c.lane==='OPERATION_RECOVERY')throw new Error('No authoritative recovery choice/timing policy exists');
  c.status='thinking';
  if(c.timer)c.timer.progress={...c.timer.progress,accruedThroughMs:s.aiClock.nowMs};
  if(c.lane!=='REQUIRED_RESPONSE'&&!c.timer) {
    const t=c.severity==='CRITICAL'?RESPONSE_TIMING.critical:RESPONSE_TIMING.urgent;
    c.timer=startProactiveTimer(s,c.factionId,`response:${c.id}:${c.revision}`,t[0],t[1],t[2]);
  }
  s.aiResponses.set(c.id,c);
  s.aiResponseScheduler.primaryByFaction.set(c.factionId,c.id);
  s.aiResponseScheduler.lastBoundaryByFaction.set(c.factionId,s.aiClock.nowMs);
  preemptProactiveThought(s,c.factionId,m);
}
/** No default executor: all physical interventions use the Orchestrator's
 * existing exact-plan atomic initiation boundary. A failed validation never
 * triggers substitute selection. */
export function processNonProactiveBoundary(s:GameState,start?:StartResponseIntervention,m?:ResponseMetrics):void {
  observeNonProactiveWork(s,m);
  settleReadyRequiredResponses(s,undefined,m);
  for(const fid of [...s.allFactionIds].sort(comparePlanIds)) {
    if(!canThink(s,fid))continue;
    let current=s.aiResponses.get(s.aiResponseScheduler.primaryByFaction.get(fid)??'');
    if(current&&!responseContextExists(s,current)){closeResponseContext(s,current,'CONTEXT_INVALIDATED');current=undefined;}
    for(const c of readyResponseContexts(s))if(c.factionId===fid&&c.lane==='OPERATION_RECOVERY'&&c.status==='queued'){
      c.status='blocked';c.outcome='NO_ADDITIONAL_INTERVENTION';c.timer=null;s.aiResponses.set(c.id,c);if(m)m.noIntervention++;
    }
    const next=orderedResponseContexts(s,fid)[0];
    if(current&&next&&P.severityOrder[next.severity]<P.severityOrder[current.severity]) {
      // Required domain response-window work is never lost. Reactive sampled
      // progress is retained on queueing; restart does not reroll it.
      current.status='queued';s.aiResponses.set(current.id,current);s.aiResponseScheduler.primaryByFaction.delete(fid);current=undefined;
    }
    if(!current) {
      if(!next)continue;
      current=next;activateResponse(s,current,m);
    }
    if(current.lane==='REQUIRED_RESPONSE')continue;
    if(!current.timer||timerRemaining(s,current.timer)>0)continue;
    if(m)m.deliberations++;
    const plans=reactivePlans(s,current);if(m)m.candidatePlans+=plans.length;
    const comparisons=plans.length?new ContextPlanComparator().compareInterventions(s,current.id,fid,plans):[];
    // Identity, revision and canonical seed define only the final near-tie draw.
    const rng=new SeededRNG(s.worldSeed).fork([...`${current.id}:${current.revision}`].reduce((n,ch)=>Math.imul(n^ch.charCodeAt(0),16777619)>>>0,2166136261));
    const selected=selectInterventionComparison(comparisons,rng);
    current.selectedPlan=selected?.plan??null;
    const operationId=selected&&start?start(selected.plan,current):null;
    // Nested transaction adoption may replace the context object.
    current=s.aiResponses.get(current.id)!;
    current.selectedPlan=selected?.plan??null;
    if(operationId){current.operationId=operationId;closeResponseContext(s,current,'INTERVENTION_STARTED');if(m)m.interventions++;}
    else {
      current.status='blocked';current.outcome='NO_ADDITIONAL_INTERVENTION';current.timer=null;
      current.blockers=current.lane==='REACTIVE_EMERGENCY'?reactivePlans(s,current,false):[];
      s.aiResponseScheduler.primaryByFaction.delete(fid);s.aiResponses.set(current.id,current);if(m)m.noIntervention++;
    }
    s.aiResponseScheduler.lastBoundaryByFaction.set(fid,s.aiClock.nowMs);
    // Begin the next bounded thought at this earned boundary. Its strictly
    // positive sampled timer prevents zero-duration recursion and avoids an
    // idle receipt/chunk gap between independently queued urgent problems.
    const following=orderedResponseContexts(s,fid)[0];
    if(following)activateResponse(s,following,m);
  }
}
