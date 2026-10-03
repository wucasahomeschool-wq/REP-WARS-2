import assert from 'assert';
import { MIN_ATTACKING_TROOPS } from '../src/army/strategicAttack';
import { InMemoryWorkoutHistoryStore } from '../src/fitness/history/inMemoryStore';
import { getCurrentExercise } from '../src/fitness/session/progress';
import { InMemoryGameStateStore } from '../src/persistence/inMemoryGameStateStore';
import { ensurePlayerWorld } from '../src/persistence/initializePlayerWorld';
import type { GameStateStore, SaveWorldResult } from '../src/persistence/types';
import { ErrorCode } from '../src/orchestration/errors';
import { PersistenceFailedError } from '../src/server/session';
import type { PlayerWorldPersistence } from '../src/server/persistencePort';
import { createSessionHost } from '../src/server/session';
import { GAME_STATE_SCHEMA_VERSION, type GameState } from '../src/types/GameState';

interface ManualClock {
  now: () => number;
  set: (ms: number) => void;
}

export async function runCommandIdempotencyTests(
  report: (name: string, fn: () => Promise<void>) => Promise<void>,
): Promise<void> {
  console.log('Gameplay command idempotency');

  await report('replaying the latest command does not mutate again', async () => {
    const { store, host } = harness();
    const opened = await host.openGameplaySession('cmd_replay', 'open-1');
    const first = await pause(host, 'cmd_replay', opened.sessionId, 'command-A', 1, true);
    assert.strictEqual(first.success, true, first.errors[0]?.message);
    const replay = await pause(host, 'cmd_replay', opened.sessionId, 'command-A', 1, false);
    assert.strictEqual(replay.idempotentReplay, true);
    assert.strictEqual(replay.payload.paused, true);
    const state = load(store, 'cmd_replay');
    assert.strictEqual(state.playerEmpirePause.paused, true);
    assert.strictEqual(state.gameplaySessionLeases[0]!.lastCommandSequence, 1);
  });

  await report('an older command after a later one does not mutate', async () => {
    const { store, host } = harness();
    const opened = await host.openGameplaySession('cmd_old', 'open-1');
    assert.strictEqual((await pause(host, 'cmd_old', opened.sessionId, 'command-A', 1, true)).success, true);
    assert.strictEqual((await pause(host, 'cmd_old', opened.sessionId, 'command-B', 2, false)).success, true);
    const replay = await pause(host, 'cmd_old', opened.sessionId, 'command-A', 1, true);
    assert.strictEqual(replay.success, false);
    assert.strictEqual(replay.errors[0]?.code, ErrorCode.COMMAND_STALE);
    const state = load(store, 'cmd_old');
    assert.strictEqual(state.playerEmpirePause.paused, false);
    assert.strictEqual(state.gameplaySessionLeases[0]!.lastCommandSequence, 2);
    assert.strictEqual(state.gameplaySessionLeases[0]!.lastCommandReceipt?.requestId, 'command-B');
  });

  await report('replaying the latest command after a newer one returns its receipt', async () => {
    const { store, host } = harness();
    const opened = await host.openGameplaySession('cmd_latest', 'open-1');
    await pause(host, 'cmd_latest', opened.sessionId, 'command-A', 1, true);
    await pause(host, 'cmd_latest', opened.sessionId, 'command-B', 2, false);
    const replay = await pause(host, 'cmd_latest', opened.sessionId, 'command-B', 2, true);
    assert.strictEqual(replay.idempotentReplay, true);
    assert.strictEqual(replay.payload.paused, false);
    assert.strictEqual(load(store, 'cmd_latest').playerEmpirePause.paused, false);
  });

  await report('the same command stays idempotent after restart', async () => {
    const { store, persistence } = harness();
    const first = createSessionHost(persistence, { nowMs: () => 10_000 });
    const opened = await first.openGameplaySession('cmd_restart', 'open-1');
    await pause(first, 'cmd_restart', opened.sessionId, 'command-A', 1, true);
    const restarted = createSessionHost(persistence, { nowMs: () => 40_000 });
    const replay = await pause(restarted, 'cmd_restart', opened.sessionId, 'command-A', 1, false);
    assert.strictEqual(replay.idempotentReplay, true);
    assert.strictEqual(load(store, 'cmd_restart').playerEmpirePause.paused, true);
    assert.strictEqual(load(store, 'cmd_restart').gameplaySessionLeases[0]!.expiresAtMs, 10_000 + 90_000);
  });

  await report('a command replay after an unrelated mutation stays stale', async () => {
    const { store, host } = harness();
    const opened = await host.openGameplaySession('cmd_between', 'open-1');
    await pause(host, 'cmd_between', opened.sessionId, 'command-A', 1, true);
    const other = await host.execute({
      commandId: 'SET_PLAYER_PAUSE',
      playerId: 'cmd_between',
      requestId: 'outside-session',
      parameters: { paused: false },
    });
    assert.strictEqual(other.success, true, other.errors[0]?.message);
    const replay = await pause(host, 'cmd_between', opened.sessionId, 'command-A', 1, true);
    assert.strictEqual(replay.idempotentReplay, true);
    assert.strictEqual(load(store, 'cmd_between').playerEmpirePause.paused, false);
    assert.strictEqual(load(store, 'cmd_between').gameplaySessionLeases[0]!.lastCommandSequence, 1);
  });

  await report('two sessions can commit distinct commands with the same sequence', async () => {
    const { store, host } = harness();
    const first = await host.openGameplaySession('cmd_two', 'open-a');
    const second = await host.openGameplaySession('cmd_two', 'open-b');
    assert.strictEqual((await pause(host, 'cmd_two', first.sessionId, 'session-a', 1, true)).success, true);
    assert.strictEqual((await pause(host, 'cmd_two', second.sessionId, 'session-b', 1, false)).success, true);
    const state = load(store, 'cmd_two');
    assert.strictEqual(state.playerEmpirePause.paused, false);
    assert.strictEqual(state.gameplaySessionLeases[0]!.lastCommandSequence, 1);
    assert.strictEqual(state.gameplaySessionLeases[1]!.lastCommandSequence, 1);
    assert.strictEqual(state.gameplaySessionLeases[0]!.lastCommandReceipt?.requestId, 'session-a');
    assert.strictEqual(state.gameplaySessionLeases[1]!.lastCommandReceipt?.requestId, 'session-b');
    const replay = await pause(host, 'cmd_two', first.sessionId, 'session-a', 1, false);
    assert.strictEqual(replay.idempotentReplay, true);
    assert.strictEqual(replay.payload.paused, true);
    assert.strictEqual(load(store, 'cmd_two').playerEmpirePause.paused, false);
  });

  await report('a conflict before commit can still commit the same command once', async () => {
    const clock = manualClock();
    const { store, persistence } = harness({ clock });
    const opener = createSessionHost(persistence, { nowMs: clock.now });
    const opened = await opener.openGameplaySession('cmd_conflict', 'open-1');
    const failing = armNextSave(persistence, () => undefined, false);
    const firstHost = createSessionHost(failing, { nowMs: clock.now });
    await assert.rejects(
      () => pause(firstHost, 'cmd_conflict', opened.sessionId, 'command-A', 1, true),
      (err: unknown) => err instanceof PersistenceFailedError,
    );
    assert.strictEqual(load(store, 'cmd_conflict').playerEmpirePause.paused, false);
    assert.strictEqual(load(store, 'cmd_conflict').gameplaySessionLeases[0]!.lastCommandSequence, null);
    const retry = await pause(firstHost, 'cmd_conflict', opened.sessionId, 'command-A', 1, true);
    assert.strictEqual(retry.success, true, retry.errors[0]?.message);
    assert.strictEqual(retry.idempotentReplay, undefined);
    assert.strictEqual(load(store, 'cmd_conflict').playerEmpirePause.paused, true);
    const again = await pause(firstHost, 'cmd_conflict', opened.sessionId, 'command-A', 1, false);
    assert.strictEqual(again.idempotentReplay, true);
    assert.strictEqual(load(store, 'cmd_conflict').playerEmpirePause.paused, true);
  });

  await report('a command that loses the version to a later command does not apply on retry', async () => {
    const clock = manualClock();
    const { store, persistence } = harness({ clock });
    const opener = createSessionHost(persistence, { nowMs: clock.now });
    const opened = await opener.openGameplaySession('cmd_race', 'open-1');
    const racing = armNextSave(persistence, () => {
      const loaded = store.load('cmd_race');
      assert.strictEqual(loaded.ok, true);
      if (!loaded.ok) return;
      loaded.state.playerEmpirePause.paused = false;
      const lease = loaded.state.gameplaySessionLeases[0]!;
      lease.lastCommandSequence = 2;
      lease.lastCommandReceipt = {
        sequence: 2,
        requestId: 'command-B',
        commandId: 'SET_PLAYER_PAUSE',
        success: true,
        payload: { paused: false, pausedAtTick: null },
        errors: [],
      };
      const saved = store.save('cmd_race', loaded.state, loaded.record.stateVersion);
      assert.strictEqual(saved.ok, true, saved.ok ? '' : saved.message);
    }, false);
    const racer = createSessionHost(racing, { nowMs: clock.now });
    await assert.rejects(
      () => pause(racer, 'cmd_race', opened.sessionId, 'command-A', 1, true),
      (err: unknown) => err instanceof PersistenceFailedError,
    );
    const retry = await pause(racer, 'cmd_race', opened.sessionId, 'command-A', 1, true);
    assert.strictEqual(retry.errors[0]?.code, ErrorCode.COMMAND_STALE);
    const state = load(store, 'cmd_race');
    assert.strictEqual(state.playerEmpirePause.paused, false);
    assert.strictEqual(state.gameplaySessionLeases[0]!.lastCommandSequence, 2);
  });

  await report('a lost success returns the committed construction id', async () => {
    const clock = manualClock();
    const { store, persistence } = harness({ clock });
    const opener = createSessionHost(persistence, { nowMs: clock.now });
    const opened = await opener.openGameplaySession('cmd_build', 'open-1');
    prepareConstruction(store, 'cmd_build');
    const losing = armNextSave(persistence, () => undefined, true);
    const lostHost = createSessionHost(losing, { nowMs: clock.now });
    await assert.rejects(
      () => build(lostHost, 'cmd_build', opened.sessionId, 'build-A', 1),
      (err: unknown) => err instanceof PersistenceFailedError,
    );
    const state = load(store, 'cmd_build');
    assert.strictEqual(state.constructions.size, 1);
    const projectId = [...state.constructions.keys()][0]!;
    const replay = await build(lostHost, 'cmd_build', opened.sessionId, 'build-A', 1);
    assert.strictEqual(replay.idempotentReplay, true);
    assert.strictEqual(replay.payload.constructionId, projectId);
    assert.strictEqual(load(store, 'cmd_build').constructions.size, 1);
  });

  await report('a seeded attack replay keeps the committed army and battle', async () => {
    const { store, host } = harness();
    const opened = await host.openGameplaySession('cmd_attack', 'open-1');
    prepareAttack(store, 'cmd_attack');
    const attacker = createSessionHost(harnessOf(store).persistence, { nowMs: () => 6_000 });
    const first = await attack(attacker, 'cmd_attack', opened.sessionId, 'attack-A', 1);
    assert.strictEqual(first.success, true, first.errors[0]?.message);
    const armyId = first.payload.committedArmyId;
    const winner = (first.payload.battleResult as { winner?: string } | undefined)?.winner;
    assert.strictEqual(typeof armyId, 'string');
    const banked = load(store, 'cmd_attack').playerRewards.bankedTroops;
    const replay = await attack(attacker, 'cmd_attack', opened.sessionId, 'attack-A', 1);
    assert.strictEqual(replay.idempotentReplay, true);
    assert.strictEqual(replay.payload.committedArmyId, armyId);
    assert.strictEqual((replay.payload.battleResult as { winner?: string }).winner, winner);
    const state = load(store, 'cmd_attack');
    assert.strictEqual(state.playerRewards.bankedTroops, banked);
    assert.strictEqual([...state.armies.keys()].filter((id) => String(id).startsWith('banked_')).length, 1);
  });

  await report('finalizing a workout twice does not grant a second reward', async () => {
    const { store, host, history } = harness();
    const opened = await host.openGameplaySession('cmd_workout', 'open-1');
    let sequence = 1;
    const started = await host.execute(command('cmd_workout', opened.sessionId, 'workout-start', sequence, 'START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      sessionId: 'wses-idem',
      now: 1_000,
    }));
    assert.strictEqual(started.success, true, started.errors[0]?.message);
    const replayStart = await host.execute(command('cmd_workout', opened.sessionId, 'workout-start', sequence, 'START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      sessionId: 'wses-other',
      now: 9_000,
    }));
    assert.strictEqual(replayStart.idempotentReplay, true);
    assert.strictEqual(replayStart.payload.sessionId, 'wses-idem');
    assert.strictEqual(load(store, 'cmd_workout').playerFitness.activeSession?.sessionId, 'wses-idem');
    let clock = 2_000;
    while (load(store, 'cmd_workout').playerFitness.activeSession?.state === 'ACTIVE') {
      sequence += 1;
      const session = load(store, 'cmd_workout').playerFitness.activeSession!;
      const step = getCurrentExercise(session);
      assert.ok(step);
      clock += 1_000;
      const parameters: Record<string, unknown> = { order: step.order, now: clock };
      const commandId = step.skippable && step.exerciseType === 'REST' ? 'SKIP_REST' : 'RECORD_EXERCISE';
      if (commandId === 'RECORD_EXERCISE') {
        if (step.prescription.kind === 'repetitions') parameters.repetitions = step.prescription.repetitions;
        else parameters.durationSeconds = step.prescription.durationSeconds;
      }
      const recorded = await host.execute(command('cmd_workout', opened.sessionId, `workout-${sequence}`, sequence, commandId, parameters));
      assert.strictEqual(recorded.success, true, recorded.errors[0]?.message);
    }
    sequence += 1;
    const feedback = await host.execute(command('cmd_workout', opened.sessionId, 'workout-feedback', sequence, 'SUBMIT_WORKOUT_FEEDBACK', {
      value: 'ABOUT_RIGHT',
      now: clock + 1_000,
    }));
    if (feedback.success) sequence += 1;
    const finalized = await host.execute(command('cmd_workout', opened.sessionId, 'workout-final', sequence, 'FINALIZE_WORKOUT', {
      now: clock + 2_000,
    }));
    assert.strictEqual(finalized.success, true, finalized.errors[0]?.message);
    const banked = load(store, 'cmd_workout').playerRewards.bankedTroops;
    const rewards = load(store, 'cmd_workout').playerRewards.appliedRewards.length;
    assert.ok(history.get('cmd_workout', 'wses-idem'));
    const replay = await host.execute(command('cmd_workout', opened.sessionId, 'workout-final', sequence, 'FINALIZE_WORKOUT', {
      now: clock + 9_000,
    }));
    assert.strictEqual(replay.idempotentReplay, true);
    assert.strictEqual(replay.payload.applicationId, finalized.payload.applicationId);
    assert.strictEqual(load(store, 'cmd_workout').playerRewards.bankedTroops, banked);
    assert.strictEqual(load(store, 'cmd_workout').playerRewards.appliedRewards.length, rewards);
    assert.ok(history.get('cmd_workout', 'wses-idem'));
    assert.strictEqual(history.get('cmd_workout', 'wses-other'), null);
  });

  await report('a duplicate command does not renew the lease again', async () => {
    const { store, host, clock } = harness();
    const opened = await host.openGameplaySession('cmd_lease', 'open-1');
    clock.set(10_000);
    const first = await host.execute(command('cmd_lease', opened.sessionId, 'command-A', 1, 'SET_PLAYER_PAUSE', { paused: true }, 1));
    assert.strictEqual(first.success, true, first.errors[0]?.message);
    clock.set(30_000);
    const staleRenewal = await host.execute(command('cmd_lease', opened.sessionId, 'command-A', 1, 'SET_PLAYER_PAUSE', { paused: false }, 1));
    assert.strictEqual(staleRenewal.idempotentReplay, true);
    clock.set(40_000);
    const newRenewal = await host.execute(command('cmd_lease', opened.sessionId, 'command-A', 1, 'SET_PLAYER_PAUSE', { paused: false }, 4));
    assert.strictEqual(newRenewal.idempotentReplay, true);
    const lease = load(store, 'cmd_lease').gameplaySessionLeases[0]!;
    assert.strictEqual(load(store, 'cmd_lease').playerEmpirePause.paused, true);
    assert.strictEqual(lease.expiresAtMs, 10_000 + 90_000);
    assert.strictEqual(lease.lastRenewalSequence, 1);
    assert.strictEqual(lease.lastCommandSequence, 1);
  });

  await report('a rejected command does not consume command identity', async () => {
    const { store, host } = harness();
    const opened = await host.openGameplaySession('cmd_reject', 'open-1');
    const rejected = await pause(host, 'cmd_reject', opened.sessionId, 'command-bad', 1, true, {});
    assert.strictEqual(rejected.success, false);
    assert.strictEqual(rejected.errors[0]?.code, ErrorCode.MISSING_PARAMETER);
    assert.strictEqual(load(store, 'cmd_reject').gameplaySessionLeases[0]!.lastCommandSequence, null);
    const accepted = await pause(host, 'cmd_reject', opened.sessionId, 'command-A', 1, true);
    assert.strictEqual(accepted.success, true, accepted.errors[0]?.message);
    assert.strictEqual(load(store, 'cmd_reject').gameplaySessionLeases[0]!.lastCommandSequence, 1);
    const conflict = await pause(host, 'cmd_reject', opened.sessionId, 'command-other', 1, false);
    assert.strictEqual(conflict.errors[0]?.code, ErrorCode.COMMAND_SEQUENCE_CONFLICT);
    assert.strictEqual(load(store, 'cmd_reject').playerEmpirePause.paused, true);
  });

  await report('a read-only command does not store command identity', async () => {
    const { store, host } = harness();
    const opened = await host.openGameplaySession('cmd_read', 'open-1');
    const read = await host.execute({
      commandId: 'GET_GAME_STATE',
      playerId: 'cmd_read',
      requestId: 'read-1',
      gameplaySessionId: opened.sessionId,
      commandSequence: 1,
    });
    assert.strictEqual(read.success, true, read.errors[0]?.message);
    assert.strictEqual(load(store, 'cmd_read').gameplaySessionLeases[0]!.lastCommandSequence, null);
    assert.strictEqual(load(store, 'cmd_read').gameplaySessionLeases[0]!.lastCommandReceipt, null);
    assert.strictEqual(GAME_STATE_SCHEMA_VERSION, 16);
  });

  await report('many commands keep one command receipt', async () => {
    const { store, host } = harness();
    const opened = await host.openGameplaySession('cmd_long', 'open-1');
    for (let sequence = 1; sequence <= 40; sequence += 1) {
      const paused = sequence % 2 === 1;
      const response = await pause(host, 'cmd_long', opened.sessionId, `req-${String(sequence).padStart(3, '0')}`, sequence, paused);
      assert.strictEqual(response.success, true, response.errors[0]?.message);
    }
    const lease = load(store, 'cmd_long').gameplaySessionLeases[0]!;
    assert.strictEqual(lease.lastCommandSequence, 40);
    assert.strictEqual(lease.lastCommandReceipt?.requestId, 'req-040');
    const encoded = JSON.stringify(lease);
    assert.strictEqual(encoded.includes('req-001'), false);
    assert.strictEqual(encoded.includes('req-039'), false);
    assert.strictEqual(load(store, 'cmd_long').gameplaySessionLeases.length, 1);
  });
}

function manualClock(): ManualClock {
  let current = 5_000;
  return {
    now: () => current,
    set: (ms: number) => {
      current = ms;
    },
  };
}

function persistenceFor(store: GameStateStore, history: InMemoryWorkoutHistoryStore): PlayerWorldPersistence {
  return {
    name: 'memory',
    history,
    ensure: (playerId: string) => ensurePlayerWorld({ playerId, store }),
    save: (playerId: string, state: GameState, expectedVersion: number) => store.save(playerId, state, expectedVersion),
  };
}

function harness(options: { clock?: ManualClock } = {}) {
  const store = new InMemoryGameStateStore();
  const history = new InMemoryWorkoutHistoryStore();
  const clock = options.clock ?? manualClock();
  const persistence = persistenceFor(store, history);
  return { store, history, clock, persistence, host: createSessionHost(persistence, { nowMs: clock.now }) };
}

function harnessOf(store: GameStateStore) {
  const history = new InMemoryWorkoutHistoryStore();
  return { persistence: persistenceFor(store, history) };
}

function armNextSave(inner: PlayerWorldPersistence, interfere: () => void, writeThenConflict: boolean): PlayerWorldPersistence {
  let armed = true;
  return {
    ...inner,
    save: (playerId, state, expectedVersion) => {
      if (!armed) return inner.save(playerId, state, expectedVersion);
      armed = false;
      if (writeThenConflict) {
        const saved = inner.save(playerId, state, expectedVersion);
        assert.strictEqual(saved.ok, true, saved.ok ? '' : saved.message);
        interfere();
        return conflict();
      }
      interfere();
      return conflict();
    },
  };
}

function conflict(): SaveWorldResult {
  return { ok: false, persisted: false, code: 'persistence.conflict', message: 'stale command write' };
}

function load(store: GameStateStore, playerId: string): GameState {
  const loaded = store.load(playerId);
  assert.strictEqual(loaded.ok, true, loaded.ok ? '' : loaded.message);
  if (!loaded.ok) throw new Error(loaded.message);
  return loaded.state;
}

function command(
  playerId: string,
  sessionId: string,
  requestId: string,
  commandSequence: number,
  commandId: string,
  parameters: Record<string, unknown>,
  renewalSequence = commandSequence,
) {
  return {
    commandId,
    playerId,
    requestId,
    gameplaySessionId: sessionId,
    renewalSequence,
    commandSequence,
    parameters,
  };
}

function pause(
  host: ReturnType<typeof createSessionHost>,
  playerId: string,
  sessionId: string,
  requestId: string,
  commandSequence: number,
  paused: boolean,
  parameters?: Record<string, unknown>,
) {
  return host.execute(command(
    playerId,
    sessionId,
    requestId,
    commandSequence,
    'SET_PLAYER_PAUSE',
    parameters ?? { paused },
  ));
}

function build(
  host: ReturnType<typeof createSessionHost>,
  playerId: string,
  sessionId: string,
  requestId: string,
  commandSequence: number,
) {
  return host.execute(command(playerId, sessionId, requestId, commandSequence, 'START_CONSTRUCTION', {
    territoryId: 't_02',
    projectType: 'FARM',
  }));
}

function attack(
  host: ReturnType<typeof createSessionHost>,
  playerId: string,
  sessionId: string,
  requestId: string,
  commandSequence: number,
) {
  return host.execute(command(playerId, sessionId, requestId, commandSequence, 'ATTACK', {
    territoryId: 't_01',
    commitAmount: MIN_ATTACKING_TROOPS + 40,
    seed: 11,
  }));
}

function prepareConstruction(store: GameStateStore, playerId: string): void {
  const loaded = store.load(playerId);
  assert.strictEqual(loaded.ok, true);
  if (!loaded.ok) return;
  loaded.state.level1Tutorial = null;
  const factionId = loaded.state.playerFactionId;
  assert.ok(factionId);
  const faction = loaded.state.factions.get(factionId!);
  assert.ok(faction);
  faction!.resources.gold += 500;
  faction!.resources.wood += 500;
  const saved = store.save(playerId, loaded.state, loaded.record.stateVersion);
  assert.strictEqual(saved.ok, true, saved.ok ? '' : saved.message);
}

function prepareAttack(store: GameStateStore, playerId: string): void {
  const loaded = store.load(playerId);
  assert.strictEqual(loaded.ok, true);
  if (!loaded.ok) return;
  loaded.state.playerRewards.bankedTroops = MIN_ATTACKING_TROOPS + 80;
  if (loaded.state.level1Tutorial) {
    loaded.state.level1Tutorial.beat = 'FIRST_ATTACK_AVAILABLE';
    loaded.state.level1Tutorial.active = true;
    loaded.state.level1Tutorial.completed = false;
  }
  const saved = store.save(playerId, loaded.state, loaded.record.stateVersion);
  assert.strictEqual(saved.ok, true, saved.ok ? '' : saved.message);
}
