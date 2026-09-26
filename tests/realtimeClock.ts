import assert from 'assert';
import { createGameState, InMemoryGameStateStore } from '../src';
import { cloneGameState } from '../src/state/cloneGameState';
import { MemoryPlayerWorldTable, SupabaseGameStateStore } from '../src/persistence/supabase/adapter';
import {
  WORLD_TICK_DURATION_MS,
  advanceAuthoritativeWorldClock,
  utcEpochMs,
} from '../src/world/realtimeClock';

export interface RealtimeClockTestApi {
  test: (name: string, fn: () => void) => void;
}

const T0 = utcEpochMs('2026-09-26T15:00:00.000Z');

function anchored() {
  const state = createGameState();
  state.worldTick = 1250;
  state.lastProcessedAtMs = T0;
  return state;
}

export function registerRealtimeClockTests(api: RealtimeClockTestApi): void {
  const { test } = api;
  console.log('Real-time world clock');

  test('one world tick is the existing one-minute prototype clock', () => {
    assert.strictEqual(WORLD_TICK_DURATION_MS, 60_000);
  });

  test('timestamps with an explicit offset are the same UTC instant', () => {
    assert.strictEqual(utcEpochMs('2026-09-26T15:00:00.000Z'), utcEpochMs('2026-09-26T09:00:00.000-06:00'));
    assert.throws(() => utcEpochMs('2026-09-26T15:00:00'), /UTC offset/);
  });

  test('zero elapsed time and a repeated timestamp do not advance the tick', () => {
    const state = anchored();
    const first = advanceAuthoritativeWorldClock(state, T0);
    assert.strictEqual(first.elapsedTicks, 0);
    assert.strictEqual(first.worldTick, 1250);
    const second = advanceAuthoritativeWorldClock(state, T0);
    assert.strictEqual(second.elapsedTicks, 0);
    assert.strictEqual(state.worldTick, 1250);
    assert.strictEqual(state.lastProcessedAtMs, T0);
  });

  test('a partial tick does not move world time', () => {
    const state = anchored();
    const result = advanceAuthoritativeWorldClock(state, T0 + WORLD_TICK_DURATION_MS - 1);
    assert.strictEqual(result.elapsedTicks, 0);
    assert.strictEqual(result.remainderMs, WORLD_TICK_DURATION_MS - 1);
    assert.strictEqual(state.worldTick, 1250);
    assert.strictEqual(state.lastProcessedAtMs, T0);
  });

  test('exact, multiple, and day-long gaps advance by whole ticks only', () => {
    const exact = anchored();
    const one = advanceAuthoritativeWorldClock(exact, T0 + WORLD_TICK_DURATION_MS);
    assert.strictEqual(one.elapsedTicks, 1);
    assert.strictEqual(exact.worldTick, 1251);
    assert.strictEqual(exact.lastProcessedAtMs, T0 + WORLD_TICK_DURATION_MS);

    const many = anchored();
    const ten = advanceAuthoritativeWorldClock(many, T0 + 10 * WORLD_TICK_DURATION_MS);
    assert.strictEqual(ten.elapsedTicks, 10);
    assert.strictEqual(many.worldTick, 1260);

    const gap = anchored();
    const dayMs = 24 * 60 * WORLD_TICK_DURATION_MS;
    const offline = advanceAuthoritativeWorldClock(gap, T0 + dayMs);
    assert.strictEqual(offline.elapsedTicks, 24 * 60);
    assert.strictEqual(gap.worldTick, 1250 + 24 * 60);
    assert.strictEqual(gap.lastProcessedAtMs, T0 + dayMs);
  });

  test('an earlier timestamp does not rewind the clock', () => {
    const state = anchored();
    const result = advanceAuthoritativeWorldClock(state, T0 - WORLD_TICK_DURATION_MS);
    assert.strictEqual(result.elapsedTicks, 0);
    assert.strictEqual(state.worldTick, 1250);
    assert.strictEqual(state.lastProcessedAtMs, T0);
  });

  test('a fresh store resumes the persisted clock from the later timestamp', () => {
    const table = new MemoryPlayerWorldTable();
    const writer = new SupabaseGameStateStore(table);
    const state = anchored();
    const saved = writer.save('repwars_clock', state, 0);
    assert.strictEqual(saved.ok, true);
    const reader = new SupabaseGameStateStore(table);
    const loaded = reader.load('repwars_clock');
    assert.strictEqual(loaded.ok, true);
    if (!loaded.ok) return;
    assert.strictEqual(loaded.state.worldTick, 1250);
    assert.strictEqual(loaded.state.lastProcessedAtMs, T0);
    const resumed = advanceAuthoritativeWorldClock(loaded.state, '2026-09-26T15:17:30.000Z');
    assert.strictEqual(resumed.elapsedTicks, 17);
    assert.strictEqual(loaded.state.worldTick, 1267);
    assert.strictEqual(resumed.remainderMs, 30_000);
  });

  test('two writers cannot both apply the same clock interval', () => {
    const store = new InMemoryGameStateStore();
    const initial = anchored();
    assert.strictEqual(store.save('repwars_clock', initial, 0).ok, true);
    const first = store.load('repwars_clock');
    const second = store.load('repwars_clock');
    assert.strictEqual(first.ok && second.ok, true);
    if (!first.ok || !second.ok) return;
    const later = T0 + 10 * WORLD_TICK_DURATION_MS;
    advanceAuthoritativeWorldClock(first.state, later);
    advanceAuthoritativeWorldClock(second.state, later);
    const won = store.save('repwars_clock', first.state, first.record.stateVersion);
    assert.strictEqual(won.ok, true);
    const lost = store.save('repwars_clock', second.state, second.record.stateVersion);
    assert.strictEqual(lost.ok, false);
    if (!lost.ok) assert.strictEqual(lost.code, 'persistence.conflict');
    const stored = store.load('repwars_clock');
    assert.strictEqual(stored.ok, true);
    if (!stored.ok) return;
    assert.strictEqual(stored.state.worldTick, 1260);
    const again = cloneGameState(stored.state);
    const repeat = advanceAuthoritativeWorldClock(again, later);
    assert.strictEqual(repeat.elapsedTicks, 0);
    assert.strictEqual(again.worldTick, 1260);
  });
}