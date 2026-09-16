/**
 * Gameplay telemetry. Observes Orchestrator/persistence after authoritative
 * GameState changes. Never decides whether a command succeeds.
 *
 * Plug-in: Orchestrator.execute → CommandResponse → IsolatedTelemetryRecorder.
 */

export { TELEMETRY_SCHEMA_VERSION, TELEMETRY_IMPORTANCE } from './types';
export type {
  TelemetryEvent,
  TelemetryEventType,
  TelemetryImportance,
  TelemetryQuery,
  TelemetryStore,
  TelemetrySink,
  TelemetryRecorder,
  TelemetryCommandObserver,
  CommandObservation,
  PersistenceObservation,
  TelemetryPayload,
  TelemetrySourceSystem,
} from './types';

export {
  TELEMETRY_EVENT_TYPES,
  importanceFor,
  isTelemetryEventType,
  isReadOnlyCommand,
} from './taxonomy';

export {
  createTelemetryEvent,
  validateTelemetryEvent,
  assertValidTelemetryEvent,
  toTelemetryPayload,
  TelemetrySchemaError,
} from './schema';

export { InMemoryTelemetryStore } from './inMemoryStore';
export { IsolatedTelemetryRecorder, createTelemetryRecorder, safeObserveCommand, safeObservePersistence } from './recorder';
export { collectCommandTelemetry, collectPersistenceTelemetry } from './observer';
export { getEvents, eventsCausedBy, reconstructChain, descendantIds, matchesTelemetryQuery } from './query';
export { summarizeGame, summarizePlayer, summarizeAi, derivedMetrics } from './summarize';
export type { GameTelemetrySummary, PlayerTelemetrySummary, AiTelemetrySummary } from './summarize';
export { observeSaveResult, observeLoadResult, observeCatchUp } from './persistence';
