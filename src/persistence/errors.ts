export const PERSISTENCE_ERROR_CODES = [
  'persistence.not_found',
  'persistence.conflict',
  'persistence.corrupt',
  'persistence.unsupported_schema',
  'persistence.invalid_state',
  'persistence.time_unauthorized',
  'persistence.time_unavailable',
  'persistence.not_configured',
  'persistence.save_failed',
] as const;

export type PersistenceErrorCode = (typeof PERSISTENCE_ERROR_CODES)[number];

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: PersistenceErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PersistenceError';
    this.code = code;
    this.details = details;
  }
}

export function isPersistenceError(value: unknown): value is PersistenceError {
  return value instanceof PersistenceError;
}
