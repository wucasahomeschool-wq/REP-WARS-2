import { ActionType } from '../types';

/**
 * Commitment actions the Orchestrator can actually execute (or complete as
 * an explicit no-op). Keep in sync with `handleResolveCommitment`.
 *
 * Economy v1 (Phase 7): BUILD is timed FORTIFICATION only. There is no
 * COLLECT or CITY/FARM/MINE/LUMBER commitment. AI waits construction
 * timers; it does not get a fake workout currency. See
 * docs/ECONOMY_DESIGN_SURFACE.md (AI economy).
 */
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

/**
 * AI may still *score* these (DecisionEngine / ActionScorer unchanged),
 * but a commitment of this type cannot be executed. RESOLVE_COMMITMENT
 * fails the commitment with FEATURE_NOT_IMPLEMENTED so it cannot stay
 * active forever.
 */
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
