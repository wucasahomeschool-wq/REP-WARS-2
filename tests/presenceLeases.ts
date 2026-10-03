import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { BALANCE } from '../src/constants/balance';
import { GAME_STATE_SCHEMA_VERSION } from '../src/types/GameState';
import {
  derivePresenceSegments,
  endGameplaySessionLease,
  gameplaySessionLeaseCoversInstant,
  gameplaySessionLeaseEffectiveEndMs,
  normalizePresenceSegments,
  openGameplaySessionLease,
  playerPresenceAt,
  projectWorldAccrual,
  renewGameplaySessionLease,
  utcEpochMs,
  validateGameplaySessionLease,
  type GameplaySessionLease,
  type PresenceSegment,
} from '../src/world';

export interface PresenceLeaseTestApi {
  test: (name: string, fn: () => void) => void;
}

const LEASE_MS = 90_000;

function open(sessionId: string, receiptMs: number, leaseDurationMs?: number): GameplaySessionLease {
  return openGameplaySessionLease({ sessionId, receiptMs, leaseDurationMs });
}

function spans(segments: readonly PresenceSegment[]) {
  return segments.map((segment) => ({
    startMs: segment.startMs,
    endMs: segment.endMs,
    presence: segment.presence,
  }));
}

function joinAdjacent(segments: readonly PresenceSegment[]): PresenceSegment[] {
  const joined: PresenceSegment[] = [];
  for (const segment of segments) {
    const last = joined[joined.length - 1];
    if (last && last.presence === segment.presence && last.endMs === segment.startMs) {
      last.endMs = segment.endMs;
    } else {
      joined.push({ ...segment });
    }
  }
  return joined;
}

export function registerPresenceLeaseTests(api: PresenceLeaseTestApi): void {
  const { test } = api;
  console.log('Gameplay-session lease algebra');

  test('lease coverage is half-open and the default duration is ninety seconds', () => {
    assert.strictEqual(BALANCE.temporal.presenceLeaseDurationMs, LEASE_MS);
    assert.strictEqual(BALANCE.temporal.onlineRatePpm, 1_000_000);
    assert.strictEqual(BALANCE.temporal.offlineRatePpm, 100_000);
    assert.strictEqual(GAME_STATE_SCHEMA_VERSION, 16);
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'world', 'presenceLeases.ts'), 'utf8');
    assert.ok(!src.includes('GameState'));
    assert.ok(!src.includes('Math.'));
    assert.ok(!src.includes('DecisionEngine'));
    assert.ok(!src.includes('maxElapsedTicksPerAdvance'));
    const lease = open('solo', 0);
    assert.strictEqual(lease.expiresAtMs, LEASE_MS);
    assert.strictEqual(lease.endedAtMs, null);
    assert.strictEqual(lease.lastRenewalRequestId, null);
    assert.strictEqual(gameplaySessionLeaseEffectiveEndMs(lease), LEASE_MS);
    assert.strictEqual(gameplaySessionLeaseCoversInstant(lease, 0), true);
    assert.strictEqual(gameplaySessionLeaseCoversInstant(lease, LEASE_MS - 1), true);
    assert.strictEqual(gameplaySessionLeaseCoversInstant(lease, LEASE_MS), false);
    assert.strictEqual(playerPresenceAt([lease], 0), 'ONLINE');
    assert.strictEqual(playerPresenceAt([lease], LEASE_MS), 'OFFLINE');
    assert.strictEqual(playerPresenceAt([], 0), 'OFFLINE');
    const zoned = openGameplaySessionLease({
      sessionId: 'zoned',
      receiptMs: '2026-10-01T12:00:00.000-06:00',
    });
    assert.strictEqual(zoned.openedAtMs, utcEpochMs('2026-10-01T18:00:00.000Z'));
  });

  test('overlapping leases union into one online span and a renewal extends only that union', () => {
    const first = open('A', 0);
    const second = open('B', 45_000);
    assert.deepStrictEqual(spans(derivePresenceSegments([second, first], 0, 135_000)), [
      { startMs: 0, endMs: 135_000, presence: 'ONLINE' },
    ]);
    assert.strictEqual(playerPresenceAt([first, second], 90_000), 'ONLINE');
    const renewed = renewGameplaySessionLease(second, 130_000, 'b-1');
    assert.strictEqual(renewed.outcome, 'renewed');
    assert.strictEqual(renewed.lease.expiresAtMs, 220_000);
    assert.strictEqual(renewed.lease.sessionId, 'B');
    assert.deepStrictEqual(spans(derivePresenceSegments([first, renewed.lease], 0, 220_000)), [
      { startMs: 0, endMs: 220_000, presence: 'ONLINE' },
    ]);
    assert.strictEqual(first.expiresAtMs, LEASE_MS);
  });

  test('an unexpected disappearance has no instant and presence lasts until expiry', () => {
    const lease = open('solo', 0);
    const segments = derivePresenceSegments([lease], 0, 200_000);
    assert.deepStrictEqual(spans(segments), [
      { startMs: 0, endMs: LEASE_MS, presence: 'ONLINE' },
      { startMs: LEASE_MS, endMs: 200_000, presence: 'OFFLINE' },
    ]);
    assert.strictEqual(playerPresenceAt([lease], 20_000), 'ONLINE');
    assert.ok(!segments.some((segment) => segment.startMs === 20_000 || segment.endMs === 20_000));
  });

  test('explicit disconnect shortens one lease and another live lease keeps presence online', () => {
    const ended = endGameplaySessionLease(open('A', 0), 20_000);
    assert.strictEqual(ended.outcome, 'ended');
    assert.strictEqual(ended.lease.endedAtMs, 20_000);
    assert.strictEqual(ended.lease.expiresAtMs, LEASE_MS);
    assert.strictEqual(gameplaySessionLeaseEffectiveEndMs(ended.lease), 20_000);
    assert.deepStrictEqual(spans(derivePresenceSegments([ended.lease], 0, LEASE_MS)), [
      { startMs: 0, endMs: 20_000, presence: 'ONLINE' },
      { startMs: 20_000, endMs: LEASE_MS, presence: 'OFFLINE' },
    ]);
    const replay = endGameplaySessionLease(ended.lease, 20_000);
    assert.strictEqual(replay.outcome, 'idempotent_replay');
    assert.strictEqual(replay.lease.endedAtMs, 20_000);
    const other = open('B', 15_000);
    assert.strictEqual(playerPresenceAt([ended.lease, other], 20_000), 'ONLINE');
    assert.deepStrictEqual(spans(derivePresenceSegments([ended.lease, other], 0, 50_000)), [
      { startMs: 0, endMs: 50_000, presence: 'ONLINE' },
    ]);
    assert.throws(() => endGameplaySessionLease(ended.lease, 25_000), /cannot move/);
  });

  test('a late heartbeat does not extend the expired lease and the offline gap remains', () => {
    const old = open('old', 0);
    const late = renewGameplaySessionLease(old, 120_000, 'late-1');
    assert.strictEqual(late.outcome, 'expired');
    assert.strictEqual(late.lease.expiresAtMs, LEASE_MS);
    assert.strictEqual(late.lease.lastRenewalRequestId, null);
    const created = open('new', 120_000);
    assert.strictEqual(created.expiresAtMs, 210_000);
    assert.deepStrictEqual(spans(derivePresenceSegments([old, created], 0, 210_000)), [
      { startMs: 0, endMs: LEASE_MS, presence: 'ONLINE' },
      { startMs: LEASE_MS, endMs: 120_000, presence: 'OFFLINE' },
      { startMs: 120_000, endMs: 210_000, presence: 'ONLINE' },
    ]);
  });

  test('the same renewal request id does not extend a lease twice', () => {
    const started = open('solo', 0);
    const snapshot = { ...started };
    const first = renewGameplaySessionLease(started, 60_000, 'heartbeat-123');
    assert.strictEqual(first.outcome, 'renewed');
    assert.strictEqual(first.lease.expiresAtMs, 150_000);
    assert.strictEqual(first.lease.lastReceiptAtMs, 60_000);
    assert.strictEqual(first.lease.lastRenewalRequestId, 'heartbeat-123');
    assert.deepStrictEqual(started, snapshot);
    const second = renewGameplaySessionLease(first.lease, 60_000, 'heartbeat-123');
    assert.strictEqual(second.outcome, 'idempotent_replay');
    assert.strictEqual(second.lease.expiresAtMs, 150_000);
    const laterRetry = renewGameplaySessionLease(first.lease, 70_000, 'heartbeat-123');
    assert.strictEqual(laterRetry.outcome, 'idempotent_replay');
    assert.strictEqual(laterRetry.lease.expiresAtMs, 150_000);
    assert.strictEqual(laterRetry.lease.lastReceiptAtMs, 60_000);
  });

  test('restart reconstruction matches uninterrupted derivation', () => {
    const cases: { leases: GameplaySessionLease[]; horizon: number; split: number }[] = [
      { leases: [open('A', 0)], horizon: 200_000, split: 40_000 },
      { leases: [open('A', 0)], horizon: 200_000, split: 100_000 },
      {
        leases: [open('A', 0), renewGameplaySessionLease(open('B', 45_000), 130_000, 'b-1').lease],
        horizon: 220_000,
        split: 90_000,
      },
      {
        leases: [open('old', 0), open('new', 120_000)],
        horizon: 210_000,
        split: 100_000,
      },
    ];
    for (const sample of cases) {
      const full = derivePresenceSegments(sample.leases, 0, sample.horizon);
      const head = derivePresenceSegments(sample.leases, 0, sample.split);
      const tail = derivePresenceSegments(sample.leases, sample.split, sample.horizon);
      assert.deepStrictEqual(spans(joinAdjacent([...head, ...tail])), spans(full));
    }
  });

  test('a long interval with no covering lease is one offline segment', () => {
    const horizon = 400 * 24 * 60 * 60 * 1000;
    const segments = derivePresenceSegments([open('gone', 0, 1_000)], 5_000, horizon);
    assert.deepStrictEqual(spans(segments), [
      { startMs: 5_000, endMs: horizon, presence: 'OFFLINE' },
    ]);
    assert.strictEqual(derivePresenceSegments([], 0, 0).length, 0);
  });

  test('repeated timely heartbeats keep a single lease', () => {
    let lease = open('solo', 0);
    let receipt = 0;
    for (let i = 1; i <= 12; i += 1) {
      receipt += 80_000;
      const renewed = renewGameplaySessionLease(lease, receipt, `hb-${i}`);
      assert.strictEqual(renewed.outcome, 'renewed');
      lease = renewed.lease;
    }
    assert.strictEqual(lease.sessionId, 'solo');
    assert.strictEqual(lease.lastReceiptAtMs, receipt);
    assert.strictEqual(lease.expiresAtMs, receipt + LEASE_MS);
    assert.strictEqual(lease.lastRenewalRequestId, 'hb-12');
    assert.strictEqual(lease.endedAtMs, null);
  });

  test('the action A/B scenario is offline, then online, then offline', () => {
    const visit = endGameplaySessionLease(open('visit', 20), 30);
    assert.strictEqual(visit.outcome, 'ended');
    assert.deepStrictEqual(spans(derivePresenceSegments([visit.lease], 0, 50)), [
      { startMs: 0, endMs: 20, presence: 'OFFLINE' },
      { startMs: 20, endMs: 30, presence: 'ONLINE' },
      { startMs: 30, endMs: 50, presence: 'OFFLINE' },
    ]);
    assert.strictEqual(playerPresenceAt([visit.lease], 19), 'OFFLINE');
    assert.strictEqual(playerPresenceAt([visit.lease], 20), 'ONLINE');
    assert.strictEqual(playerPresenceAt([visit.lease], 29), 'ONLINE');
    assert.strictEqual(playerPresenceAt([visit.lease], 40), 'OFFLINE');
  });

  test('touching leases stay online and a one millisecond gap is offline', () => {
    const first = open('A', 0);
    const touching = open('B', LEASE_MS);
    assert.strictEqual(playerPresenceAt([first, touching], LEASE_MS), 'ONLINE');
    assert.deepStrictEqual(spans(derivePresenceSegments([touching, first], 0, LEASE_MS * 2)), [
      { startMs: 0, endMs: LEASE_MS * 2, presence: 'ONLINE' },
    ]);
    const gapped = open('C', LEASE_MS + 1);
    assert.strictEqual(playerPresenceAt([first, gapped], LEASE_MS), 'OFFLINE');
    assert.strictEqual(playerPresenceAt([first, gapped], LEASE_MS + 1), 'ONLINE');
    assert.deepStrictEqual(spans(derivePresenceSegments([gapped, first], 0, LEASE_MS + 1 + LEASE_MS)), [
      { startMs: 0, endMs: LEASE_MS, presence: 'ONLINE' },
      { startMs: LEASE_MS, endMs: LEASE_MS + 1, presence: 'OFFLINE' },
      { startMs: LEASE_MS + 1, endMs: LEASE_MS + 1 + LEASE_MS, presence: 'ONLINE' },
    ]);
    const covered = open('D', 0, 50_000);
    const ended = endGameplaySessionLease(open('E', 0), 20_000);
    assert.strictEqual(playerPresenceAt([ended.lease, covered], 20_000), 'ONLINE');
  });

  test('lease input order does not change derived segments', () => {
    const leases = [open('A', 0, 10), open('B', 5, 35), open('C', 100, 10)];
    const expected = spans(derivePresenceSegments(leases, 0, 120));
    const orders = [
      [leases[2]!, leases[1]!, leases[0]!],
      [leases[1]!, leases[2]!, leases[0]!],
      [leases[0]!, leases[2]!, leases[1]!],
    ];
    for (const order of orders) {
      assert.deepStrictEqual(spans(derivePresenceSegments(order, 0, 120)), expected);
    }
    assert.deepStrictEqual(expected, [
      { startMs: 0, endMs: 40, presence: 'ONLINE' },
      { startMs: 40, endMs: 100, presence: 'OFFLINE' },
      { startMs: 100, endMs: 110, presence: 'ONLINE' },
      { startMs: 110, endMs: 120, presence: 'OFFLINE' },
    ]);
  });

  test('malformed leases and duplicate session ids are rejected', () => {
    const lease = open('solo', 1_000);
    assert.throws(() => validateGameplaySessionLease({ ...lease, sessionId: '' }), /session id/);
    assert.throws(() => validateGameplaySessionLease({ ...lease, sessionId: '  solo' }), /session id/);
    assert.throws(() => validateGameplaySessionLease({
      ...lease,
      expiresAtMs: Number.MAX_SAFE_INTEGER + 1,
    }), /safe integer/);
    assert.throws(() => validateGameplaySessionLease({ ...lease, expiresAtMs: lease.openedAtMs - 1 }), /expiry/);
    assert.throws(() => validateGameplaySessionLease({ ...lease, lastReceiptAtMs: lease.openedAtMs - 1 }), /receipt is before/);
    assert.throws(() => validateGameplaySessionLease({ ...lease, endedAtMs: lease.openedAtMs - 1 }), /before its open/);
    assert.throws(() => validateGameplaySessionLease({ ...lease, endedAtMs: lease.expiresAtMs + 1 }), /after expiry/);
    assert.throws(() => open('bad', 0, 0), /duration/);
    assert.throws(() => open('bad', 0, -5), /duration/);
    assert.throws(() => open('bad', 0, 1.5), /duration/);
    assert.throws(() => renewGameplaySessionLease(lease, 999, 'next'), /earlier than the authoritative/);
    assert.throws(() => derivePresenceSegments([lease, { ...lease }], 0, 2_000), /duplicate/i);
    assert.throws(() => derivePresenceSegments([lease], 50, 10), /rewind/);
    const ended = endGameplaySessionLease(lease, 2_000);
    assert.strictEqual(ended.outcome, 'ended');
    const afterEnd = renewGameplaySessionLease(ended.lease, 3_000, 'after-end');
    assert.strictEqual(afterEnd.outcome, 'ended');
    assert.strictEqual(afterEnd.lease.expiresAtMs, lease.expiresAtMs);
    assert.strictEqual(endGameplaySessionLease(lease, lease.expiresAtMs).outcome, 'expired');
  });

  test('derived segments are the half-open window Phase 3 accrues', () => {
    const old = open('old', 0);
    const created = open('new', 120_000);
    const frontier = LEASE_MS;
    const horizon = 210_000;
    const segments = derivePresenceSegments([created, old], frontier, horizon);
    assert.deepStrictEqual(spans(normalizePresenceSegments(segments)), spans(segments));
    assert.strictEqual(segments[0]!.startMs, frontier);
    assert.strictEqual(segments[segments.length - 1]!.endMs, horizon);
    const accrued = projectWorldAccrual({
      accruedTargetWorldTick: 0,
      subTickMicroticks: 0,
      accrualDivisionRemainder: 0,
      lastAccrualAtMs: frontier,
    }, segments);
    assert.strictEqual(accrued.lastAccrualAtMs, horizon);
    assert.strictEqual(accrued.accruedTargetWorldTick, 1);
    assert.strictEqual(accrued.subTickMicroticks, 550_000);
    assert.strictEqual(accrued.accrualDivisionRemainder, 0);
    const untouched = derivePresenceSegments([], 0, 10 * 60_000);
    const offline = projectWorldAccrual({
      accruedTargetWorldTick: 0,
      subTickMicroticks: 0,
      accrualDivisionRemainder: 0,
      lastAccrualAtMs: 0,
    }, untouched);
    assert.strictEqual(offline.accruedTargetWorldTick, 1);
    assert.strictEqual(offline.subTickMicroticks, 0);
  });
}
