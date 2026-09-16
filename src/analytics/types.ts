/**
 * Gameplay telemetry types. Analytics observes GameState after an
 * authoritative command commits; it is never a second source of truth.
 */

import { CommandRequest, CommandResponse } from '../orchestration/protocol';
import { GameState } from '../types/GameState';
import { TELEMETRY_EVENT_TYPES } from './taxonomy';

export const TELEMETRY_SCHEMA_VERSION = 'gameplay-telemetry.v1' as const;

export const TELEMETRY_IMPORTANCE = ['CRITICAL', 'IMPORTANT', 'INFORMATIONAL', 'DEBUG'] as const;
export type TelemetryImportance = (typeof TELEMETRY_IMPORTANCE)[number];

export type TelemetryEventType = (typeof TELEMETRY_EVENT_TYPES)[number];

export type TelemetryJson =
  | string
  | number
  | boolean
  | null
  | TelemetryJson[]
  | { [key: string]: TelemetryJson };

export type TelemetryPayload = { [key: string]: TelemetryJson };

export type TelemetrySourceSystem =
  | 'orchestrator'
  | 'persistence'
  | 'world'
  | 'fitness'
  | 'rewards'
  | 'battle'
  | 'ai'
  | 'economy'
  | 'invasion';

/**
 * Versioned append-only gameplay event. Identifiers reuse existing
 * requestId / sessionId / invasionId / commitmentId / battleId values
 * rather than inventing parallel ids.
 */
export interface TelemetryEvent {
  eventId: string;
  eventType: TelemetryEventType;
  schemaVersion: typeof TELEMETRY_SCHEMA_VERSION;
  importance: TelemetryImportance;
  /** Canonical time: GameState.worldTick after the observed command. */
  occurredAtWorldTick: number;
  /** Optional session/command clock. Not a gameplay authority. */
  occurredAtMs: number | null;
  worldId: string;
  definitionWorldId: string | null;
  worldLevel: number | null;
  playerId: string | null;
  factionId: string | null;
  /** WorkoutSessionId when the event belongs to a workout. */
  sessionId: string | null;
  correlationId: string;
  causationId: string | null;
  sourceSystem: TelemetrySourceSystem;
  commandId: string | null;
  requestId: string | null;
  payload: TelemetryPayload;
  metadata: TelemetryPayload;
}

export interface TelemetryQuery {
  importance?: TelemetryImportance | TelemetryImportance[];
  eventType?: TelemetryEventType | TelemetryEventType[];
  playerId?: string;
  worldId?: string;
  definitionWorldId?: string;
  sessionId?: string;
  factionId?: string;
  correlationId?: string;
  causationId?: string;
  /** Alias for causationId: events directly caused by this eventId. */
  causedByEventId?: string;
  commandId?: string;
  requestId?: string;
  sinceWorldTick?: number;
  untilWorldTick?: number;
  includeDescendants?: boolean;
}

export interface TelemetrySink {
  persist(events: readonly TelemetryEvent[]): void;
}

export interface TelemetryStore {
  append(events: readonly TelemetryEvent[]): void;
  getById(eventId: string): TelemetryEvent | undefined;
  query(query?: TelemetryQuery): TelemetryEvent[];
  all(): TelemetryEvent[];
  outbox(): TelemetryEvent[];
  flushOutbox(): { flushed: number; remaining: number };
}

export interface CommandObservation {
  request: CommandRequest;
  response: CommandResponse;
  state: GameState;
  worldId?: string;
}

export interface PersistenceObservation {
  operation: 'save' | 'load' | 'catch_up' | 'retry';
  playerId: string;
  worldId: string;
  worldTick: number;
  definitionWorldId?: string | null;
  worldLevel?: number | null;
  playerFactionId?: string | null;
  outcome: 'ok' | 'conflict' | 'failed' | 'not_found' | 'invalid_state';
  code?: string;
  message?: string;
  ticksAdvanced?: number;
  requestId?: string;
}

export interface TelemetryCommandObserver {
  observeCommand(input: CommandObservation): void;
}

export interface TelemetryPersistenceObserver {
  observePersistence(input: PersistenceObservation): void;
}

export interface TelemetryRecorder extends TelemetryCommandObserver, TelemetryPersistenceObserver {}
