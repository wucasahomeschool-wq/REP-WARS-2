import { GameState } from '../types/GameState';
import { cloneGameState } from '../state/cloneGameState';
import { checkGameStateInvariants } from '../state/gameStateInvariants';
import { OrchestrationError, ErrorCode } from './errors';

/**
 * Clone → mutate → validate → commit. Keeps the authoritative state
 * unchanged if validation or the handler throws.
 */
export function runStateTransaction<T>(
  state: GameState,
  apply: (draft: GameState) => T,
): { state: GameState; result: T } {
  const draft = cloneGameState(state);
  const result = apply(draft);
  const violations = checkGameStateInvariants(draft);
  if (violations.length > 0) {
    throw new OrchestrationError(
      ErrorCode.INVALID_GAME_STATE,
      `State invariants failed after command: ${violations[0]!.message}`,
      { violations },
    );
  }
  return { state: draft, result };
}
