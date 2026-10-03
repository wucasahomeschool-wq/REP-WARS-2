import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { BALANCE } from '../src/constants/balance';
import { InMemoryWorkoutHistoryStore } from '../src/fitness/history/inMemoryStore';
import { InMemoryGameStateStore } from '../src/persistence/inMemoryGameStateStore';
import { ensurePlayerWorld } from '../src/persistence/initializePlayerWorld';
import type { GameStateStore, SaveWorldResult } from '../src/persistence/types';
import { checkGameStateInvariants } from '../src/state/gameStateInvariants';
import { createGameState } from '../src/state/createGameState';
import { applyGameplaySessionHeartbeat } from '../src/server/gameplaySessionLifecycle';
import type { PlayerWorldPersistence } from '../src/server/persistencePort';
import { createSessionHost } from '../src/server/session';
import { GAME_STATE_SCHEMA_VERSION, type ConstructionProject, type GameState } from '../src/types/GameState';
import type { GameplaySessionLease } from '../src/world/presenceLeases';
import { accrueWorldThroughReceipt } from '../src/world/worldAccrual';

const MINUTE = 60_000;
const MICRO = BALANCE.temporal.microticksPerSimulationTick;

export async function runLeaseWorldAccrualTests(
  report: (name: string, fn: () => Promise<void>) => Promise<void>,
): Promise<void> {
  console.log('Lease-derived world accrual');

  await report('the first observation anchors and earns no historical time', async () => {
    const state = world(1000);
    state.lastProcessedAtMs = 1;
    state.accruedTargetWorldTick = 40;
    accrueWorldThroughReceipt(state, 30 * MINUTE);
    assert.strictEqual(state.worldTick, 1000);
    assert.strictEqual(state.accruedTargetWorldTick, 1000);
    assert.strictEqual(state.subTickMicroticks, 0);
    assert.strictEqual(state.accrualDivisionRemainder, 0);
    assert.strictEqual(state.lastAccrualAtMs, 30 * MINUTE);
    assert.strictEqual(state.lastProcessedAtMs, 1);
    assert.strictEqual(GAME_STATE_SCHEMA_VERSION, 16);
    assert.strictEqual(state.schemaVersion, 16);
  });

  await report('online 60 seconds earns one target tick', async () => {
    const { host, clock, store } = harness();
    clock.set(0);
    const opened = await host.openGameplaySession('online-minute', 'open-1');
    clock.set(MINUTE);
    const beat = await host.heartbeatGameplaySession('online-minute', 'hb-1', opened.sessionId, 1);
    assert.strictEqual(beat.outcome, 'renewed');
    const state = load(store, 'online-minute');
    assert.strictEqual(state.worldTick, 0);
    assert.strictEqual(state.accruedTargetWorldTick, 1);
    assert.strictEqual(state.subTickMicroticks, 0);
    assert.strictEqual(state.accrualDivisionRemainder, 0);
    assert.strictEqual(state.lastAccrualAtMs, MINUTE);
    assert.deepStrictEqual(checkGameStateInvariants(state), []);
  });

  await report('offline 10 real minutes earns one target tick', async () => {
    const state = world(1000);
    accrueWorldThroughReceipt(state, 0);
    accrueWorldThroughReceipt(state, 10 * MINUTE);
    assert.strictEqual(state.worldTick, 1000);
    assert.strictEqual(state.accruedTargetWorldTick, 1001);
    assert.strictEqual(state.subTickMicroticks, 0);
    assert.strictEqual(state.accrualDivisionRemainder, 0);
    assert.strictEqual(state.lastAccrualAtMs, 10 * MINUTE);
  });

  await report('online 30 seconds keeps half a tick', async () => {
    const state = covered(0, 2 * MINUTE);
    accrueWorldThroughReceipt(state, 0);
    accrueWorldThroughReceipt(state, 30_000);
    assert.strictEqual(state.accruedTargetWorldTick, state.worldTick);
    assert.strictEqual(state.subTickMicroticks, MICRO / 2);
    assert.strictEqual(state.accrualDivisionRemainder, 0);
    assert.strictEqual(state.lastAccrualAtMs, 30_000);
  });

  await report('the next online 30 seconds completes that tick', async () => {
    const state = covered(0, 2 * MINUTE);
    accrueWorldThroughReceipt(state, 0);
    accrueWorldThroughReceipt(state, 30_000);
    accrueWorldThroughReceipt(state, MINUTE);
    assert.strictEqual(state.accruedTargetWorldTick, state.worldTick + 1);
    assert.strictEqual(state.subTickMicroticks, 0);
    assert.strictEqual(state.accrualDivisionRemainder, 0);
    assert.strictEqual(state.lastAccrualAtMs, MINUTE);
  });

  await report('worldTick stays put while the target advances', async () => {
    const state = covered(0, 5 * MINUTE, 1000);
    accrueWorldThroughReceipt(state, 0);
    accrueWorldThroughReceipt(state, 5 * MINUTE);
    assert.strictEqual(state.worldTick, 1000);
    assert.strictEqual(state.accruedTargetWorldTick, 1005);
  });

  await report('an earlier receipt does not move the target backward', async () => {
    const state = covered(0, 2 * MINUTE, 1000);
    accrueWorldThroughReceipt(state, 0);
    accrueWorldThroughReceipt(state, MINUTE);
    const earned = temporal(state);
    accrueWorldThroughReceipt(state, 30_000);
    assert.deepStrictEqual(temporal(state), earned);
    assert.strictEqual(state.accruedTargetWorldTick, 1001);
  });

  await report('a backlog longer than 64 ticks is kept', async () => {
    const state = covered(0, 100 * MINUTE, 1000);
    accrueWorldThroughReceipt(state, 0);
    accrueWorldThroughReceipt(state, 100 * MINUTE);
    assert.strictEqual(BALANCE.world.maxElapsedTicksPerAdvance, 64);
    assert.strictEqual(state.worldTick, 1000);
    assert.strictEqual(state.accruedTargetWorldTick, 1100);
    assert.ok(state.accruedTargetWorldTick - state.worldTick > 64);
  });

  await report('opening at T does not make the previous interval online', async () => {
    const { host, clock, store } = harness();
    clock.set(0);
    const missing = await host.heartbeatGameplaySession('gap', 'hb-missing', 'missing-session', 1);
    assert.strictEqual(missing.outcome, 'unknown_session');
    clock.set(30 * MINUTE);
    const opened = await host.openGameplaySession('gap', 'open-1');
    assert.strictEqual(opened.openedAtMs, 30 * MINUTE);
    const state = load(store, 'gap');
    assert.strictEqual(state.worldTick, 0);
    assert.strictEqual(state.accruedTargetWorldTick, 3);
    assert.strictEqual(state.subTickMicroticks, 0);
    assert.strictEqual(state.accrualDivisionRemainder, 0);
    assert.strictEqual(state.lastAccrualAtMs, 30 * MINUTE);
    assert.strictEqual(state.gameplaySessionLeases.length, 1);
  });

  await report('time after expiry is offline', async () => {
    const { host, clock, store } = harness();
    clock.set(0);
    const opened = await host.openGameplaySession('expired', 'open-1');
    clock.set(90_000 + 10 * MINUTE);
    const late = await host.heartbeatGameplaySession('expired', 'hb-late', opened.sessionId, 1);
    assert.strictEqual(late.outcome, 'expired');
    const state = load(store, 'expired');
    assert.strictEqual(state.gameplaySessionLeases[0]!.expiresAtMs, 90_000);
    assert.strictEqual(state.worldTick, 0);
    assert.strictEqual(state.accruedTargetWorldTick, 2);
    assert.strictEqual(state.subTickMicroticks, 500_000);
    assert.strictEqual(state.accrualDivisionRemainder, 0);
  });

  await report('time after an explicit end is offline', async () => {
    const { host, clock, store } = harness();
    clock.set(0);
    const opened = await host.openGameplaySession('ended', 'open-1');
    clock.set(MINUTE);
    await host.endGameplaySession('ended', 'end-1', opened.sessionId);
    clock.set(2 * MINUTE);
    await host.openGameplaySession('ended', 'open-2');
    const state = load(store, 'ended');
    assert.strictEqual(state.gameplaySessionLeases[0]!.endedAtMs, MINUTE);
    assert.strictEqual(state.worldTick, 0);
    assert.strictEqual(state.accruedTargetWorldTick, 1);
    assert.strictEqual(state.subTickMicroticks, 100_000);
    assert.strictEqual(state.accrualDivisionRemainder, 0);
    assert.strictEqual(state.lastAccrualAtMs, 2 * MINUTE);
  });

  await report('overlapping sessions are one online span', async () => {
    const forward = world(1000);
    forward.gameplaySessionLeases = [
      lease('a', 0, 10 * MINUTE),
      lease('b', 5 * MINUTE, 15 * MINUTE),
    ];
    accrueWorldThroughReceipt(forward, 0);
    accrueWorldThroughReceipt(forward, 15 * MINUTE);
    assert.strictEqual(forward.worldTick, 1000);
    assert.strictEqual(forward.accruedTargetWorldTick, 1015);
    assert.strictEqual(forward.subTickMicroticks, 0);
  });

  await report('ending one session leaves the other session online', async () => {
    const { host, clock, store } = harness();
    clock.set(0);
    const first = await host.openGameplaySession('union', 'open-a');
    const second = await host.openGameplaySession('union', 'open-b');
    clock.set(30_000);
    await host.endGameplaySession('union', 'end-a', first.sessionId);
    clock.set(MINUTE);
    await host.heartbeatGameplaySession('union', 'hb-b', second.sessionId, 1);
    const state = load(store, 'union');
    assert.strictEqual(state.gameplaySessionLeases[0]!.endedAtMs, 30_000);
    assert.strictEqual(state.worldTick, 0);
    assert.strictEqual(state.accruedTargetWorldTick, 1);
    assert.strictEqual(state.subTickMicroticks, 0);
    assert.strictEqual(state.accrualDivisionRemainder, 0);
  });

  await report('a crash stays online until expiry and offline after it', async () => {
    const { host, clock, store } = harness();
    clock.set(0);
    await host.openGameplaySession('crash', 'open-1');
    clock.set(10 * MINUTE);
    await host.openGameplaySession('crash', 'open-2');
    const state = load(store, 'crash');
    assert.strictEqual(state.gameplaySessionLeases[0]!.endedAtMs, null);
    assert.strictEqual(state.gameplaySessionLeases[0]!.expiresAtMs, 90_000);
    assert.strictEqual(state.worldTick, 0);
    assert.strictEqual(state.accruedTargetWorldTick, 2);
    assert.strictEqual(state.subTickMicroticks, 350_000);
    assert.strictEqual(state.accrualDivisionRemainder, 0);
    assert.strictEqual(state.lastAccrualAtMs, 10 * MINUTE);
  });

  await report('a late heartbeat does not rewrite the expired gap', async () => {
    const { host, clock, store } = harness();
    clock.set(0);
    const opened = await host.openGameplaySession('late', 'open-1');
    clock.set(10 * MINUTE);
    const late = await host.heartbeatGameplaySession('late', 'hb-late', opened.sessionId, 1);
    assert.strictEqual(late.outcome, 'expired');
    const state = load(store, 'late');
    assert.strictEqual(state.gameplaySessionLeases.length, 1);
    assert.strictEqual(state.gameplaySessionLeases[0]!.expiresAtMs, 90_000);
    assert.strictEqual(state.accruedTargetWorldTick, 2);
    assert.strictEqual(state.subTickMicroticks, 350_000);
  });

  await report('a new session after expiry is online only from its open receipt', async () => {
    const { host, clock, store } = harness();
    clock.set(0);
    const opened = await host.openGameplaySession('reopen', 'open-1');
    clock.set(10 * MINUTE);
    await host.heartbeatGameplaySession('reopen', 'hb-late', opened.sessionId, 1);
    const revived = await host.openGameplaySession('reopen', 'open-2');
    clock.set(10 * MINUTE + MINUTE);
    await host.heartbeatGameplaySession('reopen', 'hb-new', revived.sessionId, 1);
    const state = load(store, 'reopen');
    assert.strictEqual(state.gameplaySessionLeases.length, 2);
    assert.strictEqual(state.gameplaySessionLeases[1]!.openedAtMs, 10 * MINUTE);
    assert.strictEqual(state.worldTick, 0);
    assert.strictEqual(state.accruedTargetWorldTick, 3);
    assert.strictEqual(state.subTickMicroticks, 350_000);
    assert.strictEqual(state.accrualDivisionRemainder, 0);
  });

  await report('five online minutes and thirty offline minutes earn eight ticks', async () => {
    const state = world(1000);
    state.gameplaySessionLeases = [lease('a', 0, 5 * MINUTE)];
    accrueWorldThroughReceipt(state, 0);
    accrueWorldThroughReceipt(state, 35 * MINUTE);
    assert.strictEqual(BALANCE.temporal.onlineRatePpm, 1_000_000);
    assert.strictEqual(BALANCE.temporal.offlineRatePpm, 100_000);
    assert.strictEqual(state.worldTick, 1000);
    assert.strictEqual(state.accruedTargetWorldTick, 1008);
    assert.strictEqual(state.subTickMicroticks, 0);
    assert.strictEqual(state.accrualDivisionRemainder, 0);
  });

  await report('mixed one-millisecond segments keep the fixed-point remainder', async () => {
    const state = world(50);
    state.gameplaySessionLeases = [lease('a', 0, 1)];
    accrueWorldThroughReceipt(state, 0);
    accrueWorldThroughReceipt(state, 2);
    assert.strictEqual(state.worldTick, 50);
    assert.strictEqual(state.accruedTargetWorldTick, 50);
    assert.strictEqual(state.subTickMicroticks, 18);
    assert.strictEqual(state.accrualDivisionRemainder, 20_000);
    assert.strictEqual(state.lastAccrualAtMs, 2);
  });

  await report('two sessions do not double the world rate', async () => {
    const { host, clock, store } = harness();
    clock.set(0);
    const first = await host.openGameplaySession('double', 'open-a');
    await host.openGameplaySession('double', 'open-b');
    clock.set(MINUTE);
    await host.heartbeatGameplaySession('double', 'hb-a', first.sessionId, 1);
    const state = load(store, 'double');
    assert.strictEqual(state.gameplaySessionLeases.length, 2);
    assert.strictEqual(state.accruedTargetWorldTick, 1);
    assert.strictEqual(state.subTickMicroticks, 0);
  });

  await report('overlapping coverage does not depend on lease order', async () => {
    const left = world(10);
    left.gameplaySessionLeases = [lease('a', 0, 10 * MINUTE), lease('b', 5 * MINUTE, 15 * MINUTE)];
    const right = world(10);
    right.gameplaySessionLeases = [lease('b', 5 * MINUTE, 15 * MINUTE), lease('a', 0, 10 * MINUTE)];
    accrueWorldThroughReceipt(left, 0);
    accrueWorldThroughReceipt(right, 0);
    accrueWorldThroughReceipt(left, 15 * MINUTE);
    accrueWorldThroughReceipt(right, 15 * MINUTE);
    assert.deepStrictEqual(temporal(left), temporal(right));
    assert.strictEqual(left.accruedTargetWorldTick, 25);
  });

  await report('heartbeats on two leases still earn one online rate', async () => {
    const { host, clock, store } = harness();
    clock.set(0);
    const first = await host.openGameplaySession('beats', 'open-a');
    const second = await host.openGameplaySession('beats', 'open-b');
    clock.set(30_000);
    await host.heartbeatGameplaySession('beats', 'hb-a', first.sessionId, 1);
    clock.set(MINUTE);
    await host.heartbeatGameplaySession('beats', 'hb-b', second.sessionId, 1);
    const state = load(store, 'beats');
    assert.strictEqual(state.accruedTargetWorldTick, 1);
    assert.strictEqual(state.subTickMicroticks, 0);
    assert.strictEqual(state.accrualDivisionRemainder, 0);
    assert.strictEqual(state.lastAccrualAtMs, MINUTE);
  });

  await report('many observations match one accrual over the same leases', async () => {
    const once = covered(0, 60 * MINUTE, 1000);
    accrueWorldThroughReceipt(once, 0);
    accrueWorldThroughReceipt(once, 60 * MINUTE);
    const steps = covered(0, 60 * MINUTE, 1000);
    accrueWorldThroughReceipt(steps, 0);
    for (let minute = 1; minute <= 60; minute += 1) {
      accrueWorldThroughReceipt(steps, minute * MINUTE);
    }
    assert.deepStrictEqual(temporal(steps), temporal(once));
    assert.strictEqual(once.accruedTargetWorldTick, 1060);
    assert.strictEqual(once.worldTick, 1000);
  });

  await report('a reload continues the same fraction', async () => {
    const stepped = covered(0, 2 * MINUTE, 1000);
    accrueWorldThroughReceipt(stepped, 0);
    accrueWorldThroughReceipt(stepped, 30_000);
    const store = new InMemoryGameStateStore();
    assert.strictEqual(store.save('reload', stepped, 0).ok, true);
    const loaded = store.load('reload');
    assert.strictEqual(loaded.ok, true);
    if (!loaded.ok) return;
    accrueWorldThroughReceipt(loaded.state, MINUTE);
    const direct = covered(0, 2 * MINUTE, 1000);
    accrueWorldThroughReceipt(direct, 0);
    accrueWorldThroughReceipt(direct, MINUTE);
    assert.deepStrictEqual(temporal(loaded.state), temporal(direct));
    assert.strictEqual(loaded.state.accruedTargetWorldTick, 1001);
    assert.strictEqual(loaded.state.subTickMicroticks, 0);
    assert.strictEqual(loaded.state.accrualDivisionRemainder, 0);
    assert.strictEqual(loaded.state.lastAccrualAtMs, MINUTE);
  });

  await report('competing lifecycle writes accrue one interval once', async () => {
    const { store, clock, persistence } = harness();
    clock.set(0);
    const host = createSessionHost(persistence, { nowMs: clock.now });
    const opened = await host.openGameplaySession('race', 'open-1');
    clock.set(MINUTE);
    const racing = wrapSave(persistence, () => {
      const loaded = store.load('race');
      assert.strictEqual(loaded.ok, true);
      if (!loaded.ok) return;
      const applied = applyGameplaySessionHeartbeat(loaded.state, {
        sessionId: opened.sessionId,
        requestId: 'hb-winner',
        receiptMs: MINUTE,
        renewalSequence: 1,
      });
      assert.strictEqual(store.save('race', applied.state, loaded.record.stateVersion).ok, true);
    });
    const racer = createSessionHost(racing, { nowMs: () => MINUTE });
    const result = await racer.heartbeatGameplaySession('race', 'hb-racer', opened.sessionId, 2);
    assert.strictEqual(result.outcome, 'renewed');
    const state = load(store, 'race');
    assert.strictEqual(state.worldTick, 0);
    assert.strictEqual(state.accruedTargetWorldTick, 1);
    assert.strictEqual(state.subTickMicroticks, 0);
    assert.strictEqual(state.accrualDivisionRemainder, 0);
    assert.strictEqual(state.lastAccrualAtMs, MINUTE);
  });

  await report('a stale writer conflicts and the retry keeps the captured receipt', async () => {
    const control = harness();
    control.clock.set(0);
    const controlOpen = await control.host.openGameplaySession('control', 'open-1');
    control.clock.set(MINUTE);
    await control.host.heartbeatGameplaySession('control', 'hb-1', controlOpen.sessionId, 1);

    const { store, clock, persistence } = harness();
    clock.set(0);
    const host = createSessionHost(persistence, { nowMs: clock.now });
    const opened = await host.openGameplaySession('retry', 'open-1');
    clock.set(MINUTE);
    const racing = wrapSave(persistence, () => {
      const loaded = store.load('retry');
      assert.strictEqual(loaded.ok, true);
      if (!loaded.ok) return;
      const applied = applyGameplaySessionHeartbeat(loaded.state, {
        sessionId: opened.sessionId,
        requestId: 'hb-winner',
        receiptMs: MINUTE,
        renewalSequence: 1,
      });
      assert.strictEqual(store.save('retry', applied.state, loaded.record.stateVersion).ok, true);
    });
    const racer = createSessionHost(racing, { nowMs: () => MINUTE });
    await racer.heartbeatGameplaySession('retry', 'hb-racer', opened.sessionId, 2);
    assert.deepStrictEqual(temporal(load(store, 'retry')), temporal(load(control.store, 'control')));
  });

  await report('an earlier receipt cannot regress a later accrual', async () => {
    const { store, clock, persistence } = harness();
    clock.set(0);
    const host = createSessionHost(persistence, { nowMs: clock.now });
    const opened = await host.openGameplaySession('regress', 'open-1');
    const loaded = store.load('regress');
    assert.strictEqual(loaded.ok, true);
    if (!loaded.ok) return;
    const applied = applyGameplaySessionHeartbeat(loaded.state, {
      sessionId: opened.sessionId,
      requestId: 'hb-later',
      receiptMs: MINUTE,
      renewalSequence: 1,
    });
    assert.strictEqual(store.save('regress', applied.state, loaded.record.stateVersion).ok, true);
    clock.set(30_000);
    const earlier = createSessionHost(persistence, { nowMs: clock.now });
    await assert.rejects(() => earlier.heartbeatGameplaySession('regress', 'hb-earlier', opened.sessionId, 2));
    const state = load(store, 'regress');
    assert.strictEqual(state.accruedTargetWorldTick, 1);
    assert.strictEqual(state.subTickMicroticks, 0);
    assert.strictEqual(state.lastAccrualAtMs, MINUTE);
    assert.strictEqual(state.worldTick, 0);
  });

  await report('earned time does not process gameplay', async () => {
    const state = world(1000);
    state.turn = 9;
    state.playerRewards.bankedTroops = 40;
    state.lastProcessedAtMs = 123;
    state.constructions.set('con-sentinel', {
      id: 'con-sentinel',
      factionId: 'faction-sentinel',
      territoryId: 'territory-sentinel',
      projectType: 'FARM',
      startedAtTick: 1000,
      lastProgressTick: 1000,
      durationTicks: 20,
      remainingTicks: 15,
      status: 'in_progress',
      completedAtTick: null,
    });
    state.gameplaySessionLeases = [lease('a', 0, 100 * MINUTE)];
    const invasions = state.activeInvasions.size;
    const armies = state.armies.size;
    const events = state.activeEvents.length;
    const history = state.eventHistory.length;
    accrueWorldThroughReceipt(state, 0);
    accrueWorldThroughReceipt(state, 100 * MINUTE);
    const project = state.constructions.get('con-sentinel') as ConstructionProject;
    assert.strictEqual(state.worldTick, 1000);
    assert.strictEqual(state.turn, 9);
    assert.strictEqual(state.playerRewards.bankedTroops, 40);
    assert.strictEqual(state.lastProcessedAtMs, 123);
    assert.strictEqual(project.remainingTicks, 15);
    assert.strictEqual(project.status, 'in_progress');
    assert.strictEqual(project.lastProgressTick, 1000);
    assert.strictEqual(state.activeInvasions.size, invasions);
    assert.strictEqual(state.armies.size, armies);
    assert.strictEqual(state.activeEvents.length, events);
    assert.strictEqual(state.eventHistory.length, history);
    assert.strictEqual(state.accruedTargetWorldTick, 1100);
  });

  await report('the legacy world clock is not the accrual watermark', async () => {
    const accrual = fs.readFileSync(path.join(__dirname, '..', 'src', 'world', 'worldAccrual.ts'), 'utf8');
    const lifecycle = fs.readFileSync(path.join(__dirname, '..', 'src', 'server', 'gameplaySessionLifecycle.ts'), 'utf8');
    assert.strictEqual(accrual.includes('advanceAuthoritativeWorldClock'), false);
    assert.strictEqual(lifecycle.includes('advanceAuthoritativeWorldClock'), false);
    assert.strictEqual(/state\.lastProcessedAtMs/.test(accrual), false);
    assert.strictEqual(lifecycle.includes('accrueWorldThroughReceipt'), true);
    const state = world(80);
    state.lastProcessedAtMs = 50_000;
    accrueWorldThroughReceipt(state, 0);
    accrueWorldThroughReceipt(state, 10 * MINUTE);
    assert.strictEqual(state.lastProcessedAtMs, 50_000);
    assert.strictEqual(state.worldTick, 80);
    assert.strictEqual(state.lastAccrualAtMs, 10 * MINUTE);
    assert.strictEqual(state.accruedTargetWorldTick, 81);
  });

  await report('gameplay commands and reads do not observe accrual', async () => {
    const { host, clock, store } = harness();
    clock.set(1_000);
    const opened = await host.openGameplaySession('command', 'open-1');
    const version = store.load('command');
    assert.strictEqual(version.ok, true);
    if (!version.ok) return;
    clock.set(MINUTE);
    const read = await host.execute({
      commandId: 'GET_GAME_STATE',
      playerId: 'command',
      requestId: 'read-1',
      timestamp: 1,
    });
    assert.strictEqual(read.success, true, read.errors[0]?.message);
    const paused = await host.execute({
      commandId: 'SET_PLAYER_PAUSE',
      playerId: 'command',
      requestId: 'pause-1',
      timestamp: 1,
      gameplaySessionId: opened.sessionId,
      renewalSequence: 1,
      commandSequence: 1,
      parameters: { paused: true },
    });
    assert.strictEqual(paused.success, true, paused.errors[0]?.message);
    const state = load(store, 'command');
    assert.strictEqual(state.playerEmpirePause.paused, true);
    assert.strictEqual(state.gameplaySessionLeases[0]!.expiresAtMs, MINUTE + BALANCE.temporal.presenceLeaseDurationMs);
    assert.strictEqual(state.lastAccrualAtMs, 1_000);
    assert.strictEqual(state.accruedTargetWorldTick, 0);
    assert.strictEqual(state.worldTick, 0);
    assert.strictEqual(store.load('command').ok, true);
  });
}

function world(worldTick = 0): GameState {
  const state = createGameState();
  state.worldTick = worldTick;
  state.accruedTargetWorldTick = worldTick;
  return state;
}

function covered(openedAtMs: number, expiresAtMs: number, worldTick = 0): GameState {
  const state = world(worldTick);
  state.gameplaySessionLeases = [lease('covered', openedAtMs, expiresAtMs)];
  return state;
}

function lease(sessionId: string, openedAtMs: number, expiresAtMs: number, endedAtMs: number | null = null): GameplaySessionLease {
  return {
    sessionId,
    openedAtMs,
    expiresAtMs,
    endedAtMs,
    lastReceiptAtMs: endedAtMs ?? openedAtMs,
    lastRenewalRequestId: null,
    lastRenewalSequence: null,
    openedByRequestId: `open-${sessionId}`,
    lastCommandSequence: null,
    lastCommandReceipt: null,
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

function load(store: GameStateStore, playerId: string): GameState {
  const loaded = store.load(playerId);
  assert.strictEqual(loaded.ok, true, loaded.ok ? '' : loaded.message);
  if (!loaded.ok) throw new Error(loaded.message);
  return loaded.state;
}

function persistenceFor(store: GameStateStore): PlayerWorldPersistence {
  return {
    name: 'memory',
    history: new InMemoryWorkoutHistoryStore(),
    ensure: (playerId: string) => ensurePlayerWorld({ playerId, store }),
    save: (playerId, state, expectedVersion) => store.save(playerId, state, expectedVersion),
  };
}

function harness() {
  const store = new InMemoryGameStateStore();
  let current = 0;
  const clock = {
    now: () => current,
    set: (ms: number) => {
      current = ms;
    },
  };
  const persistence = persistenceFor(store);
  return { store, clock, persistence, host: createSessionHost(persistence, { nowMs: clock.now }) };
}

function wrapSave(inner: PlayerWorldPersistence, interfere: () => void): PlayerWorldPersistence {
  let armed = true;
  return {
    ...inner,
    save: (playerId, state, expectedVersion): SaveWorldResult => {
      if (armed) {
        armed = false;
        interfere();
        return { ok: false, persisted: false, code: 'persistence.conflict', message: 'stale gameplay-session write' };
      }
      return inner.save(playerId, state, expectedVersion);
    },
  };
}
