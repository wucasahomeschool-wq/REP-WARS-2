import { RECRUITMENT_TUNING } from '../../constants/recruitment';
import type { GameState } from '../../types/GameState';
import type { ReinforcePlan } from '../../types/AIConcretePlan';
import { armyHasActiveStrategicOperation } from '../../army/strategicAttack';
import { recruitmentPoolId } from './recruitment';
/** Only live quantity claims; historical operations are never scanned. */
export function availableLocalTroops(state:GameState,territoryId:string,operationId?:string):number {
  let reserved=0;
  for(const claim of state.operationClaims.values())if(claim.kind==='local_troops'&&claim.subjectId===territoryId&&claim.operationId!==operationId)reserved+=claim.quantity??0;
  return (state.territoryRecruitment.get(territoryId)?.troops??0)-reserved;
}
export function reinforcementProblem(state:GameState,plan:ReinforcePlan,operationId?:string,ignoreClaims=false):string|null {
  const t=state.territories.get(plan.territoryId),pool=state.territoryRecruitment.get(plan.territoryId);
  if(!t||t.owner!==plan.factionId||!pool||pool.factionId!==plan.factionId||plan.sourcePoolId!==recruitmentPoolId(t.id))return 'Local source pool missing or wrong ownership';
  if(plan.destination.territoryId!==t.id)return 'Reinforcement destination must be co-located';
  if(pool.troops<plan.quantity)return 'Local pool quantity insufficient';
  if(!ignoreClaims&&availableLocalTroops(state,t.id,operationId)<plan.quantity)return 'Local pool quantity already reserved';
  if([...state.activeInvasions.values()].some(i=>i.territoryId===t.id))return 'Local destination engaged in invasion';
  if(plan.destination.kind==='new_army')return 'Local-pool army creation has no authoritative domain path';
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
  const c=[...state.operationClaims.values()].find(c=>c.operationId===operationId&&c.kind==='local_troops');
  if(c?.quantity!==plan.quantity)throw new Error('Exact local quantity reservation missing');
  state.territoryRecruitment.get(plan.territoryId)!.troops-=plan.quantity;
  if(plan.destination.kind==='garrison')state.territories.get(plan.territoryId)!.garrison+=plan.quantity;
  else if(plan.destination.kind==='army')state.armies.get(plan.destination.armyId)!.soldiers+=plan.quantity;
  else throw new Error('Unsupported local army creation');
}

/** Complete declared bounded batch scope: full measured shortfall, one meaningful
 * batch, and a batch-rounded half shortfall. Independent of current pool quantity
 * so +1 production cannot change predicate identities or rearm prematurely. */
export function reinforcementQuantities(need:number):number[] {
  if(!Number.isFinite(need)||need<=0)return [];
  const exact=Math.ceil(need),batch=Math.min(RECRUITMENT_TUNING.meaningfulBatch,exact);
  return [...new Set([exact,batch,Math.max(batch,Math.floor(exact/2/RECRUITMENT_TUNING.meaningfulBatch)*RECRUITMENT_TUNING.meaningfulBatch)])].sort((a,b)=>a-b);
}
