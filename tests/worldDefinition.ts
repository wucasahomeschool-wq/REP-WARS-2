import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  COMMAND_INDEX,
  DEFAULT_PRODUCTION_WORLD_ID,
  FIXTURE_TINY_WORLD_ID,
  FIXTURE_WORLD_REGISTRATIONS,
  PRODUCTION_LEVEL_1_WORLD_ID,
  PRODUCTION_WORLD_REGISTRATIONS,
  ErrorCode,
  GAMEPLAY_CONFIG,
  GAME_STATE_SCHEMA_VERSION,
  InMemoryGameStateStore,
  Orchestrator,
  WORLD_FORMAT_VERSION,
  WorldCatalog,
  checkGameStateInvariants,
  cloneGameState,
  createDefaultRegistry,
  createGameState,
  createGameStateFromWorld,
  applyImmutableWorldDefinition,
  createLegacySampleMapGameState,
  createProductionWorldCatalog,
  createWorldCatalog,
  getDefaultWorldCatalog,
  hydratePersistedPayload,
  identityFromDefinition,
  identityFromGameState,
  initializePlayerWorld,
  loadTinyWorldDefinition,
  loadWorldDefinition,
  parseWorldJson,
  progressWorldEconomy,
  resolveWorldDefinition,
  serializeToJson,
  snapshotGameState,
  startConstruction,
  tinyWorldJsonPath,
  validateWorldDefinition,
  worldIdentitiesEqual,
  worldRecordToRow,
  rowToWorldRecord,
} from '../src';
import { GoalSystem } from '../src/goals/GoalSystem';
import { plantCity } from './worldTestHelpers';
import type { CommandRequest } from '../src';
import type { AICommitment, WorldDefinition } from '../src';

export interface WorldDefinitionTestApi {
  test: (name: string, fn: () => void) => void;
}

function cmdReq(commandId: string, parameters: Record<string, unknown> = {}): CommandRequest {
  return { commandId, playerId: 'player_1', requestId: `wd_${commandId}`, parameters };
}

function requireTiny(): WorldDefinition {
  const loaded = loadTinyWorldDefinition();
  assert.ok(loaded.ok, loaded.ok ? '' : loaded.issues.map((i) => `${i.code}: ${i.message}`).join('; '));
  return loaded.definition;
}

function cloneWorld(def: WorldDefinition): WorldDefinition {
  return JSON.parse(JSON.stringify(def)) as WorldDefinition;
}

function codesOf(def: WorldDefinition): string[] {
  return validateWorldDefinition(def).map((i) => i.code);
}

export function registerWorldDefinitionTests(api: WorldDefinitionTestApi): void {
  const { test } = api;

  console.log('Phase 17N.2 — authored world load / validate');

  test('docs/examples/world-level1-tiny.json loads as rep-wars-world.v1', () => {
    const loaded = loadTinyWorldDefinition();
    assert.ok(loaded.ok, loaded.ok ? '' : loaded.issues.map((i) => `${i.code}: ${i.message}`).join('; '));
    assert.strictEqual(loaded.definition.formatVersion, WORLD_FORMAT_VERSION);
    assert.strictEqual(loaded.definition.worldId, 'w_ember_atoll');
    assert.strictEqual(loaded.definition.level, 1);
    assert.strictEqual(loaded.definition.name, 'Ember Atoll');
    assert.deepStrictEqual(validateWorldDefinition(loaded.definition), []);
  });

  test('invalid JSON is rejected and does not invent a replacement world', () => {
    const parsed = parseWorldJson('{');
    assert.strictEqual(parsed.ok, false);
    if (!parsed.ok) assert.ok(parsed.issues.some((i) => i.code === 'json.parse'));
    const notObject = loadWorldDefinition(null);
    assert.strictEqual(notObject.ok, false);
    if (!notObject.ok) assert.ok(notObject.issues.some((i) => i.code === 'json.not_object'));
  });

  test('duplicate territory, region, and faction IDs are rejected', () => {
    const dupT = cloneWorld(requireTiny());
    dupT.territories.push({ ...dupT.territories[0]! });
    assert.ok(codesOf(dupT).includes('territory.duplicate_id'));
    const dupR = cloneWorld(requireTiny());
    dupR.regions.push({ ...dupR.regions[0]! });
    assert.ok(codesOf(dupR).includes('region.duplicate_id'));
    const dupF = cloneWorld(requireTiny());
    dupF.factions.push({ ...dupF.factions[0]!, homeTerritoryId: 't_02' });
    assert.ok(codesOf(dupF).includes('faction.duplicate_id'));
  });

  test('invalid polygons are rejected', () => {
    const def = cloneWorld(requireTiny());
    def.territories[0]!.polygon = { rings: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]] };
    assert.ok(codesOf(def).some((c) => c.startsWith('geometry.')));
  });

  test('territory names are rejected', () => {
    const def = cloneWorld(requireTiny());
    (def.territories[0] as { name?: string }).name = 'Named Tile';
    assert.ok(codesOf(def).includes('territory.named'));
  });

  test('invalid adjacency (non-reciprocal, missing, disconnected) is rejected', () => {
    const missing = cloneWorld(requireTiny());
    missing.territories[0]!.neighborIds.push('no_such_tile');
    assert.ok(codesOf(missing).includes('adjacency.missing_neighbor'));
    const oneWay = cloneWorld(requireTiny());
    oneWay.territories.find((t) => t.id === 't_01')!.neighborIds = ['t_02'];
    oneWay.territories.find((t) => t.id === 't_02')!.neighborIds = ['t_04', 't_05'];
    assert.ok(codesOf(oneWay).includes('adjacency.non_reciprocal'));
    const disconnected = cloneWorld(requireTiny());
    for (const t of disconnected.territories) {
      t.neighborIds = t.neighborIds.filter((id) => id !== 't_06');
      if (t.id === 't_06') t.neighborIds = [];
    }
    assert.ok(codesOf(disconnected).includes('adjacency.disconnected'));
  });

  test('missing region and owner references are rejected', () => {
    const missingRegion = cloneWorld(requireTiny());
    missingRegion.territories[0]!.regionId = 'r_missing';
    assert.ok(codesOf(missingRegion).includes('territory.unknown_region'));
    const missingOwner = cloneWorld(requireTiny());
    missingOwner.territories[0]!.startingOwnerFactionId = 'f_nobody';
    assert.ok(codesOf(missingOwner).includes('owner.unknown'));
  });

  test('Level 1 player must own exactly one territory; AI allocation is authored', () => {
    const two = cloneWorld(requireTiny());
    two.territories.find((t) => t.id === 't_02')!.startingOwnerFactionId = 'f_player';
    assert.ok(codesOf(two).includes('owner.player_count'));
    const emptyAi = cloneWorld(requireTiny());
    for (const t of emptyAi.territories) {
      if (t.startingOwnerFactionId === 'f_salt_raiders') t.startingOwnerFactionId = 'f_cinder_court';
    }
    assert.ok(codesOf(emptyAi).includes('owner.ai_empty'));
  });

  test('invalid personality data is rejected', () => {
    const def = cloneWorld(requireTiny());
    def.factions.find((f) => f.id === 'f_salt_raiders')!.personality!.traits.aggression = 2;
    assert.ok(codesOf(def).includes('personality.trait'));
  });

  test('contained-world references and cross-level adjacency are validated', () => {
    const contained = cloneWorld(requireTiny());
    contained.containedWorlds = [{
      worldId: 'w_prior',
      regionId: 'r_missing',
      placement: { origin: { x: 0, y: 0 }, rotationDegrees: 0, scale: 1 },
    }];
    assert.ok(codesOf(contained).includes('contained.region'));
    const okContained = cloneWorld(requireTiny());
    okContained.containedWorlds = [{
      worldId: 'w_prior',
      regionId: 'r_cinder_highlands',
      placement: { origin: { x: 40, y: 20 }, rotationDegrees: 0, scale: 0.2 },
    }];
    assert.ok(!codesOf(okContained).includes('contained.region'));
    const cross = cloneWorld(requireTiny());
    cross.territories[0]!.neighborIds.push('w_other_world');
    assert.ok(codesOf(cross).includes('adjacency.cross_level') || codesOf(cross).includes('adjacency.missing_neighbor'));
  });

  console.log('Phase 17N.2 — createGameStateFromWorld');

  test('createGameState() uses the selected world from worldConfig, not SAMPLE_MAP', () => {
    const state = createGameState({ seed: 1 });
    assert.strictEqual(state.schemaVersion, GAME_STATE_SCHEMA_VERSION);
    assert.strictEqual(state.definitionWorldId, PRODUCTION_LEVEL_1_WORLD_ID);
    assert.strictEqual(state.definitionFormatVersion, WORLD_FORMAT_VERSION);
    assert.strictEqual(state.worldLevel, 1);
    assert.strictEqual(state.worldName, 'Level 1');
    assert.strictEqual(state.playerFactionId, 'f_player');
    assert.ok(!state.allFactionIds.includes('iron_kingdom'));
    assert.deepStrictEqual(checkGameStateInvariants(state), []);
  });

  test('authored world initializes ownership, no cities, and world-supplied personalities', () => {
    const def = requireTiny();
    const state = createGameStateFromWorld(def, { seed: 9 });
    const playerTiles = [...state.territories.values()].filter((t) => t.owner === 'f_player');
    assert.strictEqual(playerTiles.length, 1);
    assert.strictEqual(playerTiles[0]!.id, 't_01');
    assert.ok(!('name' in playerTiles[0]!));
    assert.ok(!('isCapital' in playerTiles[0]!));
    assert.ok(!('isKnown' in playerTiles[0]!));
    assert.strictEqual(state.cities.size, 0);
    assert.strictEqual(state.regions.get('r_cinder_highlands')!.name, 'Cinder Highlands');
    assert.strictEqual(state.territories.get('t_04')!.owner, 'f_cinder_court');
    assert.strictEqual(state.territories.get('t_06')!.owner, 'f_salt_raiders');
    assert.strictEqual(state.factions.get('f_cinder_court')!.personality.aggression, 0.35);
    assert.strictEqual(state.factions.get('f_cinder_court')!.ambition, 0.55);
    assert.strictEqual(state.factions.get('f_salt_raiders')!.personality.aggression, 0.9);
    assert.strictEqual(state.factions.get('f_salt_raiders')!.ambition, 0.7);
    for (const faction of state.factions.values()) {
      assert.deepStrictEqual([...faction.knownTerritories].sort(), [...state.territories.keys()].sort());
    }
  });

  test('different authored worlds can supply different personalities', () => {
    const alt = cloneWorld(requireTiny());
    alt.worldId = 'w_alt_atoll';
    for (const region of alt.regions) region.worldId = 'w_alt_atoll';
    alt.factions.find((f) => f.id === 'f_salt_raiders')!.personality!.traits.aggression = 0.1;
    alt.factions.find((f) => f.id === 'f_salt_raiders')!.personality!.ambition = 0.2;
    const a = createGameStateFromWorld(requireTiny());
    const b = createGameStateFromWorld(alt);
    assert.strictEqual(a.factions.get('f_salt_raiders')!.personality.aggression, 0.9);
    assert.strictEqual(b.factions.get('f_salt_raiders')!.personality.aggression, 0.1);
    assert.strictEqual(b.factions.get('f_salt_raiders')!.ambition, 0.2);
    assert.strictEqual(b.definitionWorldId, 'w_alt_atoll');
  });

  test('SAMPLE_MAP remains an explicit legacy fixture, not the production default', () => {
    const legacy = createLegacySampleMapGameState({ seed: 1, playerFactionId: 'iron_kingdom' });
    assert.strictEqual(legacy.definitionWorldId, 'legacy:sample-map');
    assert.ok(legacy.factions.has('iron_kingdom'));
    assert.notStrictEqual(createGameState({ seed: 1 }).definitionWorldId, 'legacy:sample-map');
  });

  console.log('Phase 17N.2 — cities, visibility, commands, region AI');

  test('explicit CITY construction founds a city; fortification is not founding', () => {
    const orch = new Orchestrator(createGameState({ seed: 1, worldId: FIXTURE_TINY_WORLD_ID }));
    assert.strictEqual(orch.getState().cities.size, 0);
    const started = orch.execute(cmdReq('START_CONSTRUCTION', {
      territoryId: 't_01', constructionId: 'con_city', projectType: 'CITY',
    }));
    assert.strictEqual(started.success, true, started.errors[0]?.message);
    assert.strictEqual(orch.getState().cities.size, 0);
    const fortTooSoon = orch.execute(cmdReq('START_CONSTRUCTION', {
      territoryId: 't_01', constructionId: 'con_fort', projectType: 'FORTIFICATION',
    }));
    assert.strictEqual(fortTooSoon.success, false);
    const ticking = orch.getState();
    ticking.worldTick += GAMEPLAY_CONFIG.cityConstructionDurationTicks;
    progressWorldEconomy(ticking);
    assert.ok(ticking.cities.has('city_t_01'));
    assert.strictEqual(ticking.cities.get('city_t_01')!.factionId, 'f_player');
  });

  test('conquest destroys the previous city and leaves the conqueror with empty land', () => {
    const state = createGameState({ seed: 1, worldId: FIXTURE_TINY_WORLD_ID });
    plantCity(state, 't_02');
    state.territories.get('t_02')!.garrison = 40;
    assert.ok(state.cities.has('city_t_02'));
    const orch = new Orchestrator(state);
    const attack = orch.execute(cmdReq('ATTACK', { territoryId: 't_02', factionId: 'f_player', seed: 42 }));
    assert.strictEqual(attack.success, true, attack.errors[0]?.message);
    assert.strictEqual(orch.getState().territories.get('t_02')!.owner, 'f_player');
    assert.ok(!orch.getState().cities.has('city_t_02'));
    const founded = startConstruction(orch.getState(), {
      factionId: 'f_player', territoryId: 't_02', projectType: 'CITY', projectId: 'con_t02',
    });
    assert.strictEqual(founded.projectType, 'CITY');
  });

  test('the current world is fully visible; SCOUT and EXPAND are not production commands', () => {
    const orch = new Orchestrator(createGameState({ seed: 1, worldId: FIXTURE_TINY_WORLD_ID }));
    const view = orch.execute(cmdReq('GET_VISIBLE_WORLD'));
    assert.strictEqual(view.success, true, view.errors[0]?.message);
    const world = view.payload.visibleWorld as { territories: Record<string, { visibility: string }>; currentWorldFullyVisible?: boolean };
    const ids = Object.keys(world.territories);
    assert.deepStrictEqual(ids.sort(), ['t_01', 't_02', 't_03', 't_04', 't_05', 't_06']);
    for (const id of ids) {
      assert.strictEqual(world.territories[id]!.visibility, 'visible');
    }
    const publicState = orch.execute(cmdReq('GET_GAME_STATE'));
    const gs = publicState.payload.gameState as { currentWorldFullyVisible: boolean; territories: Record<string, unknown> };
    assert.strictEqual(gs.currentWorldFullyVisible, true);
    assert.strictEqual(Object.keys(gs.territories).length, 6);
    const scout = orch.execute(cmdReq('SCOUT', { territoryId: 't_04' }));
    assert.strictEqual(scout.success, false);
    assert.strictEqual(scout.errors[0]!.code, ErrorCode.INVALID_COMMAND);
    const expand = orch.execute(cmdReq('EXPAND', { territoryId: 't_02' }));
    assert.strictEqual(expand.success, false);
    assert.strictEqual(expand.errors[0]!.code, ErrorCode.INVALID_COMMAND);
    const attack = orch.execute(cmdReq('ATTACK', { territoryId: 't_02', factionId: 'f_player', seed: 7 }));
    assert.ok(attack.success || attack.errors[0]?.code !== ErrorCode.INVALID_COMMAND);
    assert.ok(!COMMAND_INDEX.some((c) => c.commandId === 'SCOUT' || c.commandId === 'EXPAND'));
  });

  test('control_region uses Territory.regionId membership, not id-prefix guessing', () => {
    const state = createGameState({ seed: 1, worldId: FIXTURE_TINY_WORLD_ID });
    const goals = new GoalSystem([]);
    goals.addGoal({
      type: 'control_region',
      priority: 80,
      targetRegion: 'r_salt_margin',
      createdTurn: 0,
    });
    const self = state.factions.get('f_player')!;
    const aligned = goals.evaluateActionAlignment({
      actionType: 'ATTACK',
      targetFaction: 'f_salt_raiders',
      targetTerritory: 't_05',
      self,
      currentTurn: 0,
      allTerritories: state.territories,
    });
    assert.strictEqual(aligned.alignedGoals.length, 1);
    const outside = goals.evaluateActionAlignment({
      actionType: 'ATTACK',
      targetFaction: 'f_cinder_court',
      targetTerritory: 't_02',
      self,
      currentTurn: 0,
      allTerritories: state.territories,
    });
    assert.strictEqual(outside.alignedGoals.length, 0);
    const prefixTrap = goals.evaluateActionAlignment({
      actionType: 'ATTACK',
      targetFaction: 'enemy',
      targetTerritory: 't_02',
      self,
      currentTurn: 0,
      allTerritories: state.territories,
    });
    assert.strictEqual(prefixTrap.alignedGoals.length, 0);
  });

  test('no fixed Territory.isCapital remains on runtime tiles or production scoring/combat', () => {
    const state = createGameState({ seed: 1 });
    for (const t of state.territories.values()) {
      assert.ok(!('isCapital' in t));
    }
    const combatSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'battle', 'CombatPower.ts'), 'utf8');
    const scorerSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'scoring', 'ActionScorer.ts'), 'utf8');
    assert.ok(!/isCapital/.test(combatSrc));
    assert.ok(!/isCapital/.test(scorerSrc));
    assert.ok(!/capitalBonus/.test(combatSrc));
  });

  test('authored world identity survives persistence round-trip', () => {
    const state = createGameState({ seed: 3 });
    state.playerFactionId = 'f_player';
    const json = serializeToJson(snapshotGameState(state));
    const loaded = hydratePersistedPayload(JSON.parse(json));
    assert.strictEqual(loaded.definitionWorldId, PRODUCTION_LEVEL_1_WORLD_ID);
    assert.strictEqual(loaded.worldLevel, 1);
    assert.strictEqual(loaded.definitionFormatVersion, WORLD_FORMAT_VERSION);
    assert.strictEqual(loaded.playerFactionId, 'f_player');
    assert.ok(loaded.factions.has('f_player'));
    assert.deepStrictEqual(checkGameStateInvariants(loaded), []);
    const cloned = cloneGameState(loaded);
    assert.strictEqual(cloned.definitionWorldId, PRODUCTION_LEVEL_1_WORLD_ID);
  });

  console.log('Phase 17P — catalog boundary, gameplay, persistence identity');

  test('WorldCatalog is the production load boundary; missing worlds fail closed', () => {
    const catalog = getDefaultWorldCatalog();
    const loaded = catalog.load(DEFAULT_PRODUCTION_WORLD_ID);
    assert.ok(loaded.ok);
    if (loaded.ok) {
      assert.strictEqual(loaded.definition.worldId, PRODUCTION_LEVEL_1_WORLD_ID);
      assert.strictEqual(loaded.definition.territories.length, 3);
    }
    const missing = catalog.load('w_does_not_exist');
    assert.strictEqual(missing.ok, false);
    assert.throws(
      () => createGameState({ worldId: 'w_does_not_exist' }),
      /rejected|not registered/,
    );
    const empty = new WorldCatalog();
    assert.throws(
      () => createGameState({ catalog: empty, worldId: DEFAULT_PRODUCTION_WORLD_ID }),
      /rejected|not registered/,
    );
    assert.notStrictEqual(createGameState({ seed: 1 }).definitionWorldId, 'legacy:sample-map');
    const registry = createDefaultRegistry();
    const mapEngine = registry.list().find((e) => e.id === 'map');
    assert.ok(mapEngine);
    assert.strictEqual(mapEngine.status, 'unavailable');
    const legacyResolve = resolveWorldDefinition('legacy:sample-map');
    assert.strictEqual(legacyResolve.ok, false);
    if (!legacyResolve.ok) assert.ok(legacyResolve.issues.some((i) => i.code === 'catalog.legacy'));
  });

  test('createGameState(worldId) initializes authored ownership, regions, adjacency, and personalities', () => {
    const def = requireTiny();
    const state = createGameState({ seed: 4, worldId: 'w_ember_atoll' });
    const owners = Object.fromEntries([...state.territories.values()].map((t) => [t.id, t.owner]));
    const expected = Object.fromEntries(def.territories.map((t) => [t.id, t.startingOwnerFactionId]));
    assert.deepStrictEqual(owners, expected);
    assert.strictEqual(state.playerFactionId, 'f_player');
    assert.strictEqual([...state.territories.values()].filter((t) => t.owner === 'f_player').length, 1);
    assert.strictEqual(state.cities.size, 0);
    assert.deepStrictEqual(state.territories.get('t_01')!.neighboring.slice().sort(), ['t_02', 't_03']);
    assert.strictEqual(state.regions.get('r_salt_margin')!.name, 'Salt Margin');
    assert.ok(state.regions.get('r_salt_margin')!.territoryIds.includes('t_06'));
    for (const t of state.territories.values()) {
      assert.ok(!('name' in t));
      assert.ok(!('polygon' in t));
      assert.ok(!('isCapital' in t));
      assert.ok(!('isKnown' in t));
      assert.ok(!('scoutedTurnsAgo' in t));
    }
    assert.strictEqual(state.factions.get('f_salt_raiders')!.personality.aggression, 0.9);
  });

  test('authored Ember Atoll supports banked-troop attack, city destruction, collect, and AI decide', () => {
    const state = createGameState({ seed: 11, worldId: FIXTURE_TINY_WORLD_ID });
    plantCity(state, 't_02');
    state.territories.get('t_02')!.garrison = 40;
    state.playerRewards.bankedTroops = 900;
    const orch = new Orchestrator(state);
    const attack = orch.execute(cmdReq('ATTACK', {
      territoryId: 't_02', factionId: 'f_player', commitAmount: 900, seed: 3,
    }));
    assert.strictEqual(attack.success, true, attack.errors[0]?.message);
    if (orch.getState().territories.get('t_02')!.owner !== 'f_player') {
      orch.execute(cmdReq('ADVANCE_WORLD', { elapsedTicks: 8 }));
    }
    assert.strictEqual(orch.getState().territories.get('t_02')!.owner, 'f_player');
    assert.ok(!orch.getState().cities.has('city_t_02'));
    assert.strictEqual(orch.getState().playerRewards.bankedTroops, 0);
    const founded = startConstruction(orch.getState(), {
      factionId: 'f_player', territoryId: 't_02', projectType: 'CITY', projectId: 'con_p17',
    });
    assert.strictEqual(founded.projectType, 'CITY');
    const goldBefore = orch.getState().factions.get('f_player')!.resources.gold;
    orch.getState().worldTick += 4;
    progressWorldEconomy(orch.getState());
    const collect = orch.execute(cmdReq('COLLECT_RESOURCES', { territoryId: 't_01', factionId: 'f_player' }));
    assert.strictEqual(collect.success, true, collect.errors[0]?.message);
    assert.ok(orch.getState().factions.get('f_player')!.resources.gold >= goldBefore);
    const decide = orch.execute(cmdReq('AI_DECIDE', {}));
    assert.strictEqual(decide.success, true, decide.errors[0]?.message);
    const aiCommitments = [...orch.getState().commitments.entries()].filter(([id, c]) => id !== 'f_player' && c);
    assert.ok(aiCommitments.length >= 1);
  });

  test('authored world AI can open an invasion; player can start DEFENSE', () => {
    const state = createGameState({ seed: 8, worldId: FIXTURE_TINY_WORLD_ID });
    const army = [...state.armies.values()].find((a) => a.owner === 'f_cinder_court');
    assert.ok(army);
    army.location = 't_02';
    army.soldiers = 800;
    const commitment: AICommitment = {
      id: 'cmt_p17_inv',
      warlordId: 'f_cinder_court',
      action: 'ATTACK',
      targetId: 't_01',
      targetName: 't_01',
      status: 'committed',
      createdTurn: 0,
      originatingGoalId: null,
      reason: ['test'],
      priority: 80,
      score: 80,
      confidence: 1,
      personalityBias: 0,
      ambitionInfluence: 0,
      factorBreakdown: [],
      statusReason: null,
    };
    state.commitments.set('f_cinder_court', commitment);
    const orch = new Orchestrator(state);
    const resolve = orch.execute(cmdReq('RESOLVE_COMMITMENT', { factionId: 'f_cinder_court', seed: 9 }));
    assert.strictEqual(resolve.success, true, resolve.errors[0]?.message);
    assert.ok(
      resolve.payload.attackOutcome === 'invasion_created'
      || resolve.payload.attackOutcome === 'awaiting_defense'
      || orch.getState().activeInvasions.size === 1,
      JSON.stringify(resolve.payload),
    );
    const invasionId = [...orch.getState().activeInvasions.keys()][0];
    assert.ok(invasionId);
    const defense = orch.execute(cmdReq('START_WORKOUT', {
      purpose: 'DEFENSE',
      workoutId: 'wk_very_easy_mobility',
      invasionId,
      sessionId: 'wses_p17_def',
      now: 1_000,
    }));
    assert.strictEqual(defense.success, true, defense.errors[0]?.message);
    assert.strictEqual(orch.getState().activeInvasions.get(invasionId)!.status, 'defense_in_progress');
  });

  test('persistence envelope retains authored world identity without embedding WorldDefinition', () => {
    const store = new InMemoryGameStateStore();
    const state = createGameState({ seed: 2, worldId: FIXTURE_TINY_WORLD_ID });
    const saved = store.save('player_p17', state, 0);
    assert.ok(saved.ok, saved.ok ? '' : saved.message);
    assert.strictEqual(saved.record.worldId, 'local');
    assert.strictEqual(saved.record.definitionWorldId, 'w_ember_atoll');
    assert.strictEqual(saved.record.definitionFormatVersion, WORLD_FORMAT_VERSION);
    assert.strictEqual(saved.record.worldLevel, 1);
    assert.strictEqual(saved.record.playerFactionId, 'f_player');
    const blob = JSON.stringify(saved.record.payload);
    assert.ok(!blob.includes('"rings"'), 'payload must not embed island/territory polygons');
    const sqlRound = rowToWorldRecord(worldRecordToRow(saved.record));
    assert.strictEqual(sqlRound.definitionWorldId, 'w_ember_atoll');
    assert.strictEqual(sqlRound.worldLevel, 1);
    assert.strictEqual(sqlRound.playerFactionId, 'f_player');
    state.factions.get('f_salt_raiders')!.personality.aggression = 0.01;
    const tampered = store.save('player_p17_tamper', state, 0);
    assert.ok(tampered.ok, tampered.ok ? '' : tampered.message);
    const restored = store.load('player_p17_tamper');
    assert.ok(restored.ok);
    if (restored.ok) {
      assert.strictEqual(restored.state.factions.get('f_salt_raiders')!.personality.aggression, 0.9);
    }
    const graph = createGameState({ seed: 2, worldId: FIXTURE_TINY_WORLD_ID });
    graph.territories.get('t_01')!.neighboring = ['t_02'];
    applyImmutableWorldDefinition(graph, requireTiny());
    assert.deepStrictEqual(graph.territories.get('t_01')!.neighboring.slice().sort(), ['t_02', 't_03']);
    const loaded = store.load('player_p17');
    assert.ok(loaded.ok);
    if (!loaded.ok) return;
    assert.strictEqual(loaded.state.definitionWorldId, 'w_ember_atoll');
    assert.strictEqual(loaded.state.worldName, 'Ember Atoll');
    assert.strictEqual(loaded.state.territories.get('t_01')!.owner, 'f_player');
    const resolved = resolveWorldDefinition(loaded.state.definitionWorldId!);
    assert.ok(resolved.ok);
    if (resolved.ok) {
      assert.ok(resolved.definition.island.rings[0]!.length >= 3);
      assert.strictEqual(resolved.definition.containedWorlds.length, 0);
    }
  });

  test('contained-world references stay off the playable graph', () => {
    const def = cloneWorld(requireTiny());
    def.containedWorlds = [{
      worldId: 'w_prior_level',
      regionId: 'r_cinder_highlands',
      placement: { origin: { x: 10, y: 20 }, rotationDegrees: 0, scale: 0.25 },
    }];
    const state = createGameStateFromWorld(def);
    assert.ok(!state.territories.has('w_prior_level'));
    for (const t of state.territories.values()) {
      assert.ok(!t.neighboring.includes('w_prior_level'));
    }
    assert.strictEqual(resolveWorldDefinition('w_prior_level').ok, false);
  });

  console.log('Phase 17Q — production world registration / authoring readiness');

  test('world selection is centralized; production catalog ships Level 1 and not the tiny fixture', () => {
    assert.strictEqual(DEFAULT_PRODUCTION_WORLD_ID, PRODUCTION_LEVEL_1_WORLD_ID);
    assert.strictEqual(FIXTURE_WORLD_REGISTRATIONS.length, 1);
    assert.strictEqual(FIXTURE_WORLD_REGISTRATIONS[0]!.worldId, FIXTURE_TINY_WORLD_ID);
    assert.ok(PRODUCTION_WORLD_REGISTRATIONS.every((r) => r.role === 'production'));
    assert.ok(!PRODUCTION_WORLD_REGISTRATIONS.some((r) => r.worldId === FIXTURE_TINY_WORLD_ID));
    const productionOnly = createProductionWorldCatalog();
    assert.deepStrictEqual(productionOnly.registeredIds(), [PRODUCTION_LEVEL_1_WORLD_ID]);
    const missingFixture = productionOnly.load(FIXTURE_TINY_WORLD_ID);
    assert.strictEqual(missingFixture.ok, false);
    const prodState = createGameState({ catalog: productionOnly, seed: 1 });
    assert.strictEqual(prodState.definitionWorldId, PRODUCTION_LEVEL_1_WORLD_ID);
    const runtime = createWorldCatalog({ includeProduction: true, includeFixtures: true });
    const loaded = runtime.load(DEFAULT_PRODUCTION_WORLD_ID);
    assert.ok(loaded.ok);
    assert.ok(runtime.load(FIXTURE_TINY_WORLD_ID).ok);
  });

  test('missing, malformed, and unsupported worlds fail closed with the configured id', () => {
    const empty = new WorldCatalog();
    assert.throws(
      () => createGameState({ catalog: empty, worldId: 'w_level_1' }),
      /configured world w_level_1 could not be loaded: catalog.missing/,
    );
    const malformed = parseWorldJson('{');
    assert.strictEqual(malformed.ok, false);
    const unsupported = parseWorldJson(JSON.stringify({ formatVersion: 'rep-wars-world.v0', worldId: 'w_x' }));
    assert.strictEqual(unsupported.ok, false);
    if (!unsupported.ok) assert.ok(unsupported.issues.some((i) => i.code === 'format.unsupported'));
    const mismatch = new WorldCatalog().registerFile(tinyWorldJsonPath(), 'w_not_this_file');
    assert.strictEqual(mismatch.ok, false);
    if (!mismatch.ok) assert.ok(mismatch.issues.some((i) => i.code === 'catalog.world_id_mismatch'));
    assert.notStrictEqual(createGameState({ seed: 1 }).definitionWorldId, 'legacy:sample-map');
  });

  test('world identity is consistent across definition, GameState, catalog, and persistence', () => {
    const def = requireTiny();
    const fromDef = identityFromDefinition(def);
    const state = createGameState({ worldId: FIXTURE_TINY_WORLD_ID, seed: 2 });
    const fromState = identityFromGameState(state);
    assert.ok(fromState);
    assert.ok(worldIdentitiesEqual(fromDef, fromState!));
    const cataloged = getDefaultWorldCatalog().load(fromDef.worldId);
    assert.ok(cataloged.ok);
    if (cataloged.ok) {
      assert.ok(worldIdentitiesEqual(fromDef, identityFromDefinition(cataloged.definition)));
    }
    const created = initializePlayerWorld({
      playerId: 'player_17q',
      store: new InMemoryGameStateStore(),
      seed: 2,
      worldId: FIXTURE_TINY_WORLD_ID,
    });
    assert.strictEqual(created.record?.definitionWorldId, fromDef.worldId);
    assert.strictEqual(created.record?.definitionFormatVersion, fromDef.formatVersion);
    assert.strictEqual(created.record?.worldLevel, fromDef.level);
    assert.strictEqual(created.state.definitionWorldId, fromDef.worldId);
  });

  test('Map Assistant JSON contract: tiny fixture loads through WorldCatalog into GameState', () => {
    const catalog = new WorldCatalog();
    const registered = catalog.registerFile(tinyWorldJsonPath(), FIXTURE_TINY_WORLD_ID);
    assert.ok(registered.ok, registered.ok ? '' : registered.issues.map((i) => `${i.code}: ${i.message}`).join('; '));
    if (!registered.ok) return;
    const def = registered.definition;
    assert.strictEqual(def.formatVersion, WORLD_FORMAT_VERSION);
    assert.strictEqual(def.worldId, FIXTURE_TINY_WORLD_ID);
    assert.strictEqual(def.level, 1);
    assert.strictEqual(def.territories.length, 6);
    assert.strictEqual(def.regions.length, 2);
    assert.deepStrictEqual(validateWorldDefinition(def), []);
    const state = createGameStateFromWorld(def);
    assert.strictEqual(state.definitionWorldId, def.worldId);
    assert.strictEqual(state.definitionFormatVersion, def.formatVersion);
    assert.strictEqual(state.worldLevel, def.level);
    assert.strictEqual(state.territories.size, def.territories.length);
    assert.strictEqual(state.regions.size, def.regions.length);
    assert.strictEqual(state.cities.size, 0);
    const owners = Object.fromEntries([...state.territories.values()].map((t) => [t.id, t.owner]));
    const expectedOwners = Object.fromEntries(def.territories.map((t) => [t.id, t.startingOwnerFactionId]));
    assert.deepStrictEqual(owners, expectedOwners);
    for (const tDef of def.territories) {
      assert.deepStrictEqual(state.territories.get(tDef.id)!.neighboring.slice().sort(), [...tDef.neighborIds].sort());
    }
    const salt = def.factions.find((f) => f.id === 'f_salt_raiders')!;
    assert.strictEqual(state.factions.get('f_salt_raiders')!.personality.aggression, salt.personality!.traits.aggression);
    assert.strictEqual(state.factions.get('f_salt_raiders')!.ambition, salt.personality!.ambition);
    for (const t of state.territories.values()) {
      assert.ok(!('name' in t));
      assert.ok(!('isCapital' in t));
      assert.ok(!('isKnown' in t));
      assert.ok(!('scoutedTurnsAgo' in t));
    }
  });
}
