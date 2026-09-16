import { PersistedWorldRecord } from '../types';
import { WorkoutHistoryEntry } from '../../fitness/history/types';
import { TelemetryEvent } from '../../analytics/types';
import { SupabaseGameStateRow, SupabaseWorkoutHistoryRow, SupabaseTelemetryRow } from './schema';

function authoredIdentityFromPayload(payload: unknown): Pick<
  PersistedWorldRecord,
  'definitionWorldId' | 'definitionFormatVersion' | 'worldLevel' | 'playerFactionId'
> {
  const rec = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  return {
    definitionWorldId: typeof rec?.definitionWorldId === 'string' ? rec.definitionWorldId : null,
    definitionFormatVersion: typeof rec?.definitionFormatVersion === 'string' ? rec.definitionFormatVersion : null,
    worldLevel: typeof rec?.worldLevel === 'number' ? rec.worldLevel : null,
    playerFactionId: typeof rec?.playerFactionId === 'string' ? rec.playerFactionId : null,
  };
}

export function worldRecordToRow(record: PersistedWorldRecord): SupabaseGameStateRow {
  return {
    player_id: record.playerId,
    world_id: record.worldId,
    format_version: record.formatVersion,
    schema_version: record.schemaVersion,
    world_tick: record.worldTick,
    state_version: record.stateVersion,
    payload: record.payload,
  };
}

export function rowToWorldRecord(row: SupabaseGameStateRow): PersistedWorldRecord {
  const identity = authoredIdentityFromPayload(row.payload);
  return {
    formatVersion: row.format_version as PersistedWorldRecord['formatVersion'],
    playerId: row.player_id,
    worldId: row.world_id,
    definitionWorldId: identity.definitionWorldId,
    definitionFormatVersion: identity.definitionFormatVersion,
    worldLevel: identity.worldLevel,
    playerFactionId: identity.playerFactionId,
    schemaVersion: row.schema_version,
    worldTick: row.world_tick,
    stateVersion: row.state_version,
    payload: row.payload,
  };
}

export function historyEntryToRow(entry: WorkoutHistoryEntry): SupabaseWorkoutHistoryRow {
  return {
    player_id: entry.playerId,
    session_id: entry.sessionId,
    workout_id: entry.workoutId,
    purpose: entry.purpose,
    completion_state: entry.completionState,
    eligible_for_fitness: entry.eligibleForFitnessEvaluation,
    completed_at: entry.completedAt,
    completed_at_world_tick: entry.completedAtWorldTick,
    exercise_ids: [...entry.exerciseIds],
    payload: entry,
  };
}

export function rowToHistoryEntry(row: SupabaseWorkoutHistoryRow): WorkoutHistoryEntry {
  return row.payload as WorkoutHistoryEntry;
}

export function telemetryEventToRow(event: TelemetryEvent): SupabaseTelemetryRow {
  return {
    event_id: event.eventId,
    schema_version: event.schemaVersion,
    event_type: event.eventType,
    importance: event.importance,
    occurred_at_world_tick: event.occurredAtWorldTick,
    occurred_at: event.occurredAtMs,
    world_id: event.worldId,
    definition_world_id: event.definitionWorldId,
    world_level: event.worldLevel,
    player_id: event.playerId,
    faction_id: event.factionId,
    session_id: event.sessionId,
    correlation_id: event.correlationId,
    causation_id: event.causationId,
    source_system: event.sourceSystem,
    command_id: event.commandId,
    request_id: event.requestId,
    payload: { body: event.payload, metadata: event.metadata },
  };
}

export function rowToTelemetryEvent(row: SupabaseTelemetryRow): TelemetryEvent {
  const packed = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
    ? row.payload as { body?: TelemetryEvent['payload']; metadata?: TelemetryEvent['metadata'] }
    : {};
  return {
    eventId: row.event_id,
    eventType: row.event_type as TelemetryEvent['eventType'],
    schemaVersion: row.schema_version as TelemetryEvent['schemaVersion'],
    importance: row.importance as TelemetryEvent['importance'],
    occurredAtWorldTick: row.occurred_at_world_tick,
    occurredAtMs: row.occurred_at,
    worldId: row.world_id,
    definitionWorldId: row.definition_world_id,
    worldLevel: row.world_level,
    playerId: row.player_id,
    factionId: row.faction_id,
    sessionId: row.session_id,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    sourceSystem: row.source_system as TelemetryEvent['sourceSystem'],
    commandId: row.command_id,
    requestId: row.request_id,
    payload: packed.body ?? {},
    metadata: packed.metadata ?? {},
  };
}
