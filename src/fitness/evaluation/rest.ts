import { CompletedWorkoutRecord } from '../session/types';
import { ratio } from './ratio';
import { RestSkippingEvidence } from './types';

export function buildRestSkippingEvidence(record: CompletedWorkoutRecord): RestSkippingEvidence {
  const rest = record.summary.exercises.filter((step) => step.exerciseType === 'REST' || step.isRest);
  const restExercisesPrescribed = rest.length;
  const restExercisesCompleted = rest.filter((step) => step.status === 'COMPLETED').length;
  const restExercisesSkipped = rest.filter((step) => step.status === 'SKIPPED_REST').length;

  return {
    source: 'REST_SKIPPING',
    quality: restExercisesPrescribed === 0 ? 'UNAVAILABLE' : 'STRONG',
    restExercisesPrescribed,
    restExercisesCompleted,
    restExercisesSkipped,
    restSkipRate: ratio(restExercisesSkipped, restExercisesPrescribed),
  };
}
