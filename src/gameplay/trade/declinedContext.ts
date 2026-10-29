import { deriveSources } from '../../engine/strategicPressure';
import type { GameState } from '../../types/GameState';
import type { TradePlan } from '../../types/AIConcretePlan';
import { cloneConcretePlan, comparePlanIds } from '../../types/AIConcretePlan';
import type { TradeProposal } from '../../types/Trade';
import { availableStocks, committedTradeReceipts, bundleEntries } from './resources';
import { tradeDemand } from './candidates';
import { relationshipBetween } from '../diplomacy/relationships';
import { activeGoals } from '../../cognition/goals';

const DECLINED_CONTEXT = 'Exact Trade declined in observed context:';
/** A current proposer-owned relevance predicate, not a score/history cache or
 * a forecast of recipient-private cognition. Only resources in these terms,
 * their current banks/demand, public relationship and own
 * modifiers matter. Unrelated +1 pool troops/clock/Pressure do not rearm it. */
export function declinedTradeContext(state:GameState,plan:TradePlan):string {
  const resources=[...new Set([...bundleEntries(plan.offered),...bundleEntries(plan.requested)].map(([r])=>r))].sort(comparePlanIds);
  const stock=availableStocks(state,plan.factionId),otherStock=availableStocks(state,plan.counterpartyId);
  const incoming=committedTradeReceipts(state,plan.factionId),otherIncoming=committedTradeReceipts(state,plan.counterpartyId);
  const demand=tradeDemand(state,plan.factionId),otherDemand=tradeDemand(state,plan.counterpartyId);
  const own=state.factions.get(plan.factionId);
  return DECLINED_CONTEXT+JSON.stringify([
    plan.id,resources.map(r=>[r,stock[r],otherStock[r],incoming[r],otherIncoming[r],demand[r],otherDemand[r]]),
    relationshipBetween(state,plan.factionId,plan.counterpartyId),
    own?.diplomacy.get(plan.counterpartyId)?.opinion??0,own?.personality.riskTolerance,
    activeGoals(state,plan.factionId).filter(g=>g.lifecycle?.objective?.kind==='RESOURCE_HOLDING'&&resources.includes(g.lifecycle.objective.resource))
      .map(g=>[g.id,g.priority,g.progress,g.lifecycle?.objective]),
  ]);
}
/** Called after the native terminal reducer has released the offer's claims.
 * Other terms remain available and explicit/manual offers remain legal. The
 * existing canonical source/blocker record bounds retention to current plans. */
export function rememberDeclinedTrade(state:GameState,proposal:TradeProposal):void {
  const id=proposal.plan.sourceContextId;
  if(!id)return;
  // Reserving all available surplus can remove the live source while this
  // proposal is pending. After release, rediscover only an opportunity that
  // actually exists now; do not recreate history or advance any clocks.
  const source=state.aiPressure.get(id)??deriveSources(state,proposal.proposer,state.aiClock.nowMs).find(s=>s.id===id);
  if(!source||source.kind!=='RESOURCE_EXCHANGE'||source.factionId!==proposal.proposer||source.counterpartyId!==proposal.recipient)return;
  state.aiPressure.set(id,source);
  source.blockers=source.blockers.filter(b=>b.plan.id!==proposal.plan.id);
  source.blockers.push({plan:cloneConcretePlan(proposal.plan),reasons:[{kind:'CONTEXT',reason:declinedTradeContext(state,proposal.plan)}]});
  source.blockers.sort((a,b)=>comparePlanIds(a.plan.id,b.plan.id));
}
export function unchangedTradeDecline(state:GameState,plan:TradePlan,blockers:import('../../types/AIPressure').SourceBlocker[]) {
  const old=blockers.find(b=>b.plan.id===plan.id&&b.reasons.some(r=>r.kind==='CONTEXT'&&r.reason.startsWith(DECLINED_CONTEXT)));
  if(!old)return null;
  const current=declinedTradeContext(state,plan);
  return old.reasons.find(r=>r.kind==='CONTEXT'&&r.reason===current)??null;
}
