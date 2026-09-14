import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  COMMAND_INDEX,
  ErrorCode,
  GAMEPLAY_CONFIG,
  GAME_STATE_SCHEMA_VERSION,
  Orchestrator,
  WORLD_FORMAT_VERSION,
  checkGameStateInvariants,
  cloneGameState,
  createGameState,
  createGameStateFromWorld,
  createLegacySampleMapGameState,
  hydratePersistedPayload,
  loadTinyWorldDefinition,
  loadWorldDefinition,
  parseWorldJson,
  progressWorldEconomy,
  serializeToJson,
  snapshotGameState,
  startConstruction,
  validateWorldDefinition,
} from '../src';
import { GoalSystem } from '../src/goals/GoalSystem';
import { plantCity } from './worldTestHelpers';
import type { CommandRequest } from '../src';
import type { WorldDefinition } from '../src';

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

  test('production createGameState() uses the tiny authored world, not SAMPLE_MAP', () => {
    const state = createGameState({ seed: 1 });
    assert.strictEqual(state.schemaVersion, GAME_STATE_SCHEMA_VERSION);
    assert.strictEqual(state.definitionWorldId, 'w_ember_atoll');
    assert.strictEqual(state.definitionFormatVersion, WORLD_FORMAT_VERSION);
    assert.strictEqual(state.worldLevel, 1);
    assert.strictEqual(state.worldName, 'Ember Atoll');
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
    const orch = new Orchestrator(createGameState({ seed: 1 }));
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
    const state = createGameState({ seed: 1 });
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
    const orch = new Orchestrator(createGameState({ seed: 1 }));
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
    const state = createGameState({ seed: 1 });
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
    assert.strictEqual(loaded.definitionWorldId, 'w_ember_atoll');
    assert.strictEqual(loaded.worldLevel, 1);
    assert.strictEqual(loaded.definitionFormatVersion, WORLD_FORMAT_VERSION);
    assert.strictEqual(loaded.playerFactionId, 'f_player');
    assert.ok(loaded.factions.has('f_player'));
    assert.deepStrictEqual(checkGameStateInvariants(loaded), []);
    const cloned = cloneGameState(loaded);
    assert.strictEqual(cloned.definitionWorldId, 'w_ember_atoll');
  });
}
