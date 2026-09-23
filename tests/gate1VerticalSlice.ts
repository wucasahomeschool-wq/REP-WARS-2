/**
 * Gate 1 Phase 1A — vertical-slice scenario freshness, determinism, isolation, reset.
 */
import assert from 'assert';
import {
  checkGameStateInvariants,
  getAuthoredWorkoutCatalog,
  snapshotGameState,
} from '../src';
import {
  VERTICAL_SLICE_AI_1_ARMY,
  VERTICAL_SLICE_AI_1_FACTION_ID,
  VERTICAL_SLICE_AI_2_ARMY,
  VERTICAL_SLICE_AI_2_FACTION_ID,
  VERTICAL_SLICE_INITIAL_BANKED_TROOPS,
  VERTICAL_SLICE_PLAYER_ADJACENT_ENEMIES,
  VERTICAL_SLICE_PLAYER_FACTION_ID,
  VERTICAL_SLICE_PLAYER_ID,
  VERTICAL_SLICE_SECONDARY_ENEMY_TERRITORY,
  VERTICAL_SLICE_TERRITORY_A,
  VERTICAL_SLICE_TERRITORY_B,
  VERTICAL_SLICE_TERRITORY_C,
  VERTICAL_SLICE_TERRITORY_D,
  VERTICAL_SLICE_WORLD_ID,
  VERTICAL_SLICE_WORLD_LEVEL,
  VERTICAL_SLICE_WORLD_NAME,
  VERTICAL_SLICE_WORKOUT_CATALOG_ID,
  createVerticalSliceScenario,
  resetVerticalSliceScenario,
} from './fixtures/gate1VerticalSliceScenario';

export interface Gate1VerticalSliceTestApi {
  test: (name: string, fn: () => void) => void;
}

function ownershipMap(scenarioState: ReturnType<typeof createVerticalSliceScenario>['state']): Record<string, string | null> {
  return {
    [VERTICAL_SLICE_TERRITORY_A]: scenarioState.territories.get(VERTICAL_SLICE_TERRITORY_A)?.owner ?? null,
    [VERTICAL_SLICE_TERRITORY_B]: scenarioState.territories.get(VERTICAL_SLICE_TERRITORY_B)?.owner ?? null,
    [VERTICAL_SLICE_TERRITORY_C]: scenarioState.territories.get(VERTICAL_SLICE_TERRITORY_C)?.owner ?? null,
    [VERTICAL_SLICE_TERRITORY_D]: scenarioState.territories.get(VERTICAL_SLICE_TERRITORY_D)?.owner ?? null,
  };
}

function assertKnownInitialWorld(state: ReturnType<typeof createVerticalSliceScenario>['state']): void {
  assert.strictEqual(state.definitionWorldId, VERTICAL_SLICE_WORLD_ID);
  assert.strictEqual(state.worldName, VERTICAL_SLICE_WORLD_NAME);
  assert.strictEqual(state.worldLevel, VERTICAL_SLICE_WORLD_LEVEL);
  assert.strictEqual(state.playerFactionId, VERTICAL_SLICE_PLAYER_FACTION_ID);
  assert.ok(state.factions.has(VERTICAL_SLICE_PLAYER_FACTION_ID));
  assert.ok(state.factions.has(VERTICAL_SLICE_AI_1_FACTION_ID));
  assert.ok(state.factions.has(VERTICAL_SLICE_AI_2_FACTION_ID));
  assert.deepStrictEqual(
    [...state.allFactionIds].sort(),
    [VERTICAL_SLICE_AI_1_FACTION_ID, VERTICAL_SLICE_AI_2_FACTION_ID, VERTICAL_SLICE_PLAYER_FACTION_ID].sort(),
  );

  for (const id of [
    VERTICAL_SLICE_TERRITORY_A,
    VERTICAL_SLICE_TERRITORY_B,
    VERTICAL_SLICE_TERRITORY_C,
    VERTICAL_SLICE_TERRITORY_D,
  ]) {
    assert.ok(state.territories.has(id), `missing territory ${id}`);
  }

  assert.deepStrictEqual(ownershipMap(state), {
    [VERTICAL_SLICE_TERRITORY_A]: VERTICAL_SLICE_PLAYER_FACTION_ID,
    [VERTICAL_SLICE_TERRITORY_B]: VERTICAL_SLICE_AI_1_FACTION_ID,
    [VERTICAL_SLICE_TERRITORY_C]: VERTICAL_SLICE_AI_1_FACTION_ID,
    [VERTICAL_SLICE_TERRITORY_D]: VERTICAL_SLICE_AI_2_FACTION_ID,
  });

  const home = state.territories.get(VERTICAL_SLICE_TERRITORY_A)!;
  assert.deepStrictEqual([...home.neighboring].sort(), [...VERTICAL_SLICE_PLAYER_ADJACENT_ENEMIES].sort());
  for (const enemyId of VERTICAL_SLICE_PLAYER_ADJACENT_ENEMIES) {
    const enemy = state.territories.get(enemyId)!;
    assert.ok(enemy.neighboring.includes(VERTICAL_SLICE_TERRITORY_A));
    assert.notStrictEqual(enemy.owner, VERTICAL_SLICE_PLAYER_FACTION_ID);
  }
  assert.ok(state.territories.has(VERTICAL_SLICE_SECONDARY_ENEMY_TERRITORY));
  assert.strictEqual(
    state.territories.get(VERTICAL_SLICE_SECONDARY_ENEMY_TERRITORY)!.owner,
    VERTICAL_SLICE_AI_2_FACTION_ID,
  );

  assert.strictEqual(state.playerRewards.bankedTroops, VERTICAL_SLICE_INITIAL_BANKED_TROOPS);
  assert.strictEqual(state.playerFitness.activeSession, null);
  assert.deepStrictEqual(state.playerFitness.compactHistory, []);
  assert.strictEqual(state.level1Tutorial, null, 'Gate 1 slice must not bind production Level 1 tutorial');

  const player = state.factions.get(VERTICAL_SLICE_PLAYER_FACTION_ID)!;
  assert.deepStrictEqual(player.armies, []);
  assert.deepStrictEqual(player.territories, [VERTICAL_SLICE_TERRITORY_A]);

  const ai1 = state.factions.get(VERTICAL_SLICE_AI_1_FACTION_ID)!;
  assert.strictEqual(ai1.armies.length, 1);
  const ai1Army = state.armies.get(ai1.armies[0]!)!;
  assert.strictEqual(ai1Army.owner, VERTICAL_SLICE_AI_1_FACTION_ID);
  assert.strictEqual(ai1Army.location, VERTICAL_SLICE_AI_1_ARMY.locationTerritoryId);
  assert.strictEqual(ai1Army.soldiers, VERTICAL_SLICE_AI_1_ARMY.soldiers);
  assert.strictEqual(ai1Army.knights, VERTICAL_SLICE_AI_1_ARMY.knights);
  assert.strictEqual(ai1Army.siegeEngines, VERTICAL_SLICE_AI_1_ARMY.siegeEngines);

  const ai2 = state.factions.get(VERTICAL_SLICE_AI_2_FACTION_ID)!;
  assert.strictEqual(ai2.armies.length, 1);
  const ai2Army = state.armies.get(ai2.armies[0]!)!;
  assert.strictEqual(ai2Army.owner, VERTICAL_SLICE_AI_2_FACTION_ID);
  assert.strictEqual(ai2Army.location, VERTICAL_SLICE_AI_2_ARMY.locationTerritoryId);
  assert.strictEqual(ai2Army.soldiers, VERTICAL_SLICE_AI_2_ARMY.soldiers);
  assert.strictEqual(ai2Army.knights, VERTICAL_SLICE_AI_2_ARMY.knights);
  assert.strictEqual(ai2Army.siegeEngines, VERTICAL_SLICE_AI_2_ARMY.siegeEngines);

  assert.deepStrictEqual(checkGameStateInvariants(state), []);
}

export function registerGate1VerticalSliceTests(api: Gate1VerticalSliceTestApi): void {
  const { test } = api;

  console.log('Gate 1 Phase 1A — vertical-slice scenario');

  test('fresh vertical-slice state matches the known Gate 1 miniature world', () => {
    assert.strictEqual(getAuthoredWorkoutCatalog(), null, 'fixture must not auto-install workout catalog');
    const scenario = createVerticalSliceScenario();
    assert.strictEqual(scenario.playerId, VERTICAL_SLICE_PLAYER_ID);
    assert.strictEqual(scenario.worldId, VERTICAL_SLICE_WORLD_ID);
    assert.strictEqual(scenario.definition.worldId, VERTICAL_SLICE_WORLD_ID);
    assert.strictEqual(scenario.workoutCatalog.catalogId, VERTICAL_SLICE_WORKOUT_CATALOG_ID);
    assert.strictEqual(getAuthoredWorkoutCatalog(), null, 'compiling fixture catalog must not install it');
    assertKnownInitialWorld(scenario.state);
  });

  test('createVerticalSliceScenario is deterministic across two fresh builds', () => {
    const a = createVerticalSliceScenario();
    const b = createVerticalSliceScenario();
    assert.deepStrictEqual(snapshotGameState(a.state), snapshotGameState(b.state));
    assert.strictEqual(a.workoutCatalog.catalogId, b.workoutCatalog.catalogId);
    assert.strictEqual(a.workoutCatalog.catalogVersion, b.workoutCatalog.catalogVersion);
  });

  test('creating a second scenario is isolated from mutations on the first', () => {
    const a = createVerticalSliceScenario();
    a.state.playerRewards.bankedTroops = 999;
    a.state.territories.get(VERTICAL_SLICE_TERRITORY_B)!.owner = VERTICAL_SLICE_PLAYER_FACTION_ID;
    a.state.playerFitness.compactHistory.push({
      sessionId: 'wses_mutated',
      completedAt: 1_000,
      completedAtTick: 1,
      purpose: 'NORMAL_TROOPS',
    });
    const player = a.state.factions.get(VERTICAL_SLICE_PLAYER_FACTION_ID)!;
    player.territories.push(VERTICAL_SLICE_TERRITORY_B);

    const b = createVerticalSliceScenario();
    assertKnownInitialWorld(b.state);
    assert.notStrictEqual(a.state, b.state);
    assert.strictEqual(a.state.playerRewards.bankedTroops, 999);
    assert.strictEqual(b.state.playerRewards.bankedTroops, VERTICAL_SLICE_INITIAL_BANKED_TROOPS);
  });

  test('resetVerticalSliceScenario restores known initial state after mutation', () => {
    const scenario = createVerticalSliceScenario();
    scenario.state.playerRewards.bankedTroops = 500;
    scenario.state.territories.get(VERTICAL_SLICE_TERRITORY_A)!.owner = VERTICAL_SLICE_AI_1_FACTION_ID;
    scenario.state.worldTick = 42;
    scenario.state.playerFitness.compactHistory.push({
      sessionId: 'wses_old',
      completedAt: 2_000,
      completedAtTick: 1,
      purpose: 'NORMAL_TROOPS',
    });

    const reset = resetVerticalSliceScenario(scenario.state);
    assert.strictEqual(reset.state, scenario.state);
    assertKnownInitialWorld(scenario.state);
    assert.strictEqual(scenario.state.worldTick, 0);

    const fresh = resetVerticalSliceScenario();
    assertKnownInitialWorld(fresh.state);
    assert.deepStrictEqual(snapshotGameState(fresh.state), snapshotGameState(scenario.state));
  });
}
