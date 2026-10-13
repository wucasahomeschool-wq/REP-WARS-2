import type { TradePlan, ResourceBundle } from './AIConcretePlan';
import type { ProactiveTimer } from './AIPressure';
export type TradeProposalStatus='initiating'|'pending'|'accepted'|'declined'|'expired'|'withdrawn'|'counteroffered'|'invalidated';
export interface TradeProposal {
  id:string; operationId:string; proposer:string; recipient:string; plan:TradePlan;
  status:TradeProposalStatus; createdAtMs:number; pendingAtMs:number|null; resolvedAtMs:number|null;
  responseTimer:ProactiveTimer|null; shipmentIds:string[]; replacesProposalId?:string;
}
/** Exact cargo is removed from its authoritative bank only at bilateral ACCEPT.
 * This is custody, not a second free stockpile. No diplomatic Attention owner. */
export interface TradeShipment {
  id:string; proposalId:string; sender:string; recipient:string; cargo:ResourceBundle;
  source:{kind:'faction_stock';factionId:string}; originTerritoryId:string; destinationTerritoryId:string;
  route:string[]; legIndex:number; phase:'loading'|'transit'|'unloading'|'blocked'|'delivered';
  timer:ProactiveTimer|null; legStartedAtTick:number|null; legDurationTicks:number|null;
  blockedReason:string|null; blockedAtTick:number|null; createdAtMs:number; deliveredAtMs:number|null;
}
export interface TradeMetrics {sourceObservations:number;candidates:number;requiredResponses:number;accepts:number;declines:number;counteroffers:number;reservationsAcquired:number;reservationsReleased:number;shipments:number;deliveries:number;historyRecords:number;timerUpdates:number;}
export const emptyTradeMetrics=():TradeMetrics=>({sourceObservations:0,candidates:0,requiredResponses:0,accepts:0,declines:0,counteroffers:0,reservationsAcquired:0,reservationsReleased:0,shipments:0,deliveries:0,historyRecords:0,timerUpdates:0});
