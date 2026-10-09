import type { GameState } from '../types/GameState';
import { StrategicEvaluators } from './strategicEvaluators';
import { FactualSupport } from './factualSupport';
import { GoalSystem } from '../goals/GoalSystem';
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
  const alignment=new GoalSystem(faction.goals.map(g=>({...g}))).evaluateActionAlignment({actionType:'OFFER_PEACE',targetFaction:proposer,
    targetTerritory:null,self:faction,currentTurn:state.turn,allTerritories:state.territories});
  const goal=Math.max(-T.modifierBound,Math.min(T.modifierBound,alignment.scoreContribution/T.goalScale*T.modifierBound));
  const opinion=Math.max(-100,Math.min(100,faction.diplomacy.get(proposer)?.opinion??0))/100*T.modifierBound;
  const risk=(1-Math.max(0,Math.min(1,faction.personality.riskTolerance)))*Math.max(0,-war.facts.currentPositionBalance)*T.modifierBound;
  const modifier=Math.max(-T.modifierStackBound,Math.min(T.modifierStackBound,goal+opinion+risk));
  return {outcome:factual+modifier>=0?'ACCEPT_PEACE' as const:'DECLINE_PEACE' as const,
    factual,modifier,war,limitations:war.facts.limitations};
}
