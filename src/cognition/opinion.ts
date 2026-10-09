import type {GameState} from '../types/GameState';
import type {WarlordSnapshot} from '../types';
import {COGNITION_TUNING as T} from '../constants/cognition';
/** Single range policy shared with the legacy event adapter. No automatic decay. */
export function boundOpinion(n:number):number {
  if(!Number.isFinite(n))throw new Error('Opinion must be finite');
  return Math.max(-T.opinionRange,Math.min(T.opinionRange,n));
}
export function adjustDirectedOpinion(f:WarlordSnapshot,target:string,delta:number):void {
  if(!Number.isFinite(delta)||f.id===target)throw new Error('Invalid Opinion update');
  let r=f.diplomacy.get(target);
  if(!r){r={target,state:'neutral',opinion:0,treaties:[],yearsAtPeace:0,yearsAtWar:0};f.diplomacy.set(target,r);}
  r.opinion=boundOpinion(r.opinion+delta);
}
/** Call with a domain-owned stable transition ID. Receipts are persisted;
 * replay is a no-op, conflicting reuse is an explicit error. */
export function applyOpinionEvent(s:GameState,eventId:string,observer:string,target:string,kind:string,delta:number):boolean {
  if(typeof eventId!=='string'||!eventId||typeof kind!=='string'||!kind||observer===target||!s.factions.has(observer)||!s.factions.has(target)||!Number.isFinite(delta))throw new Error('Invalid Opinion event');
  const id=`opinion:v1:${JSON.stringify([eventId,observer,target])}`;
  const old=s.opinionEvents.get(id);
  if(old){if(old.kind!==kind||old.delta!==delta)throw new Error('Opinion event identity reused');return false;}
  adjustDirectedOpinion(s.factions.get(observer)!,target,delta);
  s.opinionEvents.set(id,{id,observer,target,kind,delta,atTick:s.worldTick});
  return true;
}
export function opinionPreference(value:number,action:'ATTACK'|'OFFER_PEACE'|'TRADE'):number {
  return boundOpinion(value)/T.opinionRange*T.opinionModifierBound*(action==='ATTACK'?-1:1);
}
