import { GameState } from '../types/GameState';
import { cloneGameState } from '../state/cloneGameState';
import { PersistenceError } from './errors';
import { hydratePersistedPayload } from './hydrate';
import { snapshotGameState } from './snapshot';
import {
  DEFAULT_WORLD_ID,
  GAME_STATE_PERSISTENCE_FORMAT,
  GameStateStore,
  LoadWorldResult,
  PersistedWorldRecord,
  SaveWorldResult,
} from './types';

function failLoad(code: PersistenceError['code'], message: string, details?: Record<string, unknown>): LoadWorldResult {
  return { ok: false, code, message, details };
}

function failSave(code: PersistenceError['code'], message: string, details?: Record<string, unknown>): SaveWorldResult {
  return { ok: false, code, message, persisted: false, details };
}

export class InMemoryGameStateStore implements GameStateStore {
  readonly saveCount = { value: 0 };
  private readonly worlds = new Map<string, PersistedWorldRecord>();
  private readonly previous = new Map<string, PersistedWorldRecord | undefined>();

  load(playerId: string): LoadWorldResult {
    const record = this.worlds.get(playerId);
    if (!record) {
      return failLoad('persistence.not_found', `No persisted world for ${playerId}`, { playerId });
    }
    try {
      const state = hydratePersistedPayload(record.payload);
      return { ok: true, record: { ...record }, state };
    } catch (err) {
      if (err instanceof PersistenceError) {
        return failLoad(err.code, err.message, err.details);
      }
      return failLoad('persistence.corrupt', err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * `expectedVersion` is the currently stored envelope version.
   * First save uses `0`. A mismatch is a conflict; the stored row is left unchanged.
   */
  save(playerId: string, state: GameState, expectedVersion: number): SaveWorldResult {
    const existing = this.worlds.get(playerId);
    const currentVersion = existing?.stateVersion ?? 0;
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
      if (err instanceof PersistenceError) {
        return failSave(err.code, err.message, err.details);
      }
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
    this.previous.set(playerId, existing);
    this.worlds.set(playerId, record);
    this.saveCount.value += 1;
    return { ok: true, record: { ...record }, persisted: true };
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

  /** Test helper: inject an unvalidated envelope (corruption / migration fixtures). */
  putRaw(record: PersistedWorldRecord): void {
    this.previous.set(record.playerId, this.worlds.get(record.playerId));
    this.worlds.set(record.playerId, record);
  }

  revertLastSave(playerId: string): void {
    if (!this.previous.has(playerId)) return;
    const prev = this.previous.get(playerId);
    if (prev === undefined) this.worlds.delete(playerId);
    else this.worlds.set(playerId, prev);
    this.previous.delete(playerId);
    this.saveCount.value = Math.max(0, this.saveCount.value - 1);
  }
}
