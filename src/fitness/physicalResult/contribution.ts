import { WorkoutSessionSummaryExercise } from '../session/types';
import {
  PHYSICAL_RESULT_CONFIG,
  PhysicalResultConfig,
  exerciseModifier,
  roundPhysicalOutput,
} from './config';
import { classifyPhysicalWork, roleFactorForClass } from './classification';
import { PhysicalExerciseContribution } from './types';

function creditedQuantity(completed: number, prescribed: number | null): number {
  if (completed <= 0) return 0;
  if (prescribed === null) return completed;
  return Math.min(completed, prescribed);
}

export function contributeExercise(
  step: WorkoutSessionSummaryExercise,
  difficultyFactorValue: number,
  config: PhysicalResultConfig = PHYSICAL_RESULT_CONFIG,
): PhysicalExerciseContribution {
  const workClass = classifyPhysicalWork(step, config);
  const roleFactor = roleFactorForClass(workClass, config);
  const modifier = exerciseModifier(step.exerciseId, config);
  const skippedOrNone = step.status === 'SKIPPED_REST' || step.actual.kind === 'none';

  const prescribedRepetitions = step.prescribed.kind === 'repetitions' ? step.prescribed.repetitions : null;
  const completedRepetitions = step.actual.kind === 'repetitions' ? step.actual.completedRepetitions : null;
  const prescribedDurationSeconds = step.prescribed.kind === 'duration' ? step.prescribed.durationSeconds : null;
  const completedDurationSeconds = step.actual.kind === 'duration' ? step.actual.completedDurationSeconds : null;

  let creditedRepetitions: number | null = null;
  let creditedDurationSeconds: number | null = null;
  let unitValue = 0;
  let raw = 0;
  let notes = 'no_credited_work';

  if (step.exerciseType === 'REP_BASED') {
    creditedRepetitions = skippedOrNone ? 0 : creditedQuantity(completedRepetitions ?? 0, prescribedRepetitions);
    unitValue = config.repWorkUnit;
    raw = creditedRepetitions * unitValue * modifier * roleFactor * difficultyFactorValue;
    notes = workClass === 'TRAINING' ? 'rep_based_completed_work' : `${workClass.toLowerCase()}_zero_or_reduced`;
  } else {
    creditedDurationSeconds = skippedOrNone ? 0 : creditedQuantity(completedDurationSeconds ?? 0, prescribedDurationSeconds);
    unitValue = config.timedWorkUnitPerSecond;
    raw = creditedDurationSeconds * unitValue * modifier * roleFactor * difficultyFactorValue;
    notes = workClass === 'TRAINING'
      ? 'timed_completed_work'
      : workClass === 'REST'
        ? 'rest_zero_output'
        : 'stretch_zero_or_reduced';
  }

  if (roleFactor === 0) {
    raw = 0;
    notes = workClass === 'REST' ? 'rest_zero_output' : 'stretch_zero_output';
  }

  return {
    order: step.order,
    exerciseId: step.exerciseId,
    exerciseType: step.exerciseType,
    bodySection: step.bodySection,
    status: step.status,
    workClass,
    prescribedRepetitions,
    completedRepetitions,
    creditedRepetitions,
    prescribedDurationSeconds,
    completedDurationSeconds,
    creditedDurationSeconds,
    unitValue,
    exerciseModifier: modifier,
    roleFactor,
    difficultyFactor: difficultyFactorValue,
    physicalOutput: roundPhysicalOutput(raw),
    notes,
  };
}
