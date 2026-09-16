import { FactionId } from '../types';
import { GameState } from '../types/GameState';
import { createGameState } from '../state/createGameState';
import { DEFAULT_PRODUCTION_WORLD_ID, WorldCatalog } from '../worldDefinition';
import { PersistenceError, PersistenceErrorCode } from './errors';
import { GameStateStore, PersistedWorldRecord } from './types';

export interface InitializePlayerWorldOptions {
  playerId: string;
  /** Defaults to DEFAULT_PRODUCTION_WORLD_ID from worldConfig. */
  worldId?: string;
  catalog?: WorldCatalog;
  seed?: number;
  playerFactionId?: FactionId | null;
  /** When set, persist the new instance (expectedVersion 0). */
  store?: GameStateStore;
}

export interface InitializePlayerWorldResult {
  state: GameState;
  record?: PersistedWorldRecord;
}

export interface EnsurePlayerWorldOptions extends InitializePlayerWorldOptions {
  store: GameStateStore;
}

export interface EnsurePlayerWorldResult {
  state: GameState;
  record: PersistedWorldRecord;
  /** True only when this call created the row. False when an existing empire was loaded. */
  created: boolean;
}

function requirePlayerId(playerId: string): string {
  if (typeof playerId !== 'string' || playerId.trim() === '') {
    throw new PersistenceError('persistence.invalid_state', 'playerId must be a non-empty string');
  }
  return playerId;
}

function throwLoadFailure(code: string, message: string, details?: Record<string, unknown>): never {
  throw new PersistenceError(
    (code as PersistenceErrorCode),
    message,
    details,
  );
}

/**
 * Create a **new** player world. Does not load an existing empire.
 *
 * `playerId` is the durable game identity (see `docs/PLAYER_IDENTITY.md`).
 * If `store` is set and a world already exists for that id, this throws
 * `persistence.already_exists` instead of overwriting.
 *
 * Returning players must use `ensurePlayerWorld` (load-or-create-once).
 */
export function initializePlayerWorld(options: InitializePlayerWorldOptions): InitializePlayerWorldResult {
  const playerId = requirePlayerId(options.playerId);
  const worldId = options.worldId ?? DEFAULT_PRODUCTION_WORLD_ID;
  if (options.store) {
    const existing = options.store.load(playerId);
    if (existing.ok) {
      throw new PersistenceError(
        'persistence.already_exists',
        `Player ${playerId} already has a persisted world`,
        { playerId, stateVersion: existing.record.stateVersion },
      );
    }
    if (existing.code !== 'persistence.not_found') {
      throwLoadFailure(existing.code, existing.message, existing.details);
    }
  }
  const state = createGameState({
    seed: options.seed,
    playerFactionId: options.playerFactionId,
    worldId,
    catalog: options.catalog,
  });
  if (!options.store) {
    return { state };
  }
  const saved = options.store.save(playerId, state, 0);
  if (!saved.ok) {
    throw new PersistenceError(saved.code as PersistenceError['code'], saved.message, saved.details);
  }
  return { state, record: saved.record };
}

/**
 * Session boot for a durable `playerId`.
 *
 * Loads the existing empire if present. Creates a new Level 1 world only
 * when that id has no row. Never overwrites, merges, or migrates identities.
 *
 * Authentication must keep using this same `playerId`. It is not a claim or
 * account-link command.
 */
export function ensurePlayerWorld(options: EnsurePlayerWorldOptions): EnsurePlayerWorldResult {
  const playerId = requirePlayerId(options.playerId);
  const loaded = options.store.load(playerId);
  if (loaded.ok) {
    return { state: loaded.state, record: loaded.record, created: false };
  }
  if (loaded.code !== 'persistence.not_found') {
    throwLoadFailure(loaded.code, loaded.message, loaded.details);
  }
  const created = initializePlayerWorld({ ...options, playerId });
  if (!created.record) {
    throw new PersistenceError('persistence.save_failed', 'ensurePlayerWorld requires a store');
  }
  return { state: created.state, record: created.record, created: true };
}
