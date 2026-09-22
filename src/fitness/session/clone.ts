import { clonePrescription } from '../guards';
import {
  ExercisePerformance,
  PauseInterval,
  WorkoutFeedbackRecord,
  WorkoutIntegrityFlag,
  WorkoutSession,
  SessionPrescribedExercise,
  SessionPrescribedWorkout,
} from './types';

export function cloneSessionPrescription(prescription: SessionPrescribedExercise['prescription']): SessionPrescribedExercise['prescription'] {
  return clonePrescription(prescription);
}

export function cloneSessionPrescribedExercise(step: SessionPrescribedExercise): SessionPrescribedExercise {
  return {
    exerciseId: step.exerciseId,
    order: step.order,
    exerciseType: step.exerciseType,
    isRest: step.isRest,
    bodySection: step.bodySection,
    prescription: cloneSessionPrescription(step.prescription),
    role: step.role,
    skippable: step.skippable,
  };
}

export function cloneSessionPrescribedWorkout(prescribed: SessionPrescribedWorkout): SessionPrescribedWorkout {
  return {
    workoutId: prescribed.workoutId,
    intendedDifficulty: prescribed.intendedDifficulty,
    exercises: prescribed.exercises.map(cloneSessionPrescribedExercise),
  };
}

export function cloneExercisePerformance(performance: ExercisePerformance): ExercisePerformance {
  return {
    exerciseId: performance.exerciseId,
    order: performance.order,
    exerciseType: performance.exerciseType,
    prescribed: cloneSessionPrescription(performance.prescribed),
    actual:
      performance.actual.kind === 'repetitions'
        ? { kind: 'repetitions', completedRepetitions: performance.actual.completedRepetitions }
        : performance.actual.kind === 'duration'
          ? { kind: 'duration', completedDurationSeconds: performance.actual.completedDurationSeconds }
          : performance.actual.kind === 'skipped_rest'
            ? { kind: 'skipped_rest' }
            : { kind: 'none' },
    status: performance.status,
    startedAt: performance.startedAt,
    completedAt: performance.completedAt,
    activeDurationMs: performance.activeDurationMs,
  };
}

export function clonePauseInterval(interval: PauseInterval): PauseInterval {
  return { startedAt: interval.startedAt, endedAt: interval.endedAt };
}

export function cloneIntegrityFlag(flag: WorkoutIntegrityFlag): WorkoutIntegrityFlag {
  return {
    index: flag.index,
    type: flag.type,
    recordedAt: flag.recordedAt,
    sessionStateAtFlag: flag.sessionStateAtFlag,
  };
}

export function cloneFeedbackRecord(feedback: WorkoutFeedbackRecord): WorkoutFeedbackRecord {
  return {
    value: feedback.value,
    intendedDifficulty: feedback.intendedDifficulty,
    submittedAt: feedback.submittedAt,
  };
}

export function cloneWorkoutSession(session: WorkoutSession): WorkoutSession {
  return {
    sessionId: session.sessionId,
    playerId: session.playerId,
    workoutId: session.workoutId,
    intendedDifficulty: session.intendedDifficulty,
    purpose: session.purpose,
    state: session.state,
    prescribedWorkout: cloneSessionPrescribedWorkout(session.prescribedWorkout),
    currentExerciseIndex: session.currentExerciseIndex,
    performances: session.performances.map(cloneExercisePerformance),
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    abandonedAt: session.abandonedAt,
    abandonmentReason: session.abandonmentReason,
    pauseIntervals: session.pauseIntervals.map(clonePauseInterval),
    pauseCount: session.pauseCount,
    integrityFlags: session.integrityFlags.map(cloneIntegrityFlag),
    feedbackState: session.feedbackState,
    feedback: session.feedback ? cloneFeedbackRecord(session.feedback) : null,
    ...(session.gameplayContext ? { gameplayContext: { ...session.gameplayContext } } : {}),
    ...(session.authoredCatalog ? { authoredCatalog: { ...session.authoredCatalog } } : {}),
  };
}
