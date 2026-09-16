import { WorkoutHistoryEntry, WorkoutHistoryStore } from '../fitness/history/types';
import { PersistenceError } from './errors';
import { InMemoryGameStateStore } from './inMemoryGameStateStore';
import { GameState } from '../types/GameState';
import { DEFAULT_WORLD_ID, SaveWorldResult } from './types';
import { observeSaveResult } from '../analytics/persistence';
import type { TelemetryRecorder } from '../analytics/types';

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
  telemetry?: TelemetryRecorder | null;
}): SaveWorldResult {
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
    input.historyStore.replacePlayer(input.playerId, backup);
    input.gameStore.revertLastSave(input.playerId);
    const failed: SaveWorldResult = {
      ok: false,
      persisted: false,
      code: 'persistence.save_failed',
      message: err instanceof Error ? err.message : String(err),
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
