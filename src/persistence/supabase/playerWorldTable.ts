import { PersistenceError } from '../errors';
import { SupabaseGameStateRow, SUPABASE_GAME_STATE_TABLE } from './schema';
import { eqFilter, restJson, supabaseRest } from './blockingRest';

export interface PlayerWorldTable {
  find(playerId: string): SupabaseGameStateRow | null;
  insert(row: SupabaseGameStateRow): 'ok' | 'conflict';
  updateIfVersion(playerId: string, expectedVersion: number, row: SupabaseGameStateRow): boolean;
  deleteIfVersion(playerId: string, version: number): boolean;
  deletePlayer(playerId: string): void;
}

function copyRow(row: SupabaseGameStateRow): SupabaseGameStateRow {
  return {
    player_id: row.player_id,
    world_id: row.world_id,
    format_version: row.format_version,
    schema_version: row.schema_version,
    world_tick: row.world_tick,
    state_version: row.state_version,
    payload: row.payload,
  };
}

/** Row store used by tests. Enforces the same compare-and-swap rules as PostgREST. */
export class MemoryPlayerWorldTable implements PlayerWorldTable {
  private readonly rows = new Map<string, SupabaseGameStateRow>();

  find(playerId: string): SupabaseGameStateRow | null {
    const row = this.rows.get(playerId);
    return row ? copyRow(row) : null;
  }

  insert(row: SupabaseGameStateRow): 'ok' | 'conflict' {
    if (this.rows.has(row.player_id)) return 'conflict';
    this.rows.set(row.player_id, copyRow(row));
    return 'ok';
  }

  updateIfVersion(playerId: string, expectedVersion: number, row: SupabaseGameStateRow): boolean {
    const current = this.rows.get(playerId);
    if (!current || current.state_version !== expectedVersion) return false;
    this.rows.set(playerId, copyRow(row));
    return true;
  }

  deleteIfVersion(playerId: string, version: number): boolean {
    const current = this.rows.get(playerId);
    if (!current || current.state_version !== version) return false;
    this.rows.delete(playerId);
    return true;
  }

  deletePlayer(playerId: string): void {
    this.rows.delete(playerId);
  }
}

export class SupabasePlayerWorldTable implements PlayerWorldTable {
  find(playerId: string): SupabaseGameStateRow | null {
    const rows = restJson<SupabaseGameStateRow[]>({
      method: 'GET',
      path: `${SUPABASE_GAME_STATE_TABLE}?${eqFilter('player_id', playerId)}&select=*`,
    });
    return rows[0] ?? null;
  }

  insert(row: SupabaseGameStateRow): 'ok' | 'conflict' {
    const result = supabaseRest({
      method: 'POST',
      path: SUPABASE_GAME_STATE_TABLE,
      body: row,
    });
    if (result.status === 409) return 'conflict';
    if (result.status < 200 || result.status >= 300) {
      throw new PersistenceError('persistence.save_failed', `Supabase insert failed (${result.status})`);
    }
    return 'ok';
  }

  updateIfVersion(playerId: string, expectedVersion: number, row: SupabaseGameStateRow): boolean {
    const rows = restJson<SupabaseGameStateRow[]>({
      method: 'PATCH',
      path: `${SUPABASE_GAME_STATE_TABLE}?${eqFilter('player_id', playerId)}&state_version=eq.${expectedVersion}`,
      body: row,
    });
    return rows.length > 0;
  }

  deleteIfVersion(playerId: string, version: number): boolean {
    const rows = restJson<SupabaseGameStateRow[]>({
      method: 'DELETE',
      path: `${SUPABASE_GAME_STATE_TABLE}?${eqFilter('player_id', playerId)}&state_version=eq.${version}`,
    });
    return rows.length > 0;
  }

  deletePlayer(playerId: string): void {
    restJson({
      method: 'DELETE',
      path: `${SUPABASE_GAME_STATE_TABLE}?${eqFilter('player_id', playerId)}`,
    });
  }
}
