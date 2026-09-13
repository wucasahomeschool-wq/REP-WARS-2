export const FITNESS_EVALUATION_ERROR_CODES = [
  'evaluation.malformed_record',
  'evaluation.not_eligible',
  'evaluation.invalid_feedback',
  'evaluation.invalid_difficulty',
  'evaluation.invalid_ids',
  'evaluation.invalid_timestamp',
  'evaluation.invalid_values',
  'evaluation.invalid_exercise',
] as const;

export type FitnessEvaluationErrorCode = (typeof FITNESS_EVALUATION_ERROR_CODES)[number];

export interface FitnessEvaluationError {
  code: FitnessEvaluationErrorCode;
  message: string;
  issues?: { code: string; message: string }[];
  details?: Record<string, string | number | boolean | null>;
}

export type EvaluationOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: FitnessEvaluationError };

export function evaluationOk<T>(value: T): EvaluationOpResult<T> {
  return { ok: true, value };
}

export function evaluationErr<T = never>(
  code: FitnessEvaluationErrorCode,
  message: string,
  extra?: { issues?: FitnessEvaluationError['issues']; details?: FitnessEvaluationError['details'] },
): EvaluationOpResult<T> {
  return { ok: false, error: { code, message, issues: extra?.issues, details: extra?.details } };
}
