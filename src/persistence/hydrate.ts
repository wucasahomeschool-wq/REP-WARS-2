import { GAME_STATE_SCHEMA_VERSION } from '../types/GameState';
import { cloneGameState } from '../state/cloneGameState';
import { checkGameStateInvariants } from '../state/gameStateInvariants';
import { PersistenceError } from './errors';
import { decodePersistable } from './serialization';
import { migrateGameStatePayload } from './versioning';
import { GameState } from '../types/GameState';

export function hydratePersistedPayload(payload: unknown): GameState {
  const raw = typeof payload === 'string' ? JSON.parse(payload) : payload;
  const decoded = decodePersistable(raw);
  const migrated = migrateGameStatePayload(decoded);
  const state = migrated as unknown as GameState;
  const violations = checkGameStateInvariants(state);
  if (violations.length > 0) {
    throw new PersistenceError(
      'persistence.corrupt',
      `Persisted GameState failed invariants: ${violations[0]!.message}`,
      { violations },
    );
  }
  if (state.schemaVersion !== GAME_STATE_SCHEMA_VERSION) {
    throw new PersistenceError(
      'persistence.unsupported_schema',
      `Unexpected schemaVersion ${state.schemaVersion}`,
      { schemaVersion: state.schemaVersion },
    );
  }
  return cloneGameState(state);
}
