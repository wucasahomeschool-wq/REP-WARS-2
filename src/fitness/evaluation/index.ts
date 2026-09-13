export {
  FITNESS_EVIDENCE_VERSION,
  FITNESS_EVIDENCE_SOURCES,
  EVIDENCE_QUALITIES,
  FEEDBACK_RELATIVE_OFFSET,
  RELATIVE_DIFFICULTY_READINGS,
} from './types';
export type {
  FitnessEvidenceSource,
  EvidenceQuality,
  RelativeDifficultyReading,
  FitnessEvaluationContext,
  PerceivedDifficultyEvidence,
  CompletionPerformanceEvidence,
  RepSpeedEvidence,
  WorkloadEvidence,
  RestSkippingEvidence,
  BodySectionEvidence,
  FrequencyEvidence,
  RegroupingEvidence,
  FitnessEvidenceComponents,
  FitnessEvidence,
  FitnessEvaluationIssue,
} from './types';

export {
  FITNESS_EVALUATION_ERROR_CODES,
} from './errors';
export type {
  FitnessEvaluationErrorCode,
  FitnessEvaluationError,
  EvaluationOpResult,
} from './errors';

export { validateCompletedWorkoutRecord, isEligibleCompletedWorkoutRecord } from './validation';
export { validateFitnessEvidence, cloneFitnessEvidence } from './clone';
export { evaluateFitnessEvidence, evaluateSessionFitnessEvidence } from './evaluator';
