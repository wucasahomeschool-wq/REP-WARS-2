import { BALANCE } from '../constants/balance';
import { ActionType, AICommitment } from '../types';
import { OrchestrationError, ErrorCode } from '../orchestration/errors';

export function parseElapsedTicks(parameters?: Record<string, unknown>): number {
  const hasElapsed = parameters != null && Object.prototype.hasOwnProperty.call(parameters, 'elapsedTicks');
  const hasTicks = parameters != null && Object.prototype.hasOwnProperty.call(parameters, 'ticks');
  const raw = hasElapsed ? parameters!.elapsedTicks : hasTicks ? parameters!.ticks : undefined;
  if (raw === undefined) {
    return BALANCE.world.defaultElapsedTicks;
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    throw new OrchestrationError(
      ErrorCode.INVALID_PARAMETER,
      'elapsedTicks must be a finite integer',
      { elapsedTicks: raw },
    );
  }
  if (raw < 0) {
    throw new OrchestrationError(
      ErrorCode.INVALID_PARAMETER,
      'elapsedTicks must be >= 0',
      { elapsedTicks: raw },
    );
  }
  if (raw > BALANCE.world.maxElapsedTicksPerAdvance) {
    throw new OrchestrationError(
      ErrorCode.INVALID_PARAMETER,
      `elapsedTicks must be <= ${BALANCE.world.maxElapsedTicksPerAdvance}`,
      { elapsedTicks: raw, max: BALANCE.world.maxElapsedTicksPerAdvance },
    );
  }
  return raw;
}

/** PROVISIONAL placeholder duration. Not a travel or army-speed formula. */
export function commitmentDurationTicksFor(action: ActionType): number {
  const table = BALANCE.world.commitmentDurationTicks;
  const value = table[action];
  return typeof value === 'number' ? value : BALANCE.world.defaultCommitmentDurationTicks;
}

export function stampCommitmentTiming(commitment: AICommitment, worldTick: number): void {
  if (commitment.startedAtTick == null) {
    commitment.startedAtTick = worldTick;
  }
  if (commitment.durationTicks == null) {
    commitment.durationTicks = commitmentDurationTicksFor(commitment.action);
  }
  if (commitment.completionCondition == null) {
    commitment.completionCondition = 'duration_elapsed';
  }
}

export function ticksRemaining(commitment: AICommitment, worldTick: number): number {
  const started = commitment.startedAtTick ?? worldTick;
  const duration = commitment.durationTicks ?? commitmentDurationTicksFor(commitment.action);
  return Math.max(0, started + duration - worldTick);
}

export function isCommitmentReady(commitment: AICommitment, worldTick: number): boolean {
  const condition = commitment.completionCondition ?? 'duration_elapsed';
  if (condition !== 'duration_elapsed') {
    return false;
  }
  return ticksRemaining(commitment, worldTick) === 0;
}

export function canReassessFaction(lastDecisionTick: number | undefined, worldTick: number): boolean {
  if (lastDecisionTick === undefined) {
    return true;
  }
  return worldTick - lastDecisionTick >= BALANCE.world.reassessmentIntervalTicks;
}
