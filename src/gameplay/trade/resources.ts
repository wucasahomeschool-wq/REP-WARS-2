import type { GameState } from '../../types/GameState';
import type { ResourceType, Resources } from '../../types';
import type { ResourceBundle, TradePlan } from '../../types/AIConcretePlan';
import type { AIOperationClaim } from '../../types/AIOperation';
import { RESOURCE_KEYS } from '../economy/config';
import {liveTradeRecords} from './records';
import {tradeShipmentNodeProblem} from './policy';
export const bankSubject=(factionId:string)=>`faction_stock:${JSON.stringify(factionId)}`;
export function reservedResource(state:GameState,factionId:string,resource:ResourceType,excludingOperation?:string):number {
  let quantity=0;for(const c of state.operationClaims.values())if(c.kind==='resource'&&c.subjectId===bankSubject(factionId)&&c.resourceType===resource&&c.operationId!==excludingOperation)quantity+=c.quantity??0;
  return quantity;
}
export function availableResource(state:GameState,factionId:string,resource:ResourceType,excludingOperation?:string):number {
  return (state.factions.get(factionId)?.resources[resource]??0)-reservedResource(state,factionId,resource,excludingOperation);
}
export function availableStocks(state:GameState,factionId:string):Resources {
  return Object.fromEntries(RESOURCE_KEYS.map(r=>[r,availableResource(state,factionId,r)])) as unknown as Resources;
}
/** Accepted inbound custody can cover residual future need, never fund current
 * spending or outgoing offers. Blocked obligations do not promise arrival.
 * Saturation is only a derived coverage bound, not a monetary ledger mutation. */
export function committedTradeReceipts(state:GameState,factionId:string):Resources {
  const receipts=Object.fromEntries(RESOURCE_KEYS.map(r=>[r,0])) as unknown as Resources;
  for(const sh of liveTradeRecords(state.tradeShipments,s=>s.phase!=='delivered'))if(sh.recipient===factionId&&sh.phase!=='blocked'&&!tradeShipmentNodeProblem(state,sh))
    for(const [r,n]of bundleEntries(sh.cargo))receipts[r]=Math.min(Number.MAX_SAFE_INTEGER,receipts[r]+n);
  return receipts;
}
export function bundleEntries(bundle:ResourceBundle):[ResourceType,number][] {return RESOURCE_KEYS.filter(r=>bundle[r]!==undefined).map(r=>[r,bundle[r]!]);}
export function validBundle(bundle:unknown):bundle is ResourceBundle {
  return !!bundle&&typeof bundle==='object'&&!Array.isArray(bundle)&&Object.keys(bundle).length>0&&Object.entries(bundle).every(([r,n])=>(RESOURCE_KEYS as readonly string[]).includes(r)&&Number.isSafeInteger(n)&&n>0);
}
export function tradeResourceClaims(plan:TradePlan,operationId:string):AIOperationClaim[] {
  return bundleEntries(plan.offered).map(([resourceType,quantity])=>({id:`resource:${JSON.stringify([operationId,plan.factionId,resourceType])}`,operationId,kind:'resource',subjectId:bankSubject(plan.factionId),scopeFactionId:plan.factionId,resourceType,quantity}));
}
