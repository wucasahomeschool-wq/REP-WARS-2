export const FITNESS_ESTIMATE_ERROR_CODES = [
  'estimate.invalid_estimate',
  'estimate.invalid_evidence',
  'estimate.player_mismatch',
  'estimate.invalid_timestamp',
  'estimate.invalid_history',
] as const;

export type FitnessEstimateErrorCode = (typeof FITNESS_ESTIMATE_ERROR_CODES)[number];

export interface FitnessEstimateError {
  code: FitnessEstimateErrorCode;
  message: string;
  details?: Record<string, string | number | boolean | null>;
}

export type EstimateOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: FitnessEstimateError };

export function estimateOk<T>(value: T): EstimateOpResult<T> {
  return { ok: true, value };
}

export function estimateErr<T = never>(
  code: FitnessEstimateErrorCode,
  message: string,
  details?: FitnessEstimateError['details'],
): EstimateOpResult<T> {
  return { ok: false, error: { code, message, details } };
}
