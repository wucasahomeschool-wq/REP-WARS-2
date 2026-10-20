import { GameState } from '../types/GameState';
import { ErrorCode, OrchestrationError } from '../orchestration/errors';

/** Reserved runtime namespace; legacy authored and banked IDs are unchanged. */
export function armySequenceFloor(ids: Iterable<string>): number {
  let floor = 0;
  for (const id of ids) {
    const match = /^army:v1:(0|[1-9]\d*)$/.exec(id);
    if (!match) continue;
    const sequence = Number(match[1]);
    floor = Math.max(floor, Number.isSafeInteger(sequence) && sequence < Number.MAX_SAFE_INTEGER
      ? sequence + 1 : Infinity);
  }
  return floor;
}

/** Allocate only inside the caller's canonical state transaction. Never reuse
 * a committed sequence after an army dies; failed drafts allocate nothing. */
export function allocateArmyId(state: GameState): string {
  const sequence = state.nextArmySequence;
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence >= Number.MAX_SAFE_INTEGER) {
    throw new OrchestrationError(ErrorCode.INVALID_GAME_STATE, 'Army identity sequence is invalid or exhausted');
  }
  const id = `army:v1:${sequence}`;
  if (state.armies.has(id)) {
    throw new OrchestrationError(ErrorCode.INVALID_GAME_STATE, 'Army identity sequence conflicts with an existing army');
  }
  state.nextArmySequence = sequence + 1;
  return id;
}
