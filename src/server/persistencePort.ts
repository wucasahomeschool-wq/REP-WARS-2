import { InMemoryWorkoutHistoryStore } from '../fitness/history/inMemoryStore';
import { WorkoutHistoryEntry, WorkoutHistoryStore } from '../fitness/history/types';
import { InMemoryGameStateStore } from '../persistence/inMemoryGameStateStore';
import { ensurePlayerWorld, EnsurePlayerWorldResult } from '../persistence/initializePlayerWorld';
import { GameStateStore, SaveWorldResult } from '../persistence/types';
import { readSupabaseServerConfig } from '../persistence/supabase/config';
import { SupabaseGameStateStore } from '../persistence/supabase/adapter';
import { RoutingHistoryStore } from '../persistence/supabase/commandHistoryBuffer';
import { SupabaseWorkoutHistoryStore } from '../persistence/supabase/historyAdapter';
import { GameState } from '../types/GameState';
import { snapshotGameState } from '../persistence/snapshot';

/**
 * HTTP persistence boundary.
 * Both credentials select Supabase. Neither credential keeps the in-memory stores.
 */
export type PersistenceProviderName = 'memory' | 'supabase';

export interface PlayerWorldPersistence {
  readonly name: PersistenceProviderName;
  readonly history: WorkoutHistoryStore;
  ensure(playerId: string): EnsurePlayerWorldResult;
  save(playerId: string, state: GameState, expectedVersion: number): SaveWorldResult;
  /**
   * Present for the built-in providers. Commits the world and this command's history upserts
   * in commit_authoritative_player_world (or its synchronous memory equivalent).
   */
  commitWorld?(
    playerId: string,
    state: GameState,
    expectedVersion: number,
    historyEntries: readonly WorkoutHistoryEntry[],
  ): SaveWorldResult;
}

function bindStore(
  name: PersistenceProviderName,
  store: GameStateStore,
  history: WorkoutHistoryStore,
): PlayerWorldPersistence {
  return {
    name,
    history,
    ensure(playerId: string): EnsurePlayerWorldResult {
      return ensurePlayerWorld({ playerId, store });
    },
    save(playerId: string, state: GameState, expectedVersion: number): SaveWorldResult {
      return store.save(playerId, state, expectedVersion);
    },
  };
}

export function createInMemoryPersistence(
  store: InMemoryGameStateStore = new InMemoryGameStateStore(),
  history: WorkoutHistoryStore = new InMemoryWorkoutHistoryStore(),
): PlayerWorldPersistence {
  const routed = new RoutingHistoryStore(history);
  return {
    ...bindStore('memory', store, routed),
    commitWorld(playerId, state, expectedVersion, historyEntries) {
      // Same buffered commit contract as Supabase, using synchronous memory
      // stores. No history write occurs before the world wins CAS.
      const backup = history.clonePlayer(playerId);
      const publishHistory = () => {
        try { for (const entry of historyEntries) history.upsert(entry); }
        catch (error) {
          store.revertLastSave(playerId);
          history.replacePlayer(playerId, backup);
          throw error;
        }
      };
      let saved: SaveWorldResult;
      try { saved = this.save(playerId, state, expectedVersion); }
      catch (error) {
        // A test/development adapter can lose the save acknowledgment. Finish
        // this synchronous commit only if the exact candidate won that CAS.
        const loaded = store.load(playerId);
        if (loaded.ok && loaded.record.stateVersion === expectedVersion + 1
          && JSON.stringify(loaded.record.payload) === JSON.stringify(snapshotGameState(state))) publishHistory();
        throw error;
      }
      if (saved.ok) publishHistory();
      return saved;
    },
  };
}

export function createSupabasePersistence(): PlayerWorldPersistence {
  const worlds = new SupabaseGameStateStore();
  const history = new RoutingHistoryStore(new SupabaseWorkoutHistoryStore());
  return {
    ...bindStore('supabase', worlds, history),
    commitWorld(playerId, state, expectedVersion, historyEntries) {
      return worlds.commitWithHistory(playerId, state, expectedVersion, historyEntries);
    },
  };
}

export function createDevelopmentPersistence(env: NodeJS.ProcessEnv = process.env): PlayerWorldPersistence {
  const url = env.SUPABASE_URL?.trim() ?? '';
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  if (!url && !key) return createInMemoryPersistence();
  readSupabaseServerConfig(env);
  return createSupabasePersistence();
}
