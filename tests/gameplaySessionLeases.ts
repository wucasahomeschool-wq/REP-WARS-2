import assert from 'assert';
import { checkGameStateInvariants, cloneGameState, createGameState } from '../src/state';
import { insertGameplaySessionLease, replaceGameplaySessionLease } from '../src/state/gameplaySessionLeases';
import { InMemoryGameStateStore } from '../src/persistence/inMemoryGameStateStore';
import { decodePersistable, encodePersistable } from '../src/persistence/serialization';
import { snapshotGameState } from '../src/persistence/snapshot';
import { GAME_STATE_PERSISTENCE_FORMAT, type GameStateStore } from '../src/persistence/types';
import { MemoryPlayerWorldTable, SupabaseGameStateStore } from '../src/persistence/supabase/adapter';
import { GAME_STATE_SCHEMA_VERSION, type GameState } from '../src/types/GameState';
import { serializePublicGameState, serializeVisibleWorld } from '../src/orchestration/publicView';
import {
  endGameplaySessionLease,
  openGameplaySessionLease,
  renewGameplaySessionLease,
  type GameplaySessionLease,
} from '../src/world/presenceLeases';

export interface GameplaySessionLeasePersistenceTestApi {
  test: (name: string, fn: () => void) => void;
}

function open(sessionId: string, receiptMs: number): GameplaySessionLease {
  return openGameplaySessionLease({ sessionId, receiptMs });
}

function putPayload(playerId: string, payload: unknown, schemaVersion: number, worldTick: number): InMemoryGameStateStore {
  const store = new InMemoryGameStateStore();
  store.putRaw({
    formatVersion: GAME_STATE_PERSISTENCE_FORMAT,
    playerId,
    worldId: 'local',
    schemaVersion,
    worldTick,
    stateVersion: 1,
    payload: encodePersistable(payload),
  });
  return store;
}

function saveAndLoad(store: GameStateStore, playerId: string, state: GameState): GameState {
  const saved = store.save(playerId, state, 0);
  assert.strictEqual(saved.ok, true, saved.ok ? '' : saved.message);
  const loaded = store.load(playerId);
  assert.strictEqual(loaded.ok, true, loaded.ok ? '' : loaded.message);
  if (!loaded.ok) throw new Error(loaded.message);
  return loaded.state;
}

function stampedWorld(): GameState {
  const state = createGameState();
  state.worldTick = 40;
  state.accruedTargetWorldTick = 55;
  state.subTickMicroticks = 16;
  state.accrualDivisionRemainder = 40_000;
  state.lastAccrualAtMs = 123_456;
  state.lastProcessedAtMs = 1_000;
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

export function registerGameplaySessionLeasePersistenceTests(api: GameplaySessionLeasePersistenceTestApi): void {
  const { test } = api;
  console.log('Durable gameplay-session leases');

  test('a new world starts with no gameplay-session leases', () => {
    const state = createGameState();
    assert.strictEqual(GAME_STATE_SCHEMA_VERSION, 15);
    assert.strictEqual(state.schemaVersion, 15);
    assert.deepStrictEqual(state.gameplaySessionLeases, []);
    assert.deepStrictEqual(checkGameStateInvariants(state), []);
  });

  test('schema 14 migrates to an empty lease set and keeps accrual fields', () => {
    const state = stampedWorld();
    const before = temporal(state);
    const decoded = decodePersistable(snapshotGameState(state)) as Record<string, unknown>;
    decoded.schemaVersion = 14;
    decoded.gameplaySessionLeases = [{
      sessionId: 'ghost',
      openedAtMs: 0,
      expiresAtMs: 90_000,
      endedAtMs: null,
      lastReceiptAtMs: 0,
      lastRenewalRequestId: null,
    }];
    const loaded = putPayload('repwars_lease_schema14', decoded, 14, 40).load('repwars_lease_schema14');
    assert.strictEqual(loaded.ok, true, loaded.ok ? '' : loaded.message);
    if (!loaded.ok) return;
    assert.strictEqual(loaded.state.schemaVersion, 15);
    assert.deepStrictEqual(loaded.state.gameplaySessionLeases, []);
    assert.deepStrictEqual(temporal(loaded.state), before);
    assert.deepStrictEqual(checkGameStateInvariants(loaded.state), []);
  });

  test('schema 15 keeps a valid lease and rejects malformed or duplicate authority', () => {
    const valid = open('alpha', 5_000);
    const state = insertGameplaySessionLease(createGameState(), valid);
    assert.deepStrictEqual(checkGameStateInvariants(state), []);
    assert.deepStrictEqual(state.gameplaySessionLeases, [valid]);

    const malformed = createGameState();
    malformed.gameplaySessionLeases = [{ ...valid, expiresAtMs: valid.openedAtMs - 1 }];
    const malformedViolations = checkGameStateInvariants(malformed);
    assert.ok(malformedViolations.some((item) => item.code === 'world.invalid_gameplay_session_leases'));
    assert.strictEqual(new InMemoryGameStateStore().save('repwars_lease_bad', malformed, 0).ok, false);

    const duplicate = createGameState();
    duplicate.gameplaySessionLeases = [valid, { ...valid }];
    const duplicateViolations = checkGameStateInvariants(duplicate);
    assert.ok(duplicateViolations.some((item) => item.code === 'world.invalid_gameplay_session_leases'));
    assert.ok(duplicateViolations.every((item) => !item.message.includes('Lease expiry')));

    const decoded = decodePersistable(snapshotGameState(createGameState())) as Record<string, unknown>;
    delete decoded.gameplaySessionLeases;
    const missing = putPayload('repwars_lease_missing', decoded, 15, 0).load('repwars_lease_missing');
    assert.strictEqual(missing.ok, false);
    if (!missing.ok) assert.strictEqual(missing.code, 'persistence.corrupt');

    const corrupt = decodePersistable(snapshotGameState(createGameState())) as Record<string, unknown>;
    corrupt.gameplaySessionLeases = [{ sessionId: 'broken' }];
    const rejected = putPayload('repwars_lease_corrupt', corrupt, 15, 0).load('repwars_lease_corrupt');
    assert.strictEqual(rejected.ok, false);
    if (!rejected.ok) {
      assert.strictEqual(rejected.code, 'persistence.corrupt');
      assert.ok(!rejected.message.includes('sessionId'));
    }
  });

  test('clone and lease helpers do not share lease objects with the source', () => {
    const source = insertGameplaySessionLease(createGameState(), open('alpha', 0));
    const copy = cloneGameState(source);
    copy.gameplaySessionLeases[0]!.expiresAtMs = 1;
    copy.gameplaySessionLeases.push(open('beta', 10));
    assert.strictEqual(source.gameplaySessionLeases.length, 1);
    assert.strictEqual(source.gameplaySessionLeases[0]!.expiresAtMs, 90_000);
    assert.notStrictEqual(copy.gameplaySessionLeases[0], source.gameplaySessionLeases[0]);

    const before = cloneGameState(source);
    const inserted = insertGameplaySessionLease(source, open('beta', 10));
    assert.deepStrictEqual(source.gameplaySessionLeases, before.gameplaySessionLeases);
    assert.deepStrictEqual(inserted.gameplaySessionLeases.map((lease) => lease.sessionId), ['alpha', 'beta']);
    assert.throws(() => insertGameplaySessionLease(inserted, open('alpha', 20)), /duplicate/i);
    assert.throws(() => replaceGameplaySessionLease(source, open('missing', 20)), /not in the authoritative set/);
  });

  test('memory and supabase payloads preserve active, expired, ended, overlapping, and renewed leases', () => {
    const active = open('active-session', 1_700_000_000_000);
    const expired = open('expired-session', 0);
    const ended = endGameplaySessionLease(open('ended-session', 0), 20_000);
    assert.strictEqual(ended.outcome, 'ended');
    const renewed = renewGameplaySessionLease(open('renewed-session', 0), 60_000, 'heartbeat-123');
    assert.strictEqual(renewed.outcome, 'renewed');
    let state = createGameState();
    state = insertGameplaySessionLease(state, active);
    state = insertGameplaySessionLease(state, expired);
    state = insertGameplaySessionLease(state, ended.lease);
    state = insertGameplaySessionLease(state, renewed.lease);
    const expected = state.gameplaySessionLeases.map((lease) => ({ ...lease }));
    const clock = temporal(stampedWorld());
    state.worldTick = clock.worldTick;
    state.accruedTargetWorldTick = clock.accruedTargetWorldTick;
    state.subTickMicroticks = clock.subTickMicroticks;
    state.accrualDivisionRemainder = clock.accrualDivisionRemainder;
    state.lastAccrualAtMs = clock.lastAccrualAtMs;
    state.lastProcessedAtMs = clock.lastProcessedAtMs;

    for (const [name, store] of [
      ['memory', new InMemoryGameStateStore()],
      ['supabase', new SupabaseGameStateStore(new MemoryPlayerWorldTable())],
    ] as const) {
      const loaded = saveAndLoad(store, `repwars_lease_${name}`, state);
      assert.deepStrictEqual(loaded.gameplaySessionLeases, expected, name);
      assert.deepStrictEqual(temporal(loaded), clock, name);
      assert.strictEqual(loaded.gameplaySessionLeases.length, 4, name);
      assert.strictEqual(loaded.gameplaySessionLeases[1]!.expiresAtMs, 90_000, name);
      assert.strictEqual(loaded.gameplaySessionLeases[2]!.endedAtMs, 20_000, name);
      assert.strictEqual(loaded.gameplaySessionLeases[3]!.lastRenewalRequestId, 'heartbeat-123', name);
      assert.strictEqual(loaded.gameplaySessionLeases[3]!.expiresAtMs, 150_000, name);
    }
  });

  test('a stale writer cannot merge leases, and a reload can add the second lease', () => {
    for (const store of [
      new InMemoryGameStateStore() as GameStateStore,
      new SupabaseGameStateStore(new MemoryPlayerWorldTable()),
    ]) {
      const playerId = `repwars_lease_cas_${store.constructor.name}`;
      const created = store.save(playerId, createGameState(), 0);
      assert.strictEqual(created.ok, true);
      const writerA = store.load(playerId);
      const writerB = store.load(playerId);
      assert.strictEqual(writerA.ok && writerB.ok, true);
      if (!writerA.ok || !writerB.ok) return;
      const withA = insertGameplaySessionLease(writerA.state, open('A', 0));
      const committed = store.save(playerId, withA, writerA.record.stateVersion);
      assert.strictEqual(committed.ok, true);
      const withB = insertGameplaySessionLease(writerB.state, open('B', 45_000));
      const stale = store.save(playerId, withB, writerB.record.stateVersion);
      assert.strictEqual(stale.ok, false);
      if (!stale.ok) assert.strictEqual(stale.code, 'persistence.conflict');
      const stored = store.load(playerId);
      assert.strictEqual(stored.ok, true);
      if (!stored.ok) return;
      assert.deepStrictEqual(stored.state.gameplaySessionLeases.map((lease) => lease.sessionId), ['A']);
      const retried = insertGameplaySessionLease(stored.state, open('B', 45_000));
      const saved = store.save(playerId, retried, stored.record.stateVersion);
      assert.strictEqual(saved.ok, true);
      const both = store.load(playerId);
      assert.strictEqual(both.ok, true);
      if (!both.ok) return;
      assert.deepStrictEqual(both.state.gameplaySessionLeases.map((lease) => lease.sessionId), ['A', 'B']);
    }
  });

  test('public views do not include gameplay-session lease authority', () => {
    const secret = 'lease-secret-session';
    const state = insertGameplaySessionLease(createGameState(), open(secret, 0));
    assert.ok(state.playerFactionId);
    const published = JSON.stringify({
      game: serializePublicGameState(state, state.playerFactionId),
      visible: serializeVisibleWorld(state, state.playerFactionId),
    });
    assert.ok(!published.includes('gameplaySessionLeases'));
    assert.ok(!published.includes('lastRenewalRequestId'));
    assert.ok(!published.includes(secret));
  });
}
