import type { GameState } from '../types/GameState';
import type { AIResponseContext } from '../types/AIResponse';
import { comparePlanIds } from '../types/AIConcretePlan';

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
export function closeResponseContext(s:GameState,c:AIResponseContext,outcome:NonNullable<AIResponseContext['outcome']>):void {
  if(!responseContextLive(c))return;
  c.outcome=outcome;c.status=outcome==='CONTEXT_INVALIDATED'?'invalidated':'resolved';c.timer=null;c.blockers=[];
  if(s.aiResponseScheduler.primaryByFaction.get(c.factionId)===c.id)s.aiResponseScheduler.primaryByFaction.delete(c.factionId);
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
