import { GameState } from '../types/GameState';
import { accrueSimulationTime, isTemporalPresence, TemporalPresence } from './timeToTick';
import { utcEpochMs } from './realtimeClock';

/**
 * Rated world accrual.
 *
 * Real time increases `accruedTargetWorldTick` and the fixed-point fraction.
 * It does not move `worldTick`. Gameplay processing of the backlog is a
 * later scheduler. Presence is an input; this function does not decide
 * whether the player is online.
 *
 * `lastProcessedAtMs` is the legacy unscaled clock watermark and is not read.
 */

export interface WorldTemporalAccrualResult {
  worldTick: number;
  accruedTargetWorldTick: number;
  /** Whole ticks added by this call. Zero when anchoring, repeating, or rewinding. */
  elapsedWholeTicks: number;
  subTickMicroticks: number;
  accrualDivisionRemainder: number;
  lastAccrualAtMs: number;
  /** Unprocessed whole ticks: accrued target minus processed worldTick. */
  backlogTicks: number;
  /** True when this call set `lastAccrualAtMs` for the first time. */
  anchored: boolean;
  /** True when this call changed the durable accrual fields. */
  applied: boolean;
}

/**
 * Account for real time since `lastAccrualAtMs` at `presence`.
 *
 * A null watermark anchors at `now` and adds no ticks. That first
 * observation also raises the target to `worldTick` when legacy processing
 * has already moved ahead, so the backlog starts at zero. It does not
 * convert the gap since `lastProcessedAtMs` into simulation time.
 *
 * An earlier timestamp does not rewind the watermark or the accrued target.
 */
export function accrueAuthoritativeWorldTime(
  state: GameState,
  now: number | string | Date,
  presence: TemporalPresence,
): WorldTemporalAccrualResult {
  if (!isTemporalPresence(presence)) {
    throw new Error('Temporal rate is not a configured online or offline rate');
  }
  const nowMs = utcEpochMs(now);
  assertAccrualFields(state);

  if (state.lastAccrualAtMs === null) {
    state.accruedTargetWorldTick = Math.max(state.accruedTargetWorldTick, state.worldTick);
    state.subTickMicroticks = 0;
    state.accrualDivisionRemainder = 0;
    state.lastAccrualAtMs = nowMs;
    return snapshot(state, 0, true, true);
  }

  if (nowMs < state.lastAccrualAtMs) {
    return snapshot(state, 0, false, false);
  }
  if (nowMs === state.lastAccrualAtMs) {
    return snapshot(state, 0, false, false);
  }
  if (state.worldTick > state.accruedTargetWorldTick) {
    throw new Error('Accrued simulation tick is behind processed worldTick');
  }

  const elapsedMs = nowMs - state.lastAccrualAtMs;
  if (!Number.isSafeInteger(elapsedMs)) {
    throw new Error('Elapsed milliseconds exceed a safe integer');
  }

  const accrued = accrueSimulationTime(
    {
      wholeTicks: state.accruedTargetWorldTick,
      subTickMicroticks: state.subTickMicroticks,
      accrualDivisionRemainder: state.accrualDivisionRemainder,
    },
    elapsedMs,
    presence,
  );
  const applied = accrued.wholeTicks !== state.accruedTargetWorldTick
    || accrued.subTickMicroticks !== state.subTickMicroticks
    || accrued.accrualDivisionRemainder !== state.accrualDivisionRemainder
    || nowMs !== state.lastAccrualAtMs;
  state.accruedTargetWorldTick = accrued.wholeTicks;
  state.subTickMicroticks = accrued.subTickMicroticks;
  state.accrualDivisionRemainder = accrued.accrualDivisionRemainder;
  state.lastAccrualAtMs = nowMs;
  return snapshot(state, accrued.elapsedWholeTicks, false, applied);
}

function snapshot(
  state: GameState,
  elapsedWholeTicks: number,
  anchored: boolean,
  applied: boolean,
): WorldTemporalAccrualResult {
  return {
    worldTick: state.worldTick,
    accruedTargetWorldTick: state.accruedTargetWorldTick,
    elapsedWholeTicks,
    subTickMicroticks: state.subTickMicroticks,
    accrualDivisionRemainder: state.accrualDivisionRemainder,
    lastAccrualAtMs: state.lastAccrualAtMs ?? 0,
    backlogTicks: state.accruedTargetWorldTick - state.worldTick,
    anchored,
    applied,
  };
}

function assertAccrualFields(state: GameState): void {
  if (!Number.isSafeInteger(state.worldTick) || state.worldTick < 0) {
    throw new Error('worldTick must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(state.accruedTargetWorldTick) || state.accruedTargetWorldTick < 0) {
    throw new Error('accruedTargetWorldTick must be a non-negative safe integer');
  }
  if (!Number.isInteger(state.subTickMicroticks) || state.subTickMicroticks < 0) {
    throw new Error('subTickMicroticks must be a non-negative integer');
  }
  if (!Number.isInteger(state.accrualDivisionRemainder) || state.accrualDivisionRemainder < 0) {
    throw new Error('accrualDivisionRemainder must be a non-negative integer');
  }
}
