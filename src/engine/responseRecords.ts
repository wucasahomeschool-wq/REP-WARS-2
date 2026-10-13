import type { GameState } from '../types/GameState';
import type { AIResponseContext } from '../types/AIResponse';
import { comparePlanIds } from '../types/AIConcretePlan';
import { ErrorCode, OrchestrationError } from '../orchestration/errors';

export const responseContextLive=(c:AIResponseContext)=>!['resolved','invalidated'].includes(c.status);
const indexes=new WeakMap<Map<string,AIResponseContext>,{live:Set<string>;ready:Set<string>;territories:Map<string,Set<string>>}>();
/** Derived indexes only. Canonical entries are the only serialized authority. */
export function createResponseMap(entries?:Iterable<readonly [string,AIResponseContext]>):Map<string,AIResponseContext> {
  const map=new Map<string,AIResponseContext>(),index={live:new Set<string>(),ready:new Set<string>(),territories:new Map<string,Set<string>>()};indexes.set(map,index);
  Object.defineProperties(map,{
    set:{value:function(id:string,c:AIResponseContext){Map.prototype.set.call(this,id,c);responseContextLive(c)?index.live.add(id):index.live.delete(id);['queued','thinking'].includes(c.status)?index.ready.add(id):index.ready.delete(id);if('territoryId'in c.subject){let keys=index.territories.get(c.subject.territoryId);if(!keys){keys=new Set();index.territories.set(c.subject.territoryId,keys);}responseContextLive(c)?keys.add(id):keys.delete(id);}return this;}},
    delete:{value:function(id:string){const c=this.get(id);if(c&&'territoryId'in c.subject)index.territories.get(c.subject.territoryId)?.delete(id);index.live.delete(id);index.ready.delete(id);return Map.prototype.delete.call(this,id);}},
    clear:{value:function(){index.live.clear();index.ready.clear();index.territories.clear();Map.prototype.clear.call(this);}},
  });
  if(entries)for(const [id,c]of entries)map.set(id,c);return map;
}
function indexed(s:GameState,ready:boolean):AIResponseContext[] {
  const index=indexes.get(s.aiResponses),keys=index?(ready?index.ready:index.live):null;
  return (keys?[...keys].map(id=>s.aiResponses.get(id)!):[...s.aiResponses.values()].filter(c=>ready?['queued','thinking'].includes(c.status):responseContextLive(c))).sort((a,b)=>comparePlanIds(a.id,b.id));
}
export function liveResponseContexts(s:GameState):AIResponseContext[] {
  return indexed(s,false);
}
export function readyResponseContexts(s:GameState):AIResponseContext[]{return indexed(s,true);}
export function responseContextId(factionId:string,subject:AIResponseContext['subject']):string {
  return `response:v1:${JSON.stringify([factionId,subject.kind,subject.id,'territoryId' in subject?subject.territoryId:null,...(subject.kind==='hostile_force'?[subject.hostileCommitmentId??null]:[])])}`;
}
/** Canonical context identity owns the primary thread. These transitions never
 * infer ownership from the caller's status or silently repair an invalid owner. */
export function primaryResponseOwner(s:GameState,factionId:string):AIResponseContext|undefined {
  const id=s.aiResponseScheduler.primaryByFaction.get(factionId);
  if(id===undefined)return undefined;
  const owner=s.aiResponses.get(id);
  if(!owner||owner.factionId!==factionId||owner.status!=='thinking')
    throw new OrchestrationError(ErrorCode.INVALID_GAME_STATE,'Inconsistent primary response owner',{factionId,contextId:id});
  return owner;
}
export function releasePrimaryResponse(s:GameState,c:AIResponseContext):boolean {
  if(s.aiResponseScheduler.primaryByFaction.get(c.factionId)!==c.id)return false;
  s.aiResponseScheduler.primaryByFaction.delete(c.factionId);return true;
}
function acquirableResponse(s:GameState,c:AIResponseContext):AIResponseContext {
  const stored=s.aiResponses.get(c.id);
  if(!stored||stored.factionId!==c.factionId||stored.revision!==c.revision||stored.materialSignature!==c.materialSignature||!['queued','thinking'].includes(stored.status)||
    stored.status==='thinking'&&s.aiResponseScheduler.primaryByFaction.get(stored.factionId)!==stored.id)
    throw new OrchestrationError(ErrorCode.INVALID_GAME_STATE,'Invalid primary response acquisition',{contextId:c.id});
  return stored;
}
export function acquirePrimaryResponse(s:GameState,c:AIResponseContext):void {
  c=acquirableResponse(s,c);
  const owner=primaryResponseOwner(s,c.factionId);
  if(owner&&owner.id!==c.id)
    throw new OrchestrationError(ErrorCode.INVALID_GAME_STATE,'Primary response already owned',{contextId:c.id,ownerId:owner.id});
  c.status='thinking';
  // Queued/preempted work earns no time while another context owns cognition.
  if(c.timer)c.timer.progress={...c.timer.progress,accruedThroughMs:s.aiClock.nowMs};
  s.aiResponses.set(c.id,c);s.aiResponseScheduler.primaryByFaction.set(c.factionId,c.id);
}
/** Resumable preemption retains sampled duration and earned work. Validate the
 * new owner before changing the old owner; all mutations are one reducer step. */
export function transferPrimaryResponse(s:GameState,c:AIResponseContext):AIResponseContext|undefined {
  c=acquirableResponse(s,c);
  const previous=primaryResponseOwner(s,c.factionId);
  if(previous&&previous.id!==c.id) {
    previous.status='queued';releasePrimaryResponse(s,previous);s.aiResponses.set(previous.id,previous);
  }
  acquirePrimaryResponse(s,c);return previous;
}
/** A material revision discards stale reasoning, unlike resumable preemption. */
export function resetResponseReasoning(s:GameState,c:AIResponseContext):void {
  releasePrimaryResponse(s,c);
  c.status='queued';c.timer=null;c.selectedPlan=null;c.outcome=null;c.blockers=[];
  s.aiResponses.set(c.id,c);
}
export function closeResponseContext(s:GameState,c:AIResponseContext,outcome:NonNullable<AIResponseContext['outcome']>):void {
  if(!responseContextLive(c))return;
  releasePrimaryResponse(s,c);
  c.outcome=outcome;c.status=outcome==='CONTEXT_INVALIDATED'?'invalidated':'resolved';c.timer=null;c.blockers=[];
  s.aiResponses.set(c.id,c);
}
/** Exact domain terminal hook; does not create outcome feedback or a fake decline. */
export function invalidateProposalResponse(s:GameState,kind:'peace'|'trade',id:string):void {
  for(const c of liveResponseContexts(s))if(c.subject.kind===kind&&c.subject.id===id)closeResponseContext(s,c,'CONTEXT_INVALIDATED');
}
export function markResponseWorldChanged(s:GameState):void {s.aiResponseScheduler.dirty=true;}
/** Recruitment arithmetic only wakes a relevant blocked context when an exact
 * complete local quantity prerequisite can change; +1 below it is silent. */
export function notifyResponsePoolAvailability(s:GameState,territoryId:string,before:number,after:number):void {
  if(after<=before||!s.aiResponses?.size)return;
  const index=indexes.get(s.aiResponses);
  const records=index?[...(index.territories.get(territoryId)??[])].map(id=>s.aiResponses.get(id)!):liveResponseContexts(s).filter(c=>'territoryId'in c.subject&&c.subject.territoryId===territoryId);
  const relevant=records.filter(c=>c.status==='blocked');
  if(relevant.some(c=>c.blockers.some(p=>p.action==='REINFORCE'&&before<p.quantity&&after>=p.quantity)))markResponseWorldChanged(s);
}
