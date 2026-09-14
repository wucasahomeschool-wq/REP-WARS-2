/** Machine-readable errors for the Game Interface & Orchestration Engine. */

export const ErrorCode = {
  INVALID_COMMAND: 'INVALID_COMMAND',
  MISSING_PARAMETER: 'MISSING_PARAMETER',
  INVALID_PARAMETER: 'INVALID_PARAMETER',
  INVALID_TARGET: 'INVALID_TARGET',
  INSUFFICIENT_RESOURCES: 'INSUFFICIENT_RESOURCES',
  INSUFFICIENT_TROOPS: 'INSUFFICIENT_TROOPS',
  INVALID_TERRITORY: 'INVALID_TERRITORY',
  INVALID_ARMY: 'INVALID_ARMY',
  INVALID_FACTION: 'INVALID_FACTION',
  ACTION_NOT_ALLOWED: 'ACTION_NOT_ALLOWED',
  ENGINE_UNAVAILABLE: 'ENGINE_UNAVAILABLE',
  ENGINE_ERROR: 'ENGINE_ERROR',
  INVALID_GAME_STATE: 'INVALID_GAME_STATE',
  FEATURE_NOT_IMPLEMENTED: 'FEATURE_NOT_IMPLEMENTED',
  EVENT_NOT_FOUND: 'EVENT_NOT_FOUND',
  INVALID_CHOICE: 'INVALID_CHOICE',
  NOT_ADJACENT: 'NOT_ADJACENT',
  WORKOUT_SESSION_INVALID: 'WORKOUT_SESSION_INVALID',
  TIME_UNAUTHORIZED: 'TIME_UNAUTHORIZED',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface OrchestrationErrorBody {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export class OrchestrationError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'OrchestrationError';
    this.code = code;
    this.details = details;
  }

  toBody(): OrchestrationErrorBody {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export const ERROR_CATALOG: Record<ErrorCode, { meaning: string; httpHint?: number }> = {
  INVALID_COMMAND: { meaning: 'commandId is not in the command index' },
  MISSING_PARAMETER: { meaning: 'A required parameter was omitted' },
  INVALID_PARAMETER: { meaning: 'A parameter was present but failed validation' },
  INVALID_TARGET: { meaning: 'Referenced entity exists but cannot be used for this action' },
  INSUFFICIENT_RESOURCES: { meaning: 'Empire cannot afford the action' },
  INSUFFICIENT_TROOPS: { meaning: 'Not enough troops to perform the action' },
  INVALID_TERRITORY: { meaning: 'Territory id does not exist' },
  INVALID_ARMY: { meaning: 'Army id does not exist' },
  INVALID_FACTION: { meaning: 'Faction id does not exist' },
  ACTION_NOT_ALLOWED: { meaning: 'Rules of the current state forbid this action' },
  ENGINE_UNAVAILABLE: { meaning: 'The routed specialized engine is not registered or is a stub' },
  ENGINE_ERROR: { meaning: 'A specialized engine threw or returned a failure' },
  INVALID_GAME_STATE: { meaning: 'Authoritative state is missing required data' },
  FEATURE_NOT_IMPLEMENTED: { meaning: 'Command is catalogued but the feature is not built yet' },
  EVENT_NOT_FOUND: { meaning: 'Imperial event instance was not found' },
  INVALID_CHOICE: { meaning: 'Event choice id is not available on that event' },
  NOT_ADJACENT: { meaning: 'Territories are not neighbors' },
  WORKOUT_SESSION_INVALID: { meaning: 'No matching active workout session' },
  TIME_UNAUTHORIZED: { meaning: 'Requested world time is beyond the authoritative clock or would rewind state' },
};
