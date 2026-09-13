import { GameState } from '../../types/GameState';
import { PersistenceError } from '../errors';
import { GameStateStore, LoadWorldResult, SaveWorldResult } from '../types';

/**
 * Boundary for a future live Supabase adapter. Tests never construct a
 * network client. Gameplay engines must not import this file.
 */
export class SupabaseGameStateStore implements GameStateStore {
  load(_playerId: string): LoadWorldResult {
    throw new PersistenceError(
      'persistence.not_configured',
      'SupabaseGameStateStore is a persistence boundary only; use InMemoryGameStateStore in this phase',
    );
  }

  save(_playerId: string, _state: GameState, _expectedVersion: number): SaveWorldResult {
    throw new PersistenceError(
      'persistence.not_configured',
      'SupabaseGameStateStore is a persistence boundary only; use InMemoryGameStateStore in this phase',
    );
  }

  replace(_playerId: string, _state: GameState, _expectedVersion: number): SaveWorldResult {
    return this.save(_playerId, _state, _expectedVersion);
  }

  transaction(
    _playerId: string,
    _mutate: (state: GameState) => void,
    _expectedVersion?: number,
  ): SaveWorldResult & { state?: GameState } {
    throw new PersistenceError(
      'persistence.not_configured',
      'SupabaseGameStateStore is a persistence boundary only; use InMemoryGameStateStore in this phase',
    );
  }
}
