import type { GameState } from '../types/GameState';
import { NON_PROACTIVE_LANES } from '../types/AIResponse';
import { concretePlanProblem } from '../types/AIConcretePlan';
import { responseContextId } from '../engine/responseRecords';
import { durationRemainingMs } from '../world/timeToTick';
export function responseStateProblems(s:GameState):string[] {
  const out:string[]=[],q=s.aiResponseScheduler;
  const int=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
  if(!(s.aiResponses instanceof Map)||!q||!(q.primaryByFaction instanceof Map)||!(q.lastBoundaryByFaction instanceof Map)||typeof q.dirty!=='boolean')return ['Missing canonical response scheduler'];
  if(q.observedWorldTick!==null&&(!int(q.observedWorldTick)||q.observedWorldTick>s.worldTick))out.push('Invalid response observation boundary');
  if(q.nextThreatBoundaryTick!=null&&!int(q.nextThreatBoundaryTick))out.push('Invalid material threat boundary');
  for(const [fid,at]of q.lastBoundaryByFaction)if(!s.factions.has(fid)||!int(at)||at>s.aiClock.nowMs)out.push('Invalid response coalescing boundary');
  for(const [id,c]of s.aiResponses)try {
    if(id!==c.id||id!==responseContextId(c.factionId,c.subject)||!s.factions.has(c.factionId)||!NON_PROACTIVE_LANES.includes(c.lane)||!['CRITICAL','URGENT','REQUIRED','RECOVERY'].includes(c.severity)||!int(c.revision)||!int(c.createdAtMs)||c.createdAtMs>s.aiClock.nowMs||typeof c.materialSignature!=='string'||!['queued','thinking','blocked','resolved','invalidated'].includes(c.status)||!int(c.irreversibility))throw new Error('identity/lifecycle');
    if(c.lane==='REQUIRED_RESPONSE'?!['peace','trade'].includes(c.subject.kind):c.lane==='OPERATION_RECOVERY'?!['operation','cargo'].includes(c.subject.kind):!['hostile_force','invasion'].includes(c.subject.kind))throw new Error('lane/subject mismatch');
    if(c.status==='blocked'&&c.outcome!=='NO_ADDITIONAL_INTERVENTION'||c.status==='invalidated'&&c.outcome!=='CONTEXT_INVALIDATED'||c.status==='resolved'&&!['INTERVENTION_STARTED','RESPONSE_SETTLED'].includes(c.outcome??'')||['queued','thinking'].includes(c.status)&&c.outcome!==null)throw new Error('outcome/lifecycle mismatch');
    if(c.lane==='REQUIRED_RESPONSE'&&c.timer)throw new Error('Duplicated required response timing authority');
    for(const p of [...c.blockers,...(c.selectedPlan?[c.selectedPlan]:[])])if(concretePlanProblem(p)||p.factionId!==c.factionId||p.action==='WAIT')throw new Error('invalid exact response plan');
    if(c.operationId&&s.operations.get(c.operationId)?.responseContextId!==id)throw new Error('operation provenance');
    if(c.timer) {
      const t=c.timer,p=t.progress;
      if(!int(t.onlineDurationMs)||t.onlineDurationMs<=0||t.onlineDurationMs%1000!==0||!int(t.offlineDurationMs)||t.offlineDurationMs!==t.onlineDurationMs*p.offlineDivisor!||!int(p.accruedThroughMs)||p.accruedThroughMs>s.aiClock.nowMs||!int(p.rationalRemainder)||p.rationalRemainder!>=p.offlineDivisor!||!['ONLINE','OFFLINE'].includes(p.achievedRate)||!int(p.wholeTicks)||!int(p.subTickMicroticks)||p.subTickMicroticks>=1000000||!int(p.accrualDivisionRemainder)||p.accrualDivisionRemainder>=60000)throw new Error('timer');
      durationRemainingMs(p,t.onlineDurationMs,p.achievedRate);
    }
    if(['blocked','resolved','invalidated'].includes(c.status)&&c.timer)throw new Error('dormant timer');
    if(c.status==='thinking'&&q.primaryByFaction.get(c.factionId)!==id)throw new Error('unowned thought');
  }catch(e){out.push(`Invalid response ${id}: ${e instanceof Error?e.message:'record'}`);}
  for(const [fid,id]of q.primaryByFaction) {
    const c=s.aiResponses.get(id);if(!c||c.factionId!==fid||c.status!=='thinking')out.push(`Invalid primary response ${fid}`);
  }
  return out;
}
