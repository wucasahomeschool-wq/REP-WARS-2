import assert from 'assert';
import {
  COMMAND_INDEX,
  DEFAULT_PRODUCTION_WORLD_ID,
  FIXTURE_TINY_WORLD_ID,
  GAME_REWARD_CONFIG,
  GAMEPLAY_CONFIG,
  Orchestrator,
  PRODUCTION_LEVEL_1_WORLD_ID,
  PRODUCTION_WORLD_REGISTRATIONS,
  checkGameStateInvariants,
  createGameState,
  createLegacySampleMapGameState,
  createProductionWorldCatalog,
  createTelemetryRecorder,
  cityCombatModifiersEnabled,
  combatDefenseMultiplier,
  consumeEmpireFood,
  defenseWorkoutMultiplier,
  ErrorCode,
  evaluateWorldCompletion,
  ensureCity,
  foodConsumptionDisabled,
  getCurrentExercise,
  hydratePersistedPayload,
  initializePlayerWorld,
  loadProductionLevel1Definition,
  reconstructChain,
  snapshotGameState,
  validateWorldDefinition,
} from '../src';
import type { CommandRequest, Level1TutorialPublicView, WorldDefinition } from '../src';
import { MIN_ATTACKING_TROOPS } from '../src/army/strategicAttack';

export interface Level1ProductionTestApi {
  test: (name: string, fn: () => void) => void;
}

const PLAYER_ID = 'player_level1';
const PLAYER_HOME = 't_02';
const FIRST_ENEMY = 't_01';
const FINAL_ENEMY = 't_03';
const WORKOUT_ID = 'wk_moderate_full_body';

function cmd(commandId: string, parameters: Record<string, unknown> = {}, requestId?: string): CommandRequest {
  return {
    commandId,
    playerId: PLAYER_ID,
    requestId: requestId ?? `${commandId}_${PLAYER_ID}`,
    parameters,
  };
}

function requireLevel1(): WorldDefinition {
  const loaded = loadProductionLevel1Definition();
  assert.ok(loaded.ok, loaded.ok ? '' : loaded.issues.map((i) => `${i.code}: ${i.message}`).join('; '));
  return loaded.definition;
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

export function registerLevel1ProductionTests(api: Level1ProductionTestApi): void {
  const { test } = api;

  console.log('Production Level 1 world registration / vertical-slice boot');

  test('worlds/level-1.json validates and is the production default', () => {
    const def = requireLevel1();
    assert.deepStrictEqual(validateWorldDefinition(def), []);
    assert.strictEqual(def.worldId, PRODUCTION_LEVEL_1_WORLD_ID);
    assert.strictEqual(def.name, 'Level 1');
    assert.strictEqual(def.level, 1);
    assert.strictEqual(def.playerFactionId, 'f_player');
    assert.strictEqual(def.territories.length, 3);
    assert.strictEqual(def.completion.type, 'control_fraction');
    assert.strictEqual(def.completion.fraction, 1);
    assert.deepStrictEqual(def.containedWorlds, []);
    assert.strictEqual(DEFAULT_PRODUCTION_WORLD_ID, PRODUCTION_LEVEL_1_WORLD_ID);
    assert.ok(PRODUCTION_WORLD_REGISTRATIONS.some((r) => r.worldId === PRODUCTION_LEVEL_1_WORLD_ID));
    assert.ok(!PRODUCTION_WORLD_REGISTRATIONS.some((r) => r.worldId === FIXTURE_TINY_WORLD_ID));
    const productionOnly = createProductionWorldCatalog();
    assert.deepStrictEqual(productionOnly.registeredIds(), [PRODUCTION_LEVEL_1_WORLD_ID]);
    assert.strictEqual(productionOnly.load(FIXTURE_TINY_WORLD_ID).ok, false);
  });

  test('createGameState and initializePlayerWorld boot authored Level 1, not Ember Atoll', () => {
    const state = createGameState({ seed: 1 });
    assert.strictEqual(state.definitionWorldId, PRODUCTION_LEVEL_1_WORLD_ID);
    assert.strictEqual(state.worldName, 'Level 1');
    assert.strictEqual(state.worldLevel, 1);
    assert.strictEqual(state.playerFactionId, 'f_player');
    assert.deepStrictEqual(state.levelAnchorTerritoryIds, [PLAYER_HOME]);
    assert.strictEqual(state.territories.get(PLAYER_HOME)?.owner, 'f_player');
    assert.strictEqual(state.territories.get(FIRST_ENEMY)?.owner, 'f_ai_01');
    assert.strictEqual(state.territories.get(FINAL_ENEMY)?.owner, 'f_ai_01');
    assert.ok(!state.territories.has('t_04'));
    assert.ok(!state.factions.has('f_cinder_court'));
    assert.ok(!state.factions.has('f_salt_raiders'));
    assert.deepStrictEqual([...state.territories.get(PLAYER_HOME)!.neighboring].sort(), [FIRST_ENEMY, FINAL_ENEMY]);
    assert.strictEqual(state.regions.get('r_01')!.name, 'Your Territories');
    assert.strictEqual(state.levelDefeat.status, 'active');
    assert.deepStrictEqual(state.levelDefeat.previousWorldIds, []);
    for (const t of state.territories.values()) {
      assert.ok(!('polygon' in t));
      assert.ok(!('name' in t));
    }
    assert.deepStrictEqual(checkGameStateInvariants(state), []);
    const created = initializePlayerWorld({ playerId: PLAYER_ID, seed: 1 });
    assert.strictEqual(created.state.definitionWorldId, PRODUCTION_LEVEL_1_WORLD_ID);
    const completion = evaluateWorldCompletion(created.state);
    assert.ok(completion);
    assert.strictEqual(completion.complete, false);
    assert.strictEqual(completion.playerOwned, 1);
    assert.strictEqual(completion.total, 3);
  });

  test('GET_WORLD_DEFINITION and GET_FITNESS_CATALOG serve the frontend contract', () => {
    const orch = new Orchestrator(initializePlayerWorld({ playerId: PLAYER_ID, seed: 2 }).state);
    const world = orch.execute(cmd('GET_WORLD_DEFINITION'));
    assert.strictEqual(world.success, true, world.errors[0]?.message);
    const def = world.payload.worldDefinition as WorldDefinition;
    assert.strictEqual(def.worldId, PRODUCTION_LEVEL_1_WORLD_ID);
    assert.ok(def.island.rings[0]!.length >= 3);
    assert.ok(def.territories.find((t) => t.id === PLAYER_HOME)?.polygon.rings[0]!.length >= 3);
    const catalog = orch.execute(cmd('GET_FITNESS_CATALOG'));
    assert.strictEqual(catalog.success, true, catalog.errors[0]?.message);
    const workouts = catalog.payload.workouts as { id: string }[];
    assert.ok(workouts.some((w) => w.id === 'wk_very_easy_mobility'));
    assert.ok(COMMAND_INDEX.some((c) => c.commandId === 'GET_WORLD_DEFINITION'));
    assert.ok(COMMAND_INDEX.some((c) => c.commandId === 'GET_FITNESS_CATALOG'));
    const gs = orch.execute(cmd('GET_GAME_STATE'));
    const snapshot = gs.payload.gameState as {
      worldCompletion: { complete: boolean };
      playerGameplay: { activeWorkout: unknown; bankedTroops: number };
      tutorial: Level1TutorialPublicView;
    };
    assert.strictEqual(snapshot.worldCompletion.complete, false);
    assert.strictEqual(snapshot.playerGameplay.activeWorkout, null);
    assert.strictEqual(snapshot.tutorial.active, true);
    assert.strictEqual(snapshot.tutorial.beat, 'FIRST_WORKOUT_PENDING');
    assert.strictEqual(snapshot.tutorial.expectedAction, 'START_WORKOUT_NORMAL_TROOPS');
    assert.strictEqual(snapshot.tutorial.expectedPurpose, 'NORMAL_TROOPS');
    assert.strictEqual(snapshot.tutorial.expectedWorkoutId, 'wk_moderate_full_body');
    const selection = orch.execute(cmd('GET_WORKOUT_SELECTION', { purpose: 'NORMAL_TROOPS' }));
    assert.strictEqual(selection.success, true, selection.errors[0]?.message);
    assert.strictEqual(selection.payload.selectedWorkoutId, 'wk_moderate_full_body');
    assert.strictEqual((selection.payload.workout as { id: string }).id, 'wk_moderate_full_body');
    const purposeSelections = catalog.payload.purposeSelections as { purpose: string; selectedWorkoutId: string }[];
    assert.ok(purposeSelections.every((row) => typeof row.selectedWorkoutId === 'string' && row.selectedWorkoutId.length > 0));
    assert.ok(COMMAND_INDEX.some((c) => c.commandId === 'GET_WORKOUT_SELECTION'));
  });

  test('Level 1 tutorial loop uses real workout, attack, scripted invasion, defense, and completion', () => {
    const recorder = createTelemetryRecorder();
    const orch = new Orchestrator(initializePlayerWorld({ playerId: PLAYER_ID, seed: 9 }).state, undefined, recorder);

    const started = orch.execute(cmd('START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      sessionId: 'wses_l1',
      now: 1_000,
    }, 'l1_wk'));
    assert.strictEqual(started.success, true, started.errors[0]?.message);
    const mid = orch.execute(cmd('GET_GAME_STATE'));
    const midView = mid.payload.gameState as { playerGameplay: { activeWorkout: { workoutId: string; state: string } | null } };
    assert.strictEqual(midView.playerGameplay.activeWorkout?.workoutId, WORKOUT_ID);
    finishActiveWorkout(orch, 2_000);
    const feedback = orch.execute(cmd('SUBMIT_WORKOUT_FEEDBACK', { value: 'ABOUT_RIGHT', now: 20_000 }, 'l1_fb'));
    assert.strictEqual(feedback.success, true, feedback.errors[0]?.message);
    const finalized = orch.execute(cmd('FINALIZE_WORKOUT', { now: 21_000 }, 'l1_fin'));
    assert.strictEqual(finalized.success, true, finalized.errors[0]?.message);
    const troops = orch.getState().playerRewards.bankedTroops;
    assert.ok(troops > MIN_ATTACKING_TROOPS, `expected banked troops above attack floor, got ${troops}`);

    const commit = Math.min(troops, MIN_ATTACKING_TROOPS + 20);
    const firstAttack = orch.execute(cmd('ATTACK', {
      territoryId: FIRST_ENEMY,
      commitAmount: commit,
      seed: 11,
    }, 'l1_atk1'));
    assert.strictEqual(firstAttack.success, true, firstAttack.errors[0]?.message);
    assert.strictEqual(orch.getState().territories.get(FIRST_ENEMY)?.owner, 'f_player');
    assert.deepStrictEqual(orch.getState().levelAnchorTerritoryIds, [PLAYER_HOME]);
    assert.strictEqual(evaluateWorldCompletion(orch.getState())?.complete, false);
    const afterAttackTutorial = firstAttack.payload.tutorial as Level1TutorialPublicView;
    assert.strictEqual(afterAttackTutorial.beat, 'DEFENSE_PENDING');
    assert.strictEqual(afterAttackTutorial.scriptedInvasionOccurred, true);
    assert.strictEqual(afterAttackTutorial.expectedAction, 'START_WORKOUT_DEFENSE');
    assert.strictEqual(orch.getState().activeInvasions.size, 1);
    const invasionId = [...orch.getState().activeInvasions.keys()][0];
    assert.ok(invasionId);
    const invading = orch.getState().activeInvasions.get(invasionId)!;
    assert.strictEqual(invading.territoryId, FIRST_ENEMY);
    for (const armyId of invading.attackingArmyIds) {
      const army = orch.getState().armies.get(armyId);
      if (!army) continue;
      assert.strictEqual(army.soldiers + army.knights + army.siegeEngines, 8);
    }
    const defense = orch.execute(cmd('START_WORKOUT', {
      purpose: 'DEFENSE',
      invasionId,
      sessionId: 'wses_l1_def',
      now: 30_000,
    }, 'l1_def'));
    assert.strictEqual(defense.success, true, defense.errors[0]?.message);
    finishActiveWorkout(orch, 31_000);
    const defFeedback = orch.execute(cmd('SUBMIT_WORKOUT_FEEDBACK', { value: 'ABOUT_RIGHT', now: 40_000 }, 'l1_def_fb'));
    assert.strictEqual(defFeedback.success, true, defFeedback.errors[0]?.message);
    const defFinal = orch.execute(cmd('FINALIZE_WORKOUT', { now: 41_000 }, 'l1_def_fin'));
    assert.strictEqual(defFinal.success, true, defFinal.errors[0]?.message);
    assert.strictEqual(orch.getState().territories.get(FIRST_ENEMY)?.owner, 'f_player');

    const more = orch.execute(cmd('START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      sessionId: 'wses_l1_b',
      now: 50_000,
    }, 'l1_wk2'));
    assert.strictEqual(more.success, true, more.errors[0]?.message);
    finishActiveWorkout(orch, 51_000);
    orch.execute(cmd('SUBMIT_WORKOUT_FEEDBACK', { value: 'ABOUT_RIGHT', now: 60_000 }, 'l1_fb2'));
    const fin2 = orch.execute(cmd('FINALIZE_WORKOUT', { now: 61_000 }, 'l1_fin2'));
    assert.strictEqual(fin2.success, true, fin2.errors[0]?.message);
    const banked = orch.getState().playerRewards.bankedTroops;
    assert.ok(banked > MIN_ATTACKING_TROOPS, `second workout troops ${banked}`);
    const finalAttack = orch.execute(cmd('ATTACK', {
      territoryId: FINAL_ENEMY,
      commitAmount: banked,
      seed: 17,
    }, 'l1_atk2'));
    assert.strictEqual(finalAttack.success, true, finalAttack.errors[0]?.message);
    assert.strictEqual(orch.getState().territories.get(FINAL_ENEMY)?.owner, 'f_player');
    const done = evaluateWorldCompletion(orch.getState());
    assert.ok(done?.complete);
    const publicDone = orch.execute(cmd('GET_GAME_STATE')).payload.gameState as {
      worldCompletion: { complete: boolean };
      tutorial: Level1TutorialPublicView;
    };
    assert.strictEqual(publicDone.worldCompletion.complete, true);
    assert.strictEqual(publicDone.tutorial.beat, 'COMPLETE');
    assert.strictEqual(publicDone.tutorial.completed, true);
    assert.strictEqual(publicDone.tutorial.expectedWorkoutId, null);
    assert.strictEqual(publicDone.tutorial.expectedPurpose, null);
    assert.ok(finalAttack.events.some((e) => e.data?.worldProgression === 'level_completed'));
    assert.deepStrictEqual(checkGameStateInvariants(orch.getState()), []);

    const events = recorder.getEvents();
    const chain = reconstructChain(events, 'wses_l1');
    assert.ok(chain.some((e) => e.eventType === 'workout.started'));
    assert.ok(chain.some((e) => e.eventType === 'workout.fitness_result'));
    assert.ok(chain.some((e) => e.eventType === 'workout.game_reward'));
    assert.ok(events.some((e) => e.eventType === 'attack.committed'));
    assert.ok(events.some((e) => e.eventType === 'territory.conquered'));
    assert.ok(events.some((e) => e.eventType === 'invasion.started' || e.eventType === 'invasion.awaiting_defense'));
    assert.ok(events.some((e) => e.eventType === 'tutorial.beat_changed'));
    assert.ok(events.some((e) => e.eventType === 'tutorial.scripted_invasion'));
    assert.ok(events.some((e) => e.eventType === 'level.completed'));

    const reloaded = hydratePersistedPayload(snapshotGameState(orch.getState()));
    assert.strictEqual(reloaded.definitionWorldId, PRODUCTION_LEVEL_1_WORLD_ID);
    assert.strictEqual(reloaded.territories.get(FINAL_ENEMY)?.owner, 'f_player');
    assert.deepStrictEqual(reloaded.levelAnchorTerritoryIds, [PLAYER_HOME]);
    assert.strictEqual(foodConsumptionDisabled(orch.getState()), true);
    assert.strictEqual(orch.getState().cities.size, 0);
    for (const infra of orch.getState().territoryInfrastructure.values()) {
      assert.strictEqual(infra.farmCompletedAtTick, null);
      assert.strictEqual(infra.mineCompletedAtTick, null);
      assert.strictEqual(infra.lumberCompletedAtTick, null);
    }
  });

  test('GET_WORLD_DEFINITION fails closed on legacy SAMPLE_MAP instances', () => {
    const orch = new Orchestrator(createLegacySampleMapGameState({ seed: 1, playerFactionId: 'iron_kingdom' }));
    const res = orch.execute(cmd('GET_WORLD_DEFINITION'));
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errors[0]?.code, ErrorCode.INVALID_GAME_STATE);
    assert.ok(!COMMAND_INDEX.some((c) => c.commandId === 'SCOUT' || c.commandId === 'EXPAND'));
  });

  test('Level 1 authored start resources, tile output, and troop conversion stay locked', () => {
    const def = requireLevel1();
    const player = def.factions.find((faction) => faction.id === 'f_player');
    assert.ok(player);
    assert.deepStrictEqual(player.startingResources, {
      gold: 400,
      food: 400,
      iron: 80,
      wood: 80,
      stone: 80,
    });
    for (const territory of def.territories) {
      assert.deepStrictEqual(territory.resourceOutput, {
        gold: 1,
        food: 2,
        iron: 0,
        wood: 2,
        stone: 0,
      });
    }
    assert.strictEqual(GAME_REWARD_CONFIG.troopsPerPhysicalUnit, 10);
    assert.strictEqual(GAME_REWARD_CONFIG.maxTroopsPerWorkout, 10_000);
    const state = createGameState({ seed: 1 });
    assert.deepStrictEqual(
      { ...state.factions.get('f_player')!.resources },
      { gold: 400, food: 400, iron: 80, wood: 80, stone: 80 },
    );
  });

  test('Level 1 authored world gates Food consume and still advances the food clock', () => {
    const state = createGameState({ seed: 3 });
    assert.strictEqual(state.worldLevel, 1);
    assert.strictEqual(foodConsumptionDisabled(state), true);
    const player = state.factions.get('f_player')!;
    const food = player.resources.food;
    const stability = player.stability;
    state.worldTick = 120;
    const result = consumeEmpireFood(state);
    assert.strictEqual(result.gated, true);
    assert.strictEqual(result.cycles, 2);
    assert.strictEqual(result.factions.length, 0);
    assert.strictEqual(player.resources.food, food);
    assert.strictEqual(player.stability, stability);
    assert.strictEqual(state.lastFoodConsumptionTick, 120);
  });

  test('Level 1 City combat and defense-workout multipliers stay off even with a city', () => {
    const state = createGameState({ seed: 4 });
    ensureCity(state, PLAYER_HOME, 'f_player');
    state.territories.get(PLAYER_HOME)!.fortification = 5;
    assert.strictEqual(cityCombatModifiersEnabled(state), false);
    assert.strictEqual(combatDefenseMultiplier(state, PLAYER_HOME), GAMEPLAY_CONFIG.citylessCombatDefenseFactor);
    assert.strictEqual(defenseWorkoutMultiplier(state, PLAYER_HOME), GAMEPLAY_CONFIG.citylessDefenseWorkoutFactor);
  });

  test('Level 1 can afford one City and does not require developments', () => {
    const orch = new Orchestrator(initializePlayerWorld({ playerId: PLAYER_ID, seed: 5 }).state);
    const started = orch.execute(cmd('START_CONSTRUCTION', {
      territoryId: PLAYER_HOME,
      projectType: 'CITY',
      constructionId: 'con_l1_city',
    }, 'l1_city'));
    assert.strictEqual(started.success, true, started.errors[0]?.message);
    assert.strictEqual(orch.getState().factions.get('f_player')!.resources.iron, 40);
    assert.strictEqual(orch.getState().factions.get('f_player')!.resources.gold, 320);
    assert.strictEqual(orch.getState().factions.get('f_player')!.resources.stone, 40);
    for (const infra of orch.getState().territoryInfrastructure.values()) {
      assert.strictEqual(infra.farmCompletedAtTick, null);
      assert.strictEqual(infra.mineCompletedAtTick, null);
      assert.strictEqual(infra.lumberCompletedAtTick, null);
    }
  });
}
