import { ActiveInvasion, InvasionStatus } from '../../types/GameState';
import { defenseWorkoutMaxDurationTicks } from '../config';

/**
 * Inclusive last-valid-tick convention for invasion deadlines.
 * `now === deadlineTick` is still valid. Expired iff `now > deadlineTick`.
 */
export function isDeadlineElapsed(nowTick: number, deadlineTick: number): boolean {
  return nowTick > deadlineTick;
}

export function remainingDeadlineTicks(nowTick: number, deadlineTick: number): number {
  return Math.max(0, deadlineTick - nowTick);
}

export function isOpenInvasion(invasion: { status: string }): invasion is ActiveInvasion {
  return invasion.status === 'pending_response' || invasion.status === 'defense_in_progress';
}

export function defenseCompletionDeadlineTick(
  startedAtTick: number,
  maxDurationTicks = defenseWorkoutMaxDurationTicks(),
): number {
  return startedAtTick + maxDurationTicks;
}

export function compareOpenInvasions(a: ActiveInvasion, b: ActiveInvasion): number {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

export const OPEN_INVASION_STATUSES: readonly InvasionStatus[] = ['pending_response', 'defense_in_progress'];
