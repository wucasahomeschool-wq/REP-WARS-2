import { sessionErr, SessionOpResult } from './errors';
import { WorkoutSession, WorkoutSessionState } from './types';

export const VALID_SESSION_TRANSITIONS: Readonly<Record<WorkoutSessionState, readonly WorkoutSessionState[]>> = {
  NOT_STARTED: ['ACTIVE'],
  ACTIVE: ['PAUSED', 'COMPLETED', 'ABANDONED'],
  PAUSED: ['ACTIVE', 'ABANDONED'],
  COMPLETED: [],
  ABANDONED: [],
};

export function isTerminalSessionState(state: WorkoutSessionState): boolean {
  return state === 'COMPLETED' || state === 'ABANDONED';
}

export function canTransitionSession(from: WorkoutSessionState, to: WorkoutSessionState): boolean {
  return VALID_SESSION_TRANSITIONS[from].includes(to);
}

export function rejectIfTerminal<T>(session: WorkoutSession): SessionOpResult<T> | null {
  if (!isTerminalSessionState(session.state)) return null;
  return sessionErr(
    'session.terminal',
    `Session ${session.sessionId} is ${session.state} and cannot change`,
    { sessionId: session.sessionId, state: session.state },
  );
}

export function rejectInvalidTransition<T>(
  session: WorkoutSession,
  to: WorkoutSessionState,
): SessionOpResult<T> | null {
  if (canTransitionSession(session.state, to)) return null;
  return sessionErr(
    'session.invalid_state_transition',
    `Cannot transition workout session from ${session.state} to ${to}`,
    { from: session.state, to },
  );
}
