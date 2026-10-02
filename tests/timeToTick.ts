import assert from 'assert';
import { BALANCE } from '../src/constants/balance';
import { createGameState } from '../src/state';
import {
  WORLD_TICK_DURATION_MS,
  advanceAuthoritativeWorldClock,
  utcEpochMs,
  accrueSimulationTime,
  accrueSimulationTimeAtRatePpm,
  realMillisecondsForSimulationWork,
  beginActivityTemporalProgress,
  accrueActivityTemporalProgress,
  promoteActivityTemporalRate,
  accrueActivityThenObservePresence,
  emptyFixedPointAccrual,
  temporalRatePpm,
  type FixedPointAccrual,
  type TemporalPresence,
  type TimeToTickAccrual,
} from '../src/world';

export interface TimeToTickTestApi {
  test: (name: string, fn: () => void) => void;
}

const T0 = utcEpochMs('2026-09-30T18:00:00.000Z');
const MINUTE = WORLD_TICK_DURATION_MS;
const DAY = 24 * 60 * MINUTE;

function at(elapsedMs: number, presence: TemporalPresence, carried = emptyFixedPointAccrual()) {
  return accrueSimulationTime(carried, elapsedMs, presence);
}

function fields(progress: FixedPointAccrual) {
  return {
    wholeTicks: progress.wholeTicks,
    subTickMicroticks: progress.subTickMicroticks,
    accrualDivisionRemainder: progress.accrualDivisionRemainder,
  };
}

function fold(chunks: number[], presence: TemporalPresence): TimeToTickAccrual {
  return chunks.reduce<TimeToTickAccrual>(
    (carried, elapsedMs) => accrueSimulationTime(carried, elapsedMs, presence),
    { ...emptyFixedPointAccrual(), elapsedWholeTicks: 0, remainderMs: 0 },
  );
}

export function registerTimeToTickTests(api: TimeToTickTestApi): void {
  const { test } = api;
  console.log('Time-to-tick engine');

  test('online and offline rates have one balance definition', () => {
    assert.strictEqual(BALANCE.temporal.ratePpmDenominator, 1_000_000);
    assert.strictEqual(BALANCE.temporal.onlineRatePpm, 1_000_000);
    assert.strictEqual(BALANCE.temporal.offlineRatePpm, 100_000);
    assert.strictEqual(BALANCE.temporal.microticksPerSimulationTick, 1_000_000);
    assert.strictEqual(temporalRatePpm('ONLINE'), BALANCE.temporal.onlineRatePpm);
    assert.strictEqual(temporalRatePpm('OFFLINE'), BALANCE.temporal.offlineRatePpm);
    assert.strictEqual(BALANCE.temporal.onlineRatePpm / BALANCE.temporal.ratePpmDenominator, 1);
    assert.strictEqual(BALANCE.temporal.offlineRatePpm / BALANCE.temporal.ratePpmDenominator, 0.1);
    assert.strictEqual(WORLD_TICK_DURATION_MS, 60_000);
    assert.strictEqual(BALANCE.world.onlineSimulationRate, 1);
    assert.strictEqual(BALANCE.world.offlineSimulationRate, 1);
    assert.strictEqual(BALANCE.world.maxElapsedTicksPerAdvance, 64);
  });

  test('zero elapsed milliseconds adds no progress and keeps a carried fraction', () => {
    const none = at(0, 'ONLINE');
    assert.deepStrictEqual(fields(none), fields(emptyFixedPointAccrual()));
    assert.strictEqual(none.elapsedWholeTicks, 0);
    assert.strictEqual(none.remainderMs, 0);
    const carried = at(1, 'ONLINE');
    const again = at(0, 'ONLINE', carried);
    assert.deepStrictEqual(fields(again), fields(carried));
    assert.strictEqual(again.elapsedWholeTicks, 0);
    assert.strictEqual(again.remainderMs, carried.remainderMs);
  });

  test('less than one online tick is kept as a recoverable remainder', () => {
    const partial = at(MINUTE - 1, 'ONLINE');
    assert.strictEqual(partial.wholeTicks, 0);
    assert.strictEqual(partial.elapsedWholeTicks, 0);
    assert.ok(partial.subTickMicroticks > 0);
    assert.strictEqual(partial.remainderMs, MINUTE - 1);
  });

  test('exactly one online tick consumes a full minute and leaves no remainder', () => {
    const one = at(MINUTE, 'ONLINE');
    assert.strictEqual(one.wholeTicks, 1);
    assert.strictEqual(one.elapsedWholeTicks, 1);
    assert.strictEqual(one.subTickMicroticks, 0);
    assert.strictEqual(one.accrualDivisionRemainder, 0);
    assert.strictEqual(one.remainderMs, 0);
    assert.strictEqual(realMillisecondsForSimulationWork(1, 0, 'ONLINE'), MINUTE);
  });

  test('multiple online ticks are whole minutes', () => {
    const ten = at(10 * MINUTE, 'ONLINE');
    assert.strictEqual(ten.wholeTicks, 10);
    assert.strictEqual(ten.remainderMs, 0);
    const withTail = at(10 * MINUTE + 15_000, 'ONLINE');
    assert.strictEqual(withTail.wholeTicks, 10);
    assert.strictEqual(withTail.remainderMs, 15_000);
  });

  test('offline rate earns one tick per ten real minutes', () => {
    const oneMinute = at(MINUTE, 'OFFLINE');
    assert.strictEqual(oneMinute.wholeTicks, 0);
    assert.strictEqual(oneMinute.subTickMicroticks, 100_000);
    assert.strictEqual(oneMinute.remainderMs, MINUTE);
    const oneTick = at(10 * MINUTE, 'OFFLINE');
    assert.strictEqual(oneTick.wholeTicks, 1);
    assert.strictEqual(oneTick.subTickMicroticks, 0);
    assert.strictEqual(oneTick.remainderMs, 0);
    assert.strictEqual(realMillisecondsForSimulationWork(1, 0, 'OFFLINE'), 10 * MINUTE);
  });

  test('a long offline duration stays exact', () => {
    const sevenDays = 7 * DAY;
    const accrued = at(sevenDays, 'OFFLINE');
    assert.strictEqual(accrued.wholeTicks, 7 * 24 * 6);
    assert.strictEqual(accrued.subTickMicroticks, 0);
    assert.strictEqual(accrued.accrualDivisionRemainder, 0);
    assert.strictEqual(accrued.remainderMs, 0);
  });

  test('split intervals match one interval at the same rate', () => {
    for (const presence of ['ONLINE', 'OFFLINE'] as const) {
      const chunks = [1, 17, 1_000, MINUTE - 1, 3 * MINUTE + 123, 0, 8 * MINUTE];
      const split = fold(chunks, presence);
      const combined = at(chunks.reduce((sum, ms) => sum + ms, 0), presence);
      assert.deepStrictEqual(fields(split), fields(combined));
      assert.strictEqual(split.remainderMs, combined.remainderMs);
      assert.strictEqual(split.wholeTicks, combined.elapsedWholeTicks);
    }
  });

  test('the same rate history matches whether it is chunked or combined', () => {
    const offlineMs = [4_000, 26_000, MINUTE];
    const onlineMs = [500, MINUTE + 20];
    let chunked = fold(offlineMs, 'OFFLINE');
    for (const ms of onlineMs) chunked = accrueSimulationTime(chunked, ms, 'ONLINE');
    let combined = at(offlineMs.reduce((sum, ms) => sum + ms, 0), 'OFFLINE');
    combined = at(onlineMs.reduce((sum, ms) => sum + ms, 0), 'ONLINE', combined);
    assert.deepStrictEqual(fields(chunked), fields(combined));
    assert.strictEqual(chunked.remainderMs, combined.remainderMs);
  });

  test('required real time is the smallest duration that earns the requested work', () => {
    const onlineTick = realMillisecondsForSimulationWork(1, 0, 'ONLINE');
    assert.strictEqual(at(onlineTick, 'ONLINE').wholeTicks, 1);
    assert.strictEqual(at(onlineTick - 1, 'ONLINE').wholeTicks, 0);
    const half = realMillisecondsForSimulationWork(0, 500_000, 'ONLINE');
    assert.strictEqual(half, MINUTE / 2);
    assert.ok(at(half, 'ONLINE').subTickMicroticks >= 500_000);
    assert.ok(at(half - 1, 'ONLINE').subTickMicroticks < 500_000);
  });

  test('an activity that starts online does not slow down when the player goes offline', () => {
    const started = beginActivityTemporalProgress(T0, 'ONLINE');
    const afterOnline = accrueActivityTemporalProgress(started, T0 + 2 * MINUTE);
    assert.strictEqual(afterOnline.achievedRate, 'ONLINE');
    assert.strictEqual(afterOnline.wholeTicks, 2);
    const observedOffline = accrueActivityThenObservePresence(afterOnline, T0 + 3 * MINUTE, 'OFFLINE');
    assert.strictEqual(observedOffline.achievedRate, 'ONLINE');
    assert.strictEqual(observedOffline.wholeTicks, 3);
    const stayedOnline = accrueActivityTemporalProgress(afterOnline, T0 + 3 * MINUTE);
    assert.deepStrictEqual(fields(observedOffline), fields(stayedOnline));
    const continued = accrueActivityTemporalProgress(observedOffline, T0 + 4 * MINUTE);
    assert.strictEqual(continued.achievedRate, 'ONLINE');
    assert.strictEqual(continued.wholeTicks, 4);
  });

  test('an activity that starts offline stays offline and keeps a partial tick', () => {
    const started = beginActivityTemporalProgress('2026-09-30T18:00:00.000Z', 'OFFLINE');
    const same = accrueActivityThenObservePresence(started, T0 + 3 * MINUTE, 'OFFLINE');
    assert.strictEqual(same.achievedRate, 'OFFLINE');
    assert.strictEqual(same.wholeTicks, 0);
    assert.strictEqual(same.subTickMicroticks, at(3 * MINUTE, 'OFFLINE').subTickMicroticks);
    const still = accrueActivityTemporalProgress(same, T0 + 10 * MINUTE);
    assert.strictEqual(still.achievedRate, 'OFFLINE');
    assert.strictEqual(still.wholeTicks, 1);
    assert.strictEqual(still.subTickMicroticks, 0);
  });

  test('promotion to online preserves earned progress and speeds only the remaining work', () => {
    const started = beginActivityTemporalProgress(T0, 'OFFLINE');
    const partial = accrueActivityTemporalProgress(started, T0 + 5 * MINUTE);
    assert.strictEqual(partial.wholeTicks, 0);
    assert.strictEqual(partial.subTickMicroticks, 500_000);
    const promoted = promoteActivityTemporalRate(partial, 'ONLINE');
    assert.strictEqual(promoted.achievedRate, 'ONLINE');
    assert.deepStrictEqual(fields(promoted), fields(partial));
    assert.strictEqual(promoted.accruedThroughMs, partial.accruedThroughMs);
    const remainingMs = realMillisecondsForSimulationWork(0, 500_000, 'ONLINE', promoted.accrualDivisionRemainder);
    assert.strictEqual(remainingMs, MINUTE / 2);
    const finished = accrueActivityTemporalProgress(promoted, partial.accruedThroughMs + remainingMs);
    assert.strictEqual(finished.wholeTicks, 1);
    assert.strictEqual(finished.subTickMicroticks, 0);
    const ifStillOffline = accrueActivityTemporalProgress(partial, partial.accruedThroughMs + remainingMs);
    assert.strictEqual(ifStillOffline.wholeTicks, 0);
    assert.ok(ifStillOffline.subTickMicroticks < partial.subTickMicroticks + 500_000);
  });

  test('a promoted activity does not return to the offline rate', () => {
    let progress = beginActivityTemporalProgress(T0, 'OFFLINE');
    progress = accrueActivityThenObservePresence(progress, T0 + 10 * MINUTE, 'ONLINE');
    assert.strictEqual(progress.achievedRate, 'ONLINE');
    assert.strictEqual(progress.wholeTicks, 1);
    const earned = fields(progress);
    progress = accrueActivityThenObservePresence(progress, T0 + 11 * MINUTE, 'OFFLINE');
    assert.strictEqual(progress.achievedRate, 'ONLINE');
    assert.strictEqual(progress.wholeTicks, 2);
    assert.notDeepStrictEqual(fields(progress), earned);
    const offlineWouldBe = accrueSimulationTime(earned, MINUTE, 'OFFLINE');
    assert.strictEqual(offlineWouldBe.wholeTicks, 1);
    assert.ok(progress.wholeTicks > offlineWouldBe.wholeTicks);
  });

  test('online and offline observations never reduce the achieved rate', () => {
    let progress = beginActivityTemporalProgress(T0, 'OFFLINE');
    const observations: TemporalPresence[] = ['OFFLINE', 'OFFLINE', 'ONLINE', 'OFFLINE', 'ONLINE', 'OFFLINE'];
    let fastest: TemporalPresence = 'OFFLINE';
    observations.forEach((presence, index) => {
      progress = accrueActivityThenObservePresence(progress, T0 + (index + 1) * MINUTE, presence);
      if (presence === 'ONLINE') fastest = 'ONLINE';
      assert.strictEqual(progress.achievedRate, fastest);
    });
    assert.strictEqual(progress.achievedRate, 'ONLINE');
    const offlineOnly = accrueActivityTemporalProgress(beginActivityTemporalProgress(T0, 'OFFLINE'), T0 + observations.length * MINUTE);
    assert.ok(progress.wholeTicks > offlineOnly.wholeTicks);
  });

  test('chunked activity accrual matches the same presence history in larger steps', () => {
    let fine = beginActivityTemporalProgress(T0, 'OFFLINE');
    for (let i = 1; i <= 5; i++) fine = accrueActivityTemporalProgress(fine, T0 + i * 1_000);
    fine = promoteActivityTemporalRate(fine, 'ONLINE');
    for (let i = 1; i <= 4; i++) fine = accrueActivityTemporalProgress(fine, T0 + 5_000 + i * MINUTE);
    fine = promoteActivityTemporalRate(fine, 'OFFLINE');
    fine = accrueActivityTemporalProgress(fine, T0 + 5_000 + 6 * MINUTE);

    let coarse = beginActivityTemporalProgress(T0, 'OFFLINE');
    coarse = accrueActivityTemporalProgress(coarse, T0 + 5_000);
    coarse = promoteActivityTemporalRate(coarse, 'ONLINE');
    coarse = accrueActivityTemporalProgress(coarse, T0 + 5_000 + 4 * MINUTE);
    coarse = promoteActivityTemporalRate(coarse, 'OFFLINE');
    coarse = accrueActivityTemporalProgress(coarse, T0 + 5_000 + 6 * MINUTE);

    assert.strictEqual(fine.achievedRate, 'ONLINE');
    assert.deepStrictEqual(fields(fine), fields(coarse));
    assert.strictEqual(fine.accruedThroughMs, coarse.accruedThroughMs);
  });

  test('negative elapsed time and time rewind are rejected', () => {
    assert.throws(() => at(-1, 'ONLINE'), /must not be negative/);
    assert.throws(() => at(-MINUTE, 'OFFLINE'), /must not be negative/);
    const started = beginActivityTemporalProgress(T0, 'ONLINE');
    const moved = accrueActivityTemporalProgress(started, T0 + MINUTE);
    assert.throws(() => accrueActivityTemporalProgress(moved, T0), /must not rewind/);
    assert.throws(() => accrueActivityTemporalProgress(moved, T0 + MINUTE - 1), /must not rewind/);
    assert.strictEqual(moved.wholeTicks, 1);
    assert.strictEqual(moved.accruedThroughMs, T0 + MINUTE);
  });

  test('invalid, non-finite, and unsafe rates and durations are rejected', () => {
    const carried = emptyFixedPointAccrual();
    assert.throws(() => accrueSimulationTimeAtRatePpm(carried, MINUTE, 0), /not a configured/);
    assert.throws(() => accrueSimulationTimeAtRatePpm(carried, MINUTE, -1), /not a configured/);
    assert.throws(() => accrueSimulationTimeAtRatePpm(carried, MINUTE, 0.1), /must be an integer/);
    assert.throws(() => accrueSimulationTimeAtRatePpm(carried, MINUTE, 2), /not a configured/);
    assert.throws(() => accrueSimulationTimeAtRatePpm(carried, MINUTE, Number.NaN), /finite number/);
    assert.throws(() => accrueSimulationTimeAtRatePpm(carried, MINUTE, Number.POSITIVE_INFINITY), /finite number/);
    assert.throws(() => accrueSimulationTime(carried, MINUTE, 'FAST' as TemporalPresence), /not a configured/);
    assert.throws(() => at(Number.NaN, 'ONLINE'), /finite number/);
    assert.throws(() => at(Number.POSITIVE_INFINITY, 'OFFLINE'), /finite number/);
    assert.throws(() => at(1.5, 'ONLINE'), /must be an integer/);
    assert.throws(() => at(Number.MAX_SAFE_INTEGER + 1, 'ONLINE'), /safe integer/);
    assert.throws(() => realMillisecondsForSimulationWork(-1, 0, 'ONLINE'), /non-negative safe integer/);
    assert.throws(() => beginActivityTemporalProgress('2026-09-30T18:00:00', 'ONLINE'), /UTC offset/);
  });

  test('a very large elapsed duration remains a safe exact tick count', () => {
    const elapsedMs = 1_000_000_000 * MINUTE;
    const accrued = at(elapsedMs, 'ONLINE');
    assert.strictEqual(accrued.wholeTicks, 1_000_000_000);
    assert.strictEqual(accrued.subTickMicroticks, 0);
    assert.strictEqual(accrued.accrualDivisionRemainder, 0);
    const offline = at(elapsedMs, 'OFFLINE');
    assert.strictEqual(offline.wholeTicks, 100_000_000);
    assert.strictEqual(offline.subTickMicroticks, 0);
  });

  test('the unscaled world clock does not apply the offline rate', () => {
    const state = createGameState();
    state.worldTick = 10;
    state.lastProcessedAtMs = T0;
    const advanced = advanceAuthoritativeWorldClock(state, T0 + 10 * MINUTE);
    assert.strictEqual(advanced.elapsedTicks, 10);
    assert.strictEqual(state.worldTick, 20);
    assert.strictEqual(at(10 * MINUTE, 'OFFLINE').wholeTicks, 1);
  });
}
