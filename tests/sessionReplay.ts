import assert from 'assert';
import { BALANCE } from '../src/constants/balance';
import { InMemoryWorkoutHistoryStore } from '../src/fitness/history/inMemoryStore';
import { checkGameStateInvariants } from '../src/state';
import { replaceGameplaySessionLease } from '../src/state/gameplaySessionLeases';
import { InMemoryGameStateStore } from '../src/persistence/inMemoryGameStateStore';
import { ensurePlayerWorld } from '../src/persistence/initializePlayerWorld';
import type { GameStateStore, SaveWorldResult } from '../src/persistence/types';
import { GameplaySessionReceiptError } from '../src/server/gameplaySessionLifecycle';
import type { PlayerWorldPersistence } from '../src/server/persistencePort';
import { createSessionHost } from '../src/server/session';
import { GAME_STATE_SCHEMA_VERSION, type GameState } from '../src/types/GameState';
import {
  openGameplaySessionLease,
  renewGameplaySessionLeaseAtSequence,
} from '../src/world/presenceLeases';

const LEASE_MS = BALANCE.temporal.presenceLeaseDurationMs;

interface ManualClock {
  now: () => number;
  set: (ms: number) => void;
}

export async function runSessionReplayTests(
  report: (name: string, fn: () => Promise<void>) => Promise<void>,
): Promise<void> {
  console.log('Gameplay-session replay safety');

  await report('replaying the latest heartbeat does not extend it', async () => {
    const { store, host, clock } = harness();
    const opened = await host.openGameplaySession('replay_latest', 'open-1');
    clock.set(10_000);
    await host.heartbeatGameplaySession('replay_latest', 'heartbeat-A', opened.sessionId, 1);
    clock.set(30_000);
    const replay = await host.heartbeatGameplaySession('replay_latest', 'heartbeat-A', opened.sessionId, 1);
    assert.strictEqual(replay.outcome, 'idempotent_replay');
    const lease = load(store, 'replay_latest').gameplaySessionLeases[0]!;
    assert.strictEqual(lease.expiresAtMs, 10_000 + LEASE_MS);
    assert.strictEqual(lease.lastReceiptAtMs, 10_000);
    assert.strictEqual(lease.lastRenewalSequence, 1);
  });

  await report('A then B then a later replay of A does not extend the lease', async () => {
    const { store, host, clock } = harness();
    const opened = await host.openGameplaySession('replay_old', 'open-1');
    clock.set(10_000);
    await host.heartbeatGameplaySession('replay_old', 'heartbeat-A', opened.sessionId, 1);
    clock.set(20_000);
    await host.heartbeatGameplaySession('replay_old', 'heartbeat-B', opened.sessionId, 2);
    clock.set(30_000);
    const replay = await host.heartbeatGameplaySession('replay_old', 'heartbeat-A', opened.sessionId, 1);
    assert.strictEqual(replay.outcome, 'stale');
    assert.strictEqual(replay.lastRenewalSequence, 2);
    const lease = load(store, 'replay_old').gameplaySessionLeases[0]!;
    assert.strictEqual(lease.expiresAtMs, 20_000 + LEASE_MS);
    assert.strictEqual(lease.lastReceiptAtMs, 20_000);
    assert.strictEqual(lease.lastRenewalRequestId, 'heartbeat-B');
    assert.strictEqual(lease.lastRenewalSequence, 2);
    assert.strictEqual(load(store, 'replay_old').gameplaySessionLeases.length, 1);
  });

  await report('replaying the latest request after a newer one stays idempotent', async () => {
    const { store, host, clock } = harness();
    const opened = await host.openGameplaySession('replay_b', 'open-1');
    clock.set(10_000);
    await host.heartbeatGameplaySession('replay_b', 'heartbeat-A', opened.sessionId, 1);
    clock.set(20_000);
    await host.heartbeatGameplaySession('replay_b', 'heartbeat-B', opened.sessionId, 2);
    clock.set(30_000);
    const replay = await host.heartbeatGameplaySession('replay_b', 'heartbeat-B', opened.sessionId, 2);
    assert.strictEqual(replay.outcome, 'idempotent_replay');
    assert.strictEqual(load(store, 'replay_b').gameplaySessionLeases[0]!.expiresAtMs, 20_000 + LEASE_MS);
  });

  await report('a concurrent earlier receipt does not regress a later committed renewal', async () => {
    const clock = manualClock();
    const { store, persistence } = harness({ clock });
    clock.set(1_000);
    const opener = createSessionHost(persistence, { nowMs: clock.now });
    const opened = await opener.openGameplaySession('race_earlier', 'open-1');
    clock.set(10_000);
    const racing = armNextSave(persistence, () => {
      commitSequence(store, 'race_earlier', opened.sessionId, 20_000, 'heartbeat-B', 2);
    });
    const racer = createSessionHost(racing, { nowMs: clock.now });
    const earlier = await racer.heartbeatGameplaySession('race_earlier', 'heartbeat-A', opened.sessionId, 1);
    assert.strictEqual(earlier.outcome, 'stale');
    const lease = load(store, 'race_earlier').gameplaySessionLeases[0]!;
    assert.strictEqual(lease.lastReceiptAtMs, 20_000);
    assert.strictEqual(lease.expiresAtMs, 20_000 + LEASE_MS);
    assert.strictEqual(lease.lastRenewalSequence, 2);
  });

  await report('a later receipt still renews when an earlier one committed first', async () => {
    const clock = manualClock();
    const { store, persistence } = harness({ clock });
    clock.set(1_000);
    const opener = createSessionHost(persistence, { nowMs: clock.now });
    const opened = await opener.openGameplaySession('race_later', 'open-1');
    clock.set(20_000);
    const racing = armNextSave(persistence, () => {
      commitSequence(store, 'race_later', opened.sessionId, 10_000, 'heartbeat-B', 1);
    });
    const racer = createSessionHost(racing, { nowMs: clock.now });
    const later = await racer.heartbeatGameplaySession('race_later', 'heartbeat-A', opened.sessionId, 2);
    assert.strictEqual(later.outcome, 'renewed');
    let lease = load(store, 'race_later').gameplaySessionLeases[0]!;
    assert.strictEqual(lease.lastReceiptAtMs, 20_000);
    assert.strictEqual(lease.expiresAtMs, 20_000 + LEASE_MS);
    assert.strictEqual(lease.lastRenewalSequence, 2);
    clock.set(10_000);
    const stale = await racer.heartbeatGameplaySession('race_later', 'heartbeat-B', opened.sessionId, 1);
    assert.strictEqual(stale.outcome, 'stale');
    lease = load(store, 'race_later').gameplaySessionLeases[0]!;
    assert.strictEqual(lease.lastReceiptAtMs, 20_000);
    assert.strictEqual(lease.expiresAtMs, 20_000 + LEASE_MS);
  });

  await report('a higher sequence with an earlier receipt does not regress the lease', async () => {
    const { store, host, clock } = harness();
    const opened = await host.openGameplaySession('earlier_receipt', 'open-1');
    clock.set(20_000);
    await host.heartbeatGameplaySession('earlier_receipt', 'heartbeat-B', opened.sessionId, 2);
    clock.set(10_000);
    await assert.rejects(
      () => host.heartbeatGameplaySession('earlier_receipt', 'heartbeat-C', opened.sessionId, 3),
      (err: unknown) => err instanceof GameplaySessionReceiptError,
    );
    const lease = load(store, 'earlier_receipt').gameplaySessionLeases[0]!;
    assert.strictEqual(lease.lastReceiptAtMs, 20_000);
    assert.strictEqual(lease.expiresAtMs, 20_000 + LEASE_MS);
    assert.strictEqual(lease.lastRenewalRequestId, 'heartbeat-B');
    assert.strictEqual(lease.lastRenewalSequence, 2);
  });

  await report('the same renewal sequence stays idempotent after restart', async () => {
    const clock = manualClock();
    const { store, persistence } = harness({ clock });
    clock.set(10_000);
    const first = createSessionHost(persistence, { nowMs: clock.now });
    const opened = await first.openGameplaySession('restart_replay', 'open-1');
    await first.heartbeatGameplaySession('restart_replay', 'heartbeat-A', opened.sessionId, 1);
    clock.set(40_000);
    const restarted = createSessionHost(persistence, { nowMs: clock.now });
    const replay = await restarted.heartbeatGameplaySession('restart_replay', 'heartbeat-A', opened.sessionId, 1);
    assert.strictEqual(replay.outcome, 'idempotent_replay');
    assert.strictEqual(load(store, 'restart_replay').gameplaySessionLeases[0]!.expiresAtMs, 10_000 + LEASE_MS);
    assert.strictEqual(GAME_STATE_SCHEMA_VERSION, 16);
  });

  await report('replaying an open request recovers the same session', async () => {
    const { store, host, clock } = harness();
    clock.set(1_000);
    const first = await host.openGameplaySession('open_replay', 'open-A');
    clock.set(2_000);
    await host.openGameplaySession('open_replay', 'open-B');
    clock.set(8_000);
    await host.heartbeatGameplaySession('open_replay', 'heartbeat-B', first.sessionId, 1);
    clock.set(40_000);
    const replay = await host.openGameplaySession('open_replay', 'open-A');
    assert.strictEqual(replay.outcome, 'idempotent_replay');
    assert.strictEqual(replay.sessionId, first.sessionId);
    assert.strictEqual(replay.openedAtMs, 1_000);
    const leases = load(store, 'open_replay').gameplaySessionLeases;
    assert.strictEqual(leases.length, 2);
    assert.strictEqual(leases.filter((lease) => lease.openedByRequestId === 'open-A').length, 1);
    const duplicated = replaceGameplaySessionLease(load(store, 'open_replay'), {
      ...leases[1]!,
      openedByRequestId: 'open-A',
    });
    const violations = checkGameStateInvariants(duplicated);
    assert.ok(violations.some((item) => item.message === 'gameplaySessionLeases contains a duplicate open request id'));
  });

  await report('replaying an end request does not move the committed end', async () => {
    const { store, host, clock } = harness();
    clock.set(1_000);
    const opened = await host.openGameplaySession('end_replay', 'open-1');
    clock.set(8_000);
    const ended = await host.endGameplaySession('end_replay', 'end-A', opened.sessionId);
    assert.strictEqual(ended.endedAtMs, 8_000);
    clock.set(12_000);
    await host.heartbeatGameplaySession('end_replay', 'heartbeat-other', 'missing-for-activity', 1);
    clock.set(15_000);
    const replay = await host.endGameplaySession('end_replay', 'end-A', opened.sessionId);
    assert.strictEqual(replay.outcome, 'idempotent_replay');
    assert.strictEqual(replay.endedAtMs, 8_000);
    const lease = load(store, 'end_replay').gameplaySessionLeases[0]!;
    assert.strictEqual(lease.endedAtMs, 8_000);
    assert.strictEqual(lease.expiresAtMs, 1_000 + LEASE_MS);
  });

  await report('a heartbeat replay after an unrelated command does not extend the lease', async () => {
    const { store, host, clock } = harness();
    const opened = await host.openGameplaySession('after_command', 'open-1');
    clock.set(10_000);
    await host.heartbeatGameplaySession('after_command', 'heartbeat-A', opened.sessionId, 1);
    clock.set(15_000);
    const paused = await host.execute({
      commandId: 'SET_PLAYER_PAUSE',
      playerId: 'after_command',
      requestId: 'pause-unrelated',
      parameters: { paused: true },
    });
    assert.strictEqual(paused.success, true, paused.errors[0]?.message);
    clock.set(30_000);
    const replay = await host.heartbeatGameplaySession('after_command', 'heartbeat-A', opened.sessionId, 1);
    assert.strictEqual(replay.outcome, 'idempotent_replay');
    const state = load(store, 'after_command');
    assert.strictEqual(state.playerEmpirePause.paused, true);
    assert.strictEqual(state.gameplaySessionLeases[0]!.expiresAtMs, 10_000 + LEASE_MS);
    assert.strictEqual(state.gameplaySessionLeases[0]!.lastRenewalSequence, 1);
  });

  await report('retrying an older command renewal does not extend the lease', async () => {
    const { store, host, clock } = harness();
    const opened = await host.openGameplaySession('command_replay', 'open-1');
    clock.set(10_000);
    const first = await host.execute({
      commandId: 'SET_PLAYER_PAUSE',
      playerId: 'command_replay',
      requestId: 'command-A',
      gameplaySessionId: opened.sessionId,
      renewalSequence: 1,
      commandSequence: 1,
      parameters: { paused: true },
    });
    assert.strictEqual(first.success, true, first.errors[0]?.message);
    clock.set(20_000);
    const second = await host.execute({
      commandId: 'SET_PLAYER_PAUSE',
      playerId: 'command_replay',
      requestId: 'command-B',
      gameplaySessionId: opened.sessionId,
      renewalSequence: 2,
      commandSequence: 2,
      parameters: { paused: false },
    });
    assert.strictEqual(second.success, true, second.errors[0]?.message);
    clock.set(30_000);
    const replay = await host.execute({
      commandId: 'SET_PLAYER_PAUSE',
      playerId: 'command_replay',
      requestId: 'command-A',
      gameplaySessionId: opened.sessionId,
      renewalSequence: 1,
      commandSequence: 1,
      parameters: { paused: true },
    });
    assert.strictEqual(replay.success, false);
    assert.strictEqual(replay.errors[0]?.code, 'COMMAND_STALE');
    const state = load(store, 'command_replay');
    assert.strictEqual(state.playerEmpirePause.paused, false);
    assert.strictEqual(state.gameplaySessionLeases[0]!.expiresAtMs, 20_000 + LEASE_MS);
    assert.strictEqual(state.gameplaySessionLeases[0]!.lastReceiptAtMs, 20_000);
    assert.strictEqual(state.gameplaySessionLeases[0]!.lastRenewalSequence, 2);
    assert.strictEqual(state.gameplaySessionLeases[0]!.lastRenewalRequestId, 'command-B');
  });

  await report('a long renewal sequence stores one sequence number', async () => {
    const { store, host, clock } = harness();
    const opened = await host.openGameplaySession('long_sequence', 'open-1');
    for (let sequence = 1; sequence <= 200; sequence += 1) {
      clock.set(1_000 + sequence);
      await host.heartbeatGameplaySession('long_sequence', `heartbeat-${sequence}`, opened.sessionId, sequence);
    }
    const state = load(store, 'long_sequence');
    assert.strictEqual(state.gameplaySessionLeases.length, 1);
    const lease = state.gameplaySessionLeases[0]!;
    assert.strictEqual(lease.lastRenewalSequence, 200);
    assert.strictEqual(lease.expiresAtMs, 1_200 + LEASE_MS);
    const encoded = JSON.stringify(lease);
    assert.strictEqual(encoded.includes('heartbeat-1'), false);
    assert.strictEqual(encoded.includes('heartbeat-199'), false);
    assert.strictEqual(Array.isArray(lease.lastRenewalSequence), false);
    assert.strictEqual(openGameplaySessionLease({ sessionId: 'shape', receiptMs: 0 }).lastRenewalSequence, null);
  });
}

function manualClock(): ManualClock {
  let current = 0;
  return {
    now: () => current,
    set: (ms: number) => {
      current = ms;
    },
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

function harness(options: { clock?: ManualClock } = {}) {
  const store = new InMemoryGameStateStore();
  const clock = options.clock ?? manualClock();
  const persistence = persistenceFor(store);
  return { store, clock, persistence, host: createSessionHost(persistence, { nowMs: clock.now }) };
}

function armNextSave(inner: PlayerWorldPersistence, interfere: () => void): PlayerWorldPersistence {
  let armed = true;
  return {
    ...inner,
    save: (playerId, state, expectedVersion) => {
      if (armed) {
        armed = false;
        interfere();
        const conflict: SaveWorldResult = {
          ok: false,
          persisted: false,
          code: 'persistence.conflict',
          message: 'stale gameplay-session write',
        };
        return conflict;
      }
      return inner.save(playerId, state, expectedVersion);
    },
  };
}

function commitSequence(
  store: GameStateStore,
  playerId: string,
  sessionId: string,
  receiptMs: number,
  requestId: string,
  renewalSequence: number,
): void {
  const loaded = store.load(playerId);
  assert.strictEqual(loaded.ok, true, loaded.ok ? '' : loaded.message);
  if (!loaded.ok) return;
  const current = loaded.state.gameplaySessionLeases.find((lease) => lease.sessionId === sessionId);
  assert.ok(current);
  const renewed = renewGameplaySessionLeaseAtSequence(current!, receiptMs, requestId, renewalSequence);
  assert.strictEqual(renewed.outcome, 'renewed');
  if (renewed.outcome !== 'renewed') return;
  const saved = store.save(playerId, replaceGameplaySessionLease(loaded.state, renewed.lease), loaded.record.stateVersion);
  assert.strictEqual(saved.ok, true, saved.ok ? '' : saved.message);
}

function load(store: GameStateStore, playerId: string): GameState {
  const loaded = store.load(playerId);
  assert.strictEqual(loaded.ok, true, loaded.ok ? '' : loaded.message);
  if (!loaded.ok) throw new Error(loaded.message);
  return loaded.state;
}
