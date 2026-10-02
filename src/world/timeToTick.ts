import { BALANCE } from '../constants/balance';
import { utcEpochMs, WORLD_TICK_DURATION_MS } from './realtimeClock';

/**
 * Pure time-to-tick conversion.
 *
 * Real elapsed time becomes fixed-point simulation progress at one of the
 * two configured rates. This module does not decide which actions exist,
 * what they cost, or when the world processes them.
 *
 * An activity remembers the fastest rate it has achieved. Offline work may
 * be promoted to online. Online work is never demoted when the player
 * disconnects. Progress already earned is not rewritten.
 */

export type TemporalPresence = 'ONLINE' | 'OFFLINE';

/** Fixed-point simulation progress. The three fields together are exact. */
export interface FixedPointAccrual {
  /** Whole simulation ticks earned. */
  wholeTicks: number;
  /** Fraction of the next tick, in [0, microticksPerSimulationTick). */
  subTickMicroticks: number;
  /**
   * Leftover numerator after dividing by the baseline tick duration.
   * Range [0, WORLD_TICK_DURATION_MS). Carried into the next accrual so
   * no real millisecond is dropped.
   */
  accrualDivisionRemainder: number;
}

/**
 * Minimum persistent shape a later action can store.
 * Not part of GameState in this phase.
 */
export interface ActivityTemporalProgress extends FixedPointAccrual {
  /**
   * Fastest presence this activity has reached.
   * OFFLINE may become ONLINE. ONLINE never returns to OFFLINE.
   */
  achievedRate: TemporalPresence;
  /** UTC epoch milliseconds through which this progress has been accrued. */
  accruedThroughMs: number;
}

export interface TimeToTickAccrual extends FixedPointAccrual {
  /** Whole ticks added by this call. */
  elapsedWholeTicks: number;
  /**
   * Real milliseconds still sitting in the fractional tick after this call,
   * measured at the rate just used.
   */
  remainderMs: number;
}

const EMPTY_ACCRUAL: FixedPointAccrual = {
  wholeTicks: 0,
  subTickMicroticks: 0,
  accrualDivisionRemainder: 0,
};

export function emptyFixedPointAccrual(): FixedPointAccrual {
  return { ...EMPTY_ACCRUAL };
}

export function isTemporalPresence(value: unknown): value is TemporalPresence {
  return value === 'ONLINE' || value === 'OFFLINE';
}

/** Parts-per-million for a presence. Reads the single balance definition. */
export function temporalRatePpm(presence: TemporalPresence): number {
  if (presence === 'ONLINE') return BALANCE.temporal.onlineRatePpm;
  if (presence === 'OFFLINE') return BALANCE.temporal.offlineRatePpm;
  throw new Error('Temporal rate is not a configured online or offline rate');
}

/**
 * Monotonic promotion. A higher observed presence replaces the achieved
 * rate. A lower one does not.
 */
export function promoteTemporalPresence(achieved: TemporalPresence, observed: TemporalPresence): TemporalPresence {
  assertPresence(achieved);
  assertPresence(observed);
  if (achieved === 'ONLINE') return 'ONLINE';
  return observed;
}

export function accrueSimulationTime(
  carried: FixedPointAccrual,
  elapsedMs: number,
  presence: TemporalPresence,
): TimeToTickAccrual {
  assertPresence(presence);
  return accrueAtRatePpm(carried, elapsedMs, temporalRatePpm(presence));
}

/**
 * Same conversion, addressed by the configured ppm value.
 * Rejects any rate other than the online and offline balance values,
 * including floats, NaN, Infinity, and unsafe integers.
 */
export function accrueSimulationTimeAtRatePpm(
  carried: FixedPointAccrual,
  elapsedMs: number,
  ratePpm: number,
): TimeToTickAccrual {
  assertConfiguredRatePpm(ratePpm);
  return accrueAtRatePpm(carried, elapsedMs, ratePpm);
}

/**
 * Real milliseconds required to earn `wholeTicks` plus `subTickMicroticks`
 * at `presence`, given a division remainder already in hand.
 */
export function realMillisecondsForSimulationWork(
  wholeTicks: number,
  subTickMicroticks: number,
  presence: TemporalPresence,
  carriedDivisionRemainder = 0,
): number {
  assertPresence(presence);
  assertWholeTicks(wholeTicks);
  assertSubTick(subTickMicroticks);
  assertRemainder(carriedDivisionRemainder);
  const microticks = BigInt(wholeTicks) * BigInt(BALANCE.temporal.microticksPerSimulationTick) + BigInt(subTickMicroticks);
  const needed = microticks * BigInt(WORLD_TICK_DURATION_MS) - BigInt(carriedDivisionRemainder);
  if (needed <= 0n) return 0;
  const rate = BigInt(temporalRatePpm(presence));
  const elapsed = (needed + rate - 1n) / rate;
  return safeNumber(elapsed, 'Required real milliseconds');
}

export function beginActivityTemporalProgress(
  startedAt: number | string | Date,
  presenceAtStart: TemporalPresence,
): ActivityTemporalProgress {
  assertPresence(presenceAtStart);
  return {
    ...emptyFixedPointAccrual(),
    achievedRate: presenceAtStart,
    accruedThroughMs: utcEpochMs(startedAt),
  };
}

/** Accrue (accruedThroughMs, now] at the activity's achieved rate. Does not look at current presence. */
export function accrueActivityTemporalProgress(
  progress: ActivityTemporalProgress,
  now: number | string | Date,
): ActivityTemporalProgress {
  const nowMs = utcEpochMs(now);
  assertAccrualFields(progress);
  if (nowMs < progress.accruedThroughMs) {
    throw new Error('Temporal accrual must not rewind');
  }
  const elapsedMs = nowMs - progress.accruedThroughMs;
  assertNonNegativeElapsedMs(elapsedMs);
  const accrued = accrueSimulationTime(progress, elapsedMs, progress.achievedRate);
  return {
    achievedRate: progress.achievedRate,
    wholeTicks: accrued.wholeTicks,
    subTickMicroticks: accrued.subTickMicroticks,
    accrualDivisionRemainder: accrued.accrualDivisionRemainder,
    accruedThroughMs: nowMs,
  };
}

/** Raise the achieved rate when the observation is faster. Never lowers it. Does not change earned progress. */
export function promoteActivityTemporalRate(
  progress: ActivityTemporalProgress,
  observedPresence: TemporalPresence,
): ActivityTemporalProgress {
  assertAccrualFields(progress);
  const achievedRate = promoteTemporalPresence(progress.achievedRate, observedPresence);
  if (achievedRate === progress.achievedRate) return progress;
  return { ...progress, achievedRate };
}

/**
 * Close the interval at the rate already achieved, then apply promotion.
 * Time before `now` keeps the old rate. Remaining work uses the promoted rate.
 */
export function accrueActivityThenObservePresence(
  progress: ActivityTemporalProgress,
  now: number | string | Date,
  observedPresence: TemporalPresence,
): ActivityTemporalProgress {
  return promoteActivityTemporalRate(accrueActivityTemporalProgress(progress, now), observedPresence);
}

function accrueAtRatePpm(carried: FixedPointAccrual, elapsedMs: number, ratePpm: number): TimeToTickAccrual {
  assertAccrualFields(carried);
  assertNonNegativeElapsedMs(elapsedMs);
  const baseline = BigInt(WORLD_TICK_DURATION_MS);
  const microPerTick = BigInt(BALANCE.temporal.microticksPerSimulationTick);
  const numerator = BigInt(elapsedMs) * BigInt(ratePpm) + BigInt(carried.accrualDivisionRemainder);
  const accruedMicroticks = numerator / baseline;
  const accrualDivisionRemainder = numerator % baseline;
  const subTotal = BigInt(carried.subTickMicroticks) + accruedMicroticks;
  const addedWhole = subTotal / microPerTick;
  const subTickMicroticks = subTotal % microPerTick;
  const wholeTicks = safeNumber(BigInt(carried.wholeTicks) + addedWhole, 'Accrued simulation ticks');
  const next: FixedPointAccrual = {
    wholeTicks,
    subTickMicroticks: Number(subTickMicroticks),
    accrualDivisionRemainder: Number(accrualDivisionRemainder),
  };
  return {
    ...next,
    elapsedWholeTicks: wholeTicks - carried.wholeTicks,
    remainderMs: fractionalRemainderMs(next, ratePpm),
  };
}

function fractionalRemainderMs(progress: FixedPointAccrual, ratePpm: number): number {
  const fraction = BigInt(progress.subTickMicroticks) * BigInt(WORLD_TICK_DURATION_MS) + BigInt(progress.accrualDivisionRemainder);
  const rate = BigInt(ratePpm);
  if (fraction % rate !== 0n) {
    throw new Error('Fractional simulation progress is not an exact real-time remainder at this rate');
  }
  return safeNumber(fraction / rate, 'Real-time remainder');
}

function assertPresence(presence: TemporalPresence): void {
  if (!isTemporalPresence(presence)) {
    throw new Error('Temporal rate is not a configured online or offline rate');
  }
}

function assertConfiguredRatePpm(ratePpm: number): void {
  if (typeof ratePpm !== 'number' || !Number.isFinite(ratePpm)) {
    throw new Error('Temporal rate must be a finite number');
  }
  if (!Number.isInteger(ratePpm)) {
    throw new Error('Temporal rate must be an integer');
  }
  if (!Number.isSafeInteger(ratePpm)) {
    throw new Error('Temporal rate exceeds a safe integer');
  }
  if (ratePpm !== BALANCE.temporal.onlineRatePpm && ratePpm !== BALANCE.temporal.offlineRatePpm) {
    throw new Error('Temporal rate is not a configured online or offline rate');
  }
}

function assertNonNegativeElapsedMs(elapsedMs: number): void {
  if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs)) {
    throw new Error('Elapsed milliseconds must be a finite number');
  }
  if (!Number.isInteger(elapsedMs)) {
    throw new Error('Elapsed milliseconds must be an integer');
  }
  if (!Number.isSafeInteger(elapsedMs)) {
    throw new Error('Elapsed milliseconds exceed a safe integer');
  }
  if (elapsedMs < 0) {
    throw new Error('Elapsed milliseconds must not be negative');
  }
}

function assertAccrualFields(progress: FixedPointAccrual): void {
  if (progress == null) throw new Error('Simulation progress is missing');
  assertWholeTicks(progress.wholeTicks);
  assertSubTick(progress.subTickMicroticks);
  assertRemainder(progress.accrualDivisionRemainder);
}

function assertWholeTicks(wholeTicks: number): void {
  if (typeof wholeTicks !== 'number' || !Number.isInteger(wholeTicks) || !Number.isSafeInteger(wholeTicks) || wholeTicks < 0) {
    throw new Error('Simulation ticks must be a non-negative safe integer');
  }
}

function assertSubTick(subTickMicroticks: number): void {
  if (
    typeof subTickMicroticks !== 'number'
    || !Number.isInteger(subTickMicroticks)
    || subTickMicroticks < 0
    || subTickMicroticks >= BALANCE.temporal.microticksPerSimulationTick
  ) {
    throw new Error('Sub-tick microticks are outside their fixed-point range');
  }
}

function assertRemainder(accrualDivisionRemainder: number): void {
  if (
    typeof accrualDivisionRemainder !== 'number'
    || !Number.isInteger(accrualDivisionRemainder)
    || accrualDivisionRemainder < 0
    || accrualDivisionRemainder >= WORLD_TICK_DURATION_MS
  ) {
    throw new Error('Accrual division remainder is outside its fixed-point range');
  }
}

function safeNumber(value: bigint, label: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds a safe integer`);
  }
  return Number(value);
}
