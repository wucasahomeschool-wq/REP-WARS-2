import { observeNonProactiveWork, settleReadyRequiredResponses } from '../engine/nonProactiveCognition';
import {refreshGoals} from '../cognition/goals';
import {processTradeBoundary} from '../gameplay/trade/trade';
import { cancelInvalidReinforcements } from '../engine/operations';
import { processPeaceBoundary } from '../gameplay/diplomacy/peace';
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
  if(draft.levelDefeat.status!=='defeated')processTradeBoundary(draft,undefined,true);
  if(draft.levelDefeat.status!=='defeated')processPeaceBoundary(draft,undefined,true); // Earned diplomacy gates precede newly issued commands.
  if(draft.levelDefeat.status!=='defeated')settleReadyRequiredResponses(draft);
  refreshGoals(draft);
  const result = apply(draft);
  cancelInvalidReinforcements(draft);
  if(draft.levelDefeat.status!=='defeated')processTradeBoundary(draft,undefined,true);
  if(draft.levelDefeat.status!=='defeated')processPeaceBoundary(draft,undefined,true);
  if(draft.levelDefeat.status!=='defeated')settleReadyRequiredResponses(draft);
  refreshGoals(draft);
  if(draft.levelDefeat.status!=='defeated')observeNonProactiveWork(draft);
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
