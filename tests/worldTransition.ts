import assert from 'assert';
import {
  ErrorCode,
  FITNESS_MODEL_VERSION,
  IsolatedTelemetryRecorder,
  InMemoryGameStateStore,
  InMemoryWorkoutHistoryStore,
  Orchestrator,
  OrchestrationError,
  PRODUCTION_LEVEL_1_WORLD_ID,
  PRODUCTION_LEVEL_2_WORLD_ID,
  PRODUCTION_WORLD_REGISTRATIONS,
  WorldCatalog,
  applyWorldCompletionCheck,
  applyWorldTransition,
  buildNextWorldState,
  checkGameStateInvariants,
  cloneGameState,
  commitAuthoritativePlayerWorld,
  createGameState,
  createGameStateFromWorld,
  createProductionWorldCatalog,
  ensureCity,
  evaluateWorldCompletion,
  evaluateWorldTransition,
  findNextProductionWorldRegistration,
  hydratePersistedPayload,
  initializePlayerWorld,
  isLevel1TutorialAiSuppressed,
  persistWorldTransition,
  snapshotGameState,
} from '../src';
import type { CommandRequest, GameState, GameStateStore } from '../src';

export interface WorldTransitionTestApi {
  test: (name: string, fn: () => void) => void;
}

const PLAYER_ID = 'player_transition_1';

function cmd(commandId: string, parameters: Record<string, unknown> = {}, requestId?: string): CommandRequest {
  return {
    commandId,
    playerId: PLAYER_ID,
    requestId: requestId ?? `${commandId}_${PLAYER_ID}`,
    parameters,
  };
}

function requireDefinition(worldId: string) {
  const loaded = createProductionWorldCatalog().load(worldId);
  assert.ok(loaded.ok, loaded.ok ? '' : loaded.issues.map((i) => `${i.code}: ${i.message}`).join('; '));
  return loaded.definition;
}

function grantPlayerAllTerritories(state: GameState): void {
  const playerId = state.playerFactionId;
  assert.ok(playerId);
  for (const territory of state.territories.values()) {
    territory.owner = playerId;
  }
  for (const faction of state.factions.values()) {
    faction.territories = [];
  }
  for (const territory of state.territories.values()) {
    if (!territory.owner) continue;
    state.factions.get(territory.owner)?.territories.push(territory.id);
  }
}

function plantPlayerFitness(state: GameState): void {
  state.playerFitness.estimate = {
    modelVersion: FITNESS_MODEL_VERSION,
    playerId: PLAYER_ID,
    level: 6.25,
    confidence: 0.44,
    bodySectionLevels: {
      GLOBAL: 6.25,
      UPPER_BODY: 6,
      CORE: 6.5,
      LOWER_BODY: 7,
    },
    initializedAt: 1_000,
    lastUpdatedAt: 2_000,
    observationCount: 3,
  };
  state.playerFitness.compactHistory = [{
    sessionId: 'wses_carry',
    completedAt: 2_000,
    completedAtTick: 12,
    purpose: 'NORMAL_TROOPS',
  }];
  state.playerFitness.lastWorkoutCompletedAtTick = 12;
  state.playerRewards.bankedTroops = 80;
}

function completeLevel1(state: GameState): GameState {
  assert.strictEqual(state.definitionWorldId, PRODUCTION_LEVEL_1_WORLD_ID);
  plantPlayerFitness(state);
  grantPlayerAllTerritories(state);
  const events = applyWorldCompletionCheck(state);
  assert.ok(events.some((event) => event.data?.worldProgression === 'level_completed'));
  assert.strictEqual(state.definitionWorldId, PRODUCTION_LEVEL_1_WORLD_ID);
  assert.ok(evaluateWorldCompletion(state)?.complete);
  return state;
}

function failingStore(inner: InMemoryGameStateStore): GameStateStore {
  return {
    load: (playerId) => inner.load(playerId),
    save: () => ({
      ok: false,
      code: 'persistence.save_failed',
      message: 'injected persistence failure',
      persisted: false,
    }),
    replace: () => ({
      ok: false,
      code: 'persistence.save_failed',
      message: 'injected persistence failure',
      persisted: false,
    }),
    transaction: () => ({
      ok: false,
      code: 'persistence.save_failed',
      message: 'injected persistence failure',
      persisted: false,
    }),
  };
}

export function registerWorldTransitionTests(api: WorldTransitionTestApi): void {
  const { test } = api;

  console.log('Level 1 → Level 2 world transition');

  test('production catalog registers Level 2 without embedding its geometry in TypeScript', () => {
    const catalog = createProductionWorldCatalog();
    const loaded = catalog.load(PRODUCTION_LEVEL_2_WORLD_ID);
    assert.ok(loaded.ok, loaded.ok ? '' : loaded.issues.map((i) => `${i.code}: ${i.message}`).join('; '));
    assert.strictEqual(loaded.definition.worldId, PRODUCTION_LEVEL_2_WORLD_ID);
    assert.strictEqual(loaded.definition.level, 2);
    assert.ok(loaded.definition.territories.length >= 1);
    assert.ok(!('_editorDrawing' in loaded.definition));
    assert.ok(!('_editorConvertReport' in loaded.definition));
    const next = evaluateWorldTransition(createGameState({ seed: 1 }));
    assert.strictEqual(next.nextWorldId, PRODUCTION_LEVEL_2_WORLD_ID);
    assert.strictEqual(next.nextWorldLevel, 2);
    assert.strictEqual(next.eligible, false);
  });

  test('completing Level 1 does not itself change the active world', () => {
    const state = completeLevel1(createGameState({ seed: 2 }));
    assert.strictEqual(state.definitionWorldId, PRODUCTION_LEVEL_1_WORLD_ID);
    assert.strictEqual(state.worldLevel, 1);
    assert.strictEqual(evaluateWorldTransition(state).eligible, true);
  });

  test('TRANSITION_TO_NEXT_WORLD is the authoritative Level 1 → Level 2 path', () => {
    const recorder = new IsolatedTelemetryRecorder();
    const state = completeLevel1(createGameState({ seed: 3 }));
    const beforeId = state.playerFitness.estimate?.playerId;
    const beforeLevel = state.playerFitness.estimate?.level;
    const beforeConfidence = state.playerFitness.estimate?.confidence;
    const beforeHistory = state.playerFitness.compactHistory.map((entry) => entry.sessionId);
    const l1Owned = [...state.territories.values()].filter((t) => t.owner === state.playerFactionId).length;
    assert.ok(l1Owned >= 3);
    if (state.level1Tutorial) state.level1Tutorial.active = true;
    const orch = new Orchestrator(state, undefined, recorder);

    const publicBefore = orch.execute(cmd('GET_GAME_STATE')).payload.gameState as {
      definitionWorldId: string;
      worldLevel: number;
      worldCompletion: { complete: boolean };
      worldTransition: { eligible: boolean; nextWorldId: string; nextWorldLevel: number };
    };
    assert.strictEqual(publicBefore.definitionWorldId, PRODUCTION_LEVEL_1_WORLD_ID);
    assert.strictEqual(publicBefore.worldLevel, 1);
    assert.strictEqual(publicBefore.worldCompletion.complete, true);
    assert.strictEqual(publicBefore.worldTransition.eligible, true);
    assert.strictEqual(publicBefore.worldTransition.nextWorldId, PRODUCTION_LEVEL_2_WORLD_ID);

    const jumped = orch.execute(cmd('TRANSITION_TO_NEXT_WORLD', { worldId: 'w_ember_atoll' }, 'tr_jump'));
    assert.strictEqual(jumped.success, true, jumped.errors[0]?.message);
    assert.strictEqual(jumped.payload.alreadyCompleted, false);
    assert.strictEqual(jumped.payload.toWorldId, PRODUCTION_LEVEL_2_WORLD_ID);
    assert.strictEqual(jumped.playerId, PLAYER_ID);

    const after = orch.getState();
    const l2 = requireDefinition(PRODUCTION_LEVEL_2_WORLD_ID);
    assert.strictEqual(after.definitionWorldId, PRODUCTION_LEVEL_2_WORLD_ID);
    assert.strictEqual(after.worldLevel, 2);
    assert.strictEqual(after.worldName, l2.name);
    assert.strictEqual(after.territories.size, l2.territories.length);
    assert.strictEqual(after.playerFactionId, l2.playerFactionId);
    assert.strictEqual(after.level1Tutorial, null);
    assert.strictEqual(after.playerRewards.bankedTroops, 0);
    assert.strictEqual(after.cities.size, 0);
    assert.strictEqual(after.constructions.size, 0);
    assert.strictEqual(after.activeInvasions.size, 0);
    assert.strictEqual(after.playerFitness.estimate?.playerId, beforeId);
    assert.strictEqual(after.playerFitness.estimate?.level, beforeLevel);
    assert.strictEqual(after.playerFitness.estimate?.confidence, beforeConfidence);
    assert.deepStrictEqual(after.playerFitness.compactHistory.map((entry) => entry.sessionId), beforeHistory);
    assert.strictEqual(after.playerFitness.activeSession, null);
    assert.strictEqual(after.playerFitness.pendingReward, null);
    assert.strictEqual(after.playerFitness.lastWorkoutCompletedAtTick, null);
    for (const tile of l2.territories) {
      assert.strictEqual(after.territories.get(tile.id)?.owner, tile.startingOwnerFactionId);
    }
    assert.deepStrictEqual(checkGameStateInvariants(after), []);
    assert.strictEqual(isLevel1TutorialAiSuppressed(after, 'f_ai_01'), false);

    const publicAfter = orch.execute(cmd('GET_GAME_STATE')).payload.gameState as {
      definitionWorldId: string;
      worldLevel: number;
      tutorial: { active: boolean };
      worldTransition: { eligible: boolean; alreadyOnLatestRegistered: boolean };
    };
    assert.strictEqual(publicAfter.definitionWorldId, PRODUCTION_LEVEL_2_WORLD_ID);
    assert.strictEqual(publicAfter.worldLevel, 2);
    assert.strictEqual(publicAfter.tutorial.active, false);
    assert.strictEqual(publicAfter.worldTransition.eligible, false);
    assert.strictEqual(publicAfter.worldTransition.alreadyOnLatestRegistered, true);

    const visible = orch.execute(cmd('GET_VISIBLE_WORLD')).payload.visibleWorld as {
      definitionWorldId: string;
      worldLevel: number;
    };
    assert.strictEqual(visible.definitionWorldId, PRODUCTION_LEVEL_2_WORLD_ID);
    assert.strictEqual(visible.worldLevel, 2);

    const worldDef = orch.execute(cmd('GET_WORLD_DEFINITION'));
    assert.strictEqual(worldDef.success, true, worldDef.errors[0]?.message);
    assert.strictEqual((worldDef.payload.worldDefinition as { worldId: string }).worldId, PRODUCTION_LEVEL_2_WORLD_ID);

    const playerHome = l2.factions.find((faction) => faction.role === 'player')!.homeTerritoryId;
    const built = orch.execute(cmd('START_CONSTRUCTION', {
      territoryId: playerHome,
      projectType: 'CITY',
      constructionId: 'con_l2_city',
    }, 'l2_city'));
    assert.strictEqual(built.success, true, built.errors[0]?.message);
    assert.strictEqual(orch.getState().constructions.size, 1);

    const ai = orch.execute(cmd('AI_DECIDE', {}, 'l2_ai'));
    assert.strictEqual(ai.success, true, ai.errors[0]?.message);

    const transitionEvents = recorder.getEvents({ eventType: 'level.transitioned' });
    assert.strictEqual(transitionEvents.length, 1);
    assert.strictEqual(transitionEvents[0]!.playerId, PLAYER_ID);
    assert.strictEqual(transitionEvents[0]!.payload.fromWorldId, PRODUCTION_LEVEL_1_WORLD_ID);
    assert.strictEqual(transitionEvents[0]!.payload.toWorldId, PRODUCTION_LEVEL_2_WORLD_ID);
    assert.strictEqual(transitionEvents[0]!.payload.fromWorldLevel, 1);
    assert.strictEqual(transitionEvents[0]!.payload.toWorldLevel, 2);
    assert.strictEqual(transitionEvents[0]!.importance, 'CRITICAL');
  });

  test('repeated TRANSITION_TO_NEXT_WORLD is idempotent and does not reset Level 2', () => {
    const recorder = new IsolatedTelemetryRecorder();
    const orch = new Orchestrator(completeLevel1(createGameState({ seed: 4 })), undefined, recorder);
    const first = orch.execute(cmd('TRANSITION_TO_NEXT_WORLD', {}, 'tr_1'));
    assert.strictEqual(first.success, true, first.errors[0]?.message);
    const playerHome = requireDefinition(PRODUCTION_LEVEL_2_WORLD_ID)
      .factions.find((faction) => faction.role === 'player')!.homeTerritoryId;
    const built = orch.execute(cmd('START_CONSTRUCTION', {
      territoryId: playerHome,
      projectType: 'CITY',
      constructionId: 'con_keep',
    }, 'keep_city'));
    assert.strictEqual(built.success, true, built.errors[0]?.message);
    orch.getState().factions.get(orch.getState().playerFactionId!)!.resources.gold = 11;
    const snapshot = cloneGameState(orch.getState());

    const second = orch.execute(cmd('TRANSITION_TO_NEXT_WORLD', {}, 'tr_2'));
    assert.strictEqual(second.success, true, second.errors[0]?.message);
    assert.strictEqual(second.payload.alreadyCompleted, true);
    assert.strictEqual(orch.getState().definitionWorldId, PRODUCTION_LEVEL_2_WORLD_ID);
    assert.strictEqual(orch.getState().constructions.get('con_keep')?.territoryId, playerHome);
    assert.strictEqual(orch.getState().factions.get(orch.getState().playerFactionId!)!.resources.gold, 11);
    assert.strictEqual(orch.getState().playerFitness.estimate?.level, snapshot.playerFitness.estimate?.level);
    assert.strictEqual(recorder.getEvents({ eventType: 'level.transitioned' }).length, 1);
  });

  test('ineligible and failed transitions leave Level 1 untouched', () => {
    const incomplete = createGameState({ seed: 5 });
    plantPlayerFitness(incomplete);
    const before = cloneGameState(incomplete);
    const orch = new Orchestrator(incomplete);
    const denied = orch.execute(cmd('TRANSITION_TO_NEXT_WORLD', {}, 'tr_no'));
    assert.strictEqual(denied.success, false);
    assert.strictEqual(denied.errors[0]?.code, ErrorCode.ACTION_NOT_ALLOWED);
    assert.strictEqual(orch.getState().definitionWorldId, PRODUCTION_LEVEL_1_WORLD_ID);
    assert.strictEqual(orch.getState().playerFitness.estimate?.level, before.playerFitness.estimate?.level);
    assert.strictEqual(orch.getState().territories.size, before.territories.size);

    const onlyLevel1 = new WorldCatalog();
    onlyLevel1.register(requireDefinition(PRODUCTION_LEVEL_1_WORLD_ID));
    const complete = completeLevel1(createGameState({ seed: 6 }));
    const missingBefore = cloneGameState(complete);
    assert.throws(
      () => buildNextWorldState(complete, onlyLevel1),
      /could not be loaded: catalog.missing/,
    );
    assert.strictEqual(complete.definitionWorldId, PRODUCTION_LEVEL_1_WORLD_ID);
    assert.deepStrictEqual([...complete.territories.keys()].sort(), [...missingBefore.territories.keys()].sort());

    const invalidCatalog = new WorldCatalog();
    invalidCatalog.register(requireDefinition(PRODUCTION_LEVEL_1_WORLD_ID));
    const bad = JSON.parse(JSON.stringify(requireDefinition(PRODUCTION_LEVEL_2_WORLD_ID))) as ReturnType<typeof requireDefinition>;
    if (bad.completion.type === 'control_fraction') bad.completion.fraction = 100;
    invalidCatalog.register(bad);
    assert.throws(() => buildNextWorldState(completeLevel1(createGameState({ seed: 7 })), invalidCatalog));
  });

  test('persistWorldTransition save failure leaves the stored Level 1 row unchanged', () => {
    const store = new InMemoryGameStateStore();
    const created = initializePlayerWorld({ playerId: PLAYER_ID, seed: 8, store });
    completeLevel1(created.state);
    const savedL1 = store.save(PLAYER_ID, created.state, created.record!.stateVersion);
    assert.ok(savedL1.ok);
    const failed = persistWorldTransition({
      store: failingStore(store),
      playerId: PLAYER_ID,
      expectedVersion: savedL1.ok ? savedL1.record.stateVersion : 0,
      state: created.state,
    });
    assert.strictEqual(failed.ok, false);
    const loaded = store.load(PLAYER_ID);
    assert.ok(loaded.ok);
    assert.strictEqual(loaded.state.definitionWorldId, PRODUCTION_LEVEL_1_WORLD_ID);
    assert.strictEqual(loaded.record.playerId, PLAYER_ID);
  });

  test('save then reload then transition, and transition then save then reload, keep identity', () => {
    const store = new InMemoryGameStateStore();
    const history = new InMemoryWorkoutHistoryStore();
    const created = initializePlayerWorld({ playerId: PLAYER_ID, seed: 9, store });
    completeLevel1(created.state);
    const savedBefore = store.save(PLAYER_ID, created.state, created.record!.stateVersion);
    assert.ok(savedBefore.ok);
    const reloadedBefore = store.load(PLAYER_ID);
    assert.ok(reloadedBefore.ok);
    assert.strictEqual(reloadedBefore.state.definitionWorldId, PRODUCTION_LEVEL_1_WORLD_ID);

    const orch = new Orchestrator(reloadedBefore.state);
    const transitioned = orch.execute(cmd('TRANSITION_TO_NEXT_WORLD', {}, 'tr_reload'));
    assert.strictEqual(transitioned.success, true, transitioned.errors[0]?.message);
    assert.strictEqual(orch.getState().playerFitness.estimate?.playerId, PLAYER_ID);

    const committed = commitAuthoritativePlayerWorld({
      gameStore: store,
      historyStore: history,
      playerId: PLAYER_ID,
      expectedVersion: reloadedBefore.record.stateVersion,
      state: orch.getState(),
    });
    assert.ok(committed.ok, committed.ok ? '' : committed.message);
    const reloadedAfter = store.load(PLAYER_ID);
    assert.ok(reloadedAfter.ok);
    assert.strictEqual(reloadedAfter.record.playerId, PLAYER_ID);
    assert.strictEqual(reloadedAfter.state.definitionWorldId, PRODUCTION_LEVEL_2_WORLD_ID);
    assert.strictEqual(reloadedAfter.state.worldLevel, 2);
    assert.strictEqual(reloadedAfter.state.playerFitness.estimate?.playerId, PLAYER_ID);
    assert.strictEqual(reloadedAfter.state.playerFitness.estimate?.level, 6.25);
    assert.strictEqual(reloadedAfter.state.level1Tutorial, null);

    const hydrated = hydratePersistedPayload(snapshotGameState(reloadedAfter.state));
    assert.strictEqual(hydrated.definitionWorldId, PRODUCTION_LEVEL_2_WORLD_ID);
    assert.strictEqual(hydrated.territories.size, requireDefinition(PRODUCTION_LEVEL_2_WORLD_ID).territories.length);
  });

  test('createGameStateFromWorld remains the Level 2 initializer used by transition', () => {
    const l2 = requireDefinition(PRODUCTION_LEVEL_2_WORLD_ID);
    const fresh = createGameStateFromWorld(l2, { seed: 10 });
    const orch = new Orchestrator(completeLevel1(createGameState({ seed: 10 })));
    orch.execute(cmd('TRANSITION_TO_NEXT_WORLD', {}, 'tr_init'));
    const after = orch.getState();
    assert.strictEqual(after.territories.size, fresh.territories.size);
    for (const [id, tile] of fresh.territories) {
      assert.strictEqual(after.territories.get(id)?.owner, tile.owner);
    }
    assert.notStrictEqual(after.playerFitness.estimate?.level, fresh.playerFitness.estimate?.level);
  });

  test('Level 1 city and tutorial overlay do not survive transition', () => {
    const state = completeLevel1(createGameState({ seed: 11 }));
    const home = [...state.territories.values()].find((t) => t.owner === state.playerFactionId)!.id;
    ensureCity(state, home, state.playerFactionId!);
    assert.ok(state.cities.size > 0);
    const orch = new Orchestrator(state);
    const res = orch.execute(cmd('TRANSITION_TO_NEXT_WORLD', {}, 'tr_city'));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    assert.strictEqual(orch.getState().cities.size, 0);
    assert.strictEqual(orch.getState().level1Tutorial, null);
    assert.ok(!orch.getState().territories.has(home) || orch.getState().definitionWorldId === PRODUCTION_LEVEL_2_WORLD_ID);
  });

  test('next-world lookup is unique: zero, one, or ambiguous matches', () => {
    assert.strictEqual(findNextProductionWorldRegistration(2), null);
    assert.strictEqual(findNextProductionWorldRegistration(99), null);
    const only = findNextProductionWorldRegistration(1);
    assert.ok(only);
    assert.strictEqual(only!.worldId, PRODUCTION_LEVEL_2_WORLD_ID);
    assert.strictEqual(only!.level, 2);

    const ambiguous = [
      ...PRODUCTION_WORLD_REGISTRATIONS,
      {
        worldId: 'Level 2 Duplicate',
        relativePath: 'worlds/level-2.json',
        role: 'production' as const,
        level: 2,
      },
    ];
    assert.throws(
      () => findNextProductionWorldRegistration(1, ambiguous),
      (err: unknown) => (
        err instanceof OrchestrationError
        && err.code === ErrorCode.INVALID_GAME_STATE
        && err.details?.reason === 'next_world_ambiguous'
      ),
    );

    const recorder = new IsolatedTelemetryRecorder();
    const complete = completeLevel1(createGameState({ seed: 12 }));
    const before = cloneGameState(complete);
    assert.throws(
      () => applyWorldTransition(complete, createProductionWorldCatalog(), ambiguous),
      (err: unknown) => (
        err instanceof OrchestrationError
        && err.code === ErrorCode.INVALID_GAME_STATE
        && err.details?.reason === 'next_world_ambiguous'
      ),
    );
    assert.strictEqual(complete.definitionWorldId, PRODUCTION_LEVEL_1_WORLD_ID);
    assert.strictEqual(complete.worldLevel, 1);
    assert.deepStrictEqual([...complete.territories.keys()].sort(), [...before.territories.keys()].sort());
    assert.strictEqual(complete.playerFitness.estimate?.level, before.playerFitness.estimate?.level);
    assert.strictEqual(recorder.getEvents({ eventType: 'level.transitioned' }).length, 0);
  });
}
