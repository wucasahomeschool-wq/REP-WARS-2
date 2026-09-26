import { SupabaseWorkoutHistoryRow, SUPABASE_WORKOUT_HISTORY_TABLE } from './schema';
import { eqFilter, restJson } from './blockingRest';

export interface WorkoutHistoryTable {
  list(playerId: string): SupabaseWorkoutHistoryRow[];
  get(playerId: string, sessionId: string): SupabaseWorkoutHistoryRow | null;
  upsert(row: SupabaseWorkoutHistoryRow): void;
  deleteSessions(playerId: string, sessionIds: string[]): void;
  deletePlayer(playerId: string): void;
}

function copyRow(row: SupabaseWorkoutHistoryRow): SupabaseWorkoutHistoryRow {
  return {
    player_id: row.player_id,
    session_id: row.session_id,
    workout_id: row.workout_id,
    purpose: row.purpose,
    completion_state: row.completion_state,
    eligible_for_fitness: row.eligible_for_fitness,
    completed_at: row.completed_at,
    completed_at_world_tick: row.completed_at_world_tick,
    exercise_ids: [...row.exercise_ids],
    payload: row.payload,
  };
}

export class MemoryWorkoutHistoryTable implements WorkoutHistoryTable {
  private readonly rows = new Map<string, SupabaseWorkoutHistoryRow>();

  private key(playerId: string, sessionId: string): string {
    return `${playerId}\n${sessionId}`;
  }

  list(playerId: string): SupabaseWorkoutHistoryRow[] {
    return [...this.rows.values()].filter((row) => row.player_id === playerId).map(copyRow);
  }

  get(playerId: string, sessionId: string): SupabaseWorkoutHistoryRow | null {
    const row = this.rows.get(this.key(playerId, sessionId));
    return row ? copyRow(row) : null;
  }

  upsert(row: SupabaseWorkoutHistoryRow): void {
    this.rows.set(this.key(row.player_id, row.session_id), copyRow(row));
  }

  deleteSessions(playerId: string, sessionIds: string[]): void {
    for (const sessionId of sessionIds) this.rows.delete(this.key(playerId, sessionId));
  }

  deletePlayer(playerId: string): void {
    for (const row of this.list(playerId)) this.rows.delete(this.key(playerId, row.session_id));
  }
}

export class SupabaseWorkoutHistoryTable implements WorkoutHistoryTable {
  list(playerId: string): SupabaseWorkoutHistoryRow[] {
    return restJson<SupabaseWorkoutHistoryRow[]>({
      method: 'GET',
      path: `${SUPABASE_WORKOUT_HISTORY_TABLE}?${eqFilter('player_id', playerId)}&select=*`,
    });
  }

  get(playerId: string, sessionId: string): SupabaseWorkoutHistoryRow | null {
    const rows = restJson<SupabaseWorkoutHistoryRow[]>({
      method: 'GET',
      path: `${SUPABASE_WORKOUT_HISTORY_TABLE}?${eqFilter('player_id', playerId)}&${eqFilter('session_id', sessionId)}&select=*`,
    });
    return rows[0] ?? null;
  }

  upsert(row: SupabaseWorkoutHistoryRow): void {
    restJson({
      method: 'POST',
      path: `${SUPABASE_WORKOUT_HISTORY_TABLE}?on_conflict=player_id,session_id`,
      body: row,
      prefer: 'resolution=merge-duplicates,return=representation',
    });
  }

  deleteSessions(playerId: string, sessionIds: string[]): void {
    for (const sessionId of sessionIds) {
      restJson({
        method: 'DELETE',
        path: `${SUPABASE_WORKOUT_HISTORY_TABLE}?${eqFilter('player_id', playerId)}&${eqFilter('session_id', sessionId)}`,
      });
    }
  }

  deletePlayer(playerId: string): void {
    restJson({
      method: 'DELETE',
      path: `${SUPABASE_WORKOUT_HISTORY_TABLE}?${eqFilter('player_id', playerId)}`,
    });
  }
}
