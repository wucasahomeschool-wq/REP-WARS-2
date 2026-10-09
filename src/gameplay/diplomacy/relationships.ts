import type { GameState } from '../../types/GameState';
import type { AuthoritativeRelationship } from '../../types/Peace';
import { activeOperations } from '../../engine/operations';
import { OrchestrationError, ErrorCode } from '../../orchestration/errors';
import { isArmyMoving } from '../../army/movement';

export function factionPair(a:string,b:string):[string,string] {return a<b?[a,b]:[b,a];}
export function peacePairId(a:string,b:string):string {return `pair:v1:${JSON.stringify(factionPair(a,b))}`;}
export function relationshipBetween(state:GameState,a:string,b:string):AuthoritativeRelationship {
  return state.peaceRelationships.get(peacePairId(a,b))?.state??'WAR';
}
export function factionsAreHostile(state:GameState,a:string,b:string|null):boolean {
  return b!==null&&a!==b&&state.factions.has(a)&&state.factions.has(b)&&relationshipBetween(state,a,b)==='WAR';
}
export function activeDiplomacyFaction(state:GameState,id:string):boolean {
  const f=state.factions.get(id);return !!f&&(f.territories.length>0||f.armies.length>0);
}
/** Live canonical links only; no historical outcome, guessed future victory or
 * faction-wide slot. Recovery travel still belongs to the old hostile work. */
export function hostileLifecyclesBetween(state:GameState,a:string,b:string):string[] {
  const pair=peacePairId(a,b),ids=new Set<string>();
  for(const op of activeOperations(state))if(op.plan?.action==='ATTACK'&&op.phase!=='selected') {
    const other=op.hostileCounterpartyId??state.territories.get(op.plan.targetTerritoryId)?.owner;
    if(other&&peacePairId(op.warlordId,other)===pair)ids.add(`operation:${op.id}`);
  }
  for(const army of state.armies.values())if(army.attackIntent&&['pending_movement','ready'].includes(army.attackIntent.status)) {
    const other=army.attackIntent.targetFactionId??state.territories.get(army.attackIntent.targetTerritoryId)?.owner;
    if(other&&peacePairId(army.owner,other)===pair)ids.add(`force:${army.id}`);
  }
  for(const army of state.armies.values())if(isArmyMoving(army)&&army.movement?.hostileCounterpartyId
    &&peacePairId(army.owner,army.movement.hostileCounterpartyId)===pair)ids.add(`force:${army.id}`);
  for(const invasion of state.activeInvasions.values())if(peacePairId(invasion.attackerFactionId,invasion.defenderFactionId)===pair)ids.add(`invasion:${invasion.id}`);
  return [...ids].sort((x,y)=>x<y?-1:x>y?1:0);
}
/** Domain continuation requires its already-committed exact force/target link.
 * A caller-supplied old operation ID cannot authorize a fresh attack. */
export function assertHostilityAllowed(state:GameState,attacker:string,defender:string,targetId:string,
  continuingArmyIds:readonly string[]=[]):void {
  if(relationshipBetween(state,attacker,defender)==='WAR')return;
  const continuing=continuingArmyIds.length>0&&continuingArmyIds.every(id=>{
    const army=state.armies.get(id),intent=army?.attackIntent;
    return army?.owner===attacker&&intent&&['pending_movement','ready'].includes(intent.status)
      &&intent.targetTerritoryId===targetId&&(intent.targetFactionId??state.territories.get(targetId)?.owner)===defender;
  });
  if(!continuing)throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED,'New hostilities blocked by authoritative Peace relationship');
}
