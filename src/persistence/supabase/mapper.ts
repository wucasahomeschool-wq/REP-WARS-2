import { PersistedWorldRecord } from '../types';
import { WorkoutHistoryEntry } from '../../fitness/history/types';
import { SupabaseGameStateRow, SupabaseWorkoutHistoryRow } from './schema';

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
  return {
    formatVersion: row.format_version as PersistedWorldRecord['formatVersion'],
    playerId: row.player_id,
    worldId: row.world_id,
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
