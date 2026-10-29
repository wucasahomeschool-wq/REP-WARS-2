import {empireFoodDemand} from '../economy/foodConsumption';
import type {GameState} from '../../types/GameState';
import type {TradePlan} from '../../types/AIConcretePlan';
import {makeConcretePlan,comparePlanIds} from '../../types/AIConcretePlan';
import {availableStocks,committedTradeReceipts} from './resources';
import {tradeNode} from './policy';
import {TRADE_TUNING} from '../../constants/trade';
import {RESOURCE_KEYS} from '../economy/config';
import {listConstructionProjectTypes,getConstructionProjectDefinition,constructionStartProblem} from '../construction/definitions';
/** Factual present-rule demand only. Current bank storage, eligible authored
 * sites and upkeep; no inferred private Goals or future localized warehouses. */
export function tradeDemand(state:GameState,fid:string) {
  const demand=Object.fromEntries(RESOURCE_KEYS.map(r=>[r,0])) as Record<import('../../types').ResourceType,number>;
  for(const t of state.territories.values())if(t.owner===fid&&!Array.from(state.constructions.values()).some(p=>p.territoryId===t.id&&p.status==='in_progress'))
    for(const kind of listConstructionProjectTypes()) {
      const d=getConstructionProjectDefinition(kind);if(constructionStartProblem(kind,{state,factionId:fid,territoryId:t.id}))continue;
      for(const r of RESOURCE_KEYS)demand[r]=Math.max(demand[r],d.cost[r]??0);
    }
  if((state.worldLevel??0)>=2)demand.food=Math.max(demand.food,empireFoodDemand(state,fid));
  return demand;
}
/** Declared complete bound: each ordered pair of distinct resources with a real
 * proposer shortage/recipient surplus AND recipient shortage/proposer surplus;
 * one exact capped quantity per side, first stable owned dispatch nodes. At most
 * R*(R-1)=20 plans per known counterparty. No private recipient cognition, RNG,
 * Cartesian quantities or global/pair proposal cap. Quantities are tuning. */
export function tradeCandidates(state:GameState,fid:string,counterparty:string,sourceContextId?:string):TradePlan[] {
  const ownStock=availableStocks(state,fid);if(!RESOURCE_KEYS.some(r=>ownStock[r]>0))return [];
  const node=tradeNode(state,fid),otherNode=tradeNode(state,counterparty);
  if(!node||!otherNode||fid===counterparty||!state.factions.get(fid)?.knownFactions.includes(counterparty))return [];
  const own=ownStock,other=availableStocks(state,counterparty),incoming=committedTradeReceipts(state,fid),otherIncoming=committedTradeReceipts(state,counterparty),demand=tradeDemand(state,fid),otherDemand=tradeDemand(state,counterparty),plans:TradePlan[]=[];
  for(const want of RESOURCE_KEYS)for(const give of RESOURCE_KEYS) {
    if(want===give)continue;
    const requested=Math.min(TRADE_TUNING.batch,Math.max(0,demand[want]-own[want]-incoming[want]),Math.max(0,other[want]-otherDemand[want]));
    const offered=Math.min(TRADE_TUNING.batch,Math.max(0,otherDemand[give]-other[give]-otherIncoming[give]),Math.max(0,own[give]-demand[give]));
    if(!Number.isSafeInteger(requested)||!Number.isSafeInteger(offered)||requested<=0||offered<=0)continue;
    const plan=makeConcretePlan({action:'TRADE',factionId:fid,counterpartyId:counterparty,offered:{[give]:offered},requested:{[want]:requested},proposerSource:{kind:'faction_stock',factionId:fid,resources:{[give]:offered}},...(sourceContextId?{sourceContextId}:{})}) as TradePlan;
    // Explicit publication can precede route restoration, but ordinary proactive
    // selection must not knowingly initiate undeliverable current-policy terms.
    plans.push(plan);
  }
  return plans.sort((a,b)=>comparePlanIds(a.id,b.id));
}
/** Cheap observer: detect complementary shortage/surplus, not concrete plans,
 * routes, scores or RNG. No pair loop at all when this faction lacks either
 * real demand or usable surplus. Only known observable counterparties queried. */
export function observableTradeCounterparties(state:GameState,fid:string):string[] {
  const own=availableStocks(state,fid);if(!RESOURCE_KEYS.some(r=>own[r]>0))return [];
  const demand=tradeDemand(state,fid),incoming=committedTradeReceipts(state,fid),needs=RESOURCE_KEYS.filter(r=>own[r]+incoming[r]<demand[r]),surplus=RESOURCE_KEYS.filter(r=>own[r]>demand[r]);
  if(!needs.length||!surplus.length)return [];
  const result:string[]=[];
  for(const otherId of [...new Set(state.factions.get(fid)?.knownFactions??[])].sort(comparePlanIds)) {
    if(otherId===fid||!state.factions.has(otherId))continue;
    const other=availableStocks(state,otherId),otherDemand=tradeDemand(state,otherId),otherIncoming=committedTradeReceipts(state,otherId);
    if(needs.some(want=>other[want]>otherDemand[want])&&surplus.some(give=>other[give]+otherIncoming[give]<otherDemand[give]))result.push(otherId);
  }
  return result;
}
