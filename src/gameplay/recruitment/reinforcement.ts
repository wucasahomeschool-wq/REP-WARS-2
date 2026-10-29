import {troopBankId,bankedTroops,availableBankedTroops,debitTroopBank,deployBankedTroops} from '../military/troopBank';
import { RECRUITMENT_TUNING } from '../../constants/recruitment';
import type { GameState } from '../../types/GameState';
import type { ReinforcePlan } from '../../types/AIConcretePlan';
import { armyHasActiveStrategicOperation } from '../../army/strategicAttack';
import { recruitmentPoolId } from './recruitment';
import { allocateArmyId } from '../../army/identity';
import { soldierForce } from '../../army/soldierForce';
export const usesTroopBank=(plan:ReinforcePlan):boolean=>plan.sourcePoolId===troopBankId(plan.factionId);
export function availableReinforcementTroops(s:GameState,p:ReinforcePlan,operationId?:string):number {
  return usesTroopBank(p)?availableBankedTroops(s,p.factionId,operationId):availableLocalTroops(s,p.territoryId,operationId);
}
/** Only live quantity claims; historical operations are never scanned. */
export function availableLocalTroops(state:GameState,territoryId:string,operationId?:string):number {
  let reserved=0;
  for(const claim of state.operationClaims.values())if(claim.kind==='local_troops'&&claim.subjectId===territoryId&&claim.operationId!==operationId)reserved+=claim.quantity??0;
  return (state.territoryRecruitment.get(territoryId)?.troops??0)-reserved;
}
export function reinforcementProblem(state:GameState,plan:ReinforcePlan,operationId?:string,ignoreClaims=false):string|null {
  if(!Number.isSafeInteger(plan.quantity)||plan.quantity<=0)return 'Invalid local quantity';
  const t=state.territories.get(plan.territoryId),pool=state.territoryRecruitment.get(plan.territoryId);
  const bank=usesTroopBank(plan);
  if(!t||t.owner!==plan.factionId||(!bank&&(!pool||pool.factionId!==plan.factionId||plan.sourcePoolId!==recruitmentPoolId(t.id))))return 'Source missing or wrong ownership';
  if(plan.destination.territoryId!==t.id)return 'Reinforcement destination must be co-located';
  if((bank?bankedTroops(state,plan.factionId):pool!.troops)<plan.quantity)return 'Local pool quantity insufficient';
  if(!ignoreClaims&&availableReinforcementTroops(state,plan,operationId)<plan.quantity)return 'Local pool quantity already reserved';
  if(!bank&&[...state.activeInvasions.values()].some(i=>i.territoryId===t.id))return 'Local destination engaged in invasion';
  if(plan.destination.kind==='new_army') {
    const sequence=state.nextArmySequence;
    if(!Number.isSafeInteger(sequence)||sequence<0||sequence>=Number.MAX_SAFE_INTEGER||state.armies.has(`army:v1:${sequence}`))return 'Army identity sequence invalid or exhausted';
    if(!state.factions.has(plan.factionId))return 'Formation faction missing';
    return null;
  }
  if(plan.destination.kind==='army') {
    const a=state.armies.get(plan.destination.armyId);
    if(!a||a.owner!==plan.factionId||a.location!==t.id||armyHasActiveStrategicOperation(a))return 'Selected destination force missing, remote or engaged';
    if([...state.activeInvasions.values()].some(i=>i.attackingArmyIds.includes(a.id)))return 'Selected destination force engaged in invasion';
    if(!Number.isSafeInteger(a.soldiers+plan.quantity))return 'Destination troop overflow';
    const c=state.operationClaims.get(`force:${a.id}`);
    if(!ignoreClaims&&c&&c.operationId!==operationId)return 'Destination force claimed';
  } else if(!Number.isSafeInteger(t.garrison+plan.quantity))return 'Destination garrison overflow';
  return null;
}
/** Called once after exact reservation/timer completion; never substitutes. */
export function allocateReinforcement(state:GameState,plan:ReinforcePlan,operationId:string):void {
  const problem=reinforcementProblem(state,plan,operationId);
  if(problem)throw new Error(problem);
  const c=[...state.operationClaims.values()].find(c=>c.operationId===operationId&&c.kind===(usesTroopBank(plan)?'banked_troops':'local_troops'));
  if(c?.quantity!==plan.quantity)throw new Error('Exact local quantity reservation missing');
  if(usesTroopBank(plan)&&plan.destination.kind==='new_army'){
    const id=deployBankedTroops(state,plan.factionId,plan.territoryId,plan.quantity,operationId);
    state.operations.get(operationId)!.links.armyId=id;return;
  }
  if(usesTroopBank(plan))debitTroopBank(state,plan.factionId,plan.quantity,operationId);
  else state.territoryRecruitment.get(plan.territoryId)!.troops-=plan.quantity;
  if(plan.destination.kind==='garrison')state.territories.get(plan.territoryId)!.garrison+=plan.quantity;
  else if(plan.destination.kind==='army')state.armies.get(plan.destination.armyId)!.soldiers+=plan.quantity;
  else {
    const id=allocateArmyId(state);
    state.armies.set(id,soldierForce(id,plan.factionId,plan.territoryId,plan.quantity));
    state.factions.get(plan.factionId)!.armies.push(id);
    state.operations.get(operationId)!.links.armyId=id;
  }
}

/** Complete declared bounded batch scope: full measured shortfall, one meaningful
 * batch, and a batch-rounded half shortfall. Independent of current pool quantity
 * so +1 production cannot change predicate identities or rearm prematurely. */
export function reinforcementQuantities(need:number):number[] {
  if(!Number.isFinite(need)||need<=0)return [];
  const exact=Math.ceil(need),batch=Math.min(RECRUITMENT_TUNING.meaningfulBatch,exact);
  return [...new Set([exact,batch,Math.max(batch,Math.floor(exact/2/RECRUITMENT_TUNING.meaningfulBatch)*RECRUITMENT_TUNING.meaningfulBatch)])].sort((a,b)=>a-b);
}
