import { sessionErr, sessionOk, SessionOpResult } from './errors';
import { totalPausedMs } from './timing';
import {
  CompletedWorkoutRecord,
  WorkoutSession,
  WorkoutSessionSummary,
  WorkoutSessionSummaryExercise,
} from './types';

export function isEligibleForFitnessEvaluation(session: WorkoutSession): boolean {
  return session.state === 'COMPLETED' && session.feedbackState === 'FEEDBACK_SUBMITTED';
}

export function buildWorkoutSessionSummary(session: WorkoutSession, now?: number): WorkoutSessionSummary {
  const at = now ?? session.completedAt ?? session.abandonedAt ?? session.startedAt ?? session.createdAt;
  const exercises: WorkoutSessionSummaryExercise[] = session.performances.map((performance) => {
    const prescribed = session.prescribedWorkout.exercises[performance.order]!;
    return {
      order: performance.order,
      exerciseId: performance.exerciseId,
      exerciseType: performance.exerciseType,
      bodySection: prescribed.bodySection,
      isRest: prescribed.isRest,
      status: performance.status,
      prescribed: performance.prescribed,
      actual: performance.actual,
      startedAt: performance.startedAt,
      completedAt: performance.completedAt,
      activeDurationMs: performance.activeDurationMs,
    };
  });
  return {
    sessionId: session.sessionId,
    playerId: session.playerId,
    workoutId: session.workoutId,
    intendedDifficulty: session.intendedDifficulty,
    purpose: session.purpose,
    state: session.state,
    feedbackState: session.feedbackState,
    feedback: session.feedback,
    eligibleForFitnessEvaluation: isEligibleForFitnessEvaluation(session),
    exerciseCount: session.performances.length,
    completedExerciseCount: session.performances.filter((p) => p.status === 'COMPLETED').length,
    skippedRestCount: session.performances.filter((p) => p.status === 'SKIPPED_REST').length,
    mandatoryIncompleteCount: session.performances.filter((p) => p.status === 'INCOMPLETE_MANDATORY').length,
    flagCount: session.integrityFlags.length,
    pauseCount: session.pauseCount,
    totalPausedMs: totalPausedMs(session, at),
    totalActiveDurationMs: session.performances.reduce((sum, p) => sum + (p.activeDurationMs ?? 0), 0),
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    abandonedAt: session.abandonedAt,
    abandonmentReason: session.abandonmentReason,
    exercises,
  };
}

export function finalizeCompletedWorkout(
  session: WorkoutSession,
  now?: number,
): SessionOpResult<CompletedWorkoutRecord> {
  if (session.state !== 'COMPLETED' || session.completedAt === null) {
    return sessionErr(
      'session.not_completed',
      'Only COMPLETED sessions can produce a completed workout record',
      { state: session.state },
    );
  }
  const summary = buildWorkoutSessionSummary(session, now ?? session.completedAt);
  return sessionOk({
    kind: 'completed_workout_record',
    sessionId: session.sessionId,
    playerId: session.playerId,
    workoutId: session.workoutId,
    intendedDifficulty: session.intendedDifficulty,
    purpose: session.purpose,
    completedAt: session.completedAt,
    feedback: session.feedback,
    feedbackState: session.feedbackState,
    eligibleForFitnessEvaluation: summary.eligibleForFitnessEvaluation,
    summary,
  });
}
