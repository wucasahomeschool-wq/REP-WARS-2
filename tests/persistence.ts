import assert from 'assert';
import {
  AdjustableClock,
  COMMAND_INDEX,
  ECONOMY_CONFIG,
  ErrorCode,
  FixedWorldTimeAuthority,
  GAME_STATE_PERSISTENCE_FORMAT,
  GAME_STATE_SCHEMA_VERSION,
  GAMEPLAY_CONFIG,
  InMemoryGameStateStore,
  InMemoryWorkoutHistoryStore,
  MS_PER_DAY,
  MS_PER_WEEK,
  Orchestrator,
  PersistenceError,
  SupabaseGameStateStore,
  beginWorkoutSession,
  catchUpWorld,
  checkGameStateInvariants,
  cloneGameState,
  completeExercise,
  createActiveInvasion,
  createDefaultRegistry,
  createGameState,
  createLegacySampleMapGameState,
  decodePersistable,
  defenseResponseTicks,
  defenseWorkoutMaxDurationTicks,
  encodePersistable,
  evaluateFitness,
  evaluateFitnessEvidence,
  failedDefenseContinuationTicks,
  fitnessHistoryContextFromStore,
  getCurrentExercise,
  hydratePersistedPayload,
  isDeadlineElapsed,
  jsonRoundTrip,
  migrateGameStatePayload,
  nextCatchUpElapsedTicks,
  parseElapsedTicks,
  peekCollectibleResources,
  persistTerminalSessionHistory,
  playerProtectionTicks,
  resolveAuthoritativeTargetTick,
  retryPendingWorkoutReward,
  runWorkoutRewardPipeline,
  serializeToJson,
  setPlayerEmpirePause,
  skipExercise,
  snapshotGameState,
  startConstruction,
  submitWorkoutFeedback,
  successfulDefenseRecoveryTicks,
  syncPlayerWorld,
  toWorkoutHistoryEntry,
  abandonWorkoutSession,
  finalizeCompletedWorkout,
} from '../src';
import type {
  CommandRequest,
  GameState,
  SessionOpResult,
  WorkoutDefinition,
  WorkoutPurpose,
  WorkoutSession,
} from '../src';
import { BALANCE } from '../src/constants/balance';
import { attachDefenseWorkoutToInvasion } from '../src/gameplay/invasion/session';
import { isPlayerEmpirePaused, playerFacingTick } from '../src/gameplay/invasion/eligibility';
import { plantOwnedCities, plantCity } from './worldTestHelpers';

export interface PersistenceTestApi {
  test: (name: string, fn: () => void) => void;
}

const PLAYER_ID = 'player_1';
const PLAYER_FACTION = 'iron_kingdom';
const OTHER_FACTION = 'celestial_theocracy';
const HOME = 'iron_kingdom_east';
const SPIRE = 'iron_spire';

function must<T>(result: SessionOpResult<T>, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error.code} ${result.error.message}`);
  return result.value;
}

function cmdReq(commandId: string, parameters: Record<string, unknown> = {}): CommandRequest {
  return { commandId, playerId: PLAYER_ID, requestId: `${commandId}_17l`, parameters };
}

function playerState(seed = 17): GameState {
  const state = createLegacySampleMapGameState({ seed, playerFactionId: PLAYER_FACTION });
  state.playerFitness.lastWorkoutCompletedAtTick = 0;
  return state;
}

function tinyWorkout(id = 'wk_17l_tiny'): WorkoutDefinition {
  return {
    id,
    name: '17L Tiny',
    description: 'Fixture',
    intendedDifficulty: 'MODERATE',
    exercises: [
      { exerciseId: 'ex_push_ups', order: 0, prescription: { kind: 'repetitions', repetitions: 10 }, role: 'UPPER_BODY', skippable: false },
      { exerciseId: 'ex_rest', order: 1, prescription: { kind: 'duration', durationSeconds: 15 }, role: 'REST', skippable: true },
      { exerciseId: 'ex_plank', order: 2, prescription: { kind: 'duration', durationSeconds: 20 }, role: 'CORE', skippable: false },
      { exerciseId: 'ex_squats', order: 3, prescription: { kind: 'repetitions', repetitions: 8 }, role: 'LOWER_BODY', skippable: false },
      { exerciseId: 'ex_child_pose', order: 4, prescription: { kind: 'duration', durationSeconds: 10 }, role: 'FINAL_STRETCH', skippable: false },
    ],
    metadata: {},
  };
}

function completeAll(session: WorkoutSession, clock: AdjustableClock): WorkoutSession {
  let current = session;
  while (current.state === 'ACTIVE') {
    const step = getCurrentExercise(current);
    assert.ok(step, 'expected current exercise');
    clock.advance(1_000);
    if (step.skippable && step.exerciseType === 'REST') {
      current = must(skipExercise(current, step.order, clock.now()), `skip ${step.order}`);
      continue;
    }
    if (step.prescription.kind === 'repetitions') {
      current = must(completeExercise(current, {
        order: step.order,
        repetitions: step.prescription.repetitions,
      }, clock.now()), `reps ${step.order}`);
    } else {
      current = must(completeExercise(current, {
        order: step.order,
        durationSeconds: step.prescription.durationSeconds,
      }, clock.now()), `timed ${step.order}`);
    }
  }
  return current;
}

function completedSession(purpose: WorkoutPurpose, sessionId: string, extras: {
  invasionId?: string;
  constructionId?: string;
  collectionTerritoryId?: string;
  startedAtWorldTick?: number;
  now?: number;
} = {}): WorkoutSession {
  const clock = new AdjustableClock(extras.now ?? 1_000);
  let session = must(beginWorkoutSession({
    playerId: PLAYER_ID,
    purpose,
    intendedDifficulty: 'MODERATE',
    workout: tinyWorkout(sessionId),
    sessionId,
    now: clock.now(),
    gameplayContext: {
      invasionId: extras.invasionId,
      constructionId: extras.constructionId,
      collectionTerritoryId: extras.collectionTerritoryId,
      startedAtWorldTick: extras.startedAtWorldTick ?? 0,
    },
  }), 'begin');
  session = completeAll(session, clock);
  return must(submitWorkoutFeedback(session, 'ABOUT_RIGHT', clock.now()), 'feedback');
}

function reloadRoundTrip(state: GameState): GameState {
  const store = new InMemoryGameStateStore();
  const saved = store.save(PLAYER_ID, state, 0);
  assert.ok(saved.ok, saved.ok ? '' : saved.message);
  const loaded = store.load(PLAYER_ID);
  assert.ok(loaded.ok, loaded.ok ? '' : loaded.message);
  return loaded.state;
}

function syncTo(state: GameState, target: number, extras: {
  history?: InMemoryWorkoutHistoryStore;
  store?: InMemoryGameStateStore;
} = {}) {
  const store = extras.store ?? new InMemoryGameStateStore();
  const saved = store.save(PLAYER_ID, state, 0);
  assert.ok(saved.ok);
  const beforeSaves = store.saveCount.value;
  const result = syncPlayerWorld({
    playerId: PLAYER_ID,
    requestedTick: target,
    authority: new FixedWorldTimeAuthority(target),
    store,
    history: extras.history,
  });
  assert.ok(result.ok, result.ok ? '' : result.message);
  return { result, store, savesDuringSync: store.saveCount.value - beforeSaves };
}

export function registerPersistenceTests(api: PersistenceTestApi): void {
  const { test } = api;

  console.log('Phase 17L — persistence, offline world sync & workout history');

  test('ADVANCE_WORLD remains capped at 64 ticks', () => {
    assert.throws(
      () => parseElapsedTicks({ elapsedTicks: BALANCE.world.maxElapsedTicksPerAdvance + 1 }),
      (err: unknown) => err instanceof Error && err.message.includes('elapsedTicks must be <='),
    );
    assert.strictEqual(BALANCE.world.maxElapsedTicksPerAdvance, 64);
  });

  test('SYNC_PLAYER_WORLD is catalogued and ADVANCE_WORLD is unchanged', () => {
    assert.ok(COMMAND_INDEX.some((command) => command.commandId === 'SYNC_PLAYER_WORLD'));
    const advance = COMMAND_INDEX.find((command) => command.commandId === 'ADVANCE_WORLD');
    assert.ok(advance);
    assert.strictEqual(advance!.status, 'implemented');
  });

  test('in-memory store save/load round-trips authoritative GameState', () => {
    const state = playerState();
    state.playerRewards.bankedTroops = 42;
    state.playerRewards.pendingGoldenYieldEffects.push({
      applicationId: 'app_gy',
      sessionId: 's_gy',
      workoutId: 'wk',
      playerId: PLAYER_ID,
      multiplier: 1.5,
      effect: 'ONE_TIME_COLLECTION',
      permanence: 'EPHEMERAL',
      consumed: false,
      appliedAtTick: 0,
      sourcePhysicalOutput: 10,
    });
    state.playerRewards.appliedRewards.push({
      applicationId: 'sid:TROOPS:game-reward.v1:game-reward-config.v1',
      sessionId: 'sid',
      kind: 'TROOPS',
      appliedAtTick: 0,
      result: { ok: true, alreadyApplied: false },
    });
    state.playerEmpirePause = { paused: true, pausedAtTick: 0 };
    state.attackerCooldowns.set(OTHER_FACTION, { recoveryUntilTick: 50, continuationUntilTick: null });
    state.activeInvasions.set('inv_1', createActiveInvasion({
      id: 'inv_1',
      defenderFactionId: PLAYER_FACTION,
      attackerFactionId: OTHER_FACTION,
      territoryId: HOME,
      startedAtTick: 0,
      notifiedAtTick: 0,
      responseDeadlineTick: 30,
    }));
    plantCity(state, HOME);
    startConstruction(state, { factionId: PLAYER_FACTION, territoryId: HOME, projectId: 'con_persist' });
    const loaded = reloadRoundTrip(state);
    assert.deepStrictEqual(checkGameStateInvariants(loaded), []);
    assert.strictEqual(loaded.playerRewards.bankedTroops, 42);
    assert.strictEqual(loaded.playerRewards.pendingGoldenYieldEffects[0]!.multiplier, 1.5);
    assert.strictEqual(loaded.playerRewards.appliedRewards[0]!.sessionId, 'sid');
    assert.strictEqual(loaded.playerEmpirePause.paused, true);
    assert.strictEqual(loaded.attackerCooldowns.get(OTHER_FACTION)?.recoveryUntilTick, 50);
    assert.ok(loaded.activeInvasions.has('inv_1'));
    assert.ok(loaded.constructions.has('con_persist'));
    assert.ok(loaded.armies.size > 0);
    assert.ok(loaded.cities.size > 0);
    assert.ok(loaded.territoryEconomy.size > 0);
  });

  test('JSON serialization round-trip preserves Maps and Sets', () => {
    const state = playerState();
    const encoded = snapshotGameState(state);
    const json = serializeToJson(encoded);
    const hydrated = hydratePersistedPayload(JSON.parse(json));
    assert.ok(hydrated.factions instanceof Map);
    assert.ok(hydrated.armies instanceof Map);
    const faction = hydrated.factions.get(PLAYER_FACTION)!;
    assert.ok(faction.diplomacy instanceof Map);
    assert.deepStrictEqual(checkGameStateInvariants(hydrated), []);
  });

  test('clone + persistence round-trip does not share mutable nested state', () => {
    const state = playerState();
    const loaded = reloadRoundTrip(state);
    loaded.playerRewards.bankedTroops = 99;
    loaded.factions.get(PLAYER_FACTION)!.resources.gold = 1;
    loaded.lastFoodConsumptionTick = 999;
    loaded.territoryInfrastructure.get(HOME)!.farmCompletedAtTick = 42;
    assert.notStrictEqual(state.playerRewards.bankedTroops, 99);
    assert.notStrictEqual(state.factions.get(PLAYER_FACTION)!.resources.gold, 1);
    assert.strictEqual(state.lastFoodConsumptionTick, 0);
    assert.strictEqual(state.territoryInfrastructure.get(HOME)!.farmCompletedAtTick, null);
  });

  test('stale concurrent writes are rejected', () => {
    const store = new InMemoryGameStateStore();
    const a = playerState();
    assert.ok(store.save(PLAYER_ID, a, 0).ok);
    const loaded = store.load(PLAYER_ID);
    assert.ok(loaded.ok);
    const first = cloneGameState(loaded.state);
    first.playerRewards.bankedTroops = 3;
    const second = cloneGameState(loaded.state);
    second.playerRewards.bankedTroops = 9;
    const saveA = store.save(PLAYER_ID, first, loaded.record.stateVersion);
    assert.ok(saveA.ok);
    const saveB = store.save(PLAYER_ID, second, loaded.record.stateVersion);
    assert.strictEqual(saveB.ok, false);
    if (!saveB.ok) {
      assert.strictEqual(saveB.code, 'persistence.conflict');
      assert.strictEqual(saveB.persisted, false);
    }
    const latest = store.load(PLAYER_ID);
    assert.ok(latest.ok);
    assert.strictEqual(latest.state.playerRewards.bankedTroops, 3);
  });

  test('replace is the same optimistic snapshot write as save', () => {
    const store = new InMemoryGameStateStore();
    const state = playerState();
    assert.ok(store.save(PLAYER_ID, state, 0).ok);
    state.playerRewards.bankedTroops = 7;
    const replaced = store.replace(PLAYER_ID, state, 1);
    assert.ok(replaced.ok);
    assert.strictEqual(replaced.record.stateVersion, 2);
  });

  test('transaction mutates then persists atomically from the store\'s view', () => {
    const store = new InMemoryGameStateStore();
    assert.ok(store.save(PLAYER_ID, playerState(), 0).ok);
    const result = store.transaction(PLAYER_ID, (draft) => {
      draft.playerRewards.bankedTroops = 12;
    });
    assert.ok(result.ok, result.ok ? '' : result.message);
    const loaded = store.load(PLAYER_ID);
    assert.ok(loaded.ok);
    assert.strictEqual(loaded.state.playerRewards.bankedTroops, 12);
  });

  test('invalid GameState is rejected on save and does not become a stored row', () => {
    const store = new InMemoryGameStateStore();
    const state = playerState();
    (state as unknown as { worldTick: number }).worldTick = -4;
    const saved = store.save(PLAYER_ID, state, 0);
    assert.strictEqual(saved.ok, false);
    if (!saved.ok) assert.strictEqual(saved.code, 'persistence.invalid_state');
    const loaded = store.load(PLAYER_ID);
    assert.strictEqual(loaded.ok, false);
    if (!loaded.ok) assert.strictEqual(loaded.code, 'persistence.not_found');
  });

  test('corrupt persisted payload cannot start gameplay', () => {
    const store = new InMemoryGameStateStore();
    store.putRaw({
      formatVersion: GAME_STATE_PERSISTENCE_FORMAT,
      playerId: PLAYER_ID,
      worldId: 'local',
      schemaVersion: 8,
      worldTick: 0,
      stateVersion: 1,
      payload: { not: 'a GameState' },
    });
    const loaded = store.load(PLAYER_ID);
    assert.strictEqual(loaded.ok, false);
    if (!loaded.ok) {
      assert.ok(loaded.code === 'persistence.corrupt' || loaded.code === 'persistence.unsupported_schema');
    }
  });

  test('unsupported old schema versions are rejected', () => {
    const store = new InMemoryGameStateStore();
    store.putRaw({
      formatVersion: GAME_STATE_PERSISTENCE_FORMAT,
      playerId: PLAYER_ID,
      worldId: 'local',
      schemaVersion: 4,
      worldTick: 0,
      stateVersion: 1,
      payload: encodePersistable({ schemaVersion: 4, worldTick: 0 }),
    });
    const loaded = store.load(PLAYER_ID);
    assert.strictEqual(loaded.ok, false);
    if (!loaded.ok) assert.strictEqual(loaded.code, 'persistence.unsupported_schema');
  });

  test('schema 5 snapshots migrate to current schema', () => {
    const state = playerState();
    const decoded = decodePersistable(snapshotGameState(state)) as Record<string, unknown>;
    delete decoded.cities;
    delete decoded.territoryEconomy;
    delete decoded.territoryInfrastructure;
    delete decoded.lastFoodConsumptionTick;
    delete decoded.constructions;
    delete decoded.playerFitness;
    delete decoded.playerEmpirePause;
    delete decoded.attackerCooldowns;
    decoded.schemaVersion = 5;
    const store = new InMemoryGameStateStore();
    store.putRaw({
      formatVersion: GAME_STATE_PERSISTENCE_FORMAT,
      playerId: PLAYER_ID,
      worldId: 'local',
      schemaVersion: 5,
      worldTick: 0,
      stateVersion: 1,
      payload: encodePersistable(decoded),
    });
    const loaded = store.load(PLAYER_ID);
    assert.ok(loaded.ok, loaded.ok ? '' : loaded.message);
    assert.strictEqual(loaded.state.schemaVersion, GAME_STATE_SCHEMA_VERSION);
    assert.ok(loaded.state.cities instanceof Map);
    assert.ok(loaded.state.playerFitness);
    assert.strictEqual(loaded.state.lastFoodConsumptionTick, loaded.state.worldTick);
    assert.ok(loaded.state.territoryInfrastructure instanceof Map);
  });

  test('schema 6 and 7 snapshots migrate invasion and construction stamps', () => {
    const state = playerState();
    state.activeInvasions.set('inv_old', {
      ...createActiveInvasion({
        id: 'inv_old',
        defenderFactionId: PLAYER_FACTION,
        attackerFactionId: OTHER_FACTION,
        territoryId: HOME,
        startedAtTick: 10,
        notifiedAtTick: 10,
        responseDeadlineTick: 40,
      }),
      status: 'pending_response',
    });
    plantCity(state, HOME);
    startConstruction(state, { factionId: PLAYER_FACTION, territoryId: HOME, projectId: 'con_old' });
    const decoded = decodePersistable(snapshotGameState(state)) as Record<string, unknown>;
    decoded.schemaVersion = 6;
    const invasions = decoded.activeInvasions as Map<string, Record<string, unknown>>;
    const inv = invasions.get('inv_old')!;
    inv.status = 'active';
    delete inv.defenseCompletionDeadlineTick;
    delete inv.defenseSessionId;
    const constructions = decoded.constructions as Map<string, Record<string, unknown>>;
    delete constructions.get('con_old')!.lastProgressTick;
    const migrated = migrateGameStatePayload(decoded);
    const invasions2 = migrated.activeInvasions as Map<string, Record<string, unknown>>;
    assert.strictEqual(invasions2.get('inv_old')!.status, 'pending_response');
    assert.strictEqual(invasions2.get('inv_old')!.defenseCompletionDeadlineTick, null);
    const constructions2 = migrated.constructions as Map<string, Record<string, unknown>>;
    assert.strictEqual(constructions2.get('con_old')!.lastProgressTick, 0);
    decoded.schemaVersion = 7;
    const migrated7 = migrateGameStatePayload(decoded);
    assert.strictEqual(migrated7.schemaVersion, GAME_STATE_SCHEMA_VERSION);
  });

  test('schema 10 snapshots migrate to schema 11 food clock and empty infrastructure', () => {
    const state = playerState();
    state.worldTick = 40;
    state.lastFoodConsumptionTick = 40;
    const decoded = decodePersistable(snapshotGameState(state)) as Record<string, unknown>;
    delete decoded.lastFoodConsumptionTick;
    delete decoded.territoryInfrastructure;
    decoded.schemaVersion = 10;
    const store = new InMemoryGameStateStore();
    store.putRaw({
      formatVersion: GAME_STATE_PERSISTENCE_FORMAT,
      playerId: PLAYER_ID,
      worldId: 'local',
      schemaVersion: 10,
      worldTick: 40,
      stateVersion: 1,
      payload: encodePersistable(decoded),
    });
    const loaded = store.load(PLAYER_ID);
    assert.ok(loaded.ok, loaded.ok ? '' : loaded.message);
    assert.strictEqual(loaded.state.schemaVersion, GAME_STATE_SCHEMA_VERSION);
    assert.strictEqual(GAME_STATE_SCHEMA_VERSION, 12);
    assert.strictEqual(loaded.state.lastFoodConsumptionTick, 40);
    assert.ok(loaded.state.territoryInfrastructure instanceof Map);
    assert.strictEqual(loaded.state.territoryInfrastructure.size, 0);
    assert.deepStrictEqual(checkGameStateInvariants(loaded.state), []);
  });

  test('schema 11 round-trips food clock, developments, construction stamps, and stability', () => {
    const state = playerState();
    state.worldTick = 90;
    state.lastFoodConsumptionTick = 60;
    state.factions.get(PLAYER_FACTION)!.stability = 64;
    state.factions.get(PLAYER_FACTION)!.resources.food = 321;
    const home = state.territories.get(HOME)!;
    home.resourceOutput = { ...home.resourceOutput, food: 9, gold: 3 };
    const infra = state.territoryInfrastructure.get(HOME)!;
    infra.farmCompletedAtTick = 12;
    infra.mineCompletedAtTick = 18;
    infra.lumberCompletedAtTick = null;
    startConstruction(state, {
      factionId: PLAYER_FACTION,
      territoryId: SPIRE,
      projectType: 'FARM',
      projectId: 'con_farm_rt',
    });
    const project = state.constructions.get('con_farm_rt')!;
    project.lastProgressTick = 90;
    project.remainingTicks = 7;
    const loaded = reloadRoundTrip(state);
    assert.strictEqual(loaded.schemaVersion, 12);
    assert.strictEqual(loaded.lastFoodConsumptionTick, 60);
    assert.strictEqual(loaded.factions.get(PLAYER_FACTION)!.stability, 64);
    assert.strictEqual(loaded.factions.get(PLAYER_FACTION)!.resources.food, 321);
    assert.strictEqual(loaded.territories.get(HOME)!.resourceOutput.food, 9);
    assert.strictEqual(loaded.territoryInfrastructure.get(HOME)!.farmCompletedAtTick, 12);
    assert.strictEqual(loaded.territoryInfrastructure.get(HOME)!.mineCompletedAtTick, 18);
    assert.strictEqual(loaded.territoryInfrastructure.get(HOME)!.lumberCompletedAtTick, null);
    const farm = loaded.constructions.get('con_farm_rt')!;
    assert.strictEqual(farm.projectType, 'FARM');
    assert.strictEqual(farm.lastProgressTick, 90);
    assert.strictEqual(farm.remainingTicks, 7);
    assert.strictEqual(farm.status, 'in_progress');
  });

  test('migrate coerces incomplete infrastructure stamps to null and keeps FARM projects', () => {
    const state = playerState();
    startConstruction(state, {
      factionId: PLAYER_FACTION,
      territoryId: HOME,
      projectType: 'FARM',
      projectId: 'con_farm_mig',
    });
    const decoded = decodePersistable(snapshotGameState(state)) as Record<string, unknown>;
    decoded.schemaVersion = 10;
    const infra = decoded.territoryInfrastructure as Map<string, Record<string, unknown>>;
    infra.set(HOME, { territoryId: HOME, farmCompletedAtTick: 'soon' });
    const constructions = decoded.constructions as Map<string, Record<string, unknown>>;
    constructions.set('con_road_legacy', {
      ...constructions.get('con_farm_mig')!,
      id: 'con_road_legacy',
      projectType: 'ROAD',
    });
    const migrated = migrateGameStatePayload(decoded);
    const nextInfra = migrated.territoryInfrastructure as Map<string, Record<string, unknown>>;
    assert.strictEqual(nextInfra.get(HOME)!.farmCompletedAtTick, null);
    assert.strictEqual(nextInfra.get(HOME)!.mineCompletedAtTick, null);
    assert.strictEqual(nextInfra.get(HOME)!.lumberCompletedAtTick, null);
    const nextProjects = migrated.constructions as Map<string, Record<string, unknown>>;
    assert.strictEqual(nextProjects.get('con_farm_mig')!.projectType, 'FARM');
    assert.strictEqual(nextProjects.get('con_road_legacy')!.projectType, 'FORTIFICATION');
  });

  test('Level 1 catch-up advances the food clock without debiting Food or Stability', () => {
    const state = playerState();
    assert.strictEqual(state.worldLevel, 1);
    const { result } = syncTo(state, 120);
    assert.strictEqual(result.state.worldTick, 120);
    assert.strictEqual(result.state.lastFoodConsumptionTick, 120);
    assert.strictEqual(result.catchUp.foodConsumption.gated, true);
    assert.ok(result.catchUp.foodConsumption.cycles >= 1);
    assert.strictEqual(result.catchUp.foodConsumption.factions.length, 0);
  });

  test('ungated catch-up consumes Food by cycle stamps and does not double-charge on a second sync', () => {
    const state = playerState();
    state.worldLevel = 2;
    const player = state.factions.get(PLAYER_FACTION)!;
    player.resources.food = 50_000;
    const store = new InMemoryGameStateStore();
    const { result } = syncTo(state, ECONOMY_CONFIG.ticksPerProductionCycle, { store });
    assert.strictEqual(result.state.worldTick, 60);
    assert.strictEqual(result.state.lastFoodConsumptionTick, 60);
    assert.strictEqual(result.catchUp.foodConsumption.gated, false);
    assert.ok(result.catchUp.foodConsumption.cycles >= 1);
    const foodRow = result.catchUp.foodConsumption.factions.find((row) => row.factionId === PLAYER_FACTION);
    assert.ok(foodRow);
    assert.ok(foodRow!.paid > 0 || foodRow!.failedCycles > 0);
    const afterFirst = result.state.factions.get(PLAYER_FACTION)!.resources.food;
    const second = syncPlayerWorld({
      playerId: PLAYER_ID,
      requestedTick: 60,
      authority: new FixedWorldTimeAuthority(60),
      store,
    });
    assert.ok(second.ok, second.ok ? '' : second.message);
    assert.strictEqual(second.catchUp.ticksAdvanced, 0);
    assert.strictEqual(second.state.lastFoodConsumptionTick, 60);
    assert.strictEqual(second.state.factions.get(PLAYER_FACTION)!.resources.food, afterFirst);
  });

  test('offline catch-up completes Farm construction by world-tick stamps', () => {
    const state = playerState();
    startConstruction(state, {
      factionId: PLAYER_FACTION,
      territoryId: HOME,
      projectType: 'FARM',
      projectId: 'con_farm_catchup',
    });
    assert.strictEqual(state.territoryInfrastructure.get(HOME)!.farmCompletedAtTick, null);
    const { result } = syncTo(state, GAMEPLAY_CONFIG.farmConstructionDurationTicks);
    const project = result.state.constructions.get('con_farm_catchup')!;
    assert.strictEqual(project.status, 'completed');
    assert.strictEqual(project.remainingTicks, 0);
    assert.strictEqual(
      result.state.territoryInfrastructure.get(HOME)!.farmCompletedAtTick,
      GAMEPLAY_CONFIG.farmConstructionDurationTicks,
    );
  });

  test('Fitness estimate and pending reward survive reload', () => {
    const state = playerState();
    const session = completedSession('NORMAL_TROOPS', 'wses_reload_pending');
    state.playerFactionId = null;
    const failed = runWorkoutRewardPipeline(state, session, PLAYER_ID);
    assert.strictEqual(failed.ok, false);
    assert.ok(state.playerFitness.pendingReward);
    state.playerFactionId = PLAYER_FACTION;
    const loaded = reloadRoundTrip(state);
    assert.ok(loaded.playerFitness.pendingReward);
    assert.strictEqual(loaded.playerFitness.pendingReward!.sessionId, 'wses_reload_pending');
    assert.ok(loaded.playerFitness.activeSession);
  });

  test('pending reward retries exactly once after reload', () => {
    const history = new InMemoryWorkoutHistoryStore();
    const state = playerState();
    const session = completedSession('NORMAL_TROOPS', 'wses_retry_pending');
    state.playerFactionId = null;
    runWorkoutRewardPipeline(state, session, PLAYER_ID, { history });
    assert.ok(state.playerFitness.pendingReward);
    const loaded = reloadRoundTrip(state);
    loaded.playerFactionId = PLAYER_FACTION;
    const first = retryPendingWorkoutReward(loaded, PLAYER_ID, { history });
    assert.ok(first && first.ok);
    const troops = loaded.playerRewards.bankedTroops;
    const second = retryPendingWorkoutReward(loaded, PLAYER_ID, { history });
    assert.ok(second === null || second.alreadyProcessed || second.ok);
    const third = runWorkoutRewardPipeline(loaded, loaded.playerFitness.activeSession ?? session, PLAYER_ID, { history });
    assert.ok(third.alreadyProcessed || third.ok);
    assert.strictEqual(loaded.playerRewards.bankedTroops, troops);
    assert.strictEqual(loaded.playerRewards.appliedRewards.filter((row) => row.sessionId === 'wses_retry_pending').length, 1);
    assert.strictEqual(history.recentCompleted(PLAYER_ID).filter((row) => row.sessionId === 'wses_retry_pending').length, 1);
  });

  test('offline catch-up of 1, 60, and 1440 ticks updates worldTick once persisted', () => {
    for (const ticks of [1, 60, 1440]) {
      const { result, savesDuringSync } = syncTo(playerState(ticks), ticks);
      assert.strictEqual(result.state.worldTick, ticks);
      assert.strictEqual(savesDuringSync, 1);
      assert.deepStrictEqual(checkGameStateInvariants(result.state), []);
    }
  });

  test('three-day and week-long catch-up persist once', () => {
    const days3 = 3 * 1440;
    const week = 7 * 1440;
    const paused = playerState(3);
    setPlayerEmpirePause(paused, true);
    const a = syncTo(paused, days3);
    assert.strictEqual(a.result.state.worldTick, days3);
    assert.strictEqual(a.savesDuringSync, 1);
    const pausedWeek = playerState(7);
    setPlayerEmpirePause(pausedWeek, true);
    const b = syncTo(pausedWeek, week);
    assert.strictEqual(b.result.state.worldTick, week);
    assert.strictEqual(b.savesDuringSync, 1);
  });

  test('several weeks of catch-up does not write per tick', () => {
    const weeks = 2 * 7 * 1440;
    const state = playerState(21);
    setPlayerEmpirePause(state, true);
    const { result, savesDuringSync } = syncTo(state, weeks);
    assert.strictEqual(result.state.worldTick, weeks);
    assert.ok(savesDuringSync === 1);
    assert.ok(result.catchUp.chunks < weeks);
  });

  test('catch-up of 100 ticks matches the same ADVANCE_WORLD chunks', () => {
    const a = playerState(100);
    const b = cloneGameState(a);
    const { result } = syncTo(a, 100);
    const orch = new Orchestrator(b);
    const first = orch.execute(cmdReq('ADVANCE_WORLD', { elapsedTicks: 64 }));
    assert.strictEqual(first.success, true, first.errors[0]?.message);
    const second = orch.execute(cmdReq('ADVANCE_WORLD', { elapsedTicks: 36 }));
    assert.strictEqual(second.success, true, second.errors[0]?.message);
    assert.strictEqual(result.state.worldTick, orch.getState().worldTick);
    assert.strictEqual(result.state.turn, orch.getState().turn);
    assert.deepStrictEqual(
      [...result.state.territories.entries()].map(([id, t]) => [id, t.owner]),
      [...orch.getState().territories.entries()].map(([id, t]) => [id, t.owner]),
    );
    const homeA = peekCollectibleResources(result.state, SPIRE);
    const homeB = peekCollectibleResources(orch.getState(), SPIRE);
    assert.deepStrictEqual(homeA, homeB);
  });

  test('single-chunk catch-up matches one ADVANCE_WORLD of the same length', () => {
    const a = playerState(40);
    const b = cloneGameState(a);
    const { result } = syncTo(a, 40);
    const orch = new Orchestrator(b);
    const res = orch.execute(cmdReq('ADVANCE_WORLD', { elapsedTicks: 40 }));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    assert.strictEqual(result.state.worldTick, 40);
    assert.deepStrictEqual(
      peekCollectibleResources(result.state, SPIRE),
      peekCollectibleResources(orch.getState(), SPIRE),
    );
  });

  test('catch-up chunking snaps to invasion expiry rather than jumping 64 ticks past it', () => {
    const state = playerState();
    state.worldTick = 100;
    state.activeInvasions.set('inv_offline', createActiveInvasion({
      id: 'inv_offline',
      defenderFactionId: PLAYER_FACTION,
      attackerFactionId: OTHER_FACTION,
      territoryId: HOME,
      startedAtTick: 100,
      notifiedAtTick: 100,
      responseDeadlineTick: 130,
    }));
    assert.strictEqual(nextCatchUpElapsedTicks(state, 200), 31);
  });

  test('response deadline crossed offline resolves and does not refresh the window', () => {
    const state = playerState();
    state.worldTick = 100;
    state.activeInvasions.set('inv_late', createActiveInvasion({
      id: 'inv_late',
      defenderFactionId: PLAYER_FACTION,
      attackerFactionId: OTHER_FACTION,
      territoryId: HOME,
      startedAtTick: 100,
      notifiedAtTick: 100,
      responseDeadlineTick: 130,
    }));
    const { result } = syncTo(state, 200);
    assert.strictEqual(result.state.activeInvasions.has('inv_late'), false);
    const registry = createDefaultRegistry();
    registry.timeAuthority = new FixedWorldTimeAuthority(200);
    const orch = new Orchestrator(result.state, registry);
    const start = orch.execute(cmdReq('START_WORKOUT', {
      purpose: 'DEFENSE',
      workoutId: 'wk_moderate_full_body',
      invasionId: 'inv_late',
    }));
    assert.strictEqual(start.success, false);
  });

  test('started defense timeout crossed offline cannot later generate defense power', () => {
    const state = playerState();
    state.worldTick = 120;
    const invasion = createActiveInvasion({
      id: 'inv_def',
      defenderFactionId: PLAYER_FACTION,
      attackerFactionId: OTHER_FACTION,
      territoryId: HOME,
      startedAtTick: 100,
      notifiedAtTick: 100,
      responseDeadlineTick: 130,
    });
    state.activeInvasions.set('inv_def', invasion);
    attachDefenseWorkoutToInvasion(state, 'inv_def', 'wses_def_offline', 120);
    assert.strictEqual(state.activeInvasions.get('inv_def')!.defenseCompletionDeadlineTick, 120 + defenseWorkoutMaxDurationTicks());
    const session = completedSession('DEFENSE', 'wses_def_offline', { invasionId: 'inv_def', startedAtWorldTick: 120 });
    state.playerFitness.activeSession = session;
    const { result } = syncTo(state, 900);
    assert.strictEqual(result.state.activeInvasions.has('inv_def'), false);
    const applied = runWorkoutRewardPipeline(result.state, session, PLAYER_ID);
    assert.strictEqual(applied.ok, false);
  });

  test('paused player facing clocks do not expire during offline catch-up', () => {
    const state = playerState();
    state.worldTick = 100;
    setPlayerEmpirePause(state, true);
    state.activeInvasions.set('inv_pause', createActiveInvasion({
      id: 'inv_pause',
      defenderFactionId: PLAYER_FACTION,
      attackerFactionId: OTHER_FACTION,
      territoryId: HOME,
      startedAtTick: 100,
      notifiedAtTick: 100,
      responseDeadlineTick: 130,
    }));
    const { result } = syncTo(state, 10_000);
    assert.strictEqual(result.state.worldTick, 10_000);
    assert.ok(isPlayerEmpirePaused(result.state));
    assert.strictEqual(playerFacingTick(result.state), 100);
    assert.ok(result.state.activeInvasions.has('inv_pause'));
    assert.strictEqual(isDeadlineElapsed(playerFacingTick(result.state), 130), false);
  });

  test('player protection elapses across offline catch-up', () => {
    const state = playerState();
    state.playerFitness.lastWorkoutCompletedAtTick = 0;
    const { result } = syncTo(state, playerProtectionTicks() + 5);
    assert.ok(result.state.worldTick > playerProtectionTicks());
    assert.ok(result.state.worldTick >= playerProtectionTicks() + 5);
  });

  test('successful-defense recovery and failed-defense continuation survive reload and catch-up', () => {
    const state = playerState();
    state.worldTick = 50;
    state.attackerCooldowns.set(OTHER_FACTION, {
      recoveryUntilTick: 50 + successfulDefenseRecoveryTicks(),
      continuationUntilTick: null,
    });
    const loaded = reloadRoundTrip(state);
    assert.strictEqual(loaded.attackerCooldowns.get(OTHER_FACTION)?.recoveryUntilTick, 50 + successfulDefenseRecoveryTicks());
    loaded.attackerCooldowns.set(OTHER_FACTION, {
      recoveryUntilTick: null,
      continuationUntilTick: 50 + failedDefenseContinuationTicks(),
    });
    const { result } = syncTo(loaded, 50 + failedDefenseContinuationTicks() + 1);
    const until = result.state.attackerCooldowns.get(OTHER_FACTION)?.continuationUntilTick;
    assert.ok(until === null || result.state.worldTick >= until);
  });

  test('economy and construction progress across a long offline catch-up without double-counting', () => {
    const state = playerState();
    plantCity(state, HOME);
    startConstruction(state, { factionId: PLAYER_FACTION, territoryId: HOME, projectId: 'con_long' });
    const project = state.constructions.get('con_long')!;
    project.durationTicks = 1440;
    project.remainingTicks = 1440;
    const goldBefore = peekCollectibleResources(state, SPIRE).gold;
    const { result } = syncTo(state, 2000);
    const done = result.state.constructions.get('con_long')!;
    assert.strictEqual(done.status, 'completed');
    assert.ok(done.completedAtTick !== null && done.completedAtTick <= 2000);
    assert.strictEqual(done.remainingTicks, 0);
    const goldAfter = peekCollectibleResources(result.state, SPIRE).gold;
    assert.ok(goldAfter >= goldBefore);
    const rec = result.state.territoryEconomy.get(SPIRE)!;
    assert.strictEqual(rec.lastAccrualTick, 2000);
  });

  test('worker acceleration after catch-up still uses progress-to-now then lastProgressTick = now', () => {
    const state = playerState();
    plantCity(state, HOME);
    startConstruction(state, { factionId: PLAYER_FACTION, territoryId: HOME, projectId: 'con_acc' });
    const { result } = syncTo(state, 5);
    const remainingAfterCatchUp = result.state.constructions.get('con_acc')!.remainingTicks;
    assert.strictEqual(remainingAfterCatchUp, GAMEPLAY_CONFIG.defaultConstructionDurationTicks - 5);
    assert.strictEqual(result.state.constructions.get('con_acc')!.lastProgressTick, 5);
    result.state.playerRewards.pendingConstructionEffects.push({
      applicationId: 'app_w',
      sessionId: 's_w',
      workoutId: 'wk',
      playerId: PLAYER_ID,
      workerPower: 5,
      permanence: 'TEMPORARY_ACCELERATION',
      appliedAtTick: 5,
      sourcePhysicalOutput: 5,
    });
    const orch = new Orchestrator(result.state);
    orch.execute(cmdReq('APPLY_CONSTRUCTION_ACCELERATION', { constructionId: 'con_acc' }));
    const project = orch.getState().constructions.get('con_acc')!;
    assert.strictEqual(project.lastProgressTick, 5);
    assert.strictEqual(project.remainingTicks, remainingAfterCatchUp - 5);
  });

  test('AI continues during unpaused catch-up', () => {
    const state = playerState(9);
    const { result } = syncTo(state, 60);
    assert.ok(result.catchUp.ticksAdvanced === 60);
    assert.ok(result.state.turn > 0 || result.state.worldTick === 60);
  });

  test('completed and abandoned workouts persist distinctly', () => {
    const history = new InMemoryWorkoutHistoryStore();
    const state = playerState();
    const completed = completedSession('NORMAL_TROOPS', 'wses_hist_ok');
    const ok = runWorkoutRewardPipeline(state, completed, PLAYER_ID, { history });
    assert.ok(ok.ok);
    const clock = new AdjustableClock(50_000);
    let abandoned = must(beginWorkoutSession({
      playerId: PLAYER_ID,
      purpose: 'NORMAL_TROOPS',
      intendedDifficulty: 'MODERATE',
      workout: tinyWorkout('wses_hist_ab'),
      sessionId: 'wses_hist_ab',
      now: clock.now(),
    }), 'begin ab');
    abandoned = must(abandonWorkoutSession(abandoned, clock.now(), 'PLAYER'), 'abandon');
    persistTerminalSessionHistory(history, abandoned, { completedAtWorldTick: 0 });
    const recent = history.recentCompleted(PLAYER_ID);
    assert.ok(recent.some((row) => row.sessionId === 'wses_hist_ok'));
    assert.ok(!recent.some((row) => row.sessionId === 'wses_hist_ab'));
    const abandonedRow = history.get(PLAYER_ID, 'wses_hist_ab');
    assert.ok(abandonedRow);
    assert.strictEqual(abandonedRow!.completionState, 'ABANDONED');
    assert.strictEqual(abandonedRow!.eligibleForFitnessEvaluation, false);
    const completedRow = history.get(PLAYER_ID, 'wses_hist_ok');
    assert.ok(completedRow);
    assert.strictEqual(completedRow!.purpose, 'NORMAL_TROOPS');
    assert.ok(completedRow!.feedback);
    assert.ok(completedRow!.performances.length > 0);
    assert.ok(completedRow!.evidence);
    assert.ok(completedRow!.summary);
  });

  test('defense workouts remain fitness-eligible history', () => {
    const history = new InMemoryWorkoutHistoryStore();
    const state = playerState();
    state.activeInvasions.set('inv_hist', createActiveInvasion({
      id: 'inv_hist',
      defenderFactionId: PLAYER_FACTION,
      attackerFactionId: OTHER_FACTION,
      territoryId: HOME,
      startedAtTick: 0,
      notifiedAtTick: 0,
      responseDeadlineTick: 30,
    }));
    const session = completedSession('DEFENSE', 'wses_def_hist', { invasionId: 'inv_hist' });
    const result = runWorkoutRewardPipeline(state, session, PLAYER_ID, { history });
    assert.ok(result.ok);
    const row = history.get(PLAYER_ID, 'wses_def_hist');
    assert.ok(row);
    assert.strictEqual(row!.purpose, 'DEFENSE');
    assert.strictEqual(row!.eligibleForFitnessEvaluation, true);
    assert.ok(row!.evidence);
    assert.strictEqual(row!.rewardKind, 'DEFENSE_MOBILIZATION');
  });

  test('history queries support recency windows and same-exercise lookup', () => {
    const history = new InMemoryWorkoutHistoryStore();
    const now = 30 * MS_PER_DAY;
    for (let i = 0; i < 3; i++) {
      const session = completedSession('NORMAL_TROOPS', `wses_q_${i}`, { now: now - i * MS_PER_DAY });
      const state = playerState();
      runWorkoutRewardPipeline(state, session, PLAYER_ID, { history });
    }
    const day = history.completedSince(PLAYER_ID, now - MS_PER_DAY, { before: now + 1 });
    const week = history.completedSince(PLAYER_ID, now - MS_PER_WEEK);
    assert.ok(day.length >= 1);
    assert.ok(week.length >= 3);
    const same = history.sameExercisePrior(PLAYER_ID, { exerciseId: 'ex_push_ups', before: now + 1 });
    assert.ok(same.length >= 1);
    same.forEach((row) => assert.ok(row.exerciseIds.includes('ex_push_ups')));
  });

  test('durable history populates FitnessHistoryContext without changing 17D equations', () => {
    const history = new InMemoryWorkoutHistoryStore();
    const firstState = playerState();
    const first = completedSession('NORMAL_TROOPS', 'wses_fit_1', { now: 10_000 });
    assert.ok(runWorkoutRewardPipeline(firstState, first, PLAYER_ID, { history }).ok);
    const second = completedSession('NORMAL_TROOPS', 'wses_fit_2', { now: 20_000 });
    const evidence = evaluateFitnessEvidence(must(finalizeCompletedWorkout(second), 'finalize'));
    assert.ok(evidence.ok);
    const ctx = fitnessHistoryContextFromStore(history, PLAYER_ID, evidence.value.completedAt, second.sessionId);
    assert.ok((ctx.priorEvidence ?? []).length >= 1);
    const evaluated = evaluateFitness({
      previousEstimate: firstState.playerFitness.estimate,
      currentEvidence: evidence.value,
      historicalContext: ctx,
    });
    assert.ok(evaluated.ok);
    assert.strictEqual(evaluated.value.frequency.available, true);
    assert.ok((evaluated.value.frequency.workoutsLastMonth ?? 0) >= 1);
  });

  test('duplicate finalize after reload does not duplicate history or rewards', () => {
    const history = new InMemoryWorkoutHistoryStore();
    const state = playerState();
    const session = completedSession('NORMAL_TROOPS', 'wses_dup');
    assert.ok(runWorkoutRewardPipeline(state, session, PLAYER_ID, { history }).ok);
    const troops = state.playerRewards.bankedTroops;
    const loaded = reloadRoundTrip(state);
    const again = runWorkoutRewardPipeline(loaded, session, PLAYER_ID, { history });
    assert.ok(again.ok);
    assert.ok(again.alreadyProcessed);
    assert.strictEqual(loaded.playerRewards.bankedTroops, troops);
    assert.strictEqual(loaded.playerRewards.appliedRewards.filter((row) => row.sessionId === 'wses_dup').length, 1);
    assert.strictEqual(history.recentCompleted(PLAYER_ID).filter((row) => row.sessionId === 'wses_dup').length, 1);
  });

  test('authoritative clock rejects a client-chosen future tick', () => {
    const err = (() => {
      try {
        resolveAuthoritativeTargetTick({
          authority: new FixedWorldTimeAuthority(100),
          requestedTick: 10_000_000,
          currentTick: 0,
        });
        return null;
      } catch (caught) {
        return caught;
      }
    })();
    assert.ok(err instanceof PersistenceError);
    assert.strictEqual((err as PersistenceError).code, 'persistence.time_unauthorized');
    const store = new InMemoryGameStateStore();
    store.save(PLAYER_ID, playerState(), 0);
    const synced = syncPlayerWorld({
      playerId: PLAYER_ID,
      requestedTick: 50_000,
      authority: new FixedWorldTimeAuthority(10),
      store,
    });
    assert.strictEqual(synced.ok, false);
    if (!synced.ok) assert.strictEqual(synced.code, 'persistence.time_unauthorized');
  });

  test('SYNC_PLAYER_WORLD command uses the registered time authority', () => {
    const registry = createDefaultRegistry();
    registry.timeAuthority = new FixedWorldTimeAuthority(40);
    const orch = new Orchestrator(playerState(), registry);
    const denied = orch.execute(cmdReq('SYNC_PLAYER_WORLD', { targetWorldTick: 9_999_999 }));
    assert.strictEqual(denied.success, false);
    assert.strictEqual(denied.errors[0]!.code, ErrorCode.TIME_UNAUTHORIZED);
    const ok = orch.execute(cmdReq('SYNC_PLAYER_WORLD', { targetWorldTick: 40 }));
    assert.strictEqual(ok.success, true, ok.errors[0]?.message);
    assert.strictEqual(orch.getState().worldTick, 40);
  });

  test('Supabase adapter is a boundary and does not touch engines', () => {
    const store = new SupabaseGameStateStore();
    assert.throws(() => store.load(PLAYER_ID), (err: unknown) => err instanceof PersistenceError && err.code === 'persistence.not_configured');
  });

  test('jsonRoundTrip helper is JSON-safe for history entries', () => {
    const session = completedSession('NORMAL_TROOPS', 'wses_json');
    const entry = toWorkoutHistoryEntry(session, { completedAtWorldTick: 3 });
    const round = jsonRoundTrip(entry);
    assert.strictEqual(round.sessionId, entry.sessionId);
    assert.strictEqual(round.completionState, 'COMPLETED');
  });
}
