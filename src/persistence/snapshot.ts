import { GameState } from '../types/GameState';
import { cloneGameState } from '../state/cloneGameState';
import { checkGameStateInvariants } from '../state/gameStateInvariants';
import { PersistenceError } from './errors';
import { encodePersistable } from './serialization';

export function snapshotGameState(state: GameState): unknown {
  const violations = checkGameStateInvariants(state);
  if (violations.length > 0) {
    throw new PersistenceError(
      'persistence.invalid_state',
      `Cannot persist invalid GameState: ${violations[0]!.message}`,
      { violations },
    );
  }
  return encodePersistable(cloneGameState(state));
}
