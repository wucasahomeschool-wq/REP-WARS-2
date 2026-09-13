import { CompletedWorkoutRecord, WorkoutSessionSummaryExercise } from '../session/types';
import { ratio } from './ratio';
import { WorkloadEvidence } from './types';

function prescribedReps(step: WorkoutSessionSummaryExercise): number {
  return step.exerciseType === 'REP_BASED' && step.prescribed.kind === 'repetitions'
    ? step.prescribed.repetitions
    : 0;
}

function completedReps(step: WorkoutSessionSummaryExercise): number {
  return step.exerciseType === 'REP_BASED' && step.actual.kind === 'repetitions'
    ? step.actual.completedRepetitions
    : 0;
}

function prescribedTimed(step: WorkoutSessionSummaryExercise): number {
  return step.exerciseType === 'TIMED' && step.prescribed.kind === 'duration'
    ? step.prescribed.durationSeconds
    : 0;
}

function completedTimed(step: WorkoutSessionSummaryExercise): number {
  return step.exerciseType === 'TIMED' && step.actual.kind === 'duration'
    ? step.actual.completedDurationSeconds
    : 0;
}

export function buildWorkloadEvidence(record: CompletedWorkoutRecord): WorkloadEvidence {
  const exercises = record.summary.exercises;
  const active = exercises.filter((step) => step.exerciseType !== 'REST' && !step.isRest);
  const totalPrescribedRepetitions = exercises.reduce((sum, step) => sum + prescribedReps(step), 0);
  const totalCompletedRepetitions = exercises.reduce((sum, step) => sum + completedReps(step), 0);
  const totalPrescribedTimedDurationSeconds = exercises.reduce((sum, step) => sum + prescribedTimed(step), 0);
  const totalCompletedTimedDurationSeconds = exercises.reduce((sum, step) => sum + completedTimed(step), 0);
  const incomplete = exercises.some((step) => step.status === 'INCOMPLETE_MANDATORY');

  return {
    source: 'WORKLOAD',
    quality: incomplete ? 'PARTIAL' : 'STRONG',
    exerciseCount: exercises.length,
    activeExerciseCount: active.length,
    intendedDifficulty: record.intendedDifficulty,
    totalPrescribedRepetitions,
    totalCompletedRepetitions,
    repetitionCompletionRatio: ratio(totalCompletedRepetitions, totalPrescribedRepetitions),
    totalPrescribedTimedDurationSeconds,
    totalCompletedTimedDurationSeconds,
    timedCompletionRatio: ratio(totalCompletedTimedDurationSeconds, totalPrescribedTimedDurationSeconds),
  };
}
