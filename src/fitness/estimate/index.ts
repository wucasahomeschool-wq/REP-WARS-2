export {
  FITNESS_MODEL_VERSION,
  FITNESS_EVALUATION_VERSION,
} from './types';
export type {
  FitnessNetDirection,
  FitnessBodySectionLevels,
  FitnessEstimate,
  FitnessHistoryContext,
  FitnessSourceContribution,
  FitnessFrequencySnapshot,
  FitnessEvaluationResult,
  CreateFitnessEstimateInput,
} from './types';

export {
  FITNESS_EVALUATION_CONFIG,
  MS_PER_DAY,
  MS_PER_WEEK,
  MS_PER_MONTH,
  roundFitness,
  clampFitness,
} from './config';
export type { FitnessEvaluationConfig } from './config';

export { FITNESS_ESTIMATE_ERROR_CODES } from './errors';
export type { FitnessEstimateErrorCode, FitnessEstimateError, EstimateOpResult } from './errors';

export { cloneFitnessEstimate, cloneFitnessEvaluationResult } from './clone';
export { validateFitnessEstimate } from './validation';
export { recencyFactor, decayConfidence } from './recency';
export { createInitialFitnessEstimate, evaluateFitness, applyFitnessEvaluation } from './evaluator';
