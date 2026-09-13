export const PHYSICAL_RESULT_ERROR_CODES = [
  'physicalResult.malformed_record',
  'physicalResult.not_eligible',
  'physicalResult.invalid_evidence',
  'physicalResult.evidence_mismatch',
  'physicalResult.invalid_estimate',
  'physicalResult.invalid_configuration',
  'physicalResult.invalid_values',
] as const;

export type PhysicalResultErrorCode = (typeof PHYSICAL_RESULT_ERROR_CODES)[number];

export interface PhysicalResultError {
  code: PhysicalResultErrorCode;
  message: string;
  details?: Record<string, string | number | boolean | null>;
}

export type PhysicalResultOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PhysicalResultError };

export function physicalResultOk<T>(value: T): PhysicalResultOpResult<T> {
  return { ok: true, value };
}

export function physicalResultErr<T = never>(
  code: PhysicalResultErrorCode,
  message: string,
  details?: PhysicalResultError['details'],
): PhysicalResultOpResult<T> {
  return { ok: false, error: { code, message, details } };
}
