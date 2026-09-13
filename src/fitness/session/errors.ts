export const WORKOUT_SESSION_ERROR_CODES = [
  'session.invalid_player',
  'session.invalid_workout',
  'session.unknown_workout',
  'session.invalid_difficulty',
  'session.invalid_purpose',
  'session.invalid_prescription',
  'session.invalid_session_id',
  'session.invalid_timestamp',
  'session.invalid_state_transition',
  'session.terminal',
  'session.wrong_exercise',
  'session.exercise_already_completed',
  'session.cannot_skip_mandatory',
  'session.invalid_repetitions',
  'session.invalid_duration',
  'session.prescription_mismatch',
  'session.feedback_not_allowed',
  'session.feedback_already_submitted',
  'session.invalid_feedback',
  'session.not_completed',
] as const;

export type WorkoutSessionErrorCode = (typeof WORKOUT_SESSION_ERROR_CODES)[number];

export interface WorkoutSessionError {
  code: WorkoutSessionErrorCode;
  message: string;
  details?: Record<string, string | number | boolean | null>;
}

export type SessionOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: WorkoutSessionError };

export function sessionOk<T>(value: T): SessionOpResult<T> {
  return { ok: true, value };
}

export function sessionErr<T = never>(
  code: WorkoutSessionErrorCode,
  message: string,
  details?: WorkoutSessionError['details'],
): SessionOpResult<T> {
  return { ok: false, error: { code, message, details } };
}
