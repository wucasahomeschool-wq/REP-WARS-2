import { cloneWorkoutSession } from './clone';
import { sessionErr, sessionOk, SessionOpResult } from './errors';
import { abandonWorkoutSession } from './lifecycle';
import { isFiniteTimestamp } from './timing';
import { IntegrityFlagType, WorkoutIntegrityFlag, WorkoutSession } from './types';

export interface RecordIntegrityFlagInput {
  type?: IntegrityFlagType;
}

export function recordIntegrityFlag(
  session: WorkoutSession,
  now: number,
  input: RecordIntegrityFlagInput = {},
): SessionOpResult<WorkoutSession> {
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
  if (session.state !== 'ACTIVE' && session.state !== 'PAUSED') {
    return sessionErr(
      'session.invalid_state_transition',
      `Integrity flags can only be recorded while ACTIVE or PAUSED, not ${session.state}`,
      { from: session.state },
    );
  }

  const flag: WorkoutIntegrityFlag = {
    index: session.integrityFlags.length + 1,
    type: input.type ?? 'SUSPECTED_INTEGRITY',
    recordedAt: now,
    sessionStateAtFlag: session.state,
  };

  const withFlag = cloneWorkoutSession(session);
  withFlag.integrityFlags.push(flag);

  if (withFlag.integrityFlags.length >= 2) {
    return abandonWorkoutSession(withFlag, now, 'INTEGRITY_FLAGS');
  }
  return sessionOk(withFlag);
}
