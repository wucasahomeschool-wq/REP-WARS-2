export { PersistenceError, isPersistenceError, PERSISTENCE_ERROR_CODES } from './errors';
export type { PersistenceErrorCode } from './errors';
export {
  GAME_STATE_PERSISTENCE_FORMAT,
  DEFAULT_WORLD_ID,
} from './types';
export type {
  PersistedWorldRecord,
  LoadWorldResult,
  SaveWorldResult,
  GameStateStore,
} from './types';
export { encodePersistable, decodePersistable, serializeToJson, deserializeFromJson, jsonRoundTrip } from './serialization';
export { migrateGameStatePayload, MIN_SUPPORTED_GAME_STATE_SCHEMA, CURRENT_GAME_STATE_SCHEMA } from './versioning';
export { hydratePersistedPayload } from './hydrate';
export { snapshotGameState } from './snapshot';
export { InMemoryGameStateStore } from './inMemoryGameStateStore';
export { FixedWorldTimeAuthority, resolveAuthoritativeTargetTick } from './timeAuthority';
export type { WorldTimeAuthority } from './timeAuthority';
export { commitAuthoritativePlayerWorld, assertCommitted } from './commit';
export { syncPlayerWorld } from './sync';
export { initializePlayerWorld, ensurePlayerWorld } from './initializePlayerWorld';
export type {
  InitializePlayerWorldOptions,
  InitializePlayerWorldResult,
  EnsurePlayerWorldOptions,
  EnsurePlayerWorldResult,
} from './initializePlayerWorld';
export { persistWorldTransition } from './transitionWorld';
export type { PersistWorldTransitionResult } from './transitionWorld';
export type { SyncPlayerWorldInput, SyncPlayerWorldResult, SyncPlayerWorldSuccess } from './sync';
export { SUPABASE_GAME_STATE_TABLE, SUPABASE_WORKOUT_HISTORY_TABLE, SUPABASE_TELEMETRY_TABLE, SUPABASE_DDL } from './supabase/schema';
export type { SupabaseGameStateRow, SupabaseWorkoutHistoryRow, SupabaseTelemetryRow } from './supabase/schema';
export { worldRecordToRow, rowToWorldRecord, historyEntryToRow, rowToHistoryEntry, telemetryEventToRow, rowToTelemetryEvent } from './supabase/mapper';
export { SupabaseGameStateStore } from './supabase/adapter';
export { SupabaseWorkoutHistoryStore } from './supabase/historyAdapter';

