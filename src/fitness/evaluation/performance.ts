import { CompletedWorkoutRecord, WorkoutSessionSummaryExercise } from '../session/types';
import { ratio } from './ratio';
import { CompletionPerformanceEvidence } from './types';

function isMandatory(step: WorkoutSessionSummaryExercise): boolean {
  return step.exerciseType !== 'REST' && !step.isRest;
}

function completedReps(step: WorkoutSessionSummaryExercise): number {
  return step.actual.kind === 'repetitions' ? step.actual.completedRepetitions : 0;
}

function prescribedReps(step: WorkoutSessionSummaryExercise): number {
  return step.prescribed.kind === 'repetitions' ? step.prescribed.repetitions : 0;
}

function completedDuration(step: WorkoutSessionSummaryExercise): number {
  return step.actual.kind === 'duration' ? step.actual.completedDurationSeconds : 0;
}

function prescribedDuration(step: WorkoutSessionSummaryExercise): number {
  return step.prescribed.kind === 'duration' ? step.prescribed.durationSeconds : 0;
}

export function buildCompletionEvidence(record: CompletedWorkoutRecord): CompletionPerformanceEvidence {
  const exercises = record.summary.exercises;
  const mandatory = exercises.filter(isMandatory);
  const completed = exercises.filter((step) => step.status === 'COMPLETED');
  const skippedRest = exercises.filter((step) => step.status === 'SKIPPED_REST');
  const incompleteMandatory = exercises.filter((step) => step.status === 'INCOMPLETE_MANDATORY');
  const repBased = exercises.filter((step) => step.exerciseType === 'REP_BASED');
  const timed = exercises.filter((step) => step.exerciseType === 'TIMED');

  const quality = incompleteMandatory.length > 0 ? 'PARTIAL' : 'STRONG';

  return {
    source: 'COMPLETION',
    quality,
    exercisesPrescribed: exercises.length,
    exercisesCompleted: completed.length,
    exercisesSkippedRest: skippedRest.length,
    exercisesIncompleteMandatory: incompleteMandatory.length,
    mandatoryPrescribed: mandatory.length,
    mandatoryCompleted: mandatory.filter((step) => step.status === 'COMPLETED').length,
    mandatoryCompletionRatio: ratio(
      mandatory.filter((step) => step.status === 'COMPLETED').length,
      mandatory.length,
    ),
    resolvedRatio: ratio(completed.length + skippedRest.length, exercises.length),
    repBased: {
      exercisesPrescribed: repBased.length,
      exercisesCompleted: repBased.filter((step) => step.status === 'COMPLETED').length,
      exercisesIncomplete: repBased.filter((step) => step.status === 'INCOMPLETE_MANDATORY').length,
      prescribedRepetitions: repBased.reduce((sum, step) => sum + prescribedReps(step), 0),
      completedRepetitions: repBased.reduce((sum, step) => sum + completedReps(step), 0),
    },
    timed: {
      exercisesPrescribed: timed.length,
      exercisesCompleted: timed.filter((step) => step.status === 'COMPLETED').length,
      exercisesIncomplete: timed.filter((step) => step.status === 'INCOMPLETE_MANDATORY').length,
      prescribedDurationSeconds: timed.reduce((sum, step) => sum + prescribedDuration(step), 0),
      completedDurationSeconds: timed.reduce((sum, step) => sum + completedDuration(step), 0),
    },
  };
}
