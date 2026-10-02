import { GameState } from '../types/GameState';
import { validateGameplaySessionLease, type GameplaySessionLease } from '../world/presenceLeases';
import { cloneGameState } from './cloneGameState';

/**
 * Insert one newly opened lease. The source state is not mutated.
 * A repeated session id is rejected instead of merged.
 */
export function insertGameplaySessionLease(state: GameState, lease: GameplaySessionLease): GameState {
  const valid = validateGameplaySessionLease(lease);
  if (state.gameplaySessionLeases.some((item) => item.sessionId === valid.sessionId)) {
    throw new Error('Duplicate gameplay session id');
  }
  const next = cloneGameState(state);
  next.gameplaySessionLeases = [...next.gameplaySessionLeases, valid];
  return next;
}

/**
 * Replace the lease with the same session id after renewal or explicit end.
 * The source state is not mutated. A missing id is not inserted.
 */
export function replaceGameplaySessionLease(state: GameState, lease: GameplaySessionLease): GameState {
  const valid = validateGameplaySessionLease(lease);
  const index = state.gameplaySessionLeases.findIndex((item) => item.sessionId === valid.sessionId);
  if (index < 0) throw new Error('Gameplay session lease is not in the authoritative set');
  const next = cloneGameState(state);
  next.gameplaySessionLeases = next.gameplaySessionLeases.map((item, itemIndex) => (
    itemIndex === index ? valid : item
  ));
  return next;
}
