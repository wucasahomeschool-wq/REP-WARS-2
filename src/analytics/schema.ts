import { DEFAULT_WORLD_ID } from '../persistence/types';
import {
  TELEMETRY_EVENT_TYPES,
  importanceFor,
  isTelemetryEventType,
} from './taxonomy';
import {
  TELEMETRY_IMPORTANCE,
  TELEMETRY_SCHEMA_VERSION,
  TelemetryEvent,
  TelemetryEventType,
  TelemetryPayload,
  TelemetrySourceSystem,
} from './types';

export class TelemetrySchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelemetrySchemaError';
  }
}

function isPlainPayload(value: unknown): value is TelemetryPayload {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function toTelemetryPayload(value: unknown): TelemetryPayload {
  if (value === undefined || value === null) return {};
  try {
    const cloned = JSON.parse(JSON.stringify(value)) as unknown;
    if (isPlainPayload(cloned)) return cloned;
    return { value: cloned as TelemetryPayload[string] };
  } catch {
    return { unserializable: true };
  }
}

export interface TelemetryEventDraft {
  eventId: string;
  eventType: TelemetryEventType;
  occurredAtWorldTick: number;
  occurredAtMs?: number | null;
  worldId?: string;
  definitionWorldId?: string | null;
  worldLevel?: number | null;
  playerId?: string | null;
  factionId?: string | null;
  sessionId?: string | null;
  correlationId: string;
  causationId?: string | null;
  sourceSystem: TelemetrySourceSystem;
  commandId?: string | null;
  requestId?: string | null;
  payload?: TelemetryPayload;
  metadata?: TelemetryPayload;
}

export function createTelemetryEvent(draft: TelemetryEventDraft): TelemetryEvent {
  const event: TelemetryEvent = {
    eventId: draft.eventId,
    eventType: draft.eventType,
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    importance: importanceFor(draft.eventType),
    occurredAtWorldTick: draft.occurredAtWorldTick,
    occurredAtMs: draft.occurredAtMs ?? null,
    worldId: draft.worldId ?? DEFAULT_WORLD_ID,
    definitionWorldId: draft.definitionWorldId ?? null,
    worldLevel: draft.worldLevel ?? null,
    playerId: draft.playerId ?? null,
    factionId: draft.factionId ?? null,
    sessionId: draft.sessionId ?? null,
    correlationId: draft.correlationId,
    causationId: draft.causationId ?? null,
    sourceSystem: draft.sourceSystem,
    commandId: draft.commandId ?? null,
    requestId: draft.requestId ?? null,
    payload: draft.payload ?? {},
    metadata: draft.metadata ?? {},
  };
  const errors = validateTelemetryEvent(event);
  if (errors.length > 0) {
    throw new TelemetrySchemaError(errors.join('; '));
  }
  return event;
}

export function validateTelemetryEvent(event: TelemetryEvent): string[] {
  const errors: string[] = [];
  if (typeof event.eventId !== 'string' || event.eventId.length === 0) {
    errors.push('eventId is required');
  }
  if (!isTelemetryEventType(event.eventType)) {
    errors.push(`unknown eventType ${String(event.eventType)}`);
  } else if (event.importance !== importanceFor(event.eventType)) {
    errors.push(`importance for ${event.eventType} must be ${importanceFor(event.eventType)}`);
  }
  if (event.schemaVersion !== TELEMETRY_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${TELEMETRY_SCHEMA_VERSION}`);
  }
  if (!(TELEMETRY_IMPORTANCE as readonly string[]).includes(event.importance)) {
    errors.push('importance is invalid');
  }
  if (!Number.isSafeInteger(event.occurredAtWorldTick) || event.occurredAtWorldTick < 0) {
    errors.push('occurredAtWorldTick must be a non-negative safe integer');
  }
  if (event.occurredAtMs !== null && !Number.isFinite(event.occurredAtMs)) {
    errors.push('occurredAtMs must be finite or null');
  }
  if (typeof event.worldId !== 'string' || event.worldId.length === 0) {
    errors.push('worldId is required');
  }
  if (typeof event.correlationId !== 'string' || event.correlationId.length === 0) {
    errors.push('correlationId is required');
  }
  if (!isPlainPayload(event.payload)) {
    errors.push('payload must be a plain object');
  }
  if (!isPlainPayload(event.metadata)) {
    errors.push('metadata must be a plain object');
  }
  return errors;
}

export function assertValidTelemetryEvent(event: TelemetryEvent): void {
  const errors = validateTelemetryEvent(event);
  if (errors.length > 0) {
    throw new TelemetrySchemaError(errors.join('; '));
  }
}

export function knownEventTypeCount(): number {
  return TELEMETRY_EVENT_TYPES.length;
}
