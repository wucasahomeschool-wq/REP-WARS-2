import { GameState } from '../../types/GameState';
import { cloneGameState } from '../../state/cloneGameState';
import { cloneWorkoutHistoryEntry } from '../../fitness/history/record';
import { WorkoutHistoryEntry } from '../../fitness/history/types';
import { PersistenceError } from '../errors';
import { hydratePersistedPayload } from '../hydrate';
import { snapshotGameState } from '../snapshot';
import {
  DEFAULT_WORLD_ID,
  GAME_STATE_PERSISTENCE_FORMAT,
  GameStateStore,
  LoadWorldResult,
  PersistedWorldRecord,
  SaveWorldResult,
} from '../types';
import { invokeCommitAuthoritativePlayerWorld } from './atomicCommit';
import { historyEntryToRow, rowToWorldRecord, worldRecordToRow } from './mapper';
import { MemoryPlayerWorldTable, PlayerWorldTable, SupabasePlayerWorldTable } from './playerWorldTable';
import { SupabaseGameStateRow } from './schema';

function failLoad(code: PersistenceError['code'], message: string, details?: Record<string, unknown>): LoadWorldResult {
  return { ok: false, code, message, details };
}

function failSave(code: PersistenceError['code'], message: string, details?: Record<string, unknown>): SaveWorldResult {
  return { ok: false, code, message, persisted: false, details };
}

interface RememberedSave {
  previous: SupabaseGameStateRow | null;
  writtenVersion: number;
}

/**
 * Authoritative world store for `player_worlds`.
 * Pass a table in tests. The default table is the linked Supabase project.
 */
export class SupabaseGameStateStore implements GameStateStore {
  private readonly table: PlayerWorldTable | null;
  private readonly previous = new Map<string, RememberedSave>();

  constructor(table?: PlayerWorldTable) {
    this.table = table ?? null;
  }

  private rows(): PlayerWorldTable {
    if (this.table) return this.table;
    return new SupabasePlayerWorldTable();
  }

  /** True when saves go through commit_authoritative_player_world. Injected tables do not. */
  usesRemoteCommit(): boolean {
    return this.table === null;
  }

  commitWithHistory(
    playerId: string,
    state: GameState,
    expectedVersion: number,
    historyEntries: readonly WorkoutHistoryEntry[],
  ): SaveWorldResult {
    let existing: SupabaseGameStateRow | null;
    try {
      existing = this.rows().find(playerId);
    } catch (err) {
      if (err instanceof PersistenceError) return failSave(err.code, err.message, err.details);
      return failSave('persistence.save_failed', err instanceof Error ? err.message : String(err));
    }
    let payload: unknown;
    try {
      payload = snapshotGameState(state);
    } catch (err) {
      if (err instanceof PersistenceError) return failSave(err.code, err.message, err.details);
      return failSave('persistence.save_failed', err instanceof Error ? err.message : String(err));
    }
    const record: PersistedWorldRecord = {
      formatVersion: GAME_STATE_PERSISTENCE_FORMAT,
      playerId,
      worldId: DEFAULT_WORLD_ID,
      definitionWorldId: state.definitionWorldId,
      definitionFormatVersion: state.definitionFormatVersion,
      worldLevel: state.worldLevel,
      playerFactionId: state.playerFactionId,
      schemaVersion: state.schemaVersion,
      worldTick: state.worldTick,
      stateVersion: (existing?.state_version ?? 0) + 1,
      payload,
    };
    let history;
    try {
      history = historyEntries.map((entry) => {
        if (entry.playerId !== playerId || !entry.sessionId) {
          throw new PersistenceError('persistence.invalid_state', 'Workout history requires the committing player and a session id');
        }
        return historyEntryToRow(cloneWorkoutHistoryEntry(entry));
      });
    } catch (err) {
      if (err instanceof PersistenceError) return failSave(err.code, err.message, err.details);
      return failSave('persistence.save_failed', err instanceof Error ? err.message : String(err));
    }
    try {
      const committed = invokeCommitAuthoritativePlayerWorld({
        playerId,
        expectedVersion,
        world: worldRecordToRow(record),
        history,
      });
      record.stateVersion = committed.state_version;
      this.previous.set(playerId, { previous: existing, writtenVersion: committed.state_version });
      return { ok: true, record, persisted: true };
    } catch (err) {
      if (err instanceof PersistenceError) return failSave(err.code, err.message, err.details);
      return failSave('persistence.save_failed', err instanceof Error ? err.message : String(err));
    }
  }

  load(playerId: string): LoadWorldResult {
    let row: SupabaseGameStateRow | null;
    try {
      row = this.rows().find(playerId);
    } catch (err) {
      if (err instanceof PersistenceError) return failLoad(err.code, err.message, err.details);
      return failLoad('persistence.save_failed', err instanceof Error ? err.message : String(err));
    }
    if (!row) {
      return failLoad('persistence.not_found', `No persisted world for ${playerId}`, { playerId });
    }
    try {
      const state = hydratePersistedPayload(row.payload);
      return { ok: true, record: rowToWorldRecord(row), state };
    } catch (err) {
      if (err instanceof PersistenceError) return failLoad(err.code, err.message, err.details);
      return failLoad('persistence.corrupt', err instanceof Error ? err.message : String(err));
    }
  }

  save(playerId: string, state: GameState, expectedVersion: number): SaveWorldResult {
    if (this.usesRemoteCommit()) return this.commitWithHistory(playerId, state, expectedVersion, []);
    const table = this.rows();
    let existing: SupabaseGameStateRow | null;
    try {
      existing = table.find(playerId);
    } catch (err) {
      if (err instanceof PersistenceError) return failSave(err.code, err.message, err.details);
      return failSave('persistence.save_failed', err instanceof Error ? err.message : String(err));
    }
    const currentVersion = existing?.state_version ?? 0;
    if (expectedVersion !== currentVersion) {
      return failSave(
        'persistence.conflict',
        `Stale world write for ${playerId}: expected version ${expectedVersion}, stored ${currentVersion}`,
        { playerId, expectedVersion, currentVersion },
      );
    }
    let payload: unknown;
    try {
      payload = snapshotGameState(state);
    } catch (err) {
      if (err instanceof PersistenceError) return failSave(err.code, err.message, err.details);
      return failSave('persistence.save_failed', err instanceof Error ? err.message : String(err));
    }
    const record: PersistedWorldRecord = {
      formatVersion: GAME_STATE_PERSISTENCE_FORMAT,
      playerId,
      worldId: DEFAULT_WORLD_ID,
      definitionWorldId: state.definitionWorldId,
      definitionFormatVersion: state.definitionFormatVersion,
      worldLevel: state.worldLevel,
      playerFactionId: state.playerFactionId,
      schemaVersion: state.schemaVersion,
      worldTick: state.worldTick,
      stateVersion: currentVersion + 1,
      payload,
    };
    const row = worldRecordToRow(record);
    try {
      if (!existing) {
        const inserted = table.insert(row);
        if (inserted === 'conflict') return this.conflictAfterRace(table, playerId, expectedVersion);
      } else {
        const updated = table.updateIfVersion(playerId, currentVersion, row);
        if (!updated) return this.conflictAfterRace(table, playerId, expectedVersion);
      }
    } catch (err) {
      if (err instanceof PersistenceError && err.code === 'persistence.conflict') {
        return this.conflictAfterRace(table, playerId, expectedVersion);
      }
      if (err instanceof PersistenceError) return failSave(err.code, err.message, err.details);
      return failSave('persistence.save_failed', err instanceof Error ? err.message : String(err));
    }
    this.previous.set(playerId, { previous: existing, writtenVersion: row.state_version });
    return { ok: true, record, persisted: true };
  }

  replace(playerId: string, state: GameState, expectedVersion: number): SaveWorldResult {
    return this.save(playerId, state, expectedVersion);
  }

  transaction(
    playerId: string,
    mutate: (state: GameState) => void,
    expectedVersion?: number,
  ): SaveWorldResult & { state?: GameState } {
    const loaded = this.load(playerId);
    if (!loaded.ok) {
      return failSave(loaded.code as PersistenceError['code'], loaded.message, loaded.details);
    }
    const version = expectedVersion ?? loaded.record.stateVersion;
    const draft = cloneGameState(loaded.state);
    try {
      mutate(draft);
    } catch (err) {
      return failSave('persistence.save_failed', err instanceof Error ? err.message : String(err));
    }
    const saved = this.save(playerId, draft, version);
    return saved.ok ? { ...saved, state: cloneGameState(draft) } : saved;
  }

  revertLastSave(playerId: string): void {
    const remembered = this.previous.get(playerId);
    if (!remembered) return;
    const table = this.rows();
    const rolledBack = remembered.previous
      ? table.updateIfVersion(playerId, remembered.writtenVersion, remembered.previous)
      : table.deleteIfVersion(playerId, remembered.writtenVersion);
    this.previous.delete(playerId);
    if (!rolledBack) {
      throw new PersistenceError(
        'persistence.save_failed',
        `Could not roll back the world save for ${playerId}`,
        { playerId, writtenVersion: remembered.writtenVersion },
      );
    }
  }

  private conflictAfterRace(table: PlayerWorldTable, playerId: string, expectedVersion: number): SaveWorldResult {
    const current = table.find(playerId);
    const currentVersion = current?.state_version ?? 0;
    return failSave(
      'persistence.conflict',
      `Stale world write for ${playerId}: expected version ${expectedVersion}, stored ${currentVersion}`,
      { playerId, expectedVersion, currentVersion },
    );
  }
}

export { MemoryPlayerWorldTable };
