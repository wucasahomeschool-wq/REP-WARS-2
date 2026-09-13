import { cloneWorkoutSession } from './clone';
import { sessionErr, sessionOk, SessionOpResult } from './errors';
import { isFiniteTimestamp } from './timing';
import {
  WORKOUT_FEEDBACK_VALUES,
  WorkoutFeedbackValue,
  WorkoutSession,
} from './types';

export function isWorkoutFeedbackValue(value: unknown): value is WorkoutFeedbackValue {
  return typeof value === 'string' && (WORKOUT_FEEDBACK_VALUES as readonly string[]).includes(value);
}

export function submitWorkoutFeedback(
  session: WorkoutSession,
  value: WorkoutFeedbackValue,
  now: number,
): SessionOpResult<WorkoutSession> {
  if (!isFiniteTimestamp(now)) {
    return sessionErr('session.invalid_timestamp', 'Session timestamp must be a finite number');
  }
  if (typeof session.sessionId !== 'string' || session.sessionId.trim() === '') {
    return sessionErr('session.invalid_session_id', 'Session id is invalid');
  }
  if (!isWorkoutFeedbackValue(value)) {
    return sessionErr('session.invalid_feedback', 'Feedback value is invalid');
  }
  if (session.state !== 'COMPLETED') {
    return sessionErr(
      'session.feedback_not_allowed',
      `Feedback can only be submitted for a COMPLETED session, not ${session.state}`,
      { state: session.state },
    );
  }
  if (session.feedbackState === 'FEEDBACK_SUBMITTED' || session.feedback !== null) {
    return sessionErr('session.feedback_already_submitted', 'Feedback can only be submitted once', {
      sessionId: session.sessionId,
    });
  }

  const next = cloneWorkoutSession(session);
  next.feedbackState = 'FEEDBACK_SUBMITTED';
  next.feedback = {
    value,
    intendedDifficulty: session.intendedDifficulty,
    submittedAt: now,
  };
  return sessionOk(next);
}
