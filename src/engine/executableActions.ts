import { ActionType } from '../types';

/** New concrete-plan execution: reusable existing physical domains plus reward-free WAIT.
 * Local pool allocation is timed; Peace/Trade proposals remain deferred.
 */
export const EXECUTABLE_CONCRETE_ACTIONS: ReadonlySet<ActionType> = new Set(['ATTACK', 'BUILD', 'REINFORCE', 'MOVE', 'RETREAT', 'WAIT']);

/** Legacy persisted commitments without plans may still use the old command bridge. */
export const EXECUTABLE_COMMITMENT_ACTIONS: ReadonlySet<ActionType> = new Set([
  'ATTACK',
  'BUILD',
  'REINFORCE',
  'MOVE',
  'NEGOTIATE',
  'DECLARE_WAR',
  'RETREAT',
  'WAIT',
  'DEFEND',
]);

/** Unsupported both for old commitments and new final-shaped contracts. */
export const UNSUPPORTED_COMMITMENT_ACTIONS: ReadonlySet<ActionType> = new Set([
  'OFFER_PEACE',
  'TRADE',
]);

export function isExecutableCommitmentAction(action: ActionType): boolean {
  return EXECUTABLE_COMMITMENT_ACTIONS.has(action);
}

export function isUnsupportedCommitmentAction(action: ActionType): boolean {
  return UNSUPPORTED_COMMITMENT_ACTIONS.has(action);
}
