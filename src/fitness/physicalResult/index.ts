export {
  PHYSICAL_RESULT_MODEL_VERSION,
  PHYSICAL_OUTPUT_VERSION,
} from './types';
export type {
  PhysicalWorkClass,
  PhysicalExerciseContribution,
  PhysicalBodySectionOutput,
  PhysicalResult,
  PhysicalResultContext,
} from './types';

export {
  PHYSICAL_RESULT_CONFIG,
  roundPhysicalOutput,
  clampPhysicalOutput,
  difficultyFactor,
  exerciseModifier,
} from './config';
export type { PhysicalResultConfig } from './config';

export {
  PHYSICAL_RESULT_ERROR_CODES,
} from './errors';
export type {
  PhysicalResultErrorCode,
  PhysicalResultError,
  PhysicalResultOpResult,
} from './errors';

export { clonePhysicalResult, emptyBodySectionOutput, validatePhysicalResultConfig, validatePhysicalResult } from './clone';
export { classifyPhysicalWork, roleFactorForClass } from './classification';
export { contributeExercise } from './contribution';
export { calculatePhysicalResult } from './evaluator';
