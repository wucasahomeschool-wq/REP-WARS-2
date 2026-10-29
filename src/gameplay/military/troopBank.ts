import type {GameState} from '../../types/GameState';
import {ErrorCode, OrchestrationError} from '../../orchestration/errors';
import {allocateArmyId} from '../../army/identity';
import {soldierForce} from '../../army/soldierForce';
import {markResponseWorldChanged} from '../../engine/responseRecords';

export const troopBankId = (factionId:string):string => `troop-bank:v1:${JSON.stringify(factionId)}`;
/** Player reward ledger retains its established balance authority. NPC balances
 * live on their canonical faction; no parallel player balance is introduced. */
export function bankedTroops(s:GameState,fid:string):number {
  return fid===s.playerFactionId?s.playerRewards.bankedTroops:s.factions.get(fid)?.bankedTroops??0;
}
export function availableBankedTroops(s:GameState,fid:string,operationId?:string):number {
  let reserved=0;
  for(const c of s.operationClaims.values())if(c.kind==='banked_troops'&&c.subjectId===fid&&c.operationId!==operationId)reserved+=c.quantity??0;
  return bankedTroops(s,fid)-reserved;
}
export function creditTroopBank(s:GameState,fid:string,amount:number):void {
  const f=s.factions.get(fid),next=bankedTroops(s,fid)+amount;
  if(!f||!Number.isSafeInteger(amount)||amount<0||!Number.isSafeInteger(next))throw new OrchestrationError(ErrorCode.INVALID_GAME_STATE,'Invalid troop bank credit');
  if(fid===s.playerFactionId)s.playerRewards.bankedTroops=next;else f.bankedTroops=next;
  markResponseWorldChanged(s);
}
export function debitTroopBank(s:GameState,fid:string,amount:number,operationId?:string):void {
  if(!s.factions.has(fid)||!Number.isSafeInteger(amount)||amount<=0||availableBankedTroops(s,fid,operationId)<amount)
    throw new OrchestrationError(ErrorCode.INSUFFICIENT_TROOPS,'Insufficient available banked troops');
  if(fid===s.playerFactionId)s.playerRewards.bankedTroops-=amount;else s.factions.get(fid)!.bankedTroops=bankedTroops(s,fid)-amount;
}
/** Atomic on the Orchestrator draft. A deployment creates a separately identified
 * field force at owned land; it never moves, merges or consumes deployed forces. */
export function deployBankedTroops(s:GameState,fid:string,territoryId:string,quantity:number,operationId?:string):string {
  const t=s.territories.get(territoryId);
  if(!t||t.owner!==fid)throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED,'Deployment requires an owned territory');
  if(!Number.isSafeInteger(quantity)||quantity<=0)throw new OrchestrationError(ErrorCode.INVALID_PARAMETER,'quantity must be a positive safe integer');
  if(availableBankedTroops(s,fid,operationId)<quantity)throw new OrchestrationError(ErrorCode.INSUFFICIENT_TROOPS,'Insufficient available banked troops');
  const id=allocateArmyId(s);
  debitTroopBank(s,fid,quantity,operationId);
  s.armies.set(id,soldierForce(id,fid,territoryId,quantity));s.factions.get(fid)!.armies.push(id);
  markResponseWorldChanged(s);return id;
}
