import {TRADE_TUNING} from '../constants/trade';
import {goalPreference} from '../cognition/goals';
import {factionDecisionView} from '../cognition/decisionView';
import {opinionPreference} from '../cognition/opinion';
import {makeConcretePlan} from '../types/AIConcretePlan';
import {STRATEGIC_EVALUATION_TUNING as T} from '../constants/strategicEvaluation';
import type {GameState} from '../types/GameState';
import type {TradeProposal} from '../types/Trade';
import {acceptanceProblem} from '../gameplay/trade/trade';
import {bundleEntries} from '../gameplay/trade/resources';
import {FactualSupport} from './factualSupport';
import {StrategicEvaluators} from './strategicEvaluators';
/** Proposer-authorized estimate boundary: exact visible terms only. No access
 * to recipient Goals, Opinion, Pressure, Memory, risk, RNG or deliberation. */
export function tradeResponseEstimate(view:{offered:import('../types/AIConcretePlan').ResourceBundle;requested:import('../types/AIConcretePlan').ResourceBundle}) {
  return {acceptanceBounds:[0,1] as const,confidence:'limited' as const,limitations:['Exact visible terms are known; recipient private preferences and future holdings are unknown.']};
}
export function assessRequiredTradeResponse(state:GameState,p:TradeProposal) {
  const problem=acceptanceProblem(state,p);if(problem)return {outcome:'DECLINE_TRADE' as const,reason:problem};
  const evaluator=new StrategicEvaluators(new FactualSupport(state));
  const gain=bundleEntries(p.plan.offered).reduce((n,[r,q])=>n+evaluator.resourceValue(p.recipient,r,q,'gain').facts.marginalUtility,0);
  const loss=bundleEntries(p.plan.requested).reduce((n,[r,q])=>n+evaluator.resourceValue(p.recipient,r,q,'loss').facts.marginalUtility,0);
  // Required assessment uses own canonical value. No Pressure prerequisite,
  // ordinary Attention charge, fabricated hostility penalty or raw Memory.
  const view=factionDecisionView(state,p.recipient);
  const responsePlan=makeConcretePlan({action:'TRADE',factionId:p.recipient,counterpartyId:p.proposer,offered:p.plan.requested,requested:p.plan.offered});
  const goals=goalPreference(state,p.recipient,responsePlan,T.modifierBound);
  const opinion=opinionPreference(view.own.opinions.get(p.proposer)??0,'TRADE');
  const factual=(gain-loss)/(T.resourceScale+Math.abs(gain-loss))*TRADE_TUNING.resourceWeight;
  const modifier=Math.max(-T.modifierStackBound,Math.min(T.modifierStackBound,goals.value+opinion));
  return {outcome:factual+modifier>=0?'ACCEPT_TRADE' as const:'DECLINE_TRADE' as const,reason:'Own factual RESOURCE_VALUE plus bounded own Goal/Opinion preference',
    factual,modifier,opinion,goal:goals.value,goalAssessments:goals.assessments};
}
