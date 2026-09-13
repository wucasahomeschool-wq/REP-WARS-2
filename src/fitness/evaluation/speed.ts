import { CompletedWorkoutRecord, WorkoutSessionSummaryExercise } from '../session/types';
import {
  RepSpeedEvidence,
  RepSpeedExerciseEvidence,
} from './types';

function completedRepetitionsOf(step: WorkoutSessionSummaryExercise): number | null {
  if (step.actual.kind === 'repetitions') return step.actual.completedRepetitions;
  return null;
}

function deriveExercise(step: WorkoutSessionSummaryExercise): RepSpeedExerciseEvidence {
  const completedRepetitions = completedRepetitionsOf(step);
  const activeDurationMs = step.activeDurationMs;
  const raw = { completedRepetitions, activeDurationMs };

  if (step.exerciseType !== 'REP_BASED') {
    return {
      order: step.order,
      exerciseId: step.exerciseId,
      status: step.status,
      raw,
      derived: { available: false, reason: 'not_rep_based' },
    };
  }
  if (completedRepetitions === null) {
    return {
      order: step.order,
      exerciseId: step.exerciseId,
      status: step.status,
      raw,
      derived: { available: false, reason: 'missing_repetitions' },
    };
  }
  if (completedRepetitions <= 0) {
    return {
      order: step.order,
      exerciseId: step.exerciseId,
      status: step.status,
      raw,
      derived: { available: false, reason: 'non_positive_repetitions' },
    };
  }
  if (activeDurationMs === null) {
    return {
      order: step.order,
      exerciseId: step.exerciseId,
      status: step.status,
      raw,
      derived: { available: false, reason: 'missing_active_duration' },
    };
  }
  if (activeDurationMs <= 0) {
    return {
      order: step.order,
      exerciseId: step.exerciseId,
      status: step.status,
      raw,
      derived: { available: false, reason: 'non_positive_duration' },
    };
  }
  return {
    order: step.order,
    exerciseId: step.exerciseId,
    status: step.status,
    raw,
    derived: {
      available: true,
      averageMsPerRep: activeDurationMs / completedRepetitions,
    },
  };
}

export function buildRepSpeedEvidence(record: CompletedWorkoutRecord): RepSpeedEvidence {
  const exercises = record.summary.exercises.map(deriveExercise);
  const repBased = exercises.filter((step, index) => record.summary.exercises[index]!.exerciseType === 'REP_BASED');
  const available = repBased.filter((step) => step.derived.available);

  let quality: RepSpeedEvidence['quality'] = 'UNAVAILABLE';
  if (repBased.length === 0) {
    quality = 'UNAVAILABLE';
  } else if (available.length === 0) {
    quality = 'UNAVAILABLE';
  } else if (available.length === repBased.length) {
    quality = 'STRONG';
  } else {
    quality = 'PARTIAL';
  }

  const aggregate = available.length === 0
    ? {
        available: false as const,
        reason: repBased.length === 0 ? 'no_rep_based_exercises' : 'insufficient_timing',
      }
    : (() => {
        const totalCompletedRepetitions = available.reduce((sum, step) => sum + (step.raw.completedRepetitions ?? 0), 0);
        const totalActiveDurationMs = available.reduce((sum, step) => sum + (step.raw.activeDurationMs ?? 0), 0);
        return {
          available: true as const,
          totalCompletedRepetitions,
          totalActiveDurationMs,
          averageMsPerRep: totalActiveDurationMs / totalCompletedRepetitions,
        };
      })();

  return {
    source: 'REP_SPEED',
    quality,
    timingPrecision: 'session_clock_minus_pauses',
    exercises,
    aggregate,
  };
}
