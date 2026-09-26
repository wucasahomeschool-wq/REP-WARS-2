import assert from 'assert';
import {
  ECONOMY_CONFIG,
  ErrorCode,
  GAMEPLAY_CONFIG,
  Orchestrator,
  cloneGameState,
  collectTerritoryYield,
  consumeEmpireFood,
  createLegacySampleMapGameState,
  checkGameStateInvariants,
  GAME_STATE_SCHEMA_VERSION,
  getConstructionProjectDefinition,
  peekCollectibleResources,
  productionAccrued,
  progressWorldEconomy,
  startConstruction,
  syncAllFactionResourceIncome,
  foodConsumptionDisabled,
} from '../src';
import type { CommandRequest, GameState } from '../src';
import { plantOwnedCities } from './worldTestHelpers';

export interface EconomyFoundationTestApi {
  test: (name: string, fn: () => void) => void;
}

const PLAYER_ID = 'player_1';

function cmdReq(commandId: string, parameters: Record<string, unknown> = {}): CommandRequest {
  return { commandId, playerId: PLAYER_ID, requestId: `${commandId}_econ_foundation`, parameters };
}

function advanceWorld(orch: Orchestrator, ticks: number): void {
  const res = orch.execute(cmdReq('ADVANCE_WORLD', { elapsedTicks: ticks }));
  assert.strictEqual(res.success, true, res.errors?.[0]?.message);
}

export function registerEconomyFoundationTests({ test }: EconomyFoundationTestApi): void {
  test('BUILD and START_CONSTRUCTION FORTIFICATION share one construction definition', () => {
    const def = getConstructionProjectDefinition('FORTIFICATION');
    assert.strictEqual(def.cost.gold, GAMEPLAY_CONFIG.constructionGoldCost);
    assert.strictEqual(def.cost.stone, GAMEPLAY_CONFIG.constructionStoneCost);
    assert.strictEqual(def.cost.iron, undefined);
    assert.strictEqual(def.durationTicks, GAMEPLAY_CONFIG.defaultConstructionDurationTicks);
  });

  test('CITY construction costs gold, stone, and iron', () => {
    const def = getConstructionProjectDefinition('CITY');
    assert.strictEqual(def.cost.gold, GAMEPLAY_CONFIG.cityGoldCost);
    assert.strictEqual(def.cost.stone, GAMEPLAY_CONFIG.cityStoneCost);
    assert.strictEqual(def.cost.iron, GAMEPLAY_CONFIG.cityIronCost);
    assert.strictEqual(def.cost.wood, undefined);
    assert.strictEqual(def.cost.food, undefined);
    assert.strictEqual(def.durationTicks, GAMEPLAY_CONFIG.cityConstructionDurationTicks);
  });

  test('BUILD starts timed fortification rather than instant fort level', () => {
    const state = createLegacySampleMapGameState({ seed: 42, playerFactionId: 'merchant_republic' });
    plantOwnedCities(state);
    const fid = 'merchant_republic';
    const owned = state.factions.get(fid)!.territories[0]!;
    const fortBefore = state.territories.get(owned)!.fortification;
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('BUILD', { territoryId: owned, factionId: fid }));
    assert.strictEqual(res.success, true);
    assert.strictEqual(orch.getState().territories.get(owned)!.fortification, fortBefore);
    assert.ok([...orch.getState().constructions.values()].some((p) => p.territoryId === owned && p.status === 'in_progress'));
    advanceWorld(orch, GAMEPLAY_CONFIG.defaultConstructionDurationTicks);
    assert.strictEqual(orch.getState().territories.get(owned)!.fortification, fortBefore + 1);
  });

  test('COLLECT_RESOURCES reports all resource keys in resourcesChanged', () => {
    const state = createLegacySampleMapGameState({ seed: 7, playerFactionId: 'iron_kingdom' });
    const fid = 'iron_kingdom';
    const owned = state.factions.get(fid)!.territories[0]!;
    state.worldTick = ECONOMY_CONFIG.ticksPerProductionCycle;
    progressWorldEconomy(state);
    const before = peekCollectibleResources(state, owned);
    assert.ok(before.food > 0 || before.wood > 0 || before.gold > 0, 'expected accrual on fixture tile');
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('COLLECT_RESOURCES', { territoryId: owned, factionId: fid }));
    assert.strictEqual(res.success, true);
    for (const key of ['gold', 'food', 'iron', 'wood', 'stone'] as const) {
      if (before[key] <= 0) continue;
      const change = res.resourcesChanged.find((c) => c.resource === key);
      assert.ok(change, `missing resourcesChanged for ${key}`);
      assert.strictEqual(change!.to - change!.from, before[key]);
    }
    assert.ok(res.payload.transferredResources);
    assert.ok(res.payload.baseResources);
  });

  test('Golden Yield collect payload includes full transferred resources', () => {
    const state = createLegacySampleMapGameState({ seed: 9, playerFactionId: 'iron_kingdom' });
    const fid = 'iron_kingdom';
    const owned = state.factions.get(fid)!.territories[0]!;
    state.worldTick = ECONOMY_CONFIG.ticksPerProductionCycle;
    progressWorldEconomy(state);
    state.playerRewards.pendingGoldenYieldEffects.push({
      applicationId: 'gy_test',
      sessionId: 'sess',
      workoutId: 'wk',
      playerId: PLAYER_ID,
      multiplier: 2,
      effect: 'ONE_TIME_COLLECTION',
      permanence: 'EPHEMERAL',
      consumed: false,
      appliedAtTick: state.worldTick,
      sourcePhysicalOutput: 50,
    });
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('COLLECT_RESOURCES', {
      territoryId: owned,
      factionId: fid,
      useGoldenYield: true,
    }));
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.payload.effectConsumed, true);
    assert.strictEqual(res.payload.multiplier, 2);
    assert.ok(res.payload.transferredResources);
    assert.strictEqual(res.payload.multiplier, 2);
  });

  test('production accrual unchanged after construction consolidation', () => {
    const rating = { gold: 12, food: 8, iron: 0, wood: 4, stone: 2 };
    const gained = productionAccrued(rating, ECONOMY_CONFIG.ticksPerProductionCycle);
    assert.strictEqual(gained.gold, 12);
    assert.strictEqual(gained.food, 8);
    assert.strictEqual(gained.wood, 4);
    assert.strictEqual(gained.stone, 2);
  });

  test('resourceIncome derives from owned territory resourceOutput on sync', () => {
    const state = createLegacySampleMapGameState({ seed: 3, playerFactionId: 'iron_kingdom' });
    syncAllFactionResourceIncome(state);
    const fid = 'iron_kingdom';
    const faction = state.factions.get(fid)!;
    let expectedGold = 0;
    for (const tid of faction.territories) {
      expectedGold += state.territories.get(tid)?.resourceOutput.gold ?? 0;
    }
    assert.strictEqual(faction.resourceIncome.gold ?? 0, expectedGold);
  });

  test('START_CONSTRUCTION records gold and stone spend in resourcesChanged', () => {
    const state = createLegacySampleMapGameState({ seed: 11, playerFactionId: 'merchant_republic' });
    plantOwnedCities(state);
    const fid = 'merchant_republic';
    const owned = state.factions.get(fid)!.territories[0]!;
    const def = getConstructionProjectDefinition('FORTIFICATION');
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('START_CONSTRUCTION', { territoryId: owned, factionId: fid, projectType: 'FORTIFICATION' }));
    assert.strictEqual(res.success, true);
    const gold = res.resourcesChanged.find((c) => c.resource === 'gold');
    const stone = res.resourcesChanged.find((c) => c.resource === 'stone');
    assert.ok(gold && gold.from - gold.to === def.cost.gold);
    assert.ok(stone && stone.from - stone.to === def.cost.stone);
    assert.ok(!res.resourcesChanged.some((c) => c.resource === 'iron' || c.resource === 'food' || c.resource === 'wood'));
  });

  test('insufficient resources leaves state unchanged on BUILD alias', () => {
    const state = createLegacySampleMapGameState({ seed: 42, playerFactionId: 'merchant_republic' });
    plantOwnedCities(state);
    const fid = 'merchant_republic';
    const owned = state.factions.get(fid)!.territories[0]!;
    state.factions.get(fid)!.resources.gold = 0;
    const before = cloneGameState(state);
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('BUILD', { territoryId: owned, factionId: fid }));
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errors[0]!.code, ErrorCode.INSUFFICIENT_RESOURCES);
    assert.deepStrictEqual(orch.getState(), before);
  });

  test('CITY construction charges gold, stone, and iron in resourcesChanged', () => {
    const state = createLegacySampleMapGameState({ seed: 11, playerFactionId: 'merchant_republic' });
    const fid = 'merchant_republic';
    const owned = state.factions.get(fid)!.territories[0]!;
    const def = getConstructionProjectDefinition('CITY');
    const ironBefore = state.factions.get(fid)!.resources.iron;
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('START_CONSTRUCTION', { territoryId: owned, factionId: fid, projectType: 'CITY' }));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    for (const key of ['gold', 'stone', 'iron'] as const) {
      const change = res.resourcesChanged.find((c) => c.resource === key);
      assert.ok(change, `missing resourcesChanged for ${key}`);
      assert.strictEqual(change!.from - change!.to, def.cost[key]);
    }
    assert.ok(!res.resourcesChanged.some((c) => c.resource === 'food' || c.resource === 'wood'));
    assert.strictEqual(orch.getState().factions.get(fid)!.resources.iron, ironBefore - GAMEPLAY_CONFIG.cityIronCost);
  });

  test('insufficient iron leaves state unchanged on CITY', () => {
    const state = createLegacySampleMapGameState({ seed: 11, playerFactionId: 'merchant_republic' });
    const fid = 'merchant_republic';
    const owned = state.factions.get(fid)!.territories[0]!;
    state.factions.get(fid)!.resources.iron = GAMEPLAY_CONFIG.cityIronCost - 1;
    const before = cloneGameState(state);
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('START_CONSTRUCTION', { territoryId: owned, factionId: fid, projectType: 'CITY' }));
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errors[0]!.code, ErrorCode.INSUFFICIENT_RESOURCES);
    assert.deepStrictEqual(orch.getState(), before);
  });

  test('schema 13 seeds food clock at worldTick and empty infrastructure occupancy', () => {
    const state = createLegacySampleMapGameState({ seed: 42, playerFactionId: 'iron_kingdom' });
    assert.strictEqual(state.schemaVersion, GAME_STATE_SCHEMA_VERSION);
    assert.strictEqual(GAME_STATE_SCHEMA_VERSION, 13);
    assert.strictEqual(state.lastFoodConsumptionTick, state.worldTick);
    assert.strictEqual(state.territoryInfrastructure.size, state.territories.size);
    for (const territory of state.territories.values()) {
      const infra = state.territoryInfrastructure.get(territory.id);
      assert.ok(infra, `missing infrastructure for ${territory.id}`);
      assert.strictEqual(infra.territoryId, territory.id);
      assert.strictEqual(infra.farmCompletedAtTick, null);
      assert.strictEqual(infra.mineCompletedAtTick, null);
      assert.strictEqual(infra.lumberCompletedAtTick, null);
    }
    assert.deepStrictEqual(checkGameStateInvariants(state), []);
  });

  test('Level 1 worldLevel gates Food consume and still advances the food clock', () => {
    const state = createLegacySampleMapGameState({ seed: 4, playerFactionId: 'iron_kingdom' });
    assert.strictEqual(foodConsumptionDisabled(state), true);
    const fid = 'iron_kingdom';
    const stabBefore = state.factions.get(fid)!.stability;
    state.factions.get(fid)!.resources.food = 0;
    state.worldTick = 120;
    const result = consumeEmpireFood(state);
    assert.strictEqual(result.gated, true);
    assert.strictEqual(result.cycles, 2);
    assert.strictEqual(state.lastFoodConsumptionTick, 120);
    assert.strictEqual(state.factions.get(fid)!.resources.food, 0);
    assert.strictEqual(state.factions.get(fid)!.stability, stabBefore);
    assert.strictEqual(result.factions.length, 0);
  });

  test('Food consume pays 1 Food per owned territory per cycle with no Stability change', () => {
    const state = createLegacySampleMapGameState({ seed: 5, playerFactionId: 'iron_kingdom' });
    state.worldLevel = 2;
    const fid = 'iron_kingdom';
    const demand = state.factions.get(fid)!.territories.length * ECONOMY_CONFIG.foodPerTerritoryPerCycle;
    const foodBefore = demand * 8;
    const stabBefore = state.factions.get(fid)!.stability;
    state.factions.get(fid)!.resources.food = foodBefore;
    state.worldTick = ECONOMY_CONFIG.ticksPerProductionCycle;
    const result = consumeEmpireFood(state);
    assert.strictEqual(result.gated, false);
    assert.strictEqual(result.cycles, 1);
    assert.strictEqual(state.factions.get(fid)!.resources.food, foodBefore - demand);
    assert.strictEqual(state.factions.get(fid)!.stability, stabBefore);
    const row = result.factions.find((f) => f.factionId === fid);
    assert.ok(row);
    assert.strictEqual(row!.paid, demand);
    assert.strictEqual(row!.failedCycles, 0);
    assert.strictEqual(state.lastFoodConsumptionTick, 60);
  });

  test('failed Food cycle zeros banked Food and subtracts 2 Stability', () => {
    const state = createLegacySampleMapGameState({ seed: 6, playerFactionId: 'iron_kingdom' });
    state.worldLevel = 2;
    const fid = 'iron_kingdom';
    state.factions.get(fid)!.resources.food = 0;
    state.factions.get(fid)!.stability = 70;
    state.worldTick = 60;
    const result = consumeEmpireFood(state);
    const row = result.factions.find((f) => f.factionId === fid)!;
    assert.strictEqual(state.factions.get(fid)!.resources.food, 0);
    assert.strictEqual(state.factions.get(fid)!.stability, 68);
    assert.strictEqual(row.failedCycles, 1);
    assert.strictEqual(row.paid, 0);
  });

  test('partial Food pays what remains then fails the cycle', () => {
    const state = createLegacySampleMapGameState({ seed: 7, playerFactionId: 'iron_kingdom' });
    state.worldLevel = 2;
    const fid = 'iron_kingdom';
    const demand = state.factions.get(fid)!.territories.length * ECONOMY_CONFIG.foodPerTerritoryPerCycle;
    assert.ok(demand > 1);
    state.factions.get(fid)!.resources.food = demand - 1;
    state.factions.get(fid)!.stability = 70;
    state.worldTick = 60;
    consumeEmpireFood(state);
    assert.strictEqual(state.factions.get(fid)!.resources.food, 0);
    assert.strictEqual(state.factions.get(fid)!.stability, 68);
  });

  test('failed Food cycles clamp Stability at 0', () => {
    const state = createLegacySampleMapGameState({ seed: 8, playerFactionId: 'iron_kingdom' });
    state.worldLevel = 2;
    const fid = 'iron_kingdom';
    state.factions.get(fid)!.resources.food = 0;
    state.factions.get(fid)!.stability = 1;
    state.worldTick = 60;
    consumeEmpireFood(state);
    assert.strictEqual(state.factions.get(fid)!.stability, 0);
    consumeEmpireFood(state);
    assert.strictEqual(state.factions.get(fid)!.stability, 0);
  });

  test('Food consume lumps N production cycles in one pass', () => {
    const state = createLegacySampleMapGameState({ seed: 9, playerFactionId: 'iron_kingdom' });
    state.worldLevel = 2;
    const fid = 'iron_kingdom';
    const demand = state.factions.get(fid)!.territories.length * ECONOMY_CONFIG.foodPerTerritoryPerCycle;
    state.factions.get(fid)!.resources.food = demand * 2 + 5;
    state.factions.get(fid)!.stability = 70;
    state.worldTick = 120;
    const paid = consumeEmpireFood(state);
    assert.strictEqual(paid.cycles, 2);
    assert.strictEqual(state.factions.get(fid)!.resources.food, 5);
    assert.strictEqual(state.factions.get(fid)!.stability, 70);

    const fail = createLegacySampleMapGameState({ seed: 9, playerFactionId: 'iron_kingdom' });
    fail.worldLevel = 2;
    fail.factions.get(fid)!.resources.food = 0;
    fail.factions.get(fid)!.stability = 70;
    fail.worldTick = 120;
    const failed = consumeEmpireFood(fail);
    assert.strictEqual(failed.cycles, 2);
    assert.strictEqual(fail.factions.get(fid)!.resources.food, 0);
    assert.strictEqual(fail.factions.get(fid)!.stability, 66);
    assert.strictEqual(failed.factions.find((f) => f.factionId === fid)!.failedCycles, 2);
  });

  test('AI factions consume Food on worldLevel 2 fixtures', () => {
    const state = createLegacySampleMapGameState({ seed: 10, playerFactionId: 'iron_kingdom' });
    state.worldLevel = 2;
    const ai = 'ashen_horde';
    const demand = state.factions.get(ai)!.territories.length * ECONOMY_CONFIG.foodPerTerritoryPerCycle;
    const foodBefore = demand * 4;
    const stabBefore = state.factions.get(ai)!.stability;
    state.factions.get(ai)!.resources.food = foodBefore;
    state.worldTick = 60;
    consumeEmpireFood(state);
    assert.strictEqual(state.factions.get(ai)!.resources.food, foodBefore - demand);
    assert.strictEqual(state.factions.get(ai)!.stability, stabBefore);
  });

  test('Food consume does not touch uncollected territory Food', () => {
    const state = createLegacySampleMapGameState({ seed: 11, playerFactionId: 'iron_kingdom' });
    state.worldLevel = 2;
    const owned = state.factions.get('iron_kingdom')!.territories[0]!;
    state.worldTick = 60;
    const uncollected = peekCollectibleResources(state, owned).food;
    consumeEmpireFood(state);
    assert.strictEqual(peekCollectibleResources(state, owned).food, uncollected);
  });

  test('gated Food clock prevents back-charge after worldLevel 2', () => {
    const state = createLegacySampleMapGameState({ seed: 12, playerFactionId: 'iron_kingdom' });
    const fid = 'iron_kingdom';
    const demand = state.factions.get(fid)!.territories.length * ECONOMY_CONFIG.foodPerTerritoryPerCycle;
    state.factions.get(fid)!.resources.food = demand * 10;
    state.factions.get(fid)!.stability = 70;
    state.worldTick = 120;
    consumeEmpireFood(state);
    assert.strictEqual(state.lastFoodConsumptionTick, 120);
    assert.strictEqual(state.factions.get(fid)!.resources.food, demand * 10);
    state.worldLevel = 2;
    state.worldTick = 180;
    consumeEmpireFood(state);
    assert.strictEqual(state.lastFoodConsumptionTick, 180);
    assert.strictEqual(state.factions.get(fid)!.resources.food, demand * 9);
    assert.strictEqual(state.factions.get(fid)!.stability, 70);
  });

  test('progressWorldEconomy catch-up at 60 and 120 ticks consumes once per cycle', () => {
    const state = createLegacySampleMapGameState({ seed: 13, playerFactionId: 'iron_kingdom' });
    state.worldLevel = 2;
    const fid = 'iron_kingdom';
    const demand = state.factions.get(fid)!.territories.length * ECONOMY_CONFIG.foodPerTerritoryPerCycle;
    state.factions.get(fid)!.resources.food = demand * 10;
    state.worldTick = 60;
    progressWorldEconomy(state);
    assert.strictEqual(state.factions.get(fid)!.resources.food, demand * 9);
    progressWorldEconomy(state);
    assert.strictEqual(state.factions.get(fid)!.resources.food, demand * 9);
    state.worldTick = 120;
    progressWorldEconomy(state);
    assert.strictEqual(state.factions.get(fid)!.resources.food, demand * 8);
    assert.strictEqual(state.lastFoodConsumptionTick, 120);
  });
}
