import { WorkoutSessionSummaryExercise } from '../session/types';
import { PHYSICAL_RESULT_CONFIG, PhysicalResultConfig } from './config';
import { PhysicalWorkClass } from './types';

export function classifyPhysicalWork(
  step: WorkoutSessionSummaryExercise,
  config: PhysicalResultConfig = PHYSICAL_RESULT_CONFIG,
): PhysicalWorkClass {
  if (step.isRest || step.exerciseType === 'REST' || step.status === 'SKIPPED_REST') {
    return 'REST';
  }
  if ((config.stretchExerciseIds as readonly string[]).includes(step.exerciseId)) {
    return 'STRETCH';
  }
  if (step.bodySection === 'GLOBAL' && step.exerciseType === 'TIMED') {
    return 'STRETCH';
  }
  return 'TRAINING';
}

export function roleFactorForClass(
  workClass: PhysicalWorkClass,
  config: PhysicalResultConfig = PHYSICAL_RESULT_CONFIG,
): number {
  if (workClass === 'REST') return config.restFactor;
  if (workClass === 'STRETCH') return config.stretchFactor;
  return 1;
}
