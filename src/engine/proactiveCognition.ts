import { progressRecruitmentThroughReceipt } from '../gameplay/recruitment/recruitment';
import { activeOperations } from './operations';
import type { GameState } from '../types/GameState';
import type { AISourceContext, AIPressureMetrics, ProactiveTimer } from '../types/AIPressure';
import type { AIDecisionOpportunity } from '../types/AIStrategy';
import { accrueDurationProgress, beginDurationProgress, durationRemainingMs, TemporalPresence } from '../world/timeToTick';
import { derivePresenceSegments } from '../world/presenceLeases';
import { SeededRNG } from '../utils/SeededRNG';
import { PROACTIVE_TEMPORAL_RULES as TIME, STRATEGIC_PRESSURE_TUNING as T } from '../constants/strategicPressure';
import { accrueSourcePressure, factionCanObserve, observeSources, readySource, relieveSource, sourceConcretePlans, pressureRate } from './strategicPressure';

export function authoritativePresence(state:GameState,atMs=state.aiClock.nowMs):TemporalPresence {
  return derivePresenceSegments(state.gameplaySessionLeases,atMs,atMs+1)[0]?.presence??'OFFLINE';
}
export function opportunity(state:GameState,fid:string):AIDecisionOpportunity {
  let o=state.aiDecisionOpportunities.get(fid);
  if(!o) {o={lastBoundaryTick:null,primaryOperationId:null,lastBoundaryMs:null,primary:null,spacing:null,nextTimerSequence:0,lastOutcome:null};state.aiDecisionOpportunities.set(fid,o);}
  return o;
}
function hash(text:string):number {let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return h>>>0;}
export function startProactiveTimer(state:GameState,fid:string,kind:string,minMs:number,maxMs:number,divisor:number):ProactiveTimer {
  if(!Number.isSafeInteger(minMs)||!Number.isSafeInteger(maxMs)||minMs<=0||maxMs<minMs||minMs%1000||maxMs%1000)
    throw new Error('Proactive duration ranges must use canonical whole seconds');
  const o=opportunity(state,fid);const seq=o.nextTimerSequence??0;o.nextTimerSequence=seq+1;
  const rng=new SeededRNG(state.worldSeed).fork(hash(JSON.stringify([fid,kind,seq])));
  // Source of Truth §37: canonical duration authoring precision is one second.
  // UTC watermarks/fractional progress retain the existing millisecond algebra.
  const onlineDurationMs=rng.nextInt(minMs/1000,maxMs/1000)*1000;
  return {onlineDurationMs,offlineDurationMs:onlineDurationMs*divisor,
    progress:beginDurationProgress(state.aiClock.nowMs,authoritativePresence(state),divisor)};
}
export function timerRemaining(state:GameState,timer:ProactiveTimer):number {
  return durationRemainingMs(timer.progress,timer.onlineDurationMs,authoritativePresence(state));
}
function outcome(state:GameState,fid:string,result:'CONTEXT_INVALIDATED'|'NO_ACTIONABLE_PLAN',metrics?:AIPressureMetrics):void {
  const o=opportunity(state,fid);o.primary=null;o.primaryOperationId=null;o.lastOutcome=result;
  if(metrics) result==='CONTEXT_INVALIDATED'?metrics.contextInvalidated++:metrics.noActionablePlan++;
}
export function successfulInitiation(state:GameState,fid:string,contextId:string,wait:boolean,metrics?:AIPressureMetrics):void {
  const o=opportunity(state,fid);
  relieveSource(state,contextId,wait?T.waitRelief:T.successfulInitiationRelief);
  o.primary=null;o.primaryOperationId=null;o.lastOutcome=null;o.lastBoundaryMs=state.aiClock.nowMs;
  o.spacing=startProactiveTimer(state,fid,'spacing',TIME.spacingOnlineMinMs,TIME.spacingOnlineMaxMs,TIME.spacingOfflineDivisor);
  state.lastAiDecisionTick.set(fid,state.worldTick);
  if(metrics){metrics.spacingStarts++;wait?metrics.waitCompletions++:metrics.operationStarts++;}
}
export function selectWaitInitiation(state:GameState,fid:string,metrics?:AIPressureMetrics):void {
  const o=opportunity(state,fid);if(!o.primary)throw new Error('WAIT needs an actionable source');
  o.primary.phase='waiting';o.primary.timer=startProactiveTimer(state,fid,'wait',TIME.waitOnlineMs,TIME.waitOnlineMs,TIME.waitOfflineMs/TIME.waitOnlineMs);
  if(metrics)metrics.waitSelections++;
}
/** Returns a context only after its canonical deliberation timer. Observer and
 * WAIT completion are prerequisite probes; neither scores nor consumes selection RNG. */
export function prepareProactiveDecision(state:GameState,fid:string,metrics?:AIPressureMetrics):AISourceContext|null {
  if(!factionCanObserve(state,fid)) {
    for(const source of [...state.aiPressure.values()])if(source.factionId===fid)state.aiPressure.delete(source.id);
    const existing=state.aiDecisionOpportunities.get(fid);
    if(existing?.primary){existing.primary=null;existing.primaryOperationId=null;existing.lastOutcome='CONTEXT_INVALIDATED';}
    if(existing)existing.spacing=null;
    return null;
  }
  observeSources(state,fid,metrics);
  const o=opportunity(state,fid);
  if(o.primaryOperationId) return null;
  if(o.primary) {
    const p=o.primary;
    if(p.phase==='waiting'&&p.timer&&timerRemaining(state,p.timer)>0)return null;
    const s=state.aiPressure.get(p.contextId);
    if(!s||(p.phase==='waiting'&&s.revision!==p.contextRevision)) {outcome(state,fid,'CONTEXT_INVALIDATED',metrics);return null;}
    if(p.timer&&timerRemaining(state,p.timer)>0)return null;
    if(!sourceConcretePlans(state,s).some(plan=>plan.action!=='WAIT')) {outcome(state,fid,'NO_ACTIONABLE_PLAN',metrics);return null;}
    if(p.phase==='waiting') {successfulInitiation(state,fid,s.id,true,metrics);return null;}
    if(p.phase==='deliberating') {p.contextRevision=s.revision;p.phase='selected';p.timer=null;o.lastBoundaryMs=state.aiClock.nowMs;if(metrics)metrics.deliberations++;return s;}
    return null;
  }
  if(o.spacing) {if(timerRemaining(state,o.spacing)>0)return null;o.spacing=null;}
  if(o.lastBoundaryMs===state.aiClock.nowMs)return null;
  const s=readySource(state,fid);if(!s)return null;
  const timing=s.domain==='MILITARY_INITIATIVE'?TIME.deliberation.major:s.domain==='FORCE_POSITIONING'?TIME.deliberation.standard:TIME.deliberation.routine;
  o.primary={contextId:s.id,contextRevision:s.revision,opportunityId:`opportunity:v1:${JSON.stringify([fid,o.nextTimerSequence??0])}`,phase:'deliberating',timer:startProactiveTimer(state,fid,'deliberation',timing[0]!,timing[1]!,timing[2]!)};
  o.lastBoundaryMs=state.aiClock.nowMs;o.lastBoundaryTick=state.worldTick;
  return null;
}
export function invalidateProactiveInitiation(state:GameState,fid:string):void {
  outcome(state,fid,'NO_ACTIONABLE_PLAN');observeSources(state,fid);
}
/** Next meaningful temporal boundary, not a poll. Blocked contexts have no
 * pressure-triggered wake. Saturation and physical completion do not spawn cognition. */
export function nextProactiveBoundary(state:GameState,horizon:number,presence:TemporalPresence):number {
  let next=horizon;
  for(const op of activeOperations(state))if(op.initiationTimer)next=Math.min(next,state.aiClock.nowMs+Math.max(1,durationRemainingMs(op.initiationTimer.progress,op.initiationTimer.onlineDurationMs,presence)));
  for(const [fid,o] of state.aiDecisionOpportunities) {
    if(!factionCanObserve(state,fid))continue;
    const timer=o.primary?.timer??o.spacing;
    if(timer) next=Math.min(next,state.aiClock.nowMs+Math.max(1,durationRemainingMs(timer.progress,timer.onlineDurationMs,presence)));
  }
  for(const s of state.aiPressure.values()) {
    const o=opportunity(state,s.factionId);
    if(s.blocked||o.primary||o.spacing||o.primaryOperationId||s.pressure>=T.ready)continue;
    // Same exact fixed-point rate as pressure accumulation; boundary rounds up.
    const rate=pressureRate(state,s)*(presence==='ONLINE'?TIME.pressureOfflineDivisor:1);
    if(rate>0)next=Math.min(next,state.aiClock.nowMs+Math.max(1,Math.ceil(((T.ready-s.pressure)*1000*TIME.pressureOfflineDivisor-s.pressureRemainder)/rate)));
  }
  return next;
}
export function accrueProactiveClocks(state:GameState,atMs:number,presence:TemporalPresence):void {
  const elapsed=atMs-state.aiClock.nowMs;if(elapsed<0)throw new Error('AI clock cannot rewind');
  progressRecruitmentThroughReceipt(state,atMs);
  accrueSourcePressure(state,elapsed,presence);
  for(const o of state.aiDecisionOpportunities.values()) {
    if(o.primary?.timer)o.primary.timer.progress=accrueDurationProgress(o.primary.timer.progress,atMs,presence);
    if(o.spacing)o.spacing.progress=accrueDurationProgress(o.spacing.progress,atMs,presence);
  }
  for(const op of activeOperations(state))if(op.initiationTimer)op.initiationTimer.progress=accrueDurationProgress(op.initiationTimer.progress,atMs,presence);
  state.aiClock.nowMs=atMs;
}
