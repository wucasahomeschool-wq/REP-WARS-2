import type { AIConcretePlan } from './AIConcretePlan';
export const STRATEGIC_EVALUATORS = ['BATTLE_OUTLOOK','TERRITORY_VALUE','LOCAL_DANGER','FORCE_POSITION_VALUE','RESOURCE_VALUE','BUILD_VALUE','WAR_VALUE'] as const;
export type StrategicEvaluator = typeof STRATEGIC_EVALUATORS[number];
export interface FactualUncertainty {
  branches: readonly string[];
  realizationStructure: 'deterministic'|'contingent'|'conditional';
  confidence: 'high'|'bounded'|'limited';
  timingSensitivity: boolean;
  unresolvedExternalChoice: boolean;
}
export interface TimingSupport {
  unit: 'world_ticks'; progressTicks: number; remainingTicks: number;
  remainingOnlineMs: readonly [number,number]|null;
  remainingOfflineMs: readonly [number,number]|null;
  presence: 'ONLINE'|'OFFLINE';
  certainty: 'authored'|'persisted'|'blocked'|'external';
  realWorldDeadlineMs: number|null;
  explanation: string;
}
export interface EvaluatorAssessment {
  evaluator: StrategicEvaluator;
  facts: Readonly<Record<string,unknown>>;
  uncertainty: FactualUncertainty;
  provenance: readonly string[];
}
export type ComparisonCategory = 'source_resolution'|'additional_benefit'|'direct_cost'|'opportunity_cost'|'commitment_burden'|'timeliness'|'realization'|'modifier'|'stabilizer';
export interface PlanContribution {
  causalKey: string;
  owner: StrategicEvaluator|'TIMING_SUPPORT'|'ATTENTION_BURDEN'|'GOAL_MODIFIER'|'OPINION_MODIFIER'|'RISK_MODIFIER'|'REPETITION';
  category: ComparisonCategory;
  normalizedMagnitude: number;
  direction: 'benefit'|'cost';
  confidence: FactualUncertainty['confidence'];
  explanation: string;
}
/** Derived, decision-local private explanation. Never serialized into GameState. */
export interface PlanComparison {
  sourceContextId: string; plan: AIConcretePlan;
  assessments: readonly EvaluatorAssessment[];
  contributions: readonly PlanContribution[];
  categories: Readonly<Record<ComparisonCategory,number>>;
  factualValue: number; modifierValue: number; stabilizerValue: number;
  finalValue: number; qualifies: boolean;
  baseline: 'CURRENT_STATE_PLUS_COMMITTED_EFFECTS';
  goalIds: readonly string[];
}
