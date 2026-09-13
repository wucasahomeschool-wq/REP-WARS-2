import { cloneWorkoutSession } from './clone';
import { sessionErr, sessionOk, SessionOpResult } from './errors';
import { currentOpenPause, isFiniteTimestamp } from './timing';
import { rejectIfTerminal, rejectInvalidTransition } from './transitions';
import { WorkoutAbandonmentReason, WorkoutSession } from './types';

function requireTimestamp(session: WorkoutSession, now: number): SessionOpResult<WorkoutSession> | null {
  if (!isFiniteTimestamp(now)) {
    return sessionErr('session.invalid_timestamp', 'Session timestamp must be a finite number');
  }
  if (typeof session.sessionId !== 'string' || session.sessionId.trim() === '') {
    return sessionErr('session.invalid_session_id', 'Session id is invalid');
  }
  return null;
}

export function pauseWorkoutSession(session: WorkoutSession, now: number): SessionOpResult<WorkoutSession> {
  const invalid = requireTimestamp(session, now);
  if (invalid) return invalid;
  const terminal = rejectIfTerminal<WorkoutSession>(session);
  if (terminal) return terminal;
  const transition = rejectInvalidTransition<WorkoutSession>(session, 'PAUSED');
  if (transition) return transition;

  const next = cloneWorkoutSession(session);
  next.state = 'PAUSED';
  next.pauseCount += 1;
  next.pauseIntervals.push({ startedAt: now, endedAt: null });
  return sessionOk(next);
}

export function resumeWorkoutSession(session: WorkoutSession, now: number): SessionOpResult<WorkoutSession> {
  const invalid = requireTimestamp(session, now);
  if (invalid) return invalid;
  const terminal = rejectIfTerminal<WorkoutSession>(session);
  if (terminal) return terminal;
  const transition = rejectInvalidTransition<WorkoutSession>(session, 'ACTIVE');
  if (transition) return transition;

  const next = cloneWorkoutSession(session);
  const open = currentOpenPause(next);
  if (open) open.endedAt = now;
  next.state = 'ACTIVE';
  return sessionOk(next);
}

export function abandonWorkoutSession(
  session: WorkoutSession,
  now: number,
  reason: WorkoutAbandonmentReason = 'PLAYER',
): SessionOpResult<WorkoutSession> {
  const invalid = requireTimestamp(session, now);
  if (invalid) return invalid;
  const terminal = rejectIfTerminal<WorkoutSession>(session);
  if (terminal) return terminal;
  const transition = rejectInvalidTransition<WorkoutSession>(session, 'ABANDONED');
  if (transition) return transition;

  const next = cloneWorkoutSession(session);
  const open = currentOpenPause(next);
  if (open) open.endedAt = now;
  next.state = 'ABANDONED';
  next.abandonedAt = now;
  next.abandonmentReason = reason;
  next.feedbackState = 'NOT_APPLICABLE';
  return sessionOk(next);
}
