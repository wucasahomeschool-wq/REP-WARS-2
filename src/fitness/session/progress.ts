import { isPositiveInteger, isPositiveNumber } from '../guards';
import { cloneWorkoutSession } from './clone';
import { sessionErr, sessionOk, SessionOpResult } from './errors';
import { activeDurationMs, isFiniteTimestamp } from './timing';
import {
  ExercisePerformance,
  SessionPrescribedExercise,
  WorkoutSession,
} from './types';

export interface CompleteExerciseInput {
  order: number;
  repetitions?: number;
  durationSeconds?: number;
}

export function getCurrentExercise(session: WorkoutSession): SessionPrescribedExercise | null {
  if (session.currentExerciseIndex === null) return null;
  return session.prescribedWorkout.exercises[session.currentExerciseIndex] ?? null;
}

function requireActive(session: WorkoutSession, now: number): SessionOpResult<WorkoutSession> | null {
  if (!isFiniteTimestamp(now)) {
    return sessionErr('session.invalid_timestamp', 'Session timestamp must be a finite number');
  }
  if (typeof session.sessionId !== 'string' || session.sessionId.trim() === '') {
    return sessionErr('session.invalid_session_id', 'Session id is invalid');
  }
  if (session.state === 'COMPLETED' || session.state === 'ABANDONED') {
    return sessionErr('session.terminal', `Session ${session.sessionId} is ${session.state} and cannot change`, {
      sessionId: session.sessionId,
      state: session.state,
    });
  }
  if (session.state !== 'ACTIVE') {
    return sessionErr(
      'session.invalid_state_transition',
      `Exercises can only be recorded while ACTIVE, not ${session.state}`,
      { from: session.state },
    );
  }
  return null;
}

function requireCurrent(
  session: WorkoutSession,
  order: number,
): SessionOpResult<{ step: SessionPrescribedExercise; performance: ExercisePerformance }> {
  const step = session.prescribedWorkout.exercises[order];
  const performance = session.performances[order];
  if (!step || !performance) {
    return sessionErr('session.wrong_exercise', `No exercise at order ${order}`, { requested: order });
  }
  if (performance.status === 'COMPLETED' || performance.status === 'SKIPPED_REST') {
    return sessionErr(
      'session.exercise_already_completed',
      `Exercise ${order} has already been recorded as ${performance.status}`,
      { order },
    );
  }
  if (session.currentExerciseIndex === null || session.currentExerciseIndex !== order) {
    return sessionErr(
      'session.wrong_exercise',
      `Current exercise is ${session.currentExerciseIndex}, cannot record order ${order}`,
      { current: session.currentExerciseIndex ?? -1, requested: order },
    );
  }
  return sessionOk({ step, performance });
}

function finishCurrentExercise(next: WorkoutSession, now: number): void {
  const index = next.currentExerciseIndex;
  if (index === null) return;
  const lastIndex = next.prescribedWorkout.exercises.length - 1;
  if (index >= lastIndex) {
    next.state = 'COMPLETED';
    next.completedAt = now;
    next.currentExerciseIndex = null;
    next.feedbackState = 'FEEDBACK_REQUIRED';
    return;
  }
  next.currentExerciseIndex = index + 1;
  const upcoming = next.performances[next.currentExerciseIndex];
  if (upcoming) upcoming.startedAt = now;
}

function applyActiveDuration(performance: ExercisePerformance, session: WorkoutSession, now: number): void {
  if (performance.startedAt === null) performance.startedAt = now;
  performance.activeDurationMs = activeDurationMs(performance.startedAt, now, session.pauseIntervals);
}

export function completeExercise(
  session: WorkoutSession,
  input: CompleteExerciseInput,
  now: number,
): SessionOpResult<WorkoutSession> {
  const active = requireActive(session, now);
  if (active) return active;
  const current = requireCurrent(session, input.order);
  if (!current.ok) return sessionErr(current.error.code, current.error.message, current.error.details);

  const { step } = current.value;
  const next = cloneWorkoutSession(session);
  const performance = next.performances[input.order]!;

  if (step.exerciseType === 'REP_BASED') {
    if (input.durationSeconds !== undefined) {
      return sessionErr(
        'session.prescription_mismatch',
        'REP_BASED exercises record repetitions, not duration',
        { order: input.order },
      );
    }
    if (!isPositiveInteger(input.repetitions)) {
      return sessionErr('session.invalid_repetitions', 'Completed repetitions must be a positive integer', {
        order: input.order,
      });
    }
    if (step.prescription.kind !== 'repetitions') {
      return sessionErr('session.prescription_mismatch', 'REP_BASED prescription is missing repetitions', {
        order: input.order,
      });
    }
    applyActiveDuration(performance, next, now);
    performance.actual = { kind: 'repetitions', completedRepetitions: input.repetitions };
    if (input.repetitions >= step.prescription.repetitions) {
      performance.status = 'COMPLETED';
      performance.completedAt = now;
      finishCurrentExercise(next, now);
    } else {
      performance.status = 'INCOMPLETE_MANDATORY';
      performance.completedAt = null;
    }
    return sessionOk(next);
  }

  if (step.exerciseType === 'TIMED' || step.exerciseType === 'REST') {
    if (input.repetitions !== undefined) {
      return sessionErr(
        'session.prescription_mismatch',
        `${step.exerciseType} exercises record duration, not repetitions`,
        { order: input.order },
      );
    }
    if (!isPositiveNumber(input.durationSeconds)) {
      return sessionErr('session.invalid_duration', 'Completed duration must be a positive number of seconds', {
        order: input.order,
      });
    }
    if (step.prescription.kind !== 'duration') {
      return sessionErr('session.prescription_mismatch', `${step.exerciseType} prescription is missing duration`, {
        order: input.order,
      });
    }
    applyActiveDuration(performance, next, now);
    performance.actual = { kind: 'duration', completedDurationSeconds: input.durationSeconds };
    if (step.exerciseType === 'REST' || input.durationSeconds >= step.prescription.durationSeconds) {
      performance.status = 'COMPLETED';
      performance.completedAt = now;
      finishCurrentExercise(next, now);
    } else {
      performance.status = 'INCOMPLETE_MANDATORY';
      performance.completedAt = null;
    }
    return sessionOk(next);
  }

  return sessionErr('session.prescription_mismatch', `Unsupported exercise type ${step.exerciseType}`, {
    order: input.order,
  });
}

export function skipExercise(
  session: WorkoutSession,
  order: number,
  now: number,
): SessionOpResult<WorkoutSession> {
  const active = requireActive(session, now);
  if (active) return active;
  const current = requireCurrent(session, order);
  if (!current.ok) return sessionErr(current.error.code, current.error.message, current.error.details);

  const { step } = current.value;
  if (!step.isRest || !step.skippable || step.exerciseType !== 'REST') {
    return sessionErr(
      'session.cannot_skip_mandatory',
      'Only REST exercises may be skipped',
      { order, exerciseId: step.exerciseId },
    );
  }

  const next = cloneWorkoutSession(session);
  const performance = next.performances[order]!;
  applyActiveDuration(performance, next, now);
  performance.actual = { kind: 'skipped_rest' };
  performance.status = 'SKIPPED_REST';
  performance.completedAt = now;
  finishCurrentExercise(next, now);
  return sessionOk(next);
}
