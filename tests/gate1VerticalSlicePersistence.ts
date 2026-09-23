/**
 * Gate 1 Phase 1D — the offensive loop survives the real persistence boundary.
 *
 * Save path: commitAuthoritativePlayerWorld → snapshotGameState → encodePersistable.
 * Reload path: JSON text → a new store → hydratePersistedPayload (migrate,
 * WorldCatalog rebind, invariants). Not cloneGameState.
 *
 * The Gate 1 world is registered on the default catalog only while a test
 * loads it, then the catalog singleton is reset. It is not added to
 * production or fixture registration lists.
 */
import assert from 'assert';
import {
  FixedWorldTimeAuthority,
  GAME_STATE_PERSISTENCE_FORMAT,
  GAME_STATE_SCHEMA_VERSION,
  InMemoryGameStateStore,
  InMemoryWorkoutHistoryStore,
  Orchestrator,
  checkGameStateInvariants,
  commitAuthoritativePlayerWorld,
  createDefaultRegistry,
  createTelemetryRecorder,
  ensureCity,
  getCurrentExercise,
  installAuthoredWorkoutCatalog,
  syncPlayerWorld,
} from '../src';
import type { CommandRequest, GameState, PersistedWorldRecord } from '../src';
import { MIN_ATTACKING_TROOPS } from '../src/army/strategicAttack';
import {
  getDefaultWorldCatalog,
  resetDefaultWorldCatalogForTests,
} from '../src/worldDefinition';
import {
  VERTICAL_SLICE_AI_1_FACTION_ID,
  VERTICAL_SLICE_PLAYER_FACTION_ID,
  VERTICAL_SLICE_PLAYER_ID,
  VERTICAL_SLICE_TERRITORY_A,
  VERTICAL_SLICE_TERRITORY_B,
  VERTICAL_SLICE_TERRITORY_C,
  VERTICAL_SLICE_TERRITORY_D,
  VERTICAL_SLICE_WORLD_ID,
  VERTICAL_SLICE_WORKOUT_CATALOG_ID,
  createVerticalSliceScenario,
  loadVerticalSliceWorldDefinition,
} from './fixtures/gate1VerticalSliceScenario';

export interface Gate1VerticalSlicePersistenceTestApi {
  test: (name: string, fn: () => void) => void;
}

/** Same BattleEngine inputs measured in Phase 1C. Not a persistence formula. */
const VICTORY_COMMIT = 2000;
const VICTORY_SEED = 1;
const RESERVE = 250;
const SESSION_ID = 'wses_g1_persist';

function cmd(commandId: string, parameters: Record<string, unknown>, requestId: string): CommandRequest {
  return {
    commandId,
    playerId: VERTICAL_SLICE_PLAYER_ID,
    requestId,
    parameters,
  };
}

function usingGate1World<T>(fn: () => T): T {
  getDefaultWorldCatalog().register(loadVerticalSliceWorldDefinition());
  try {
    return fn();
  } finally {
    resetDefaultWorldCatalogForTests();
  }
}

function finishActiveWorkout(orch: Orchestrator, now = 2_000): void {
  let clock = now;
  while (orch.getState().playerFitness.activeSession?.state === 'ACTIVE') {
    const session = orch.getState().playerFitness.activeSession!;
    const step = getCurrentExercise(session);
    assert.ok(step, 'expected current exercise');
    clock += 1_000;
    if (step.skippable && step.exerciseType === 'REST') {
      const skipped = orch.execute(cmd('SKIP_REST', { order: step.order, now: clock }, `rest_${clock}`));
      assert.strictEqual(skipped.success, true, skipped.errors[0]?.message);
      continue;
    }
    const parameters: Record<string, unknown> = { order: step.order, now: clock };
    if (step.prescription.kind === 'repetitions') parameters.repetitions = step.prescription.repetitions;
    else parameters.durationSeconds = step.prescription.durationSeconds;
    const recorded = orch.execute(cmd('RECORD_EXERCISE', parameters, `rec_${clock}`));
    assert.strictEqual(recorded.success, true, recorded.errors[0]?.message);
  }
}

function completeAuthoredWorkout(state: GameState): { state: GameState; history: InMemoryWorkoutHistoryStore } {
  const catalog = createVerticalSliceScenario().workoutCatalog;
  installAuthoredWorkoutCatalog(catalog);
  const registry = createDefaultRegistry();
  const history = new InMemoryWorkoutHistoryStore();
  registry.workoutHistory = history;
  try {
    const orch = new Orchestrator(state, registry, createTelemetryRecorder());
    const start = orch.execute(cmd('START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      sessionId: SESSION_ID,
      now: 1_000,
    }, 'g1d_start'));
    assert.strictEqual(start.success, true, start.errors[0]?.message);
    finishActiveWorkout(orch);
    const feedback = orch.execute(cmd('SUBMIT_WORKOUT_FEEDBACK', {
      value: 'ABOUT_RIGHT',
      now: 40_000,
    }, 'g1d_fb'));
    assert.strictEqual(feedback.success, true, feedback.errors[0]?.message);
    const finalized = orch.execute(cmd('FINALIZE_WORKOUT', { now: 41_000 }, 'g1d_fin'));
    assert.strictEqual(finalized.success, true, finalized.errors[0]?.message);
    const done = orch.getState();
    assert.ok(done.playerRewards.bankedTroops > 0);
    assert.strictEqual(done.playerFitness.activeSession, null);
    assert.ok(history.get(VERTICAL_SLICE_PLAYER_ID, SESSION_ID));
    return { state: done, history };
  } finally {
    installAuthoredWorkoutCatalog(null);
  }
}

function plantConquerableWorks(state: GameState): void {
  const territory = state.territories.get(VERTICAL_SLICE_TERRITORY_B);
  assert.ok(territory);
  territory.fortification = 2;
  ensureCity(state, VERTICAL_SLICE_TERRITORY_B, VERTICAL_SLICE_AI_1_FACTION_ID);
  const infra = state.territoryInfrastructure.get(VERTICAL_SLICE_TERRITORY_B);
  assert.ok(infra);
  infra.farmCompletedAtTick = 1;
  const projectId = 'c_gate1_t_b_mine';
  state.constructions.set(projectId, {
    id: projectId,
    factionId: VERTICAL_SLICE_AI_1_FACTION_ID,
    territoryId: VERTICAL_SLICE_TERRITORY_B,
    projectType: 'MINE',
    startedAtTick: 0,
    lastProgressTick: 0,
    durationTicks: 8,
    remainingTicks: 8,
    status: 'in_progress',
    completedAtTick: null,
  });
}

function conquerTB(state: GameState): GameState {
  const orch = new Orchestrator(state);
  const res = orch.execute(cmd('ATTACK', {
    territoryId: VERTICAL_SLICE_TERRITORY_B,
    commitAmount: VICTORY_COMMIT,
    seed: VICTORY_SEED,
  }, 'g1d_attack'));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  const done = orch.getState();
  assert.strictEqual(done.territories.get(VERTICAL_SLICE_TERRITORY_B)?.owner, VERTICAL_SLICE_PLAYER_FACTION_ID);
  assert.strictEqual(done.playerRewards.bankedTroops, RESERVE);
  return done;
}

interface PersistedBundle {
  recordJson: string;
  historyJson: string;
}

function persistAcrossBoundary(
  state: GameState,
  history: InMemoryWorkoutHistoryStore | null,
): PersistedBundle {
  const gameStore = new InMemoryGameStateStore();
  const historyStore = new InMemoryWorkoutHistoryStore();
  const entries = history ? history.clonePlayer(VERTICAL_SLICE_PLAYER_ID) : [];
  const saved = commitAuthoritativePlayerWorld({
    gameStore,
    historyStore,
    playerId: VERTICAL_SLICE_PLAYER_ID,
    expectedVersion: 0,
    state,
    historyEntries: entries,
  });
  assert.strictEqual(saved.ok, true, saved.ok ? '' : saved.message);
  assert.strictEqual(saved.persisted, true);
  assert.strictEqual(saved.record.formatVersion, GAME_STATE_PERSISTENCE_FORMAT);
  assert.strictEqual(saved.record.schemaVersion, GAME_STATE_SCHEMA_VERSION);
  assert.strictEqual(saved.record.definitionWorldId, VERTICAL_SLICE_WORLD_ID);
  assert.strictEqual(saved.record.playerId, VERTICAL_SLICE_PLAYER_ID);
  return {
    recordJson: JSON.stringify(saved.record),
    historyJson: JSON.stringify(historyStore.clonePlayer(VERTICAL_SLICE_PLAYER_ID)),
  };
}

function restoreFromBoundary(bundle: PersistedBundle): {
  state: GameState;
  history: InMemoryWorkoutHistoryStore;
  store: InMemoryGameStateStore;
  version: number;
} {
  const record = JSON.parse(bundle.recordJson) as PersistedWorldRecord;
  const entries = JSON.parse(bundle.historyJson) as ReturnType<InMemoryWorkoutHistoryStore['clonePlayer']>;
  const store = new InMemoryGameStateStore();
  store.putRaw(record);
  const loaded = usingGate1World(() => store.load(VERTICAL_SLICE_PLAYER_ID));
  assert.strictEqual(loaded.ok, true, loaded.ok ? '' : loaded.message);
  if (!loaded.ok) throw new Error('unreachable');
  const history = new InMemoryWorkoutHistoryStore();
  history.replacePlayer(VERTICAL_SLICE_PLAYER_ID, entries);
  assert.notStrictEqual(loaded.state, null);
  assert.deepStrictEqual(checkGameStateInvariants(loaded.state), []);
  return { state: loaded.state, history, store, version: loaded.record.stateVersion };
}

function fingerprint(state: GameState) {
  const territories = [...state.territories.values()]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((t) => ({
      id: t.id,
      owner: t.owner,
      neighbors: [...t.neighboring].sort(),
      terrain: t.terrain,
      regionId: t.regionId,
      fortification: t.fortification,
      garrison: t.garrison,
      resourceOutput: { ...t.resourceOutput },
    }));
  const factions = [...state.factions.values()]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((f) => ({
      id: f.id,
      territories: [...f.territories].sort(),
      armies: [...f.armies].sort(),
    }));
  const armies = [...state.armies.values()]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((a) => ({
      id: a.id,
      owner: a.owner,
      location: a.location,
      soldiers: a.soldiers,
      knights: a.knights,
      siegeEngines: a.siegeEngines,
    }));
  const evidence = state.playerFitness.progression.evidenceLog.map((entry) => ({
    sessionId: entry.sessionId,
    workoutId: entry.workoutId,
    catalogId: entry.catalogId,
    catalogVersion: entry.catalogVersion,
    completed: entry.completed,
    abandoned: entry.abandoned,
  }));
  return {
    schemaVersion: state.schemaVersion,
    definitionWorldId: state.definitionWorldId,
    definitionFormatVersion: state.definitionFormatVersion,
    worldLevel: state.worldLevel,
    worldName: state.worldName,
    playerFactionId: state.playerFactionId,
    worldTick: state.worldTick,
    bankedTroops: state.playerRewards.bankedTroops,
    appliedSessions: state.playerRewards.appliedRewards.map((reward) => reward.sessionId),
    territories,
    factions,
    armies,
    cities: [...state.cities.keys()].sort(),
    infrastructure: [...state.territoryInfrastructure.values()]
      .sort((a, b) => (a.territoryId < b.territoryId ? -1 : 1))
      .map((row) => ({
        territoryId: row.territoryId,
        farm: row.farmCompletedAtTick,
        mine: row.mineCompletedAtTick,
        lumber: row.lumberCompletedAtTick,
      })),
    constructions: [...state.constructions.keys()].sort(),
    activeSession: state.playerFitness.activeSession,
    compactHistory: state.playerFitness.compactHistory.map((entry) => entry.sessionId),
    progressionCatalogId: state.playerFitness.progression.catalogId,
    evidence,
    level1Tutorial: state.level1Tutorial,
  };
}

export function registerGate1VerticalSlicePersistenceTests(api: Gate1VerticalSlicePersistenceTestApi): void {
  const { test } = api;

  console.log('Gate 1 Phase 1D — persistence / reload');

  test('workout-earned Troops and progression survive save, discard, and restore', () => {
    const scenario = createVerticalSliceScenario();
    const played = completeAuthoredWorkout(scenario.state);
    const history = played.history;
    const live = played.state;
    const earned = live.playerRewards.bankedTroops;
    assert.ok(earned > 0);
    assert.strictEqual(live.playerFitness.activeSession, null);
    assert.strictEqual(live.playerFitness.compactHistory.some((entry) => entry.sessionId === SESSION_ID), true);
    assert.strictEqual(live.playerFitness.progression.catalogId, VERTICAL_SLICE_WORKOUT_CATALOG_ID);
    assert.strictEqual(live.playerFitness.progression.evidenceLog[0]?.catalogId, VERTICAL_SLICE_WORKOUT_CATALOG_ID);
    const before = fingerprint(live);

    const bundle = persistAcrossBoundary(live, history);
    live.playerRewards.bankedTroops = 999_999;
    live.playerFitness.progression.evidenceLog = [];
    live.playerFitness.compactHistory = [];

    const restored = restoreFromBoundary(bundle);
    assert.notStrictEqual(restored.state, live);
    assert.deepStrictEqual(fingerprint(restored.state), before);
    assert.strictEqual(restored.state.playerRewards.bankedTroops, earned);
    assert.strictEqual(restored.state.playerFitness.activeSession, null);
    assert.strictEqual(restored.state.definitionWorldId, VERTICAL_SLICE_WORLD_ID);
    assert.strictEqual(restored.state.playerFactionId, VERTICAL_SLICE_PLAYER_FACTION_ID);
    assert.strictEqual(restored.state.territories.get(VERTICAL_SLICE_TERRITORY_A)?.owner, VERTICAL_SLICE_PLAYER_FACTION_ID);
    const entry = restored.history.get(VERTICAL_SLICE_PLAYER_ID, SESSION_ID);
    assert.ok(entry);
    assert.strictEqual(entry.completionState, 'COMPLETED');
    assert.strictEqual(entry.workoutId, 'aw_bridge_1a_1b');
    assert.strictEqual(entry.playerId, VERTICAL_SLICE_PLAYER_ID);
    assert.strictEqual(getDefaultWorldCatalog().has(VERTICAL_SLICE_WORLD_ID), false);
  });

  test('deterministic conquest survives save, discard, and restore', () => {
    const scenario = createVerticalSliceScenario();
    scenario.state.playerRewards.bankedTroops = VICTORY_COMMIT + RESERVE;
    plantConquerableWorks(scenario.state);
    const live = conquerTB(scenario.state);
    assert.strictEqual(live.playerRewards.bankedTroops, RESERVE);
    assert.strictEqual(live.cities.has(`city_${VERTICAL_SLICE_TERRITORY_B}`), false);
    assert.strictEqual(live.territories.get(VERTICAL_SLICE_TERRITORY_B)?.fortification, 0);
    assert.strictEqual(live.territoryInfrastructure.get(VERTICAL_SLICE_TERRITORY_B)?.farmCompletedAtTick, null);
    assert.strictEqual([...live.constructions.keys()].length, 0);
    assert.ok(live.factions.get(VERTICAL_SLICE_PLAYER_FACTION_ID)?.territories.includes(VERTICAL_SLICE_TERRITORY_B));
    assert.ok(!live.factions.get(VERTICAL_SLICE_AI_1_FACTION_ID)?.territories.includes(VERTICAL_SLICE_TERRITORY_B));
    const survivors = [...live.armies.values()].filter((army) => army.owner === VERTICAL_SLICE_PLAYER_FACTION_ID);
    assert.strictEqual(survivors.length, 1);
    assert.strictEqual(survivors[0]!.location, VERTICAL_SLICE_TERRITORY_B);
    const before = fingerprint(live);

    const bundle = persistAcrossBoundary(live, null);
    live.territories.get(VERTICAL_SLICE_TERRITORY_B)!.owner = VERTICAL_SLICE_AI_1_FACTION_ID;
    live.playerRewards.bankedTroops = 0;
    ensureCity(live, VERTICAL_SLICE_TERRITORY_B, VERTICAL_SLICE_AI_1_FACTION_ID);

    const restored = restoreFromBoundary(bundle);
    assert.notStrictEqual(restored.state, live);
    assert.deepStrictEqual(fingerprint(restored.state), before);
    assert.strictEqual(restored.state.playerRewards.bankedTroops, RESERVE);
    assert.strictEqual(restored.state.territories.get(VERTICAL_SLICE_TERRITORY_B)?.owner, VERTICAL_SLICE_PLAYER_FACTION_ID);
    assert.strictEqual(restored.state.territories.get(VERTICAL_SLICE_TERRITORY_C)?.owner, VERTICAL_SLICE_AI_1_FACTION_ID);
    assert.strictEqual(restored.state.territories.get(VERTICAL_SLICE_TERRITORY_D)?.owner, 'f_ai_2');
    assert.ok(restored.state.territories.get(VERTICAL_SLICE_TERRITORY_A)?.neighboring.includes(VERTICAL_SLICE_TERRITORY_B));
    assert.ok(restored.state.territories.get(VERTICAL_SLICE_TERRITORY_A)?.neighboring.includes(VERTICAL_SLICE_TERRITORY_C));
    assert.strictEqual(restored.state.cities.has(`city_${VERTICAL_SLICE_TERRITORY_B}`), false);
    assert.strictEqual(restored.state.playerFitness.activeSession, null);
    assert.ok(restored.state.playerRewards.bankedTroops > MIN_ATTACKING_TROOPS);
  });

  test('save, restore, save, restore stays semantically stable', () => {
    const scenario = createVerticalSliceScenario();
    scenario.state.playerRewards.bankedTroops = VICTORY_COMMIT + RESERVE;
    plantConquerableWorks(scenario.state);
    const conquered = conquerTB(scenario.state);
    const first = restoreFromBoundary(persistAcrossBoundary(conquered, null));
    const second = restoreFromBoundary(persistAcrossBoundary(first.state, null));
    assert.notStrictEqual(second.state, first.state);
    assert.deepStrictEqual(fingerprint(second.state), fingerprint(first.state));
    assert.strictEqual(second.state.playerRewards.bankedTroops, RESERVE);
    assert.strictEqual(second.state.territories.get(VERTICAL_SLICE_TERRITORY_B)?.owner, VERTICAL_SLICE_PLAYER_FACTION_ID);
  });

  test('failed save and corrupt or unregistered loads do not invent a playable state', () => {
    const scenario = createVerticalSliceScenario();
    scenario.state.playerRewards.bankedTroops = RESERVE;
    const broken = scenario.state;
    broken.worldTick = -3;
    const gameStore = new InMemoryGameStateStore();
    const historyStore = new InMemoryWorkoutHistoryStore();
    const failed = commitAuthoritativePlayerWorld({
      gameStore,
      historyStore,
      playerId: VERTICAL_SLICE_PLAYER_ID,
      expectedVersion: 0,
      state: broken,
    });
    assert.strictEqual(failed.ok, false);
    assert.strictEqual(failed.persisted, false);
    if (!failed.ok) assert.strictEqual(failed.code, 'persistence.invalid_state');
    const missing = gameStore.load(VERTICAL_SLICE_PLAYER_ID);
    assert.strictEqual(missing.ok, false);
    if (!missing.ok) assert.strictEqual(missing.code, 'persistence.not_found');

    broken.worldTick = 0;
    const saved = commitAuthoritativePlayerWorld({
      gameStore,
      historyStore,
      playerId: VERTICAL_SLICE_PLAYER_ID,
      expectedVersion: 0,
      state: broken,
    });
    assert.strictEqual(saved.ok, true, saved.ok ? '' : saved.message);
    const conflict = gameStore.save(VERTICAL_SLICE_PLAYER_ID, broken, 0);
    assert.strictEqual(conflict.ok, false);
    assert.strictEqual(conflict.persisted, false);
    if (!conflict.ok) assert.strictEqual(conflict.code, 'persistence.conflict');
    resetDefaultWorldCatalogForTests();
    const unregistered = gameStore.load(VERTICAL_SLICE_PLAYER_ID);
    assert.strictEqual(unregistered.ok, false);
    if (!unregistered.ok) {
      assert.strictEqual(unregistered.code, 'persistence.invalid_state');
      assert.match(unregistered.message, /not registered/);
      assert.strictEqual('state' in unregistered, false);
    }
    const still = usingGate1World(() => gameStore.load(VERTICAL_SLICE_PLAYER_ID));
    assert.strictEqual(still.ok, true, still.ok ? '' : still.message);
    if (still.ok) assert.strictEqual(still.state.playerRewards.bankedTroops, RESERVE);

    const corrupt = new InMemoryGameStateStore();
    corrupt.putRaw({
      formatVersion: GAME_STATE_PERSISTENCE_FORMAT,
      playerId: VERTICAL_SLICE_PLAYER_ID,
      worldId: 'local',
      definitionWorldId: VERTICAL_SLICE_WORLD_ID,
      schemaVersion: GAME_STATE_SCHEMA_VERSION,
      worldTick: 0,
      stateVersion: 1,
      payload: { not: 'a GameState' },
    });
    const corruptLoad = usingGate1World(() => corrupt.load(VERTICAL_SLICE_PLAYER_ID));
    assert.strictEqual(corruptLoad.ok, false);
    if (!corruptLoad.ok) {
      assert.ok(
        corruptLoad.code === 'persistence.corrupt'
          || corruptLoad.code === 'persistence.invalid_state'
          || corruptLoad.code === 'persistence.unsupported_schema',
        corruptLoad.code,
      );
      assert.strictEqual('state' in corruptLoad, false);
    }
  });

  test('syncPlayerWorld reloads the conquered world into a new runtime without advancing it', () => {
    const scenario = createVerticalSliceScenario();
    scenario.state.playerRewards.bankedTroops = VICTORY_COMMIT + RESERVE;
    plantConquerableWorks(scenario.state);
    const conquered = conquerTB(scenario.state);
    const bundle = persistAcrossBoundary(conquered, null);
    const record = JSON.parse(bundle.recordJson) as PersistedWorldRecord;
    const store = new InMemoryGameStateStore();
    store.putRaw(record);
    const tick = conquered.worldTick;
    conquered.playerRewards.bankedTroops = 1;
    conquered.territories.get(VERTICAL_SLICE_TERRITORY_B)!.owner = VERTICAL_SLICE_AI_1_FACTION_ID;

    const synced = usingGate1World(() => syncPlayerWorld({
      playerId: VERTICAL_SLICE_PLAYER_ID,
      requestedTick: tick,
      authority: new FixedWorldTimeAuthority(tick),
      store,
      history: new InMemoryWorkoutHistoryStore(),
      registry: createDefaultRegistry(),
    }));
    assert.strictEqual(synced.ok, true, synced.ok ? '' : synced.message);
    if (!synced.ok) return;
    assert.strictEqual(synced.persisted, true);
    assert.strictEqual(synced.catchUp.ticksAdvanced, 0);
    assert.strictEqual(synced.state.playerRewards.bankedTroops, RESERVE);
    assert.strictEqual(synced.state.territories.get(VERTICAL_SLICE_TERRITORY_B)?.owner, VERTICAL_SLICE_PLAYER_FACTION_ID);
    assert.strictEqual(synced.state.definitionWorldId, VERTICAL_SLICE_WORLD_ID);
    assert.strictEqual(synced.state.playerFactionId, VERTICAL_SLICE_PLAYER_FACTION_ID);
    assert.strictEqual(synced.state.cities.has(`city_${VERTICAL_SLICE_TERRITORY_B}`), false);
    assert.deepStrictEqual(checkGameStateInvariants(synced.state), []);
    assert.notStrictEqual(synced.state, conquered);
  });
}
