import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { BALANCE } from '../src/constants/balance';
import { cloneGameState } from '../src/state/cloneGameState';
import { checkGameStateInvariants } from '../src/state/gameStateInvariants';
import { createGameState } from '../src/state/createGameState';
import { InMemoryGameStateStore } from '../src/persistence/inMemoryGameStateStore';
import { decodePersistable, encodePersistable } from '../src/persistence/serialization';
import { snapshotGameState } from '../src/persistence/snapshot';
import { GAME_STATE_PERSISTENCE_FORMAT } from '../src/persistence/types';
import { migrateGameStatePayload } from '../src/persistence/versioning';
import { MemoryPlayerWorldTable, SupabaseGameStateStore } from '../src/persistence/supabase/adapter';
import { GAME_STATE_SCHEMA_VERSION, GameState } from '../src/types/GameState';
import {
  WORLD_TICK_DURATION_MS,
  advanceAuthoritativeWorldClock,
  utcEpochMs,
} from '../src/world/realtimeClock';
import { accrueAuthoritativeWorldTime } from '../src/world/worldAccrual';
import type { TemporalPresence } from '../src/world/timeToTick';

export interface WorldAccrualTestApi {
  test: (name: string, fn: () => void) => void;
}

const T0 = utcEpochMs('2026-09-30T18:00:00.000Z');
const MINUTE = WORLD_TICK_DURATION_MS;
const DAY = 24 * 60 * MINUTE;
const PROCESSED = 1000;

function world(worldTick = PROCESSED): GameState {
  const state = createGameState();
  state.worldTick = worldTick;
  return state;
}

function temporal(state: GameState) {
  return {
    worldTick: state.worldTick,
    accruedTargetWorldTick: state.accruedTargetWorldTick,
    subTickMicroticks: state.subTickMicroticks,
    accrualDivisionRemainder: state.accrualDivisionRemainder,
    lastAccrualAtMs: state.lastAccrualAtMs,
    lastProcessedAtMs: state.lastProcessedAtMs,
  };
}

function anchor(state: GameState, at = T0, presence: TemporalPresence = 'ONLINE') {
  return accrueAuthoritativeWorldTime(state, at, presence);
}

function putDecoded(
  playerId: string,
  decoded: Record<string, unknown>,
  schemaVersion: number,
  worldTick: number,
): InMemoryGameStateStore {
  const store = new InMemoryGameStateStore();
  store.putRaw({
    formatVersion: GAME_STATE_PERSISTENCE_FORMAT,
    playerId,
    worldId: 'local',
    schemaVersion,
    worldTick,
    stateVersion: 1,
    payload: encodePersistable(decoded),
  });
  return store;
}

function legacyDecoded(): Record<string, unknown> {
  const state = world(40);
  state.lastFoodConsumptionTick = 40;
  state.lastProcessedAtMs = T0 - DAY;
  const decoded = decodePersistable(snapshotGameState(state)) as Record<string, unknown>;
  decoded.schemaVersion = 13;
  decoded.worldTick = 40;
  decoded.accruedTargetWorldTick = 50_000;
  decoded.subTickMicroticks = 123;
  decoded.accrualDivisionRemainder = 456;
  decoded.lastAccrualAtMs = T0 - DAY;
  return decoded;
}

export function registerWorldAccrualTests(api: WorldAccrualTestApi): void {
  const { test } = api;
  console.log('Durable world temporal accrual');

  test('accrual records rated time and does not cap or process worldTick', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'world', 'worldAccrual.ts'), 'utf8');
    assert.ok(!/state\.worldTick\s*=/.test(src));
    assert.ok(!/state\.lastProcessedAtMs/.test(src));
    assert.ok(!/maxElapsedTicksPerAdvance/.test(src));
    assert.ok(/accrueSimulationTime\(/.test(src));
    assert.strictEqual(BALANCE.world.maxElapsedTicksPerAdvance, 64);
    assert.strictEqual(BALANCE.temporal.onlineRatePpm, 1_000_000);
    assert.strictEqual(BALANCE.temporal.offlineRatePpm, 100_000);
  });

  test('a new world starts with the accrued target equal to worldTick', () => {
    const state = createGameState();
    assert.strictEqual(state.worldTick, 0);
    assert.strictEqual(state.accruedTargetWorldTick, state.worldTick);
    assert.strictEqual(state.subTickMicroticks, 0);
    assert.strictEqual(state.accrualDivisionRemainder, 0);
    assert.strictEqual(state.lastAccrualAtMs, null);
    assert.deepStrictEqual(checkGameStateInvariants(state), []);
  });

  test('a legacy schema 13 world migrates to a zero-backlog baseline', () => {
    const store = putDecoded('repwars_accrual_legacy', legacyDecoded(), 13, 40);
    const loaded = store.load('repwars_accrual_legacy');
    assert.strictEqual(loaded.ok, true);
    if (!loaded.ok) return;
    assert.strictEqual(loaded.state.schemaVersion, GAME_STATE_SCHEMA_VERSION);
    assert.strictEqual(loaded.state.worldTick, 40);
    assert.strictEqual(loaded.state.accruedTargetWorldTick, 40);
    assert.strictEqual(loaded.state.subTickMicroticks, 0);
    assert.strictEqual(loaded.state.accrualDivisionRemainder, 0);
    assert.strictEqual(loaded.state.lastAccrualAtMs, null);
    assert.strictEqual(loaded.state.lastProcessedAtMs, T0 - DAY);
    assert.strictEqual(loaded.state.lastFoodConsumptionTick, 40);
    assert.deepStrictEqual(checkGameStateInvariants(loaded.state), []);
  });

  test('the first observation does not backfill time before the accrual authority', () => {
    const store = putDecoded('repwars_accrual_nobackfill', legacyDecoded(), 13, 40);
    const loaded = store.load('repwars_accrual_nobackfill');
    assert.strictEqual(loaded.ok, true);
    if (!loaded.ok) return;
    const result = accrueAuthoritativeWorldTime(loaded.state, T0, 'ONLINE');
    assert.strictEqual(result.anchored, true);
    assert.strictEqual(result.elapsedWholeTicks, 0);
    assert.strictEqual(result.applied, true);
    assert.strictEqual(loaded.state.worldTick, 40);
    assert.strictEqual(loaded.state.accruedTargetWorldTick, 40);
    assert.strictEqual(loaded.state.subTickMicroticks, 0);
    assert.strictEqual(loaded.state.accrualDivisionRemainder, 0);
    assert.strictEqual(loaded.state.lastAccrualAtMs, T0);
    assert.strictEqual(loaded.state.lastProcessedAtMs, T0 - DAY);
    assert.strictEqual(result.backlogTicks, 0);
  });

  test('an in-memory first observation also ignores the legacy clock watermark', () => {
    const state = world(40);
    state.lastProcessedAtMs = T0 - DAY;
    const result = anchor(state, T0);
    assert.strictEqual(result.elapsedWholeTicks, 0);
    assert.strictEqual(state.accruedTargetWorldTick, 40);
    assert.strictEqual(state.worldTick, 40);
    assert.strictEqual(state.lastAccrualAtMs, T0);
    assert.strictEqual(state.lastProcessedAtMs, T0 - DAY);
  });

  test('older snapshots still migrate and receive the same accrual baseline', () => {
    const state = world(40);
    state.lastFoodConsumptionTick = 40;
    state.lastProcessedAtMs = T0;
    const decoded = decodePersistable(snapshotGameState(state)) as Record<string, unknown>;
    decoded.schemaVersion = 11;
    delete decoded.accruedTargetWorldTick;
    delete decoded.subTickMicroticks;
    delete decoded.accrualDivisionRemainder;
    delete decoded.lastAccrualAtMs;
    const store = putDecoded('repwars_accrual_schema11', decoded, 11, 40);
    const loaded = store.load('repwars_accrual_schema11');
    assert.strictEqual(loaded.ok, true);
    if (!loaded.ok) return;
    assert.strictEqual(loaded.state.schemaVersion, GAME_STATE_SCHEMA_VERSION);
    assert.strictEqual(loaded.state.worldTick, 40);
    assert.strictEqual(loaded.state.lastFoodConsumptionTick, 40);
    assert.strictEqual(loaded.state.lastProcessedAtMs, T0);
    assert.strictEqual(loaded.state.accruedTargetWorldTick, 40);
    assert.strictEqual(loaded.state.lastAccrualAtMs, null);
    assert.deepStrictEqual(checkGameStateInvariants(loaded.state), []);
  });

  test('a conflicting anchored target is re-baselined instead of replayed', () => {
    const state = world(100);
    anchor(state, T0);
    const decoded = decodePersistable(snapshotGameState(state)) as Record<string, unknown>;
    decoded.worldTick = 150;
    decoded.accruedTargetWorldTick = 100;
    decoded.subTickMicroticks = 16;
    decoded.accrualDivisionRemainder = 40_000;
    const migrated = migrateGameStatePayload(decoded);
    assert.strictEqual(migrated.worldTick, 150);
    assert.strictEqual(migrated.accruedTargetWorldTick, 150);
    assert.strictEqual(migrated.subTickMicroticks, 0);
    assert.strictEqual(migrated.accrualDivisionRemainder, 0);
    assert.strictEqual(migrated.lastAccrualAtMs, null);
    assert.strictEqual(migrated.lastProcessedAtMs, state.lastProcessedAtMs);
  });

  test('an out-of-range fraction on a valid target is not rewritten', () => {
    const state = world(40);
    anchor(state, T0);
    const decoded = decodePersistable(snapshotGameState(state)) as Record<string, unknown>;
    decoded.subTickMicroticks = 2_000_000;
    const migrated = migrateGameStatePayload(decoded);
    assert.strictEqual(migrated.subTickMicroticks, 2_000_000);
    const store = putDecoded('repwars_accrual_corrupt', decoded, 14, 40);
    const loaded = store.load('repwars_accrual_corrupt');
    assert.strictEqual(loaded.ok, false);
    if (!loaded.ok) assert.strictEqual(loaded.code, 'persistence.corrupt');
  });

  test('zero elapsed accrual adds no simulation progress', () => {
    const state = world();
    const first = anchor(state, T0);
    assert.strictEqual(first.elapsedWholeTicks, 0);
    assert.strictEqual(first.accruedTargetWorldTick, PROCESSED);
    const again = accrueAuthoritativeWorldTime(state, T0, 'ONLINE');
    assert.strictEqual(again.elapsedWholeTicks, 0);
    assert.strictEqual(again.applied, false);
    assert.strictEqual(again.anchored, false);
    assert.strictEqual(state.accruedTargetWorldTick, PROCESSED);
    assert.strictEqual(state.subTickMicroticks, 0);
    assert.strictEqual(state.accrualDivisionRemainder, 0);
    assert.strictEqual(state.lastAccrualAtMs, T0);
    assert.strictEqual(state.worldTick, PROCESSED);
  });

  test('a partial online tick is stored and does not move worldTick', () => {
    const state = world();
    anchor(state, T0);
    const partial = accrueAuthoritativeWorldTime(state, T0 + MINUTE / 2, 'ONLINE');
    assert.strictEqual(partial.elapsedWholeTicks, 0);
    assert.strictEqual(partial.applied, true);
    assert.strictEqual(state.worldTick, PROCESSED);
    assert.strictEqual(state.accruedTargetWorldTick, PROCESSED);
    assert.strictEqual(state.subTickMicroticks, 500_000);
    assert.strictEqual(state.accrualDivisionRemainder, 0);
    assert.strictEqual(state.lastAccrualAtMs, T0 + MINUTE / 2);
    assert.strictEqual(partial.backlogTicks, 0);
  });

  test('a whole online tick advances only the accrued target', () => {
    const state = world();
    anchor(state, T0);
    const one = accrueAuthoritativeWorldTime(state, T0 + MINUTE, 'ONLINE');
    assert.strictEqual(one.elapsedWholeTicks, 1);
    assert.strictEqual(state.worldTick, PROCESSED);
    assert.strictEqual(state.accruedTargetWorldTick, PROCESSED + 1);
    assert.strictEqual(state.subTickMicroticks, 0);
    assert.strictEqual(state.accrualDivisionRemainder, 0);
    assert.strictEqual(one.backlogTicks, 1);
    assert.ok(state.worldTick <= state.accruedTargetWorldTick);
  });

  test('online accrual earns one tick per real minute', () => {
    const state = world();
    anchor(state, T0);
    const ten = accrueAuthoritativeWorldTime(state, T0 + 10 * MINUTE, 'ONLINE');
    assert.strictEqual(ten.elapsedWholeTicks, 10);
    assert.strictEqual(state.accruedTargetWorldTick, PROCESSED + 10);
    assert.strictEqual(state.worldTick, PROCESSED);
  });

  test('offline accrual earns one tick per ten real minutes', () => {
    const state = world();
    anchor(state, T0);
    const oneMinute = accrueAuthoritativeWorldTime(state, T0 + MINUTE, 'OFFLINE');
    assert.strictEqual(oneMinute.elapsedWholeTicks, 0);
    assert.strictEqual(state.accruedTargetWorldTick, PROCESSED);
    assert.strictEqual(state.subTickMicroticks, 100_000);
    assert.strictEqual(state.worldTick, PROCESSED);
    const oneTick = accrueAuthoritativeWorldTime(state, T0 + 10 * MINUTE, 'OFFLINE');
    assert.strictEqual(oneTick.elapsedWholeTicks, 1);
    assert.strictEqual(state.accruedTargetWorldTick, PROCESSED + 1);
    assert.strictEqual(state.subTickMicroticks, 0);
    assert.strictEqual(state.worldTick, PROCESSED);
  });

  test('a long offline accrual keeps the full backlog', () => {
    const state = world();
    anchor(state, T0);
    const sevenDays = 7 * DAY;
    const accrued = accrueAuthoritativeWorldTime(state, T0 + sevenDays, 'OFFLINE');
    assert.strictEqual(accrued.elapsedWholeTicks, 7 * 24 * 6);
    assert.strictEqual(state.accruedTargetWorldTick, PROCESSED + 7 * 24 * 6);
    assert.strictEqual(state.subTickMicroticks, 0);
    assert.strictEqual(state.accrualDivisionRemainder, 0);
    assert.strictEqual(state.worldTick, PROCESSED);
    assert.ok(accrued.backlogTicks > BALANCE.world.maxElapsedTicksPerAdvance);
  });

  test('fractional remainder survives another accrual step', () => {
    const state = world();
    anchor(state, T0);
    const first = accrueAuthoritativeWorldTime(state, T0 + 1, 'ONLINE');
    assert.strictEqual(first.elapsedWholeTicks, 0);
    assert.strictEqual(state.subTickMicroticks, 16);
    assert.strictEqual(state.accrualDivisionRemainder, 40_000);
    const second = accrueAuthoritativeWorldTime(state, T0 + 2, 'ONLINE');
    assert.strictEqual(second.elapsedWholeTicks, 0);
    assert.strictEqual(state.subTickMicroticks, 33);
    assert.strictEqual(state.accrualDivisionRemainder, 20_000);
    assert.strictEqual(state.accruedTargetWorldTick, PROCESSED);
    assert.strictEqual(state.worldTick, PROCESSED);
  });

  test('splitting one presence interval matches a single accrual', () => {
    const chunks = [1, 17, 1_000, MINUTE - 1, 3 * MINUTE + 123, 0, 8 * MINUTE];
    for (const presence of ['ONLINE', 'OFFLINE'] as const) {
      const split = world();
      let cursor = T0;
      anchor(split, cursor, presence);
      for (const elapsed of chunks) {
        cursor += elapsed;
        accrueAuthoritativeWorldTime(split, cursor, presence);
      }
      const combined = world();
      anchor(combined, T0, presence);
      const total = chunks.reduce((sum, elapsed) => sum + elapsed, 0);
      accrueAuthoritativeWorldTime(combined, T0 + total, presence);
      assert.deepStrictEqual(temporal(split), temporal(combined));
    }
  });

  test('a repeated call at the same server time adds nothing', () => {
    const state = world();
    anchor(state, T0);
    accrueAuthoritativeWorldTime(state, T0 + MINUTE + 1, 'ONLINE');
    const before = temporal(state);
    const repeated = accrueAuthoritativeWorldTime(state, T0 + MINUTE + 1, 'ONLINE');
    assert.strictEqual(repeated.elapsedWholeTicks, 0);
    assert.strictEqual(repeated.applied, false);
    assert.deepStrictEqual(temporal(state), before);
    const zoned = accrueAuthoritativeWorldTime(state, '2026-09-30T18:01:00.001Z', 'OFFLINE');
    assert.strictEqual(zoned.applied, false);
    const offset = accrueAuthoritativeWorldTime(state, '2026-09-30T12:01:00.001-06:00', 'ONLINE');
    assert.strictEqual(offset.applied, false);
    assert.deepStrictEqual(temporal(state), before);
  });

  test('an earlier timestamp does not rewind accrued time', () => {
    const state = world();
    anchor(state, T0);
    accrueAuthoritativeWorldTime(state, T0 + 3 * MINUTE, 'ONLINE');
    const before = cloneGameState(state);
    const rewound = accrueAuthoritativeWorldTime(state, T0 + MINUTE, 'OFFLINE');
    assert.strictEqual(rewound.elapsedWholeTicks, 0);
    assert.strictEqual(rewound.applied, false);
    assert.deepStrictEqual(temporal(state), temporal(before));
    assert.strictEqual(state.worldTick, PROCESSED);
    assert.strictEqual(state.accruedTargetWorldTick, PROCESSED + 3);
  });

  test('accrual never advances worldTick and the target stays ahead of it', () => {
    const state = world();
    anchor(state, T0);
    const accrued = accrueAuthoritativeWorldTime(state, T0 + 65 * MINUTE, 'ONLINE');
    assert.strictEqual(state.worldTick, PROCESSED);
    assert.strictEqual(state.accruedTargetWorldTick, PROCESSED + 65);
    assert.strictEqual(accrued.backlogTicks, 65);
    assert.ok(accrued.backlogTicks > BALANCE.world.maxElapsedTicksPerAdvance);
    assert.ok(state.worldTick <= state.accruedTargetWorldTick);
    assert.deepStrictEqual(checkGameStateInvariants(state), []);
  });

  test('one day online is a durable backlog larger than the processing slice', () => {
    const state = world();
    anchor(state, T0);
    const day = accrueAuthoritativeWorldTime(state, T0 + DAY, 'ONLINE');
    assert.strictEqual(day.elapsedWholeTicks, 24 * 60);
    assert.strictEqual(state.worldTick, PROCESSED);
    assert.strictEqual(state.accruedTargetWorldTick, PROCESSED + 1440);
    assert.strictEqual(day.backlogTicks, 1440);
    assert.ok(day.backlogTicks > 64);
    assert.deepStrictEqual(checkGameStateInvariants(state), []);
  });

  test('serialize and reload keeps the unprocessed backlog', () => {
    const state = world();
    anchor(state, T0);
    accrueAuthoritativeWorldTime(state, T0 + DAY, 'OFFLINE');
    const backlog = state.accruedTargetWorldTick - state.worldTick;
    assert.strictEqual(backlog, 144);
    const store = new InMemoryGameStateStore();
    assert.strictEqual(store.save('repwars_accrual_backlog', state, 0).ok, true);
    const loaded = store.load('repwars_accrual_backlog');
    assert.strictEqual(loaded.ok, true);
    if (!loaded.ok) return;
    assert.strictEqual(loaded.state.worldTick, PROCESSED);
    assert.strictEqual(loaded.state.accruedTargetWorldTick, PROCESSED + 144);
    assert.strictEqual(loaded.state.accruedTargetWorldTick - loaded.state.worldTick, backlog);
    assert.strictEqual(loaded.state.lastAccrualAtMs, T0 + DAY);
    assert.deepStrictEqual(checkGameStateInvariants(loaded.state), []);
  });

  test('a restarted reader keeps fractional accrual', () => {
    const table = new MemoryPlayerWorldTable();
    const writer = new SupabaseGameStateStore(table);
    const state = world();
    anchor(state, T0);
    accrueAuthoritativeWorldTime(state, T0 + MINUTE + 30_000, 'ONLINE');
    assert.strictEqual(state.worldTick, PROCESSED);
    assert.strictEqual(state.accruedTargetWorldTick, PROCESSED + 1);
    assert.strictEqual(state.subTickMicroticks, 500_000);
    assert.strictEqual(writer.save('repwars_accrual_restart', state, 0).ok, true);
    const reader = new SupabaseGameStateStore(table);
    const loaded = reader.load('repwars_accrual_restart');
    assert.strictEqual(loaded.ok, true);
    if (!loaded.ok) return;
    assert.strictEqual(loaded.state.worldTick, PROCESSED);
    assert.strictEqual(loaded.state.accruedTargetWorldTick, PROCESSED + 1);
    assert.strictEqual(loaded.state.subTickMicroticks, 500_000);
    assert.strictEqual(loaded.state.accrualDivisionRemainder, 0);
    assert.strictEqual(loaded.state.lastAccrualAtMs, T0 + MINUTE + 30_000);
    assert.strictEqual(loaded.state.accruedTargetWorldTick - loaded.state.worldTick, 1);
    const continued = accrueAuthoritativeWorldTime(loaded.state, T0 + 2 * MINUTE, 'ONLINE');
    assert.strictEqual(continued.elapsedWholeTicks, 1);
    assert.strictEqual(loaded.state.worldTick, PROCESSED);
    assert.strictEqual(loaded.state.accruedTargetWorldTick, PROCESSED + 2);
    assert.strictEqual(loaded.state.subTickMicroticks, 0);
    assert.strictEqual(loaded.state.accrualDivisionRemainder, 0);
  });

  test('the legacy clock does not update durable accrual', () => {
    const state = world(10);
    state.lastProcessedAtMs = T0;
    const advanced = advanceAuthoritativeWorldClock(state, T0 + 10 * MINUTE);
    assert.strictEqual(advanced.elapsedTicks, 10);
    assert.strictEqual(state.worldTick, 20);
    assert.strictEqual(state.accruedTargetWorldTick, 0);
    assert.strictEqual(state.subTickMicroticks, 0);
    assert.strictEqual(state.accrualDivisionRemainder, 0);
    assert.strictEqual(state.lastAccrualAtMs, null);
    assert.strictEqual(state.lastProcessedAtMs, T0 + 10 * MINUTE);
    assert.deepStrictEqual(checkGameStateInvariants(state), []);
  });

  test('worldTick ahead of an anchored target is rejected and not accrued', () => {
    const state = world();
    anchor(state, T0);
    state.worldTick = PROCESSED + 1;
    const violations = checkGameStateInvariants(state);
    assert.ok(violations.some((violation) => violation.code === 'world.accrued_target_behind'));
    assert.throws(() => accrueAuthoritativeWorldTime(state, T0 + MINUTE, 'ONLINE'), /behind processed worldTick/);
    assert.strictEqual(state.lastAccrualAtMs, T0);
    assert.strictEqual(state.accruedTargetWorldTick, PROCESSED);
    const repeated = accrueAuthoritativeWorldTime(state, T0, 'ONLINE');
    assert.strictEqual(repeated.applied, false);
    assert.strictEqual(state.accruedTargetWorldTick, PROCESSED);
  });

  test('a stale accrual writer loses and the winner keeps the full temporal state', () => {
    const store = new InMemoryGameStateStore();
    const initial = world();
    anchor(initial, T0);
    assert.strictEqual(store.save('repwars_accrual_cas', initial, 0).ok, true);
    const first = store.load('repwars_accrual_cas');
    const second = store.load('repwars_accrual_cas');
    assert.strictEqual(first.ok && second.ok, true);
    if (!first.ok || !second.ok) return;
    accrueAuthoritativeWorldTime(first.state, T0 + MINUTE + 30_000, 'ONLINE');
    accrueAuthoritativeWorldTime(second.state, T0 + 10 * MINUTE, 'ONLINE');
    const won = store.save('repwars_accrual_cas', first.state, first.record.stateVersion);
    assert.strictEqual(won.ok, true);
    const lost = store.save('repwars_accrual_cas', second.state, second.record.stateVersion);
    assert.strictEqual(lost.ok, false);
    if (!lost.ok) assert.strictEqual(lost.code, 'persistence.conflict');
    const stored = store.load('repwars_accrual_cas');
    assert.strictEqual(stored.ok, true);
    if (!stored.ok) return;
    assert.strictEqual(stored.state.worldTick, PROCESSED);
    assert.strictEqual(stored.state.accruedTargetWorldTick, PROCESSED + 1);
    assert.strictEqual(stored.state.subTickMicroticks, 500_000);
    assert.strictEqual(stored.state.accrualDivisionRemainder, 0);
    assert.strictEqual(stored.state.lastAccrualAtMs, T0 + MINUTE + 30_000);
    assert.notStrictEqual(stored.state.accruedTargetWorldTick, PROCESSED + 10);
  });

  test('the losing writer must accrue again from the committed temporal state', () => {
    const store = new InMemoryGameStateStore();
    const initial = world();
    anchor(initial, T0);
    assert.strictEqual(store.save('repwars_accrual_retry', initial, 0).ok, true);
    const winner = store.load('repwars_accrual_retry');
    const loser = store.load('repwars_accrual_retry');
    assert.strictEqual(winner.ok && loser.ok, true);
    if (!winner.ok || !loser.ok) return;
    accrueAuthoritativeWorldTime(winner.state, T0 + MINUTE + 30_000, 'ONLINE');
    accrueAuthoritativeWorldTime(loser.state, T0 + 10 * MINUTE, 'ONLINE');
    assert.strictEqual(store.save('repwars_accrual_retry', winner.state, winner.record.stateVersion).ok, true);
    const conflict = store.save('repwars_accrual_retry', loser.state, loser.record.stateVersion);
    assert.strictEqual(conflict.ok, false);
    const fresh = store.load('repwars_accrual_retry');
    assert.strictEqual(fresh.ok, true);
    if (!fresh.ok) return;
    accrueAuthoritativeWorldTime(fresh.state, T0 + 10 * MINUTE, 'ONLINE');
    assert.strictEqual(store.save('repwars_accrual_retry', fresh.state, fresh.record.stateVersion).ok, true);
    const done = store.load('repwars_accrual_retry');
    assert.strictEqual(done.ok, true);
    if (!done.ok) return;
    const direct = world();
    anchor(direct, T0);
    accrueAuthoritativeWorldTime(direct, T0 + 10 * MINUTE, 'ONLINE');
    assert.deepStrictEqual(temporal(done.state), temporal(direct));
    assert.strictEqual(done.state.accruedTargetWorldTick, PROCESSED + 10);
    assert.strictEqual(done.state.worldTick, PROCESSED);
  });

  test('invalid presence and a zoneless timestamp do not anchor the world', () => {
    const state = world(40);
    const before = temporal(state);
    assert.throws(
      () => accrueAuthoritativeWorldTime(state, T0, 'FAST' as TemporalPresence),
      /not a configured/,
    );
    assert.throws(() => accrueAuthoritativeWorldTime(state, '2026-09-30T18:00:00', 'ONLINE'), /UTC offset/);
    assert.deepStrictEqual(temporal(state), before);
  });
}
