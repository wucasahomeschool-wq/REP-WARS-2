import { ActionType } from '../types';

/** New concrete-plan execution: reusable existing physical domains plus reward-free WAIT.
 * Local pool allocation and Peace proposals are timed; Trade remains deferred.
 */
export const EXECUTABLE_CONCRETE_ACTIONS: ReadonlySet<ActionType> = new Set(['ATTACK', 'BUILD', 'REINFORCE', 'OFFER_PEACE', 'MOVE', 'RETREAT', 'WAIT']);

/** Historical classification only. Incomplete legacy commitments cannot start
 * canonical operations; no declaration may become executable through this bridge. */
export const EXECUTABLE_COMMITMENT_ACTIONS: ReadonlySet<ActionType> = new Set([
  'ATTACK',
  'BUILD',
  'REINFORCE',
  'MOVE',
  'NEGOTIATE',
  'RETREAT',
  'WAIT',
  'DEFEND',
]);

/** Unsupported incomplete historical contracts. Exact current Peace plans use
 * EXECUTABLE_CONCRETE_ACTIONS; historical declarations are obsolete outright. */
export const UNSUPPORTED_COMMITMENT_ACTIONS: ReadonlySet<ActionType> = new Set([
  'DECLARE_WAR',
  'OFFER_PEACE',
  'TRADE',
]);

export function isExecutableCommitmentAction(action: ActionType): boolean {
  return EXECUTABLE_COMMITMENT_ACTIONS.has(action);
}

export function isUnsupportedCommitmentAction(action: ActionType): boolean {
  return UNSUPPORTED_COMMITMENT_ACTIONS.has(action);
}
