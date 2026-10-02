import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { BALANCE } from '../src/constants/balance';
import { GAME_STATE_SCHEMA_VERSION } from '../src/types/GameState';
import {
  accrueActivityThenObservePresence,
  accrueSimulationTime,
  beginActivityTemporalProgress,
  emptyFixedPointAccrual,
  realMillisecondsForSimulationWork,
  utcEpochMs,
  WORLD_TICK_DURATION_MS,
  TEMPORAL_BOUNDARY_STAGE,
  compareTemporalBoundaries,
  deriveActionCompletion,
  deriveOrderedBoundaries,
  deriveWorldTickBoundaries,
  interruptionBoundary,
  observeActionProgress,
  observeWorldAccrual,
  orderTemporalBoundaries,
  postCompletionDecisionBoundary,
  projectActionProgress,
  projectWorldAccrual,
  realWorldGateBoundary,
  worldTickBoundaryInstant,
  type ActionClockInput,
  type PresenceSegmentInput,
  type TemporalBoundary,
  type TemporalPresence,
  type WorldAccrualState,
} from '../src/world';

export interface TemporalBoundaryTestApi {
  test: (name: string, fn: () => void) => void;
}

const T0 = utcEpochMs('2026-10-01T18:00:00.000Z');
const MINUTE = WORLD_TICK_DURATION_MS;
const WORLD_ORIGIN = 1000;

function segments(spans: readonly (readonly [number, TemporalPresence])[], origin = T0): PresenceSegmentInput[] {
  let cursor = origin;
  return spans.map(([durationMs, presence]) => {
    const segment = { startMs: cursor, endMs: cursor + durationMs, presence };
    cursor += durationMs;
    return segment;
  });
}

function world(tick = WORLD_ORIGIN, at = T0): WorldAccrualState {
  return {
    accruedTargetWorldTick: tick,
    subTickMicroticks: 0,
    accrualDivisionRemainder: 0,
    lastAccrualAtMs: at,
  };
}

function clock(id: string, presence: TemporalPresence, requiredWholeTicks: number, at = T0): ActionClockInput {
  return {
    stableId: id,
    progress: beginActivityTemporalProgress(at, presence),
    requiredWholeTicks,
  };
}

function key(boundary: TemporalBoundary) {
  return {
    at: boundary.realInstantMs - T0,
    stage: boundary.stage,
    id: boundary.stableId,
    kind: boundary.kind,
  };
}

export function registerTemporalBoundaryTests(api: TemporalBoundaryTestApi): void {
  const { test } = api;
  console.log('Temporal boundary algebra');

  test('boundary instants use Phase 1 earliest-millisecond rounding', () => {
    const online = realMillisecondsForSimulationWork(10, 0, 'ONLINE');
    assert.strictEqual(online, 10 * MINUTE);
    const before = accrueSimulationTime(emptyFixedPointAccrual(), online - 1, 'ONLINE');
    assert.strictEqual(before.wholeTicks, 9);
    const exact = accrueSimulationTime(emptyFixedPointAccrual(), online, 'ONLINE');
    assert.strictEqual(exact.wholeTicks, 10);
    assert.strictEqual(exact.subTickMicroticks, 0);
    assert.strictEqual(exact.accrualDivisionRemainder, 0);
    const oneMicro = realMillisecondsForSimulationWork(0, 1, 'ONLINE');
    assert.strictEqual(oneMicro, 1);
    assert.strictEqual(accrueSimulationTime(emptyFixedPointAccrual(), 0, 'ONLINE').subTickMicroticks, 0);
    assert.ok(accrueSimulationTime(emptyFixedPointAccrual(), 1, 'ONLINE').subTickMicroticks >= 1);
    assert.strictEqual(realMillisecondsForSimulationWork(1, 0, 'OFFLINE'), 10 * MINUTE);
    assert.strictEqual(GAME_STATE_SCHEMA_VERSION, 14);
    assert.strictEqual(BALANCE.temporal.onlineRatePpm, 1_000_000);
    assert.strictEqual(BALANCE.temporal.offlineRatePpm, 100_000);
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'world', 'temporalBoundaries.ts'), 'utf8');
    assert.ok(!src.includes('GameState'));
    assert.ok(!src.includes('maxElapsedTicksPerAdvance'));
    assert.ok(!src.includes('Math.'));
    assert.ok(!src.includes('DecisionEngine'));
    assert.deepStrictEqual(TEMPORAL_BOUNDARY_STAGE, {
      ACTION_COMPLETION: 1,
      INTERRUPTION: 2,
      DEADLINE: 3,
      WORLD_PROCESS: 4,
      AI_DECISION: 5,
    });
  });

  test('scenario A: an online action finishes between world ticks 1002 and 1003', () => {
    const span = segments([[2 * MINUTE, 'ONLINE'], [28 * MINUTE, 'OFFLINE']]);
    const action = clock('march', 'ONLINE', 10);
    const ordered = deriveOrderedBoundaries({ world: world(), segments: span, actions: [action] });
    const completion = ordered.find((item) => item.kind === 'ACTION_COMPLETION');
    assert.ok(completion);
    assert.strictEqual(completion.realInstantMs, T0 + 10 * MINUTE);
    assert.strictEqual(completion.achievedRate, 'ONLINE');
    assert.strictEqual(completion.stage, TEMPORAL_BOUNDARY_STAGE.ACTION_COMPLETION);
    const tick1002 = ordered.find((item) => item.earnedWorldTick === 1002);
    const tick1003 = ordered.find((item) => item.earnedWorldTick === 1003);
    assert.ok(tick1002 && tick1003);
    assert.strictEqual(tick1002.realInstantMs, T0 + 2 * MINUTE);
    assert.strictEqual(tick1003.realInstantMs, T0 + 12 * MINUTE);
    assert.ok(tick1002.realInstantMs < completion.realInstantMs);
    assert.ok(completion.realInstantMs < tick1003.realInstantMs);
    const atCompletion = projectWorldAccrual(world(), segments([[2 * MINUTE, 'ONLINE'], [8 * MINUTE, 'OFFLINE']]));
    assert.strictEqual(atCompletion.accruedTargetWorldTick, 1002);
    assert.strictEqual(atCompletion.subTickMicroticks, 800_000);
    assert.strictEqual(atCompletion.accrualDivisionRemainder, 0);
    assert.notStrictEqual(completion.realInstantMs, T0 + 82 * MINUTE);
  });

  test('scenario B: an offline action and the world earn ten ticks in one hundred minutes', () => {
    const span = segments([[100 * MINUTE, 'OFFLINE']]);
    const ordered = deriveOrderedBoundaries({
      world: world(0),
      segments: span,
      actions: [clock('siege', 'OFFLINE', 10)],
    });
    const completion = ordered.find((item) => item.kind === 'ACTION_COMPLETION')!;
    const tenth = ordered.find((item) => item.earnedWorldTick === 10)!;
    assert.strictEqual(completion.realInstantMs, T0 + 100 * MINUTE);
    assert.strictEqual(completion.achievedRate, 'OFFLINE');
    assert.strictEqual(tenth.realInstantMs, completion.realInstantMs);
    assert.ok(completion.stage < tenth.stage);
    assert.strictEqual(ordered.filter((item) => item.kind === 'WORLD_TICK').length, 10);
    const done = projectWorldAccrual(world(0), span);
    assert.strictEqual(done.accruedTargetWorldTick, 10);
    assert.strictEqual(done.subTickMicroticks, 0);
  });

  test('scenario C: offline progress is kept and the remainder finishes online', () => {
    const span = segments([[30 * MINUTE, 'OFFLINE'], [30 * MINUTE, 'ONLINE']]);
    const completion = deriveActionCompletion(clock('build', 'OFFLINE', 10), span);
    assert.ok(completion);
    assert.strictEqual(completion.realInstantMs, T0 + 37 * MINUTE);
    assert.strictEqual(completion.achievedRate, 'ONLINE');
    const midpoint = projectActionProgress(clock('build', 'OFFLINE', 10).progress, segments([[30 * MINUTE, 'OFFLINE']]));
    assert.strictEqual(midpoint.wholeTicks, 3);
    assert.strictEqual(midpoint.subTickMicroticks, 0);
    assert.strictEqual(midpoint.achievedRate, 'OFFLINE');
    const atCompletion = projectWorldAccrual(world(0), segments([[30 * MINUTE, 'OFFLINE'], [7 * MINUTE, 'ONLINE']]));
    assert.strictEqual(atCompletion.accruedTargetWorldTick, 10);
    assert.strictEqual(atCompletion.subTickMicroticks, 0);
  });

  test('scenario D: logout after promotion does not move the completion instant', () => {
    const stayedOnline = deriveActionCompletion(
      clock('build', 'OFFLINE', 10),
      segments([[30 * MINUTE, 'OFFLINE'], [30 * MINUTE, 'ONLINE']]),
    );
    const loggedOut = deriveActionCompletion(
      clock('build', 'OFFLINE', 10),
      segments([[30 * MINUTE, 'OFFLINE'], [2 * MINUTE, 'ONLINE'], [30 * MINUTE, 'OFFLINE']]),
    );
    assert.ok(stayedOnline && loggedOut);
    assert.strictEqual(loggedOut.realInstantMs, stayedOnline.realInstantMs);
    assert.strictEqual(loggedOut.realInstantMs, T0 + 37 * MINUTE);
    assert.strictEqual(loggedOut.achievedRate, 'ONLINE');
    const atCompletion = projectWorldAccrual(
      world(0),
      segments([[30 * MINUTE, 'OFFLINE'], [2 * MINUTE, 'ONLINE'], [5 * MINUTE, 'OFFLINE']]),
    );
    assert.strictEqual(atCompletion.accruedTargetWorldTick, 5);
    assert.strictEqual(atCompletion.subTickMicroticks, 500_000);
    const tick5 = worldTickBoundaryInstant(world(0), 5, segments([[30 * MINUTE, 'OFFLINE'], [2 * MINUTE, 'ONLINE'], [20 * MINUTE, 'OFFLINE']]));
    const tick6 = worldTickBoundaryInstant(world(0), 6, segments([[30 * MINUTE, 'OFFLINE'], [2 * MINUTE, 'ONLINE'], [20 * MINUTE, 'OFFLINE']]));
    assert.strictEqual(tick5, T0 + 32 * MINUTE);
    assert.strictEqual(tick6, T0 + 42 * MINUTE);
    assert.ok(tick5 < loggedOut.realInstantMs && loggedOut.realInstantMs < tick6);
  });

  test('scenario E: four online ticks sort ahead of one offline tick', () => {
    const span = segments([[30 * MINUTE, 'OFFLINE']]);
    const online = clock('march-online', 'ONLINE', 10);
    online.progress.wholeTicks = 6;
    const offline = clock('march-offline', 'OFFLINE', 10);
    offline.progress.wholeTicks = 9;
    const forward = deriveOrderedBoundaries({ world: world(), segments: span, actions: [offline, online] });
    const reverse = deriveOrderedBoundaries({ world: world(), segments: span, actions: [online, offline] });
    assert.deepStrictEqual(forward.map(key), reverse.map(key));
    const completions = forward.filter((item) => item.kind === 'ACTION_COMPLETION');
    assert.deepStrictEqual(completions.map(key), [
      { at: 4 * MINUTE, stage: 1, id: 'march-online', kind: 'ACTION_COMPLETION' },
      { at: 10 * MINUTE, stage: 1, id: 'march-offline', kind: 'ACTION_COMPLETION' },
    ]);
    assert.strictEqual(completions[0]!.achievedRate, 'ONLINE');
    assert.strictEqual(completions[1]!.achievedRate, 'OFFLINE');
    const firstWorld = forward.find((item) => item.kind === 'WORLD_TICK')!;
    assert.strictEqual(firstWorld.realInstantMs, T0 + 10 * MINUTE);
    assert.ok(completions[0]!.realInstantMs < firstWorld.realInstantMs);
    assert.ok(compareTemporalBoundaries(completions[1]!, firstWorld) < 0);
  });

  test('scenario F: a completion inside a long backlog stays in its fractional gap', () => {
    const span = segments([[1000 * MINUTE, 'OFFLINE']]);
    const ordered = deriveOrderedBoundaries({
      world: world(),
      segments: span,
      actions: [clock('raid', 'ONLINE', 15)],
    });
    const completion = ordered.find((item) => item.kind === 'ACTION_COMPLETION')!;
    const before = ordered.find((item) => item.earnedWorldTick === 1001)!;
    const after = ordered.find((item) => item.earnedWorldTick === 1002)!;
    const last = ordered.filter((item) => item.kind === 'WORLD_TICK').at(-1)!;
    assert.strictEqual(completion.realInstantMs, T0 + 15 * MINUTE);
    assert.strictEqual(before.realInstantMs, T0 + 10 * MINUTE);
    assert.strictEqual(after.realInstantMs, T0 + 20 * MINUTE);
    assert.ok(before.realInstantMs < completion.realInstantMs && completion.realInstantMs < after.realInstantMs);
    assert.ok(completion.realInstantMs < last.realInstantMs);
    assert.strictEqual(last.earnedWorldTick, 1100);
    const atCompletion = projectWorldAccrual(world(), segments([[15 * MINUTE, 'OFFLINE']]));
    assert.strictEqual(atCompletion.accruedTargetWorldTick, 1001);
    assert.strictEqual(atCompletion.subTickMicroticks, 500_000);
    assert.ok(ordered.findIndex((item) => item.kind === 'ACTION_COMPLETION') < ordered.length - 1);
  });

  test('scenario G: equal milliseconds sort by stable id, not input order', () => {
    const span = segments([[10 * MINUTE, 'OFFLINE']]);
    const zeta = clock('zeta', 'OFFLINE', 1);
    const alpha = clock('alpha', 'OFFLINE', 1);
    const forward = deriveOrderedBoundaries({ world: world(0), segments: span, actions: [zeta, alpha] });
    const reverse = deriveOrderedBoundaries({ world: world(0), segments: span, actions: [alpha, zeta] });
    const completions = forward.filter((item) => item.kind === 'ACTION_COMPLETION');
    assert.strictEqual(completions[0]!.realInstantMs, completions[1]!.realInstantMs);
    assert.deepStrictEqual(completions.map((item) => item.stableId), ['alpha', 'zeta']);
    assert.deepStrictEqual(forward.map(key), reverse.map(key));
    const gates = [
      realWorldGateBoundary('action-2', T0 + MINUTE),
      realWorldGateBoundary('action-10', T0 + MINUTE),
      realWorldGateBoundary('m', T0 + MINUTE),
      realWorldGateBoundary('M', T0 + MINUTE),
    ];
    assert.deepStrictEqual(orderTemporalBoundaries([...gates].reverse()).map((item) => item.stableId), ['M', 'action-10', 'action-2', 'm']);
    assert.throws(() => orderTemporalBoundaries([gates[0]!, gates[0]!]), /stable id/);
  });

  test('scenario H: same-instant stages beat stable id, and a nearer millisecond beats stage', () => {
    const completionAt = T0 + 100 * MINUTE;
    const span = segments([[100 * MINUTE + 1, 'OFFLINE']]);
    const ordered = deriveOrderedBoundaries({
      world: world(),
      segments: span,
      actions: [clock('assault', 'OFFLINE', 10)],
      interruptions: [{ stableId: 'route-lost', atMs: completionAt }],
      gates: [
        { stableId: 'gate-b', atMs: completionAt },
        { stableId: 'gate-a', atMs: completionAt },
        { stableId: 'earlier-gate', atMs: completionAt - 1 },
        { stableId: 'later-gate', atMs: completionAt + 1 },
      ],
      includePostCompletionDecisions: true,
    });
    const cluster = ordered.filter((item) => item.realInstantMs === completionAt).map(key);
    assert.deepStrictEqual(cluster, [
      { at: 100 * MINUTE, stage: 1, id: 'assault', kind: 'ACTION_COMPLETION' },
      { at: 100 * MINUTE, stage: 2, id: 'route-lost', kind: 'INTERRUPTION' },
      { at: 100 * MINUTE, stage: 3, id: 'gate-a', kind: 'REAL_WORLD_GATE' },
      { at: 100 * MINUTE, stage: 3, id: 'gate-b', kind: 'REAL_WORLD_GATE' },
      { at: 100 * MINUTE, stage: 4, id: 'world-tick:1010', kind: 'WORLD_TICK' },
      { at: 100 * MINUTE, stage: 5, id: 'assault', kind: 'AI_DECISION' },
    ]);
    const earlier = ordered.find((item) => item.stableId === 'earlier-gate')!;
    const later = ordered.find((item) => item.stableId === 'later-gate')!;
    assert.ok(earlier.realInstantMs < cluster[0]!.at + T0);
    assert.ok(later.realInstantMs > completionAt);
    assert.ok(compareTemporalBoundaries(earlier, ordered.find((item) => item.kind === 'ACTION_COMPLETION')!) < 0);
    const shuffled = orderTemporalBoundaries([...ordered].reverse());
    assert.deepStrictEqual(shuffled.map(key), ordered.map(key));
  });

  test('scenario I: the decision opportunity follows action completion at the same millisecond', () => {
    const completion = deriveActionCompletion(clock('faction-a', 'ONLINE', 1), segments([[MINUTE, 'ONLINE']]));
    assert.ok(completion);
    const decision = postCompletionDecisionBoundary(completion);
    assert.strictEqual(decision.kind, 'AI_DECISION');
    assert.strictEqual(decision.realInstantMs, completion.realInstantMs);
    assert.strictEqual(decision.stage, TEMPORAL_BOUNDARY_STAGE.AI_DECISION);
    assert.ok(completion.stage < decision.stage);
    const ordered = orderTemporalBoundaries([decision, completion]);
    assert.deepStrictEqual(ordered.map((item) => item.kind), ['ACTION_COMPLETION', 'AI_DECISION']);
    assert.throws(() => postCompletionDecisionBoundary(decision), /action-completion/);
  });

  test('scenario J: a split resume matches the uninterrupted boundary list', () => {
    const span = segments([[2 * MINUTE, 'ONLINE'], [28 * MINUTE, 'OFFLINE']]);
    const action = clock('march', 'ONLINE', 10);
    const full = deriveOrderedBoundaries({ world: world(), segments: span, actions: [action] });
    for (const split of [T0 + 2 * MINUTE + 30_000 + 17, T0 + 11 * MINUTE]) {
      const prefix = span.map((segment) => ({ ...segment })).filter((segment) => segment.startMs < split);
      const clipped = prefix.map((segment) => (
        segment.endMs > split ? { ...segment, endMs: split } : segment
      ));
      const carriedWorld = projectWorldAccrual(world(), clipped);
      const carriedAction = projectActionProgress(action.progress, clipped);
      const suffix = span.map((segment) => ({
        startMs: segment.startMs < split ? split : segment.startMs,
        endMs: segment.endMs,
        presence: segment.presence,
      })).filter((segment) => segment.endMs > segment.startMs);
      const resumed = deriveOrderedBoundaries({
        world: carriedWorld,
        segments: suffix,
        actions: [{ ...action, progress: carriedAction }],
      });
      const head = full.filter((item) => item.realInstantMs <= split);
      const tail = full.filter((item) => item.realInstantMs > split);
      assert.deepStrictEqual(head.concat(resumed).map(key), full.map(key));
      assert.deepStrictEqual(resumed.map(key), tail.map(key));
    }
  });

  test('chunked observations match one catch-up over the same presence history', () => {
    const coarse = segments([[2 * MINUTE, 'ONLINE'], [58 * MINUTE, 'OFFLINE']]);
    const fine: PresenceSegmentInput[] = [{ startMs: T0, endMs: T0 + 2 * MINUTE, presence: 'ONLINE' }];
    for (let minute = 2; minute < 60; minute += 10) {
      const end = minute + 10 > 60 ? 60 : minute + 10;
      fine.push({ startMs: T0 + minute * MINUTE, endMs: T0 + end * MINUTE, presence: 'OFFLINE' });
    }
    const action = clock('march', 'ONLINE', 10);
    const once = deriveOrderedBoundaries({ world: world(), segments: coarse, actions: [action] });
    const chunked = deriveOrderedBoundaries({ world: world(), segments: fine, actions: [action] });
    assert.deepStrictEqual(chunked.map(key), once.map(key));
    assert.deepStrictEqual(projectWorldAccrual(world(), fine), projectWorldAccrual(world(), coarse));
    assert.deepStrictEqual(projectActionProgress(action.progress, fine), projectActionProgress(action.progress, coarse));

    const fractional = world();
    fractional.subTickMicroticks = 16;
    fractional.accrualDivisionRemainder = 40_000;
    const hour = segments([[60 * MINUTE, 'ONLINE']]);
    const slices = segments(Array.from({ length: 6 }, () => [10 * MINUTE, 'ONLINE'] as const));
    assert.deepStrictEqual(
      deriveWorldTickBoundaries(fractional, slices).map(key),
      deriveWorldTickBoundaries(fractional, hour).map(key),
    );
    assert.deepStrictEqual(projectWorldAccrual(fractional, slices), projectWorldAccrual(fractional, hour));
  });

  test('zero elapsed time, offset strings, and rewind leave earned work in place', () => {
    const idle = world();
    assert.deepStrictEqual(deriveWorldTickBoundaries(idle, segments([[0, 'ONLINE']])), []);
    assert.deepStrictEqual(projectWorldAccrual(idle, []), idle);
    const zoned = segments([[10 * MINUTE, 'ONLINE']]);
    const offset = [{
      startMs: '2026-10-01T12:00:00.000-06:00',
      endMs: '2026-10-01T12:10:00.000-06:00',
      presence: 'ONLINE' as const,
    }];
    assert.deepStrictEqual(deriveWorldTickBoundaries(world(), offset).map(key), deriveWorldTickBoundaries(world(), zoned).map(key));
    assert.deepStrictEqual(observeWorldAccrual(idle, T0 - MINUTE, 'OFFLINE'), idle);
    assert.deepStrictEqual(observeWorldAccrual(idle, T0, 'ONLINE'), idle);
    const offline = clock('build', 'OFFLINE', 10).progress;
    const rewound = observeActionProgress(offline, T0 - 1, 'ONLINE');
    assert.strictEqual(rewound.achievedRate, 'OFFLINE');
    assert.strictEqual(rewound.wholeTicks, 0);
    const promoted = observeActionProgress(offline, T0, 'ONLINE');
    assert.strictEqual(promoted.achievedRate, 'ONLINE');
    assert.strictEqual(promoted.wholeTicks, 0);
    assert.strictEqual(promoted.accruedThroughMs, T0);
    const kept = observeActionProgress(clock('march', 'ONLINE', 10).progress, T0, 'OFFLINE');
    assert.strictEqual(kept.achievedRate, 'ONLINE');
  });

  test('exact, early, fractional, and remainder boundaries agree with Phase 1 accrual', () => {
    const one = deriveActionCompletion(clock('march', 'ONLINE', 1), segments([[MINUTE, 'ONLINE']]));
    assert.strictEqual(one?.realInstantMs, T0 + MINUTE);
    assert.strictEqual(deriveActionCompletion(clock('march', 'ONLINE', 1), segments([[MINUTE - 1, 'ONLINE']])), null);
    const partial = world();
    partial.subTickMicroticks = 500_000;
    assert.strictEqual(worldTickBoundaryInstant(partial, 1001, segments([[MINUTE, 'ONLINE']])), T0 + MINUTE / 2);
    const remainder = world();
    remainder.subTickMicroticks = 16;
    remainder.accrualDivisionRemainder = 40_000;
    const expected = T0 + realMillisecondsForSimulationWork(1, 0, 'ONLINE', 40_000) - realMillisecondsForSimulationWork(0, 16, 'ONLINE', 40_000);
    assert.strictEqual(
      worldTickBoundaryInstant(remainder, 1001, segments([[MINUTE, 'ONLINE']])),
      T0 + realMillisecondsForSimulationWork(0, BALANCE.temporal.microticksPerSimulationTick - 16, 'ONLINE', 40_000),
    );
    assert.ok(expected > T0);
    const landed = projectWorldAccrual(remainder, [{
      startMs: T0,
      endMs: worldTickBoundaryInstant(remainder, 1001, segments([[MINUTE, 'ONLINE']]))!,
      presence: 'ONLINE',
    }]);
    assert.strictEqual(landed.accruedTargetWorldTick, 1001);
  });

  test('promotion exactly at completion does not consume the faster rate', () => {
    const completion = deriveActionCompletion(
      clock('build', 'OFFLINE', 3),
      segments([[30 * MINUTE, 'OFFLINE'], [10 * MINUTE, 'ONLINE']]),
    );
    assert.ok(completion);
    assert.strictEqual(completion.realInstantMs, T0 + 30 * MINUTE);
    assert.strictEqual(completion.achievedRate, 'OFFLINE');
    assert.strictEqual(
      deriveActionCompletion(clock('build', 'OFFLINE', 3), segments([[30 * MINUTE - 1, 'OFFLINE']])),
      null,
    );
  });

  test('repeated presence transitions keep each segment on its own world rate', () => {
    const span = segments([
      [MINUTE, 'ONLINE'],
      [10 * MINUTE, 'OFFLINE'],
      [MINUTE, 'ONLINE'],
      [10 * MINUTE, 'OFFLINE'],
    ]);
    assert.deepStrictEqual(deriveWorldTickBoundaries(world(0), span).map((item) => item.realInstantMs - T0), [
      MINUTE,
      11 * MINUTE,
      12 * MINUTE,
      22 * MINUTE,
    ]);
  });

  test('segment projection matches chained Phase 1 activity observations', () => {
    const started = beginActivityTemporalProgress(T0, 'OFFLINE');
    let stepped = accrueActivityThenObservePresence(started, T0 + 30 * MINUTE, 'ONLINE');
    stepped = accrueActivityThenObservePresence(stepped, T0 + 32 * MINUTE, 'OFFLINE');
    stepped = accrueActivityThenObservePresence(stepped, T0 + 37 * MINUTE, 'OFFLINE');
    const projected = projectActionProgress(started, segments([
      [30 * MINUTE, 'OFFLINE'],
      [2 * MINUTE, 'ONLINE'],
      [5 * MINUTE, 'OFFLINE'],
    ]));
    assert.deepStrictEqual(projected, stepped);
    assert.strictEqual(projected.achievedRate, 'ONLINE');
    assert.strictEqual(projected.wholeTicks, 10);
  });

  test('a later action start does not inherit earlier world time', () => {
    const span = segments([[10 * MINUTE, 'ONLINE']]);
    const late = clock('late', 'ONLINE', 1, T0 + 5 * MINUTE);
    const ordered = deriveOrderedBoundaries({ world: world(0), segments: span, actions: [late] });
    const completion = ordered.find((item) => item.kind === 'ACTION_COMPLETION')!;
    assert.strictEqual(completion.realInstantMs, T0 + 6 * MINUTE);
    assert.ok(ordered.some((item) => item.earnedWorldTick === 5 && item.realInstantMs === T0 + 5 * MINUTE));
    assert.ok(ordered.some((item) => item.earnedWorldTick === 6 && item.realInstantMs === completion.realInstantMs));
    assert.ok(compareTemporalBoundaries(
      ordered.find((item) => item.earnedWorldTick === 6)!,
      completion,
    ) > 0);
  });

  test('a million-tick instant stays exact and an unsafe span throws', () => {
    const ticks = 1_000_000;
    const horizon = ticks * MINUTE;
    const instant = worldTickBoundaryInstant(world(0), ticks, segments([[horizon, 'ONLINE']]));
    assert.strictEqual(instant, T0 + horizon);
    assert.strictEqual(realMillisecondsForSimulationWork(ticks, 0, 'ONLINE'), horizon);
    assert.strictEqual(accrueSimulationTime(emptyFixedPointAccrual(), horizon, 'ONLINE').wholeTicks, ticks);
    assert.strictEqual(worldTickBoundaryInstant(world(0), 5, segments([[10 * MINUTE, 'ONLINE']])), T0 + 5 * MINUTE);
    assert.throws(
      () => worldTickBoundaryInstant(world(0), Number.MAX_SAFE_INTEGER, [{
        startMs: T0,
        endMs: Number.MAX_SAFE_INTEGER,
        presence: 'ONLINE',
      }]),
      /safe integer/,
    );
    const original = world();
    const snapshot = { ...original };
    deriveOrderedBoundaries({ world: original, segments: segments([[MINUTE, 'ONLINE']]), actions: [clock('march', 'ONLINE', 1)] });
    assert.deepStrictEqual(original, snapshot);
  });

  test('malformed presence history is rejected', () => {
    assert.throws(() => deriveWorldTickBoundaries(world(), [
      { startMs: T0, endMs: T0 + MINUTE, presence: 'ONLINE' },
      { startMs: T0 + MINUTE + 1, endMs: T0 + 2 * MINUTE, presence: 'OFFLINE' },
    ]), /contiguous/);
    assert.throws(() => deriveWorldTickBoundaries(world(), [
      { startMs: T0, endMs: T0 - 1, presence: 'ONLINE' },
    ]), /rewind/);
    const sample = interruptionBoundary('lost', T0);
    const moved = orderTemporalBoundaries([sample]);
    assert.notStrictEqual(moved[0], sample);
  });
}
