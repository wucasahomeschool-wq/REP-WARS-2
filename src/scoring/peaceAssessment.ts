import type { GameState } from '../types/GameState';
import { StrategicEvaluators } from './strategicEvaluators';
import { FactualSupport } from './factualSupport';
import {goalPreference} from '../cognition/goals';
import {factionDecisionView} from '../cognition/decisionView';
import {opinionPreference} from '../cognition/opinion';
import {makeConcretePlan} from '../types/AIConcretePlan';
import { STRATEGIC_EVALUATION_TUNING as T } from '../constants/strategicEvaluation';
import { PEACE_TUNING } from '../constants/peace';
import { relationshipBetween } from '../gameplay/diplomacy/relationships';

/** COUNTERPARTY_RESPONSE_ESTIMATE is support, not an evaluator or recipient AI.
 * Current world visibility does not authorize private diplomatic intent. With
 * no public response model/history contract, acceptance stays [0,1], limited.
 * The explicit minimal input view cannot contain recipient private state. */
export function counterpartyResponseEstimate(view: {proposer:string;recipient:string;relationship:ReturnType<typeof relationshipBetween>}) {
  return {counterparty:view.recipient,relationship:view.relationship,acceptanceBounds:[0,1] as const,
    confidence:'limited' as const,unresolvedChoice:true,limitations:['No authored public recipient preference/response model; no recursive AI prediction.']};
}
export function peaceEstimateView(state:GameState,proposer:string,recipient:string) {
  return {proposer,recipient,relationship:relationshipBetween(state,proposer,recipient)};
}
/** Required response observes its own canonical state; never calls the
 * proposer's estimate, pressure, proactive selection, Memory or future RNG. */
export function assessRequiredPeaceResponse(state:GameState,recipient:string,proposer:string) {
  const faction=state.factions.get(recipient)!;
  const war=new StrategicEvaluators(new FactualSupport(state)).warValue(recipient,proposer);
  const factual=-war.facts.currentPositionBalance*PEACE_TUNING.warPositionWeight;
  const view=factionDecisionView(state,recipient);
  const progress=goalPreference(state,recipient,makeConcretePlan({action:'OFFER_PEACE',factionId:recipient,counterpartyId:proposer}),T.modifierBound);
  const goal=progress.value;
  const opinion=opinionPreference(view.own.opinions.get(proposer)??0,'OFFER_PEACE');
  const risk=(1-Math.max(0,Math.min(1,faction.personality.riskTolerance)))*Math.max(0,-war.facts.currentPositionBalance)*T.modifierBound;
  const modifier=Math.max(-T.modifierStackBound,Math.min(T.modifierStackBound,goal+opinion+risk));
  return {outcome:factual+modifier>=0?'ACCEPT_PEACE' as const:'DECLINE_PEACE' as const,
    factual,modifier,goal,opinion,goalAssessments:progress.assessments,war,limitations:war.facts.limitations};
}
