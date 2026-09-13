import { WorkoutHistoryEntry, WorkoutHistoryStore } from '../fitness/history/types';
import { PersistenceError } from './errors';
import { InMemoryGameStateStore } from './inMemoryGameStateStore';
import { GameState } from '../types/GameState';
import { SaveWorldResult } from './types';

/**
 * Persist GameState and workout-history upserts together.
 *
 * In-memory implementation: save the world envelope first; if history
 * upsert throws, revert the world save so callers never observe
 * "reward applied, history missing" or the reverse.
 */
export function commitAuthoritativePlayerWorld(input: {
  gameStore: InMemoryGameStateStore;
  historyStore: WorkoutHistoryStore;
  playerId: string;
  expectedVersion: number;
  state: GameState;
  historyEntries?: readonly WorkoutHistoryEntry[];
}): SaveWorldResult {
  const backup = input.historyStore.clonePlayer(input.playerId);
  const saved = input.gameStore.save(input.playerId, input.state, input.expectedVersion);
  if (!saved.ok) {
    return saved;
  }
  try {
    for (const entry of input.historyEntries ?? []) {
      input.historyStore.upsert(entry);
    }
    return saved;
  } catch (err) {
    input.historyStore.replacePlayer(input.playerId, backup);
    input.gameStore.revertLastSave(input.playerId);
    return {
      ok: false,
      persisted: false,
      code: 'persistence.save_failed',
      message: err instanceof Error ? err.message : String(err),
    };
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
