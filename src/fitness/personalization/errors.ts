export const FITNESS_PERSONALIZATION_ERROR_CODES = [
  'personalization.invalid_player',
  'personalization.invalid_estimate',
  'personalization.player_mismatch',
  'personalization.invalid_difficulty',
  'personalization.invalid_workout',
  'personalization.unknown_exercise',
  'personalization.invalid_prescription',
  'personalization.invalid_configuration',
] as const;

export type FitnessPersonalizationErrorCode = (typeof FITNESS_PERSONALIZATION_ERROR_CODES)[number];

export interface FitnessPersonalizationError {
  code: FitnessPersonalizationErrorCode;
  message: string;
  details?: Record<string, string | number | boolean | null>;
}

export type PersonalizationOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: FitnessPersonalizationError };

export function personalizationOk<T>(value: T): PersonalizationOpResult<T> {
  return { ok: true, value };
}

export function personalizationErr<T = never>(
  code: FitnessPersonalizationErrorCode,
  message: string,
  details?: FitnessPersonalizationError['details'],
): PersonalizationOpResult<T> {
  return { ok: false, error: { code, message, details } };
}
