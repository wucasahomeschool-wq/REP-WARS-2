import assert from 'assert';
import {
  ErrorCode,
  FixedWorldTimeAuthority,
  GAME_STATE_SCHEMA_VERSION,
  InMemoryGameStateStore,
  InMemoryWorkoutHistoryStore,
  Orchestrator,
  PRODUCTION_LEVEL_1_WORLD_ID,
  PersistenceError,
  checkGameStateInvariants,
  cloneGameState,
  commitAuthoritativePlayerWorld,
  ensurePlayerWorld,
  getCurrentExercise,
  hydratePersistedPayload,
  initializePlayerWorld,
  snapshotGameState,
  syncPlayerWorld,
} from '../src';
import type { CommandRequest, GameState } from '../src';
import { MIN_ATTACKING_TROOPS } from '../src/army/strategicAttack';

export interface PlayerIdentityTestApi {
  test: (name: string, fn: () => void) => void;
}

const PLAYER_ID = 'player_identity';
const OTHER_ID = 'player_other_account';

function cmd(commandId: string, parameters: Record<string, unknown> = {}, requestId?: string): CommandRequest {
  return {
    commandId,
    playerId: PLAYER_ID,
    requestId: requestId ?? `${commandId}_${PLAYER_ID}`,
    parameters,
  };
}

function finishActiveWorkout(orch: Orchestrator, now = 2_000): void {
  let clock = now;
  while (orch.getState().playerFitness.activeSession?.state === 'ACTIVE') {
    const session = orch.getState().playerFitness.activeSession!;
    const step = getCurrentExercise(session);
    assert.ok(step, 'expected current exercise');
    clock += 1_000;
    if (step.skippable && step.exerciseType === 'REST') {
      const skipped = orch.execute(cmd('SKIP_REST', { order: step.order, now: clock }, `skip_${step.order}_${clock}`));
      assert.strictEqual(skipped.success, true, skipped.errors[0]?.message);
      continue;
    }
    const parameters: Record<string, unknown> = { order: step.order, now: clock };
    if (step.prescription.kind === 'repetitions') {
      parameters.repetitions = step.prescription.repetitions;
    } else {
      parameters.durationSeconds = step.prescription.durationSeconds;
    }
    const recorded = orch.execute(cmd('RECORD_EXERCISE', parameters, `ex_${step.order}_${clock}`));
    assert.strictEqual(recorded.success, true, recorded.errors[0]?.message);
  }
}

function assertSameEmpire(left: GameState, right: GameState): void {
  assert.deepStrictEqual(snapshotGameState(left), snapshotGameState(right));
  assert.deepStrictEqual(checkGameStateInvariants(right), []);
}

export function registerPlayerIdentityTests(api: PlayerIdentityTestApi): void {
  const { test } = api;

  console.log('Anonymous Level 1 → persistent account identity contract');

  test('ensurePlayerWorld creates once, then loads the same Level 1 empire', () => {
    const store = new InMemoryGameStateStore();
    const first = ensurePlayerWorld({ playerId: PLAYER_ID, seed: 11, store });
    assert.strictEqual(first.created, true);
    assert.strictEqual(first.record.playerId, PLAYER_ID);
    assert.strictEqual(first.state.definitionWorldId, PRODUCTION_LEVEL_1_WORLD_ID);
    assert.strictEqual(first.state.schemaVersion, GAME_STATE_SCHEMA_VERSION);
    assert.ok(first.state.level1Tutorial);
    const again = ensurePlayerWorld({ playerId: PLAYER_ID, seed: 99, store });
    assert.strictEqual(again.created, false);
    assert.strictEqual(again.record.stateVersion, first.record.stateVersion);
    assertSameEmpire(first.state, again.state);
    assert.notStrictEqual(again.state.worldSeed, 99);
    assert.strictEqual(again.state.worldSeed, first.state.worldSeed);
  });

  test('account association keeps the same playerId and does not mint a second empire', () => {
    const store = new InMemoryGameStateStore();
    const history = new InMemoryWorkoutHistoryStore();
    const boot = ensurePlayerWorld({ playerId: PLAYER_ID, seed: 7, store });
    const orch = new Orchestrator(boot.state);
    const started = orch.execute(cmd('START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      sessionId: 'wses_identity',
      now: 1_000,
    }));
    assert.strictEqual(started.success, true, started.errors[0]?.message);
    finishActiveWorkout(orch, 2_000);
    assert.strictEqual(orch.execute(cmd('SUBMIT_WORKOUT_FEEDBACK', { value: 'ABOUT_RIGHT', now: 20_000 })).success, true);
    const finalized = orch.execute(cmd('FINALIZE_WORKOUT', { now: 21_000 }));
    assert.strictEqual(finalized.success, true, finalized.errors[0]?.message);
    const committed = commitAuthoritativePlayerWorld({
      gameStore: store,
      historyStore: history,
      playerId: PLAYER_ID,
      expectedVersion: boot.record.stateVersion,
      state: orch.getState(),
    });
    assert.strictEqual(committed.ok, true);

    const afterAuth = ensurePlayerWorld({ playerId: PLAYER_ID, store });
    assert.strictEqual(afterAuth.created, false);
    assert.strictEqual(afterAuth.state.playerRewards.bankedTroops, orch.getState().playerRewards.bankedTroops);
    assert.ok(afterAuth.state.playerRewards.bankedTroops > MIN_ATTACKING_TROOPS);
    assert.strictEqual(afterAuth.state.level1Tutorial?.beat, orch.getState().level1Tutorial?.beat);
    assert.strictEqual(afterAuth.state.playerFitness.compactHistory.length, orch.getState().playerFitness.compactHistory.length);
    assert.strictEqual(afterAuth.state.territories.get('t_02')?.owner, 'f_player');
    assertSameEmpire(orch.getState(), afterAuth.state);

    const rows = [PLAYER_ID, OTHER_ID].map((id) => store.load(id));
    assert.strictEqual(rows[0]!.ok, true);
    assert.strictEqual(rows[1]!.ok, false);
  });

  test('initializePlayerWorld refuses to overwrite an existing empire', () => {
    const store = new InMemoryGameStateStore();
    const created = initializePlayerWorld({ playerId: PLAYER_ID, seed: 3, store });
    created.state.playerRewards.bankedTroops = 777;
    const saved = store.save(PLAYER_ID, created.state, created.record!.stateVersion);
    assert.strictEqual(saved.ok, true);
    assert.throws(
      () => initializePlayerWorld({ playerId: PLAYER_ID, seed: 4, store }),
      (err: unknown) => err instanceof PersistenceError && err.code === 'persistence.already_exists',
    );
    const loaded = store.load(PLAYER_ID);
    assert.strictEqual(loaded.ok, true);
    if (!loaded.ok) return;
    assert.strictEqual(loaded.state.playerRewards.bankedTroops, 777);
    assert.strictEqual(loaded.record.stateVersion, saved.record.stateVersion);
  });

  test('a different playerId is a different empire and cannot claim the first', () => {
    const store = new InMemoryGameStateStore();
    const first = ensurePlayerWorld({ playerId: PLAYER_ID, seed: 5, store });
    first.state.playerRewards.bankedTroops = 321;
    assert.strictEqual(store.save(PLAYER_ID, first.state, first.record.stateVersion).ok, true);
    const other = ensurePlayerWorld({ playerId: OTHER_ID, seed: 6, store });
    assert.strictEqual(other.created, true);
    assert.strictEqual(other.state.playerRewards.bankedTroops, 0);
    const original = store.load(PLAYER_ID);
    assert.strictEqual(original.ok, true);
    if (!original.ok) return;
    assert.strictEqual(original.state.playerRewards.bankedTroops, 321);
    assert.notStrictEqual(other.record.playerId, original.record.playerId);
  });

  test('missing identity fails closed and is not a silent new game', () => {
    const store = new InMemoryGameStateStore();
    const loaded = store.load(PLAYER_ID);
    assert.strictEqual(loaded.ok, false);
    if (loaded.ok) return;
    assert.strictEqual(loaded.code, 'persistence.not_found');
    const synced = syncPlayerWorld({
      playerId: PLAYER_ID,
      authority: new FixedWorldTimeAuthority(0),
      store,
    });
    assert.strictEqual(synced.ok, false);
    assert.strictEqual(synced.persisted, false);
    if (!synced.ok) assert.strictEqual(synced.code, 'persistence.not_found');
    assert.strictEqual(store.load(PLAYER_ID).ok, false);
  });

  test('invalid playerId fails closed without creating a row', () => {
    const store = new InMemoryGameStateStore();
    assert.throws(
      () => ensurePlayerWorld({ playerId: '   ', store }),
      (err: unknown) => err instanceof PersistenceError && err.code === 'persistence.invalid_state',
    );
    assert.throws(
      () => initializePlayerWorld({ playerId: '', store }),
      (err: unknown) => err instanceof PersistenceError && err.code === 'persistence.invalid_state',
    );
    assert.strictEqual(store.load('   ').ok, false);
  });

  test('optimistic concurrency still rejects stale writes after ensure', () => {
    const store = new InMemoryGameStateStore();
    const boot = ensurePlayerWorld({ playerId: PLAYER_ID, seed: 8, store });
    const next = cloneGameState(boot.state);
    next.playerRewards.bankedTroops = 50;
    const ok = store.save(PLAYER_ID, next, boot.record.stateVersion);
    assert.strictEqual(ok.ok, true);
    const stale = cloneGameState(boot.state);
    stale.playerRewards.bankedTroops = 999;
    const conflict = store.save(PLAYER_ID, stale, boot.record.stateVersion);
    assert.strictEqual(conflict.ok, false);
    if (conflict.ok) return;
    assert.strictEqual(conflict.code, 'persistence.conflict');
    const loaded = store.load(PLAYER_ID);
    assert.strictEqual(loaded.ok, true);
    if (!loaded.ok) return;
    assert.strictEqual(loaded.state.playerRewards.bankedTroops, 50);
  });

  test('persisted identity round-trip hydrates the same empire', () => {
    const store = new InMemoryGameStateStore();
    const boot = ensurePlayerWorld({ playerId: PLAYER_ID, seed: 2, store });
    const orch = new Orchestrator(boot.state);
    orch.execute(cmd('START_WORKOUT', { purpose: 'NORMAL_TROOPS', sessionId: 'wses_rt', now: 1_000 }));
    const mid = orch.getState();
    const saved = store.save(PLAYER_ID, mid, boot.record.stateVersion);
    assert.strictEqual(saved.ok, true);
    const loaded = store.load(PLAYER_ID);
    assert.strictEqual(loaded.ok, true);
    if (!loaded.ok) return;
    const hydrated = hydratePersistedPayload(snapshotGameState(loaded.state));
    assert.strictEqual(hydrated.playerFitness.activeSession?.sessionId, 'wses_rt');
    assert.strictEqual(hydrated.level1Tutorial?.beat, 'FIRST_WORKOUT_PENDING');
    assert.strictEqual(hydrated.definitionWorldId, PRODUCTION_LEVEL_1_WORLD_ID);
  });

  test('commands still reject impersonation; identity is not a faction rewrite', () => {
    const store = new InMemoryGameStateStore();
    const boot = ensurePlayerWorld({ playerId: PLAYER_ID, seed: 1, store });
    const orch = new Orchestrator(boot.state);
    const attack = orch.execute(cmd('ATTACK', {
      territoryId: 't_01',
      factionId: 'f_ai_01',
      commitAmount: 120,
      seed: 1,
    }));
    assert.strictEqual(attack.success, false);
    assert.strictEqual(attack.errors[0]?.code, ErrorCode.ACTION_NOT_ALLOWED);
    assert.strictEqual(orch.getState().territories.get('t_01')?.owner, 'f_ai_01');
  });
}
