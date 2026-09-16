import { GameState } from '../types/GameState';
import { WorldCatalog, getDefaultWorldCatalog } from '../worldDefinition/catalog';
import { GameStateStore, SaveWorldResult } from './types';
import { buildNextWorldState } from '../gameplay/worldTransition';

export type PersistWorldTransitionResult =
  | {
    ok: true;
    alreadyCompleted: true;
    state: GameState;
  }
  | {
    ok: true;
    alreadyCompleted: false;
    state: GameState;
    saved: Extract<SaveWorldResult, { ok: true }>;
  }
  | {
    ok: false;
    state: GameState;
    saved: Extract<SaveWorldResult, { ok: false }>;
  };

/**
 * Persist a world transition without mutating `state`.
 * If save fails, the store row and the passed GameState stay unchanged.
 */
export function persistWorldTransition(input: {
  store: GameStateStore;
  playerId: string;
  expectedVersion: number;
  state: GameState;
  catalog?: WorldCatalog;
}): PersistWorldTransitionResult {
  const catalog = input.catalog ?? getDefaultWorldCatalog();
  const built = buildNextWorldState(input.state, catalog);
  if (built.status === 'already_completed') {
    return { ok: true, alreadyCompleted: true, state: input.state };
  }
  if (!built.next) {
    return {
      ok: false,
      state: input.state,
      saved: {
        ok: false,
        code: 'persistence.save_failed',
        message: 'World transition produced no next state',
        persisted: false,
      },
    };
  }
  const saved = input.store.save(input.playerId, built.next, input.expectedVersion);
  if (!saved.ok) {
    return { ok: false, state: input.state, saved };
  }
  return { ok: true, alreadyCompleted: false, state: built.next, saved };
}
