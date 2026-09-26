import { WorkoutHistoryEntry, WorkoutHistoryStore } from '../fitness/history/types';
import { PersistenceError } from './errors';
import { GameState } from '../types/GameState';
import { DEFAULT_WORLD_ID, GameStateStore, SaveWorldResult } from './types';
import { observeSaveResult } from '../analytics/persistence';
import type { TelemetryRecorder } from '../analytics/types';

interface AtomicGameStore extends GameStateStore {
  usesRemoteCommit(): boolean;
  commitWithHistory(
    playerId: string,
    state: GameState,
    expectedVersion: number,
    historyEntries: readonly WorkoutHistoryEntry[],
  ): SaveWorldResult;
}

function atomicStore(store: GameStateStore): AtomicGameStore | null {
  const candidate = store as GameStateStore & Partial<AtomicGameStore>;
  if (typeof candidate.usesRemoteCommit === 'function' && candidate.usesRemoteCommit() && candidate.commitWithHistory) {
    return candidate as AtomicGameStore;
  }
  return null;
}

/**
 * Persist GameState and workout-history upserts together.
 *
 * Supabase calls commit_authoritative_player_world, which commits or rolls
 * back both tables in one PostgreSQL statement. In-memory stores still save
 * the world first and revert it if a history upsert throws. That compensating
 * path remains because those stores have no shared database transaction.
 */
export function commitAuthoritativePlayerWorld(input: {
  gameStore: GameStateStore;
  historyStore: WorkoutHistoryStore;
  playerId: string;
  expectedVersion: number;
  state: GameState;
  historyEntries?: readonly WorkoutHistoryEntry[];
  telemetry?: TelemetryRecorder | null;
}): SaveWorldResult {
  const atomic = atomicStore(input.gameStore);
  if (atomic) {
    const saved = atomic.commitWithHistory(
      input.playerId,
      input.state,
      input.expectedVersion,
      input.historyEntries ?? [],
    );
    observeSaveResult(input.telemetry, {
      playerId: input.playerId,
      worldId: saved.ok ? saved.record.worldId : DEFAULT_WORLD_ID,
      worldTick: input.state.worldTick,
      definitionWorldId: input.state.definitionWorldId,
      worldLevel: input.state.worldLevel,
      playerFactionId: input.state.playerFactionId,
      result: saved,
    });
    return saved;
  }
  const backup = input.historyStore.clonePlayer(input.playerId);
  const saved = input.gameStore.save(input.playerId, input.state, input.expectedVersion);
  if (!saved.ok) {
    observeSaveResult(input.telemetry, {
      playerId: input.playerId,
      worldId: DEFAULT_WORLD_ID,
      worldTick: input.state.worldTick,
      definitionWorldId: input.state.definitionWorldId,
      worldLevel: input.state.worldLevel,
      playerFactionId: input.state.playerFactionId,
      result: saved,
    });
    return saved;
  }
  try {
    for (const entry of input.historyEntries ?? []) {
      input.historyStore.upsert(entry);
    }
    observeSaveResult(input.telemetry, {
      playerId: input.playerId,
      worldId: saved.record.worldId,
      worldTick: input.state.worldTick,
      definitionWorldId: input.state.definitionWorldId,
      worldLevel: input.state.worldLevel,
      playerFactionId: input.state.playerFactionId,
      result: saved,
    });
    return saved;
  } catch (err) {
    let message = err instanceof Error ? err.message : String(err);
    try {
      input.historyStore.replacePlayer(input.playerId, backup);
      input.gameStore.revertLastSave(input.playerId);
    } catch (rollbackErr) {
      const rollbackMessage = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
      message = `${message} Rollback failed: ${rollbackMessage}`;
    }
    const failed: SaveWorldResult = {
      ok: false,
      persisted: false,
      code: 'persistence.save_failed',
      message,
    };
    observeSaveResult(input.telemetry, {
      playerId: input.playerId,
      worldId: saved.record.worldId,
      worldTick: input.state.worldTick,
      definitionWorldId: input.state.definitionWorldId,
      worldLevel: input.state.worldLevel,
      playerFactionId: input.state.playerFactionId,
      result: failed,
    });
    return failed;
  }
}

export function assertCommitted(result: SaveWorldResult): void {
  if (!result.ok || !result.persisted) {
    throw new PersistenceError(
      (result.code as PersistenceError['code']) ?? 'persistence.save_failed',
      result.message,
      result.details,
    );
  }
}
