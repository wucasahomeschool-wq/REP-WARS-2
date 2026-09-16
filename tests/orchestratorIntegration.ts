import assert from 'assert';
import {
  COMMAND_INDEX,
  ErrorCode,
  FixedWorldTimeAuthority,
  InMemoryGameStateStore,
  InMemoryWorkoutHistoryStore,
  MUTATING_HANDLERS,
  Orchestrator,
  READ_ONLY_HANDLERS,
  checkGameStateInvariants,
  cloneGameState,
  commitAuthoritativePlayerWorld,
  createGameState,
  createTelemetryRecorder,
  foodConsumptionDisabled,
  getCurrentExercise,
  hydratePersistedPayload,
  initializePlayerWorld,
  reconstructChain,
  snapshotGameState,
  syncPlayerWorld,
} from '../src';
import type { CommandRequest, TelemetryRecorder } from '../src';
import { MIN_ATTACKING_TROOPS } from '../src/army/strategicAttack';
import { emptyLevel1TutorialState } from '../src/types/GameState';
import { DEFAULT_PRODUCTION_WORLD_ID, PRODUCTION_LEVEL_1_WORLD_ID } from '../src/worldDefinition';
import { createDefaultRegistry } from '../src/orchestration';

export interface OrchestratorIntegrationTestApi {
  test: (name: string, fn: () => void) => void;
}

const PLAYER_ID = 'player_1';
const WORKOUT_ID = 'wk_moderate_full_body';
const PLAYER_HOME = 't_02';
const ENEMY_TILE = 't_01';

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
      const skipped = orch.execute(cmd('SKIP_REST', { order: step.order, now: clock }, `skip_${step.order}`));
      assert.strictEqual(skipped.success, true, skipped.errors[0]?.message);
      continue;
    }
    const parameters: Record<string, unknown> = { order: step.order, now: clock };
    if (step.prescription.kind === 'repetitions') {
      parameters.repetitions = step.prescription.repetitions;
    } else {
      parameters.durationSeconds = step.prescription.durationSeconds;
    }
    const recorded = orch.execute(cmd('RECORD_EXERCISE', parameters, `ex_${step.order}`));
    assert.strictEqual(recorded.success, true, recorded.errors[0]?.message);
  }
}

export function registerOrchestratorIntegrationTests(api: OrchestratorIntegrationTestApi): void {
  const { test } = api;

  console.log('Orchestrator integration checkpoint');

  test('command catalog matches routed handlers', () => {
    const implemented = COMMAND_INDEX.filter((c) => c.status === 'implemented');
    const unsupported = COMMAND_INDEX.filter((c) => c.status === 'unsupported');
    assert.deepStrictEqual(unsupported.map((c) => c.commandId).sort(), ['OFFER_PEACE', 'TRADE']);
    for (const def of implemented) {
      if (!def.changesState) {
        assert.ok(READ_ONLY_HANDLERS[def.commandId], `missing read handler ${def.commandId}`);
        continue;
      }
      if (def.commandId === 'SYNC_PLAYER_WORLD') continue;
      assert.ok(MUTATING_HANDLERS[def.commandId], `missing mutating handler ${def.commandId}`);
    }
    for (const id of Object.keys(MUTATING_HANDLERS)) {
      const def = COMMAND_INDEX.find((c) => c.commandId === id);
      assert.ok(def, `handler ${id} is not in COMMAND_INDEX`);
      assert.strictEqual(def!.status, 'implemented');
      assert.strictEqual(def!.changesState, true);
    }
    const sync = COMMAND_INDEX.find((c) => c.commandId === 'SYNC_PLAYER_WORLD');
    assert.ok(sync && sync.status === 'implemented' && sync.changesState);
    assert.ok(!MUTATING_HANDLERS.SYNC_PLAYER_WORLD);
  });

  test('unsupported catalog commands fail closed without mutating', () => {
    const state = createGameState({ seed: 4 });
    const before = cloneGameState(state);
    const orch = new Orchestrator(state);
    const peace = orch.execute(cmd('OFFER_PEACE', { targetFactionId: 'f_ai_01' }));
    assert.strictEqual(peace.success, false);
    assert.strictEqual(peace.errors[0]!.code, ErrorCode.FEATURE_NOT_IMPLEMENTED);
    assert.deepStrictEqual(
      orch.getState().factions.get('f_player')?.diplomacy.get('f_ai_01')?.state,
      before.factions.get('f_player')?.diplomacy.get('f_ai_01')?.state,
    );
  });

  test('Level 1 authored world boots through WorldCatalog into Orchestrator', () => {
    assert.strictEqual(DEFAULT_PRODUCTION_WORLD_ID, PRODUCTION_LEVEL_1_WORLD_ID);
    const created = initializePlayerWorld({ playerId: PLAYER_ID, seed: 5 });
    assert.strictEqual(created.state.definitionWorldId, PRODUCTION_LEVEL_1_WORLD_ID);
    assert.strictEqual(created.state.worldLevel, 1);
    assert.strictEqual(created.state.playerFactionId, 'f_player');
    assert.strictEqual(created.state.territories.get(PLAYER_HOME)?.owner, 'f_player');
    assert.strictEqual(created.state.territories.get(ENEMY_TILE)?.owner, 'f_ai_01');
    assert.ok(created.state.factions.has('f_ai_01'));
    assert.ok(!created.state.factions.has('f_cinder_court'));
    assert.deepStrictEqual(checkGameStateInvariants(created.state), []);
    const orch = new Orchestrator(created.state);
    const view = orch.execute(cmd('GET_VISIBLE_WORLD'));
    assert.strictEqual(view.success, true);
    const index = orch.execute(cmd('GET_COMMAND_INDEX'));
    assert.strictEqual(index.success, true);
  });

  test('GET commands produce no telemetry', () => {
    const recorder = createTelemetryRecorder();
    const orch = new Orchestrator(initializePlayerWorld({ playerId: PLAYER_ID, seed: 1 }).state, undefined, recorder);
    assert.strictEqual(orch.execute(cmd('GET_GAME_STATE')).success, true);
    assert.strictEqual(orch.execute(cmd('GET_VISIBLE_WORLD')).success, true);
    assert.strictEqual(orch.execute(cmd('GET_COMMAND_INDEX')).success, true);
    assert.strictEqual(orch.execute(cmd('GET_WORLD_DEFINITION')).success, true);
    assert.strictEqual(orch.execute(cmd('GET_FITNESS_CATALOG')).success, true);
    assert.strictEqual(orch.execute(cmd('GET_WORKOUT_SELECTION', { purpose: 'NORMAL_TROOPS' })).success, true);
    assert.strictEqual(recorder.getEvents().length, 0);
  });

  test('player pause freezes player-facing time while the world and AI still advance', () => {
    const orch = new Orchestrator(initializePlayerWorld({ playerId: PLAYER_ID, seed: 6 }).state);
    const paused = orch.execute(cmd('SET_PLAYER_PAUSE', { paused: true }, 'pause_on'));
    assert.strictEqual(paused.success, true, paused.errors[0]?.message);
    assert.strictEqual(orch.getState().playerEmpirePause.paused, true);
    const tick = orch.getState().worldTick;
    const advanced = orch.execute(cmd('ADVANCE_WORLD', { elapsedTicks: 12 }, 'pause_adv'));
    assert.strictEqual(advanced.success, true, advanced.errors[0]?.message);
    assert.ok(orch.getState().worldTick > tick);
    assert.strictEqual(orch.getState().playerEmpirePause.paused, true);
    assert.ok(orch.getState().factions.has('f_ai_01'));
    assert.deepStrictEqual(checkGameStateInvariants(orch.getState()), []);
    const resumed = orch.execute(cmd('SET_PLAYER_PAUSE', { paused: false }, 'pause_off'));
    assert.strictEqual(resumed.success, true, resumed.errors[0]?.message);
    assert.strictEqual(orch.getState().playerEmpirePause.paused, false);
  });

  test('vertical slice: Level 1 workout → troops → attack → persist → reload', () => {
    const store = new InMemoryGameStateStore();
    const history = new InMemoryWorkoutHistoryStore();
    const created = initializePlayerWorld({ playerId: PLAYER_ID, seed: 9, store });
    const recorder = createTelemetryRecorder();
    const registry = createDefaultRegistry();
    registry.workoutHistory = history;
    registry.timeAuthority = new FixedWorldTimeAuthority(24);
    const orch = new Orchestrator(created.state, registry, recorder);

    assert.strictEqual(orch.getState().territories.get(PLAYER_HOME)?.owner, 'f_player');
    const bankedBefore = orch.getState().playerRewards.bankedTroops;
    const homeArmy = [...orch.getState().armies.values()].find((a) => a.owner === 'f_player' && a.location === PLAYER_HOME);
    assert.ok(homeArmy);
    const uncommittedSoldiers = homeArmy.soldiers;
    const uncommittedKnights = homeArmy.knights;

    const start = orch.execute(cmd('START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      sessionId: 'wses_slice',
      now: 1_000,
    }, 'slice_start'));
    assert.strictEqual(start.success, true, start.errors[0]?.message);
    assert.strictEqual(start.payload.workoutId, WORKOUT_ID);
    finishActiveWorkout(orch);
    assert.strictEqual(orch.execute(cmd('SUBMIT_WORKOUT_FEEDBACK', { value: 'ABOUT_RIGHT', now: 40_000 }, 'slice_fb')).success, true);
    const finalized = orch.execute(cmd('FINALIZE_WORKOUT', { now: 41_000 }, 'slice_fin'));
    assert.strictEqual(finalized.success, true, finalized.errors[0]?.message);
    assert.strictEqual(finalized.payload.alreadyProcessed, false);
    assert.ok(typeof finalized.payload.applicationId === 'string');
    assert.ok(typeof finalized.payload.physicalOutput === 'number');
    const bankedAfter = orch.getState().playerRewards.bankedTroops;
    assert.ok(bankedAfter > bankedBefore, 'banked Troops must increase from the workout reward');
    assert.ok(bankedAfter > MIN_ATTACKING_TROOPS, 'Level 1 moderate workout must grant a committable troop amount');
    assert.strictEqual(orch.getState().playerRewards.appliedRewards.filter((r) => r.sessionId === 'wses_slice').length, 1);

    const again = orch.execute(cmd('FINALIZE_WORKOUT', { now: 42_000 }, 'slice_fin_dup'));
    assert.strictEqual(again.success, false);
    assert.strictEqual(orch.getState().playerRewards.bankedTroops, bankedAfter);

    const committed = MIN_ATTACKING_TROOPS + 40;
    const remaining = bankedAfter - committed;
    const attack = orch.execute(cmd('ATTACK', {
      territoryId: ENEMY_TILE,
      commitAmount: committed,
      seed: 11,
    }, 'slice_atk'));
    assert.strictEqual(attack.success, true, attack.errors[0]?.message);
    assert.strictEqual(attack.payload.committedTroops, committed);
    assert.strictEqual(orch.getState().playerRewards.bankedTroops, remaining);
    assert.strictEqual(orch.getState().armies.get(homeArmy.id)?.soldiers, uncommittedSoldiers);
    assert.strictEqual(orch.getState().armies.get(homeArmy.id)?.knights, uncommittedKnights);
    assert.strictEqual(attack.payload.attackOutcome, 'battle_resolved');
    const battle = attack.payload.battleResult as {
      winner: string;
      territoryOutcome: string;
      attacker: { casualties: { total: number } };
      defender: { casualties: { total: number } };
    };
    assert.strictEqual(battle.winner, 'attacker');
    assert.strictEqual(battle.territoryOutcome, 'captured');
    assert.strictEqual(battle.attacker.casualties.total, 0);
    assert.strictEqual(battle.defender.casualties.total, 0);
    assert.strictEqual(orch.getState().territories.get(ENEMY_TILE)?.owner, 'f_player');

    const overspend = orch.execute(cmd('ATTACK', {
      territoryId: 't_03',
      commitAmount: remaining + 1,
      seed: 12,
    }, 'slice_atk_over'));
    assert.strictEqual(overspend.success, false);
    assert.strictEqual(orch.getState().playerRewards.bankedTroops, remaining);

    const city = orch.execute(cmd('START_CONSTRUCTION', {
      territoryId: PLAYER_HOME,
      projectType: 'CITY',
      constructionId: 'con_slice_city',
    }, 'slice_city'));
    assert.strictEqual(city.success, true, city.errors[0]?.message);

    const advanced = orch.execute(cmd('ADVANCE_WORLD', { elapsedTicks: 8 }, 'slice_adv'));
    assert.strictEqual(advanced.success, true, advanced.errors[0]?.message);
    assert.ok(orch.getState().factions.has('f_ai_01'));
    assert.strictEqual(orch.getState().worldLevel, 1);
    assert.strictEqual(foodConsumptionDisabled(orch.getState()), true);
    assert.strictEqual(recorder.getEvents({ eventType: 'resource.consumed' }).length, 0);
    assert.deepStrictEqual(checkGameStateInvariants(orch.getState()), []);

    const saved = commitAuthoritativePlayerWorld({
      gameStore: store,
      historyStore: history,
      playerId: PLAYER_ID,
      expectedVersion: created.record?.stateVersion ?? 0,
      state: orch.getState(),
      telemetry: recorder,
    });
    assert.strictEqual(saved.ok, true);

    const synced = syncPlayerWorld({
      playerId: PLAYER_ID,
      requestedTick: 24,
      authority: new FixedWorldTimeAuthority(24),
      store,
      history,
      telemetry: recorder,
    });
    assert.strictEqual(synced.ok, true);
    if (!synced.ok) return;
    const reloaded = hydratePersistedPayload(snapshotGameState(synced.state));
    assert.strictEqual(reloaded.definitionWorldId, PRODUCTION_LEVEL_1_WORLD_ID);
    assert.strictEqual(reloaded.playerRewards.bankedTroops, synced.state.playerRewards.bankedTroops);
    assert.strictEqual(reloaded.territories.get(PLAYER_HOME)?.owner, 'f_player');
    assert.strictEqual(reloaded.armies.get(homeArmy.id)?.soldiers, synced.state.armies.get(homeArmy.id)?.soldiers);
    assert.deepStrictEqual(checkGameStateInvariants(reloaded), []);

    const events = recorder.getEvents();
    const workout = reconstructChain(events, 'wses_slice');
    assert.ok(workout.some((e) => e.eventType === 'workout.started'));
    assert.ok(workout.some((e) => e.eventType === 'workout.feedback_submitted'));
    assert.ok(workout.some((e) => e.eventType === 'workout.completed'));
    assert.ok(workout.some((e) => e.eventType === 'workout.fitness_result'));
    assert.ok(workout.some((e) => e.eventType === 'workout.game_reward'));
    assert.ok(workout.some((e) => e.eventType === 'workout.reward_applied' && e.payload.alreadyProcessed !== true));
    assert.ok(events.some((e) => e.eventType === 'attack.committed'));
    assert.ok(events.some((e) => e.eventType === 'battle.resolved'));
    assert.ok(events.some((e) => e.eventType === 'construction.started'));
    assert.ok(events.some((e) => e.eventType === 'world.advanced' || e.eventType === 'world.synced' || e.eventType === 'world.catch_up'));
    assert.ok(events.some((e) => e.eventType === 'persistence.saved'));
    const rewardApplied = events.filter((e) => e.eventType === 'workout.reward_applied' && e.sessionId === 'wses_slice' && e.payload.alreadyProcessed !== true);
    assert.strictEqual(rewardApplied.length, 1);
    assert.strictEqual(recorder.getEvents({ commandId: 'GET_GAME_STATE' }).length, 0);
  });

  test('analytics failure cannot fail a Level 1 ATTACK', () => {
    const state = createGameState({ seed: 2 });
    state.playerRewards.bankedTroops = 200;
    state.level1Tutorial = {
      ...emptyLevel1TutorialState(),
      beat: 'FIRST_ATTACK_AVAILABLE',
      firstWorkoutSessionId: 'wses_iso',
    };
    const throwing: TelemetryRecorder = {
      observeCommand(): void {
        throw new Error('analytics down');
      },
      observePersistence(): void {
        throw new Error('analytics down');
      },
    };
    const orch = new Orchestrator(state, undefined, throwing);
    const res = orch.execute(cmd('ATTACK', { territoryId: ENEMY_TILE, commitAmount: 120, seed: 3 }, 'iso_atk'));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
  });
}
