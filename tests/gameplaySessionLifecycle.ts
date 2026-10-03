import assert from 'assert';
import { request as httpRequest } from 'node:http';
import { BALANCE } from '../src/constants/balance';
import { ErrorCode } from '../src/orchestration/errors';
import { InMemoryGameStateStore } from '../src/persistence/inMemoryGameStateStore';
import { ensurePlayerWorld } from '../src/persistence/initializePlayerWorld';
import { decodePersistable, encodePersistable } from '../src/persistence/serialization';
import { snapshotGameState } from '../src/persistence/snapshot';
import { MemoryPlayerWorldTable, SupabaseGameStateStore } from '../src/persistence/supabase/adapter';
import { GAME_STATE_PERSISTENCE_FORMAT, type GameStateStore, type SaveWorldResult } from '../src/persistence/types';
import { InMemoryWorkoutHistoryStore } from '../src/fitness/history/inMemoryStore';
import { checkGameStateInvariants, insertGameplaySessionLease } from '../src/state';
import { createGameState } from '../src/state/createGameState';
import { createCommandHttpServer } from '../src/server/http';
import { CommandNotExposedError, createSessionHost, PersistenceFailedError } from '../src/server/session';
import type { PlayerWorldPersistence } from '../src/server/persistencePort';
import { GAME_STATE_SCHEMA_VERSION, type GameState } from '../src/types/GameState';
import { setPlayerEmpirePause } from '../src/gameplay/invasion/pause';
import { openGameplaySessionLease, renewGameplaySessionLease } from '../src/world/presenceLeases';
import { serializePublicGameState } from '../src/orchestration/publicView';

const LEASE_MS = BALANCE.temporal.presenceLeaseDurationMs;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ManualClock {
  now: () => number;
  set: (ms: number) => void;
  calls: () => number;
}

interface Harness {
  store: GameStateStore;
  host: ReturnType<typeof createSessionHost>;
  clock: ManualClock;
  persistence: PlayerWorldPersistence;
}

export async function runGameplaySessionLifecycleTests(
  report: (name: string, fn: () => Promise<void>) => Promise<void>,
): Promise<void> {
  console.log('Server gameplay-session lifecycle');
  await report('server open issues a session at the server receipt and ignores client time', async () => {
    const { store, host, clock } = harness();
    clock.set(1_700_000_000_000);
    const opened = await host.openGameplaySession('player_open', 'open-1');
    assert.match(opened.sessionId, UUID);
    assert.notStrictEqual(opened.sessionId, 'player_open');
    assert.notStrictEqual(opened.sessionId, 'client-picked');
    assert.strictEqual(opened.outcome, 'opened');
    assert.strictEqual(opened.openedAtMs, 1_700_000_000_000);
    assert.strictEqual(opened.expiresAtMs, 1_700_000_000_000 + LEASE_MS);
    assert.strictEqual(opened.endedAtMs, null);
    const state = load(store, 'player_open');
    assert.strictEqual(state.gameplaySessionLeases.length, 1);
    assert.strictEqual(state.gameplaySessionLeases[0]!.sessionId, opened.sessionId);
    assert.strictEqual(state.gameplaySessionLeases[0]!.openedByRequestId, 'open-1');
    assert.deepStrictEqual(temporal(state), emptyTemporal());
    assert.strictEqual(GAME_STATE_SCHEMA_VERSION, 16);
    assert.strictEqual(state.schemaVersion, 16);
  });

  await report('the same open request recovers the committed session', async () => {
    const { store, host, clock } = harness();
    clock.set(5_000);
    const first = await host.openGameplaySession('player_replay', 'open-same');
    clock.set(50_000);
    const second = await host.openGameplaySession('player_replay', 'open-same');
    assert.strictEqual(second.outcome, 'idempotent_replay');
    assert.strictEqual(second.sessionId, first.sessionId);
    assert.strictEqual(second.openedAtMs, 5_000);
    assert.strictEqual(second.expiresAtMs, 5_000 + LEASE_MS);
    assert.strictEqual(load(store, 'player_replay').gameplaySessionLeases.length, 1);
  });

  await report('a lost open success does not create a second session on retry', async () => {
    const { store, host } = harness({ loseAfter: 0 });
    const opened = await host.openGameplaySession('player_lost_open', 'open-lost');
    assert.strictEqual(opened.outcome, 'idempotent_replay');
    const leases = load(store, 'player_lost_open').gameplaySessionLeases;
    assert.strictEqual(leases.length, 1);
    assert.strictEqual(leases[0]!.sessionId, opened.sessionId);
    assert.strictEqual(leases[0]!.openedByRequestId, 'open-lost');
  });

  await report('two opens create independent sessions', async () => {
    const { store, host, clock } = harness();
    clock.set(1_000);
    const first = await host.openGameplaySession('player_multi', 'open-a');
    clock.set(2_000);
    const second = await host.openGameplaySession('player_multi', 'open-b');
    assert.notStrictEqual(first.sessionId, second.sessionId);
    const ids = load(store, 'player_multi').gameplaySessionLeases.map((lease) => lease.sessionId);
    assert.deepStrictEqual(ids, [first.sessionId, second.sessionId]);
  });

  await report('heartbeat renews only the named session at the captured receipt', async () => {
    const { store, host, clock } = harness();
    clock.set(1_000);
    const first = await host.openGameplaySession('player_hb', 'open-a');
    const second = await host.openGameplaySession('player_hb', 'open-b');
    clock.set(10_000);
    const callsBefore = clock.calls();
    const renewed = await host.heartbeatGameplaySession('player_hb', 'hb-1', first.sessionId, 1);
    assert.strictEqual(clock.calls(), callsBefore + 1);
    assert.strictEqual(renewed.outcome, 'renewed');
    assert.strictEqual(renewed.expiresAtMs, 10_000 + LEASE_MS);
    assert.strictEqual(renewed.receiptMs, 10_000);
    const leases = load(store, 'player_hb').gameplaySessionLeases;
    assert.strictEqual(leases[0]!.expiresAtMs, 10_000 + LEASE_MS);
    assert.strictEqual(leases[0]!.lastRenewalRequestId, 'hb-1');
    assert.strictEqual(leases[1]!.sessionId, second.sessionId);
    assert.strictEqual(leases[1]!.expiresAtMs, 1_000 + LEASE_MS);
    assert.strictEqual(leases[1]!.lastRenewalRequestId, null);
  });

  await report('the same heartbeat request does not extend again after reload', async () => {
    const { store, persistence, clock } = harness();
    clock.set(1_000);
    const firstHost = createSessionHost(persistence, { nowMs: clock.now });
    const opened = await firstHost.openGameplaySession('player_hb_replay', 'open-1');
    clock.set(20_000);
    await firstHost.heartbeatGameplaySession('player_hb_replay', 'hb-1', opened.sessionId, 1);
    clock.set(40_000);
    const restarted = createSessionHost(persistence, { nowMs: clock.now });
    const replay = await restarted.heartbeatGameplaySession('player_hb_replay', 'hb-1', opened.sessionId, 1);
    assert.strictEqual(replay.outcome, 'idempotent_replay');
    assert.strictEqual(replay.expiresAtMs, 20_000 + LEASE_MS);
    assert.strictEqual(load(store, 'player_hb_replay').gameplaySessionLeases[0]!.lastReceiptAtMs, 20_000);
  });

  await report('a compare-and-swap retry reuses the original heartbeat receipt', async () => {
    const clock = manualClock(0);
    clock.set(8_000);
    const { store, host } = harness({ clock, loseAfter: 1 });
    const opened = await host.openGameplaySession('player_retry_receipt', 'open-1');
    const before = clock.calls();
    clock.set(30_000);
    const renewed = await host.heartbeatGameplaySession('player_retry_receipt', 'hb-retry', opened.sessionId, 1);
    assert.strictEqual(clock.calls(), before + 1);
    assert.strictEqual(renewed.outcome, 'idempotent_replay');
    assert.strictEqual(load(store, 'player_retry_receipt').gameplaySessionLeases[0]!.expiresAtMs, 30_000 + LEASE_MS);
    assert.strictEqual(load(store, 'player_retry_receipt').gameplaySessionLeases[0]!.lastReceiptAtMs, 30_000);
  });

  await report('an expired or ended or unknown session is not renewed or invented', async () => {
    const { store, host, clock } = harness();
    clock.set(0);
    const opened = await host.openGameplaySession('player_closed', 'open-1');
    clock.set(LEASE_MS);
    const expired = await host.heartbeatGameplaySession('player_closed', 'hb-late', opened.sessionId, 1);
    assert.strictEqual(expired.outcome, 'expired');
    let lease = load(store, 'player_closed').gameplaySessionLeases[0]!;
    assert.strictEqual(lease.expiresAtMs, LEASE_MS);
    assert.strictEqual(lease.endedAtMs, null);
    assert.strictEqual(lease.lastRenewalRequestId, null);
    clock.set(1_000);
    const endedOpen = await host.openGameplaySession('player_closed', 'open-ended');
    clock.set(4_000);
    await host.endGameplaySession('player_closed', 'end-1', endedOpen.sessionId);
    clock.set(5_000);
    const ended = await host.heartbeatGameplaySession('player_closed', 'hb-ended', endedOpen.sessionId, 1);
    assert.strictEqual(ended.outcome, 'ended');
    lease = load(store, 'player_closed').gameplaySessionLeases.find((item) => item.sessionId === endedOpen.sessionId)!;
    assert.strictEqual(lease.endedAtMs, 4_000);
    assert.strictEqual(lease.expiresAtMs, 1_000 + LEASE_MS);
    const unknown = await host.heartbeatGameplaySession('player_closed', 'hb-missing', 'missing-session', 1);
    assert.strictEqual(unknown.outcome, 'unknown_session');
    assert.strictEqual(load(store, 'player_closed').gameplaySessionLeases.length, 2);
  });

  await report('explicit end changes one lease at the server receipt', async () => {
    const { store, host, clock } = harness();
    clock.set(1_000);
    const first = await host.openGameplaySession('player_end', 'open-a');
    const second = await host.openGameplaySession('player_end', 'open-b');
    clock.set(12_000);
    const ended = await host.endGameplaySession('player_end', 'end-1', first.sessionId);
    assert.strictEqual(ended.outcome, 'ended');
    assert.strictEqual(ended.endedAtMs, 12_000);
    assert.strictEqual(ended.expiresAtMs, 1_000 + LEASE_MS);
    clock.set(18_000);
    const again = await host.endGameplaySession('player_end', 'end-2', first.sessionId);
    assert.strictEqual(again.outcome, 'idempotent_replay');
    assert.strictEqual(again.endedAtMs, 12_000);
    const lateHostClock = 1_000 + LEASE_MS;
    clock.set(lateHostClock);
    const late = await host.endGameplaySession('player_end', 'end-late', second.sessionId);
    assert.strictEqual(late.outcome, 'expired');
    const leases = load(store, 'player_end').gameplaySessionLeases;
    assert.strictEqual(leases[0]!.endedAtMs, 12_000);
    assert.strictEqual(leases[0]!.expiresAtMs, 1_000 + LEASE_MS);
    assert.strictEqual(leases[1]!.sessionId, second.sessionId);
    assert.strictEqual(leases[1]!.endedAtMs, null);
    assert.strictEqual(leases[1]!.expiresAtMs, 1_000 + LEASE_MS);
    assert.strictEqual(leases.length, 2);
  });

  await report('restart keeps active, expired, ended, and overlapping sessions', async () => {
    const clock = manualClock(0);
    const { store, persistence } = harness({ clock });
    clock.set(2_000);
    const firstHost = createSessionHost(persistence, { nowMs: clock.now });
    const active = await firstHost.openGameplaySession('player_restart', 'open-active');
    const other = await firstHost.openGameplaySession('player_restart', 'open-other');
    clock.set(9_000);
    await firstHost.heartbeatGameplaySession('player_restart', 'hb-active', active.sessionId, 1);
    const restarted = createSessionHost(persistence, { nowMs: clock.now });
    clock.set(15_000);
    const continued = await restarted.heartbeatGameplaySession('player_restart', 'hb-next', active.sessionId, 2);
    assert.strictEqual(continued.outcome, 'renewed');
    assert.strictEqual(continued.expiresAtMs, 15_000 + LEASE_MS);
    const otherLease = load(store, 'player_restart').gameplaySessionLeases[1]!;
    assert.strictEqual(otherLease.sessionId, other.sessionId);
    assert.strictEqual(otherLease.expiresAtMs, 2_000 + LEASE_MS);
    assert.strictEqual(otherLease.lastRenewalRequestId, null);

    clock.set(0);
    const expiryHost = createSessionHost(persistence, { nowMs: clock.now });
    const expiring = await expiryHost.openGameplaySession('player_restart_exp', 'open-exp');
    clock.set(LEASE_MS);
    const afterExpiry = createSessionHost(persistence, { nowMs: clock.now });
    const expired = await afterExpiry.heartbeatGameplaySession('player_restart_exp', 'hb-exp', expiring.sessionId, 1);
    assert.strictEqual(expired.outcome, 'expired');
    assert.strictEqual(load(store, 'player_restart_exp').gameplaySessionLeases.length, 1);

    clock.set(3_000);
    const endHost = createSessionHost(persistence, { nowMs: clock.now });
    const ending = await endHost.openGameplaySession('player_restart_end', 'open-end');
    clock.set(6_000);
    await endHost.endGameplaySession('player_restart_end', 'end-1', ending.sessionId);
    const afterEnd = createSessionHost(persistence, { nowMs: clock.now });
    const stillEnded = await afterEnd.heartbeatGameplaySession('player_restart_end', 'hb-end', ending.sessionId, 1);
    assert.strictEqual(stillEnded.outcome, 'ended');
    assert.strictEqual(load(store, 'player_restart_end').gameplaySessionLeases[0]!.endedAtMs, 6_000);
  });

  await report('an accepted gameplay command renews its session in the same save', async () => {
    const { store, host, clock } = harness();
    clock.set(1_000);
    const opened = await host.openGameplaySession('player_cmd', 'open-1');
    const savesBefore = (store as InMemoryGameStateStore).saveCount.value;
    clock.set(25_000);
    const paused = await host.execute({
      commandId: 'SET_PLAYER_PAUSE',
      playerId: 'player_cmd',
      requestId: 'pause-1',
      timestamp: 1,
      gameplaySessionId: opened.sessionId,
      renewalSequence: 1,
      commandSequence: 1,
      parameters: { paused: true },
    });
    assert.strictEqual(paused.success, true, paused.errors[0]?.message);
    assert.strictEqual((store as InMemoryGameStateStore).saveCount.value, savesBefore + 1);
    const state = load(store, 'player_cmd');
    assert.strictEqual(state.playerEmpirePause.paused, true);
    assert.strictEqual(state.gameplaySessionLeases[0]!.expiresAtMs, 25_000 + LEASE_MS);
    assert.strictEqual(state.gameplaySessionLeases[0]!.lastReceiptAtMs, 25_000);
    assert.strictEqual(state.gameplaySessionLeases[0]!.lastRenewalRequestId, 'pause-1');
    assert.deepStrictEqual(temporal(state), emptyTemporal());
    clock.set(80_000);
    const replay = await host.execute({
      commandId: 'SET_PLAYER_PAUSE',
      playerId: 'player_cmd',
      requestId: 'pause-1',
      timestamp: 999_999,
      gameplaySessionId: opened.sessionId,
      renewalSequence: 1,
      commandSequence: 1,
      parameters: { paused: true },
    });
    assert.strictEqual(replay.success, true, replay.errors[0]?.message);
    assert.strictEqual(load(store, 'player_cmd').gameplaySessionLeases[0]!.expiresAtMs, 25_000 + LEASE_MS);
  });

  await report('rejected, read-only, and unexposed commands do not renew a session', async () => {
    const { store, host, clock } = harness();
    clock.set(1_000);
    const opened = await host.openGameplaySession('player_reject', 'open-1');
    clock.set(30_000);
    const rejected = await host.execute({
      commandId: 'SET_PLAYER_PAUSE',
      playerId: 'player_reject',
      requestId: 'pause-bad',
      gameplaySessionId: opened.sessionId,
      renewalSequence: 1,
      commandSequence: 1,
      parameters: {},
    });
    assert.strictEqual(rejected.success, false);
    const denied = await host.execute({
      commandId: 'SET_PLAYER_PAUSE',
      playerId: 'player_reject',
      requestId: 'pause-faction',
      gameplaySessionId: opened.sessionId,
      renewalSequence: 1,
      commandSequence: 1,
      parameters: { paused: true, factionId: 'not_the_player' },
    });
    assert.strictEqual(denied.success, false);
    assert.strictEqual(denied.errors[0]?.code, ErrorCode.ACTION_NOT_ALLOWED);
    const read = await host.execute({
      commandId: 'GET_GAME_STATE',
      playerId: 'player_reject',
      requestId: 'read-1',
      timestamp: 1,
      gameplaySessionId: opened.sessionId,
    });
    assert.strictEqual(read.success, true);
    await assert.rejects(
      () => host.execute({
        commandId: 'ADVANCE_WORLD',
        playerId: 'player_reject',
        requestId: 'advance-1',
        gameplaySessionId: opened.sessionId,
        parameters: { ticks: 1 },
      }),
      (err: unknown) => err instanceof CommandNotExposedError,
    );
    clock.set(1_000 + LEASE_MS);
    const tooLate = await host.execute({
      commandId: 'SET_PLAYER_PAUSE',
      playerId: 'player_reject',
      requestId: 'pause-too-late',
      gameplaySessionId: opened.sessionId,
      renewalSequence: 1,
      commandSequence: 1,
      parameters: { paused: true },
    });
    assert.strictEqual(tooLate.success, false);
    assert.strictEqual(tooLate.errors[0]?.code, ErrorCode.GAMEPLAY_SESSION_INVALID);
    const state = load(store, 'player_reject');
    assert.strictEqual(state.playerEmpirePause.paused, false);
    assert.strictEqual(state.gameplaySessionLeases[0]!.expiresAtMs, 1_000 + LEASE_MS);
    assert.strictEqual(state.gameplaySessionLeases[0]!.lastRenewalRequestId, null);
    assert.strictEqual(JSON.stringify(read.payload).includes(opened.sessionId), false);
    assert.strictEqual(JSON.stringify(read.payload).includes('gameplaySessionLeases'), false);
  });

  await report('a conflicting gameplay save does not leave a renewed lease behind', async () => {
    const { store, host, clock } = harness({ failNextCommand: true });
    clock.set(1_000);
    const opened = await host.openGameplaySession('player_cmd_conflict', 'open-1');
    clock.set(20_000);
    await assert.rejects(
      () => host.execute({
        commandId: 'SET_PLAYER_PAUSE',
        playerId: 'player_cmd_conflict',
        requestId: 'pause-conflict',
        gameplaySessionId: opened.sessionId,
        renewalSequence: 1,
      commandSequence: 1,
        parameters: { paused: true },
      }),
      (err: unknown) => err instanceof PersistenceFailedError && err.code === 'persistence.conflict',
    );
    const state = load(store, 'player_cmd_conflict');
    assert.strictEqual(state.playerEmpirePause.paused, false);
    assert.strictEqual(state.gameplaySessionLeases[0]!.expiresAtMs, 1_000 + LEASE_MS);
  });

  await report('a stale heartbeat reloads and keeps both sessions at their own receipts', async () => {
    const { store, host, clock, persistence } = harness();
    clock.set(1_000);
    const first = await host.openGameplaySession('player_race', 'open-a');
    const second = await host.openGameplaySession('player_race', 'open-b');
    clock.set(11_000);
    const racing = wrapSave(persistence, () => {
      const loaded = store.load('player_race');
      assert.strictEqual(loaded.ok, true);
      if (!loaded.ok) return;
      const renewed = renewGameplaySessionLease(loaded.state.gameplaySessionLeases[1]!, 22_000, 'other-writer');
      assert.strictEqual(renewed.outcome, 'renewed');
      const next = insertReplacement(loaded.state, renewed.lease);
      const saved = store.save('player_race', next, loaded.record.stateVersion);
      assert.strictEqual(saved.ok, true);
    });
    const hostRace = createSessionHost(racing, { nowMs: clock.now });
    const result = await hostRace.heartbeatGameplaySession('player_race', 'hb-a', first.sessionId, 1);
    assert.strictEqual(result.outcome, 'renewed');
    const leases = load(store, 'player_race').gameplaySessionLeases;
    assert.deepStrictEqual(leases.map((lease) => lease.sessionId), [first.sessionId, second.sessionId]);
    assert.strictEqual(leases[0]!.expiresAtMs, 11_000 + LEASE_MS);
    assert.strictEqual(leases[0]!.lastReceiptAtMs, 11_000);
    assert.strictEqual(leases[1]!.expiresAtMs, 22_000 + LEASE_MS);
    assert.strictEqual(leases[1]!.lastReceiptAtMs, 22_000);
  });

  await report('a heartbeat that loses the version to an end does not extend that lease', async () => {
    const { store, host, clock, persistence } = harness();
    clock.set(1_000);
    const opened = await host.openGameplaySession('player_end_race', 'open-1');
    clock.set(7_000);
    const racing = wrapSave(persistence, () => {
      const loaded = store.load('player_end_race');
      assert.strictEqual(loaded.ok, true);
      if (!loaded.ok) return;
      const ended = loaded.state.gameplaySessionLeases[0]!;
      const next = insertReplacement(loaded.state, {
        ...ended,
        endedAtMs: 6_500,
        lastReceiptAtMs: 6_500,
      });
      assert.strictEqual(store.save('player_end_race', next, loaded.record.stateVersion).ok, true);
    });
    const hostRace = createSessionHost(racing, { nowMs: clock.now });
    const result = await hostRace.heartbeatGameplaySession('player_end_race', 'hb-race', opened.sessionId, 1);
    assert.strictEqual(result.outcome, 'ended');
    const lease = load(store, 'player_end_race').gameplaySessionLeases[0]!;
    assert.strictEqual(lease.endedAtMs, 6_500);
    assert.strictEqual(lease.expiresAtMs, 1_000 + LEASE_MS);
    assert.strictEqual(lease.lastRenewalRequestId, null);
  });

  await report('a heartbeat that loses the version to gameplay keeps that gameplay and its own receipt', async () => {
    const { store, host, clock, persistence } = harness();
    clock.set(1_000);
    const opened = await host.openGameplaySession('player_play_race', 'open-1');
    clock.set(13_000);
    const racing = wrapSave(persistence, () => {
      const loaded = store.load('player_play_race');
      assert.strictEqual(loaded.ok, true);
      if (!loaded.ok) return;
      setPlayerEmpirePause(loaded.state, true);
      assert.strictEqual(store.save('player_play_race', loaded.state, loaded.record.stateVersion).ok, true);
    });
    const hostRace = createSessionHost(racing, { nowMs: clock.now });
    const result = await hostRace.heartbeatGameplaySession('player_play_race', 'hb-play', opened.sessionId, 1);
    assert.strictEqual(result.outcome, 'renewed');
    const state = load(store, 'player_play_race');
    assert.strictEqual(state.playerEmpirePause.paused, true);
    assert.strictEqual(state.gameplaySessionLeases[0]!.expiresAtMs, 13_000 + LEASE_MS);
    assert.strictEqual(state.gameplaySessionLeases[0]!.lastReceiptAtMs, 13_000);
    assert.deepStrictEqual(temporal(state), emptyTemporal());
  });

  await report('another player cannot use a persisted session id, and public state hides leases', async () => {
    const { store, host, clock } = harness();
    clock.set(4_000);
    const opened = await host.openGameplaySession('player_a', 'open-a');
    const intruder = await host.heartbeatGameplaySession('player_b', 'hb-stolen', opened.sessionId, 1);
    assert.strictEqual(intruder.outcome, 'unknown_session');
    assert.strictEqual(load(store, 'player_a').gameplaySessionLeases[0]!.expiresAtMs, 4_000 + LEASE_MS);
    assert.strictEqual(load(store, 'player_b').gameplaySessionLeases.length, 0);
    const state = load(store, 'player_a');
    const published = JSON.stringify(serializePublicGameState(state, state.playerFactionId));
    assert.strictEqual(published.includes(opened.sessionId), false);
    assert.strictEqual(published.includes('gameplaySessionLeases'), false);
    assert.strictEqual(published.includes('openedByRequestId'), false);
  });

  await report('a workout session id is not gameplay-session authority', async () => {
    const { store, host } = harness();
    const started = await host.execute({
      commandId: 'START_WORKOUT',
      playerId: 'player_workout',
      requestId: 'workout-start',
      parameters: { purpose: 'NORMAL_TROOPS', sessionId: 'workout-local-1', now: 1_000 },
    });
    assert.strictEqual(started.success, true, started.errors[0]?.message);
    assert.strictEqual(load(store, 'player_workout').gameplaySessionLeases.length, 0);
  });

  await report('a legacy lease without an open request id remains valid authority', async () => {
    const store = new InMemoryGameStateStore();
    const state = createGameState();
    const legacy = openGameplaySessionLease({ sessionId: 'legacy-session', receiptMs: 0 });
    delete legacy.openedByRequestId;
    state.gameplaySessionLeases = [legacy];
    const decoded = decodePersistable(snapshotGameState(state)) as { gameplaySessionLeases: Array<Record<string, unknown>> };
    delete decoded.gameplaySessionLeases[0]!.openedByRequestId;
    store.putRaw({
      formatVersion: GAME_STATE_PERSISTENCE_FORMAT,
      playerId: 'player_legacy',
      worldId: 'local',
      schemaVersion: 15,
      worldTick: state.worldTick,
      stateVersion: 1,
      payload: encodePersistable(decoded),
    });
    const loaded = store.load('player_legacy');
    assert.strictEqual(loaded.ok, true, loaded.ok ? '' : loaded.message);
    if (!loaded.ok) return;
    assert.deepStrictEqual(checkGameStateInvariants(loaded.state), []);
    const clock = manualClock(10_000);
    const host = createSessionHost(persistenceFor(store), { nowMs: clock.now });
    const renewed = await host.heartbeatGameplaySession('player_legacy', 'hb-legacy', 'legacy-session', 1);
    assert.strictEqual(renewed.outcome, 'renewed');
    assert.strictEqual(renewed.expiresAtMs, 10_000 + LEASE_MS);
    const duplicate = insertGameplaySessionLease(createGameState(), openGameplaySessionLease({
      sessionId: 'one',
      receiptMs: 0,
      openedByRequestId: 'same-open',
    }));
    duplicate.gameplaySessionLeases.push(openGameplaySessionLease({
      sessionId: 'two',
      receiptMs: 0,
      openedByRequestId: 'same-open',
    }));
    const violations = checkGameStateInvariants(duplicate);
    assert.ok(violations.some((item) => item.message === 'gameplaySessionLeases contains a duplicate open request id'));
  });

  await report('supabase payload and http routes keep one player session and ignore client clocks', async () => {
    const table = new MemoryPlayerWorldTable();
    const store = new SupabaseGameStateStore(table);
    const clock = manualClock(6_000);
    const host = createSessionHost(persistenceFor(store), { nowMs: clock.now });
    const opened = await host.openGameplaySession('player_supabase', 'open-sb');
    clock.set(12_000);
    const restarted = createSessionHost(persistenceFor(store), { nowMs: clock.now });
    const renewed = await restarted.heartbeatGameplaySession('player_supabase', 'hb-sb', opened.sessionId, 1);
    assert.strictEqual(renewed.outcome, 'renewed');
    assert.strictEqual(renewed.expiresAtMs, 12_000 + LEASE_MS);
    const server = createCommandHttpServer(restarted);
    await listen(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('session HTTP did not bind');
    try {
      const httpOpened = await httpJson(address.port, '/session/open', {
        playerId: 'player_http',
        requestId: 'open-http',
        timestamp: 1,
        sessionId: 'client-picked',
        expiresAtMs: 1,
        openedAtMs: 1,
        lastReceiptAtMs: 1,
      });
      assert.strictEqual(httpOpened.status, 200);
      assert.strictEqual(httpOpened.json.outcome, 'opened');
      assert.strictEqual(httpOpened.json.openedAtMs, 12_000);
      assert.notStrictEqual(httpOpened.json.sessionId, 'client-picked');
      assert.match(String(httpOpened.json.sessionId), UUID);
      const leaked = JSON.stringify(httpOpened.json);
      assert.strictEqual(leaked.includes('gameplaySessionLeases'), false);
      const heartbeat = await httpJson(address.port, '/session/heartbeat', {
        playerId: 'player_http',
        requestId: 'hb-http',
        gameplaySessionId: httpOpened.json.sessionId,
        renewalSequence: 1,
      commandSequence: 1,
        timestamp: 99,
        expiresAtMs: 5,
      });
      assert.strictEqual(heartbeat.status, 200);
      assert.strictEqual(heartbeat.json.outcome, 'renewed');
      assert.strictEqual(heartbeat.json.expiresAtMs, 12_000 + LEASE_MS);
      const ended = await httpJson(address.port, '/session/end', {
        playerId: 'player_http',
        requestId: 'end-http',
        gameplaySessionId: httpOpened.json.sessionId,
        timestamp: 1,
      });
      assert.strictEqual(ended.status, 200);
      assert.strictEqual(ended.json.outcome, 'ended');
      assert.strictEqual(ended.json.endedAtMs, 12_000);
      assert.strictEqual(ended.json.expiresAtMs, 12_000 + LEASE_MS);
      const malformed = await httpJson(address.port, '/commands', { commandId: '' });
      assert.strictEqual(malformed.status, 400);
      const state = store.load('player_http');
      assert.strictEqual(state.ok, true);
      if (!state.ok) return;
      assert.strictEqual(state.state.gameplaySessionLeases.length, 1);
      assert.strictEqual(state.state.gameplaySessionLeases[0]!.endedAtMs, 12_000);
      assert.deepStrictEqual(temporal(state.state), emptyTemporal());
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
}

function manualClock(start: number): ManualClock {
  let current = start;
  let calls = 0;
  return {
    now: () => {
      calls += 1;
      return current;
    },
    set: (ms: number) => {
      current = ms;
    },
    calls: () => calls,
  };
}

function persistenceFor(store: GameStateStore): PlayerWorldPersistence {
  return {
    name: 'memory',
    history: new InMemoryWorkoutHistoryStore(),
    ensure: (playerId: string) => ensurePlayerWorld({ playerId, store }),
    save: (playerId: string, state: GameState, expectedVersion: number) => store.save(playerId, state, expectedVersion),
  };
}

function harness(options: { clock?: ManualClock; loseAfter?: number; failNextCommand?: boolean } = {}): Harness {
  const store = new InMemoryGameStateStore();
  const clock = options.clock ?? manualClock(0);
  const inner = persistenceFor(store);
  let loseAfter = options.loseAfter;
  let failCommand = options.failNextCommand === true;
  const persistence: PlayerWorldPersistence = {
    ...inner,
    save: (playerId, state, expectedVersion) => {
      if (loseAfter === 0) {
        loseAfter = undefined;
        const saved = inner.save(playerId, state, expectedVersion);
        assert.strictEqual(saved.ok, true);
        return conflict();
      }
      if (loseAfter !== undefined) loseAfter -= 1;
      if (failCommand && state.playerEmpirePause?.paused === true) {
        failCommand = false;
        return conflict();
      }
      return inner.save(playerId, state, expectedVersion);
    },
  };
  return { store, clock, persistence, host: createSessionHost(persistence, { nowMs: clock.now }) };
}

function wrapSave(inner: PlayerWorldPersistence, interfere: () => void): PlayerWorldPersistence {
  let armed = true;
  return {
    ...inner,
    save: (playerId, state, expectedVersion) => {
      if (armed) {
        armed = false;
        interfere();
        return conflict();
      }
      return inner.save(playerId, state, expectedVersion);
    },
  };
}

function conflict(): SaveWorldResult {
  return { ok: false, persisted: false, code: 'persistence.conflict', message: 'stale gameplay-session write' };
}

function load(store: GameStateStore, playerId: string): GameState {
  const loaded = store.load(playerId);
  assert.strictEqual(loaded.ok, true, loaded.ok ? '' : loaded.message);
  if (!loaded.ok) throw new Error(loaded.message);
  return loaded.state;
}

function insertReplacement(state: GameState, lease: GameState['gameplaySessionLeases'][number]): GameState {
  return {
    ...state,
    gameplaySessionLeases: state.gameplaySessionLeases.map((item) => (
      item.sessionId === lease.sessionId ? lease : item
    )),
  };
}

function temporal(state: GameState) {
  return {
    worldTick: state.worldTick,
    accruedTargetWorldTick: state.accruedTargetWorldTick,
    subTickMicroticks: state.subTickMicroticks,
    accrualDivisionRemainder: state.accrualDivisionRemainder,
    lastAccrualAtMs: state.lastAccrualAtMs,
  };
}

function emptyTemporal() {
  return {
    worldTick: 0,
    accruedTargetWorldTick: 0,
    subTickMicroticks: 0,
    accrualDivisionRemainder: 0,
    lastAccrualAtMs: null,
  };
}

function listen(server: ReturnType<typeof createCommandHttpServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
}

function httpJson(port: number, path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          json: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
        });
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
