export {
  FITNESS_PERSONALIZATION_VERSION,
  FITNESS_PERSONALIZATION_CONFIG,
  roundPersonalization,
  clampPersonalization,
} from './config';
export type { FitnessPersonalizationConfig } from './config';

export type {
  PersonalizationInput,
  PersonalizationMapping,
  PersonalizedExerciseDecision,
} from './types';

export {
  FITNESS_PERSONALIZATION_ERROR_CODES,
} from './errors';
export type {
  FitnessPersonalizationErrorCode,
  FitnessPersonalizationError,
  PersonalizationOpResult,
} from './errors';

export { validatePersonalizationConfig } from './validation';
export {
  confidenceFactor,
  fitnessShiftFromLevel,
  difficultyShiftFromRanks,
  fitnessLevelForSection,
  computePersonalizationMapping,
} from './mapping';
export {
  personalizationDecisionForStep,
  scaleRepetitions,
  scaleDurationSeconds,
  scaleExercisePrescription,
} from './scale';
export { personalizeWorkout } from './evaluator';
