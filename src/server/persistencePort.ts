import { InMemoryGameStateStore } from '../persistence/inMemoryGameStateStore';
import { ensurePlayerWorld, EnsurePlayerWorldResult } from '../persistence/initializePlayerWorld';
import { SaveWorldResult } from '../persistence/types';
import { GameState } from '../types/GameState';

/**
 * HTTP persistence boundary. Local dev uses memory. A later Supabase adapter
 * implements the same two methods; do not call SupabaseGameStateStore here.
 */
export interface PlayerWorldPersistence {
  readonly name: 'memory';
  ensure(playerId: string): EnsurePlayerWorldResult;
  save(playerId: string, state: GameState, expectedVersion: number): SaveWorldResult;
}

export function createInMemoryPersistence(store: InMemoryGameStateStore = new InMemoryGameStateStore()): PlayerWorldPersistence {
  return {
    name: 'memory',
    ensure(playerId: string): EnsurePlayerWorldResult {
      return ensurePlayerWorld({ playerId, store });
    },
    save(playerId: string, state: GameState, expectedVersion: number): SaveWorldResult {
      return store.save(playerId, state, expectedVersion);
    },
  };
}
