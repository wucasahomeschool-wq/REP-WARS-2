import type {GameState} from '../../types/GameState';
import {comparePlanIds} from '../../types/AIConcretePlan';
import type {TradePlan} from '../../types/AIConcretePlan';
import type {TradeShipment} from '../../types/Trade';
/** PROVISIONAL IMPLEMENTATION POLICY — PRODUCT CONFIRMATION REQUIRED.
 * Banked resources have no authored location. An exact owned territory is a
 * shipment dispatch/receiving node, NOT a newly invented local stockpile.
 * Candidates use stable first owned nodes. Explicit plans may choose any owned
 * nodes. Recipient bank is credited only after physical unload at that node.
 * ACCEPT currently requires both graph routes; failure preserves pending stock.
 * Mid-route loss blocks custody, never destroys/refunds/teleports cargo. */
export function tradeNode(state:GameState,factionId:string):string|null {
  return [...state.territories.values()].filter(t=>t.owner===factionId).map(t=>t.id).sort(comparePlanIds)[0]??null;
}
/** Same provisional node policy for exact initiation and ACCEPT validation. */
export function tradeEndpointProblem(state:GameState,plan:TradePlan):string|null {
  const d=plan.delivery;
  return !d||state.territories.get(d.proposerTerritoryId)?.owner!==plan.factionId||state.territories.get(d.recipientTerritoryId)?.owner!==plan.counterpartyId
    ?'Exact Trade dispatch/delivery nodes are unavailable':null;
}
/** PROVISIONAL IMPLEMENTATION POLICY — PRODUCT CONFIRMATION REQUIRED.
 * One replaceable authority for both-routes-at-ACCEPT, shared by response and
 * settlement. Availability of stock is independent of this delivery policy. */
export function tradeAcceptanceRoutes(state:GameState,plan:TradePlan):{offered:string[];requested:string[]}|null {
  if(tradeEndpointProblem(state,plan))return null;
  const d=plan.delivery!,offered=tradeRoute(state,d.proposerTerritoryId,d.recipientTerritoryId),requested=tradeRoute(state,d.recipientTerritoryId,d.proposerTerritoryId);
  return offered&&requested?{offered,requested}:null;
}
/** PROVISIONAL IMPLEMENTATION POLICY — PRODUCT CONFIRMATION REQUIRED.
 * Loss of exact receiving node interrupts all undelivered work. Dispatch-node
 * ownership matters while loading; after departure it cannot erase cargo in
 * transit. Block intact custody; no reroute/refund/seizure/recovery is inferred. */
export function tradeShipmentNodeProblem(state:GameState,shipment:TradeShipment):string|null {
  if(state.territories.get(shipment.destinationTerritoryId)?.owner!==shipment.recipient||!state.factions.has(shipment.recipient))return 'Exact receiving node unavailable; cargo preserved';
  if(shipment.phase==='loading'&&state.territories.get(shipment.originTerritoryId)?.owner!==shipment.sender)return 'Exact dispatch node lost before departure; cargo preserved';
  return null;
}
/** Stable shortest-hop route over the existing authoritative territory graph.
 * No seizure/ceasefire/access rule is fabricated; WAR is not a route exclusion. */
export function tradeRoute(state:GameState,from:string,to:string):string[]|null {
  if(!state.territories.has(from)||!state.territories.has(to))return null;
  const queue:string[][]=[[from]],seen=new Set([from]);
  for(let i=0;i<queue.length;i++) {const path=queue[i]!,node=path[path.length-1]!;if(node===to)return path;
    for(const next of [...state.territories.get(node)!.neighboring].sort(comparePlanIds))if(!seen.has(next)&&state.territories.has(next)){seen.add(next);queue.push([...path,next]);}}
  return null;
}
