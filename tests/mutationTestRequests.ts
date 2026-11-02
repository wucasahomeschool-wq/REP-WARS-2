/** Explicit client identity for existing public-host fixtures. Creating a new
 * request literal models a new intended action; retry tests retain that object
 * or supply their own stable requestId. Production never generates these IDs. */
let nextId = 0;
export function nextMutationTestId(): string { return `test-mutation-${++nextId}`; }

import {GameState} from '../src/types/GameState';
import {snapshotGameState} from '../src/persistence/snapshot';
/** Compare gameplay after DIFFERENT request schedules. The retained receipts
 * intentionally differ; all other canonical fields, including attempt and
 * session sequencing, remain part of the equality check. */
export function gameplaySnapshot(state: GameState): unknown {
  return snapshotGameState({...state, commandReceipts: new Map()});
}
