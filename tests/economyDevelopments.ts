import assert from 'assert';
import {
  ECONOMY_CONFIG,
  ErrorCode,
  GAMEPLAY_CONFIG,
  Orchestrator,
  acceleratedRemainingTicks,
  collectTerritoryYield,
  createLegacySampleMapGameState,
  decodePersistable,
  deriveFactionResourceIncome,
  effectiveResourceOutput,
  getConstructionProjectDefinition,
  listConstructionProjectTypes,
  migrateGameStatePayload,
  peekCollectibleResources,
  productionAccrued,
  progressWorldEconomy,
  settleTerritoryOwnershipChange,
  snapshotGameState,
  startConstruction,
  syncAllFactionResourceIncome,
} from '../src';
import type { CommandRequest, GameState } from '../src';

export interface EconomyDevelopmentsTestApi {
  test: (name: string, fn: () => void) => void;
}

const PLAYER_ID = 'player_1';
const MERCHANT = 'merchant_republic';
const REACH = 'western_reach';
const IRON_EAST = 'iron_kingdom_east';
const OTHER = 'celestial_theocracy';

function cmdReq(commandId: string, parameters: Record<string, unknown> = {}): CommandRequest {
  return { commandId, playerId: PLAYER_ID, requestId: `${commandId}_econ_dev`, parameters };
}

function merchantState(): GameState {
  return createLegacySampleMapGameState({ seed: 12, playerFactionId: MERCHANT });
}

function completeFarm(state: GameState, territoryId = REACH): void {
  startConstruction(state, {
    factionId: MERCHANT,
    territoryId,
    projectType: 'FARM',
    projectId: `con_farm_${territoryId}`,
  });
  state.worldTick += GAMEPLAY_CONFIG.farmConstructionDurationTicks;
  progressWorldEconomy(state);
}

function pushWorkers(state: GameState, workerPower: number, applicationId = 'cw_dev'): void {
  state.playerRewards.pendingConstructionEffects.push({
    applicationId,
    sessionId: 'wses_dev_cw',
    workoutId: 'wk',
    playerId: PLAYER_ID,
    workerPower,
    permanence: 'TEMPORARY_ACCELERATION',
    appliedAtTick: state.worldTick,
    sourcePhysicalOutput: 10,
  });
}

function snapshotResources(state: GameState) {
  return {
    resources: { ...state.factions.get(MERCHANT)!.resources },
    bankedTroops: state.playerRewards.bankedTroops,
  };
}

export function registerEconomyDevelopmentsTests({ test }: EconomyDevelopmentsTestApi): void {
  test('Farm, Mine, and Lumber construction costs match gameplay config', () => {
    const farm = getConstructionProjectDefinition('FARM');
    const mine = getConstructionProjectDefinition('MINE');
    const lumber = getConstructionProjectDefinition('LUMBER');
    assert.strictEqual(farm.cost.gold, GAMEPLAY_CONFIG.farmGoldCost);
    assert.strictEqual(farm.cost.wood, GAMEPLAY_CONFIG.farmWoodCost);
    assert.strictEqual(farm.cost.stone, undefined);
    assert.strictEqual(farm.durationTicks, GAMEPLAY_CONFIG.farmConstructionDurationTicks);
    assert.strictEqual(mine.cost.gold, GAMEPLAY_CONFIG.mineGoldCost);
    assert.strictEqual(mine.cost.wood, GAMEPLAY_CONFIG.mineWoodCost);
    assert.strictEqual(lumber.cost.gold, GAMEPLAY_CONFIG.lumberGoldCost);
    assert.strictEqual(lumber.cost.stone, GAMEPLAY_CONFIG.lumberStoneCost);
    assert.deepStrictEqual([...listConstructionProjectTypes()], ['CITY', 'FORTIFICATION', 'FARM', 'MINE', 'LUMBER']);
  });

  test('Farm multiplies food ×1.5 and leaves gold unchanged', () => {
    const state = merchantState();
    const tile = state.territories.get(REACH)!;
    const baseFood = tile.resourceOutput.food;
    const baseGold = tile.resourceOutput.gold;
    assert.ok(baseFood >= 2);
    const before = effectiveResourceOutput(state, tile);
    assert.strictEqual(before.food, baseFood);
    assert.strictEqual(before.gold, baseGold);
    state.territoryInfrastructure.get(REACH)!.farmCompletedAtTick = 0;
    const after = effectiveResourceOutput(state, tile);
    assert.strictEqual(after.food, baseFood * ECONOMY_CONFIG.developmentOutputMultiplier);
    assert.strictEqual(after.gold, baseGold);
    assert.strictEqual(tile.resourceOutput.food, baseFood);
  });

  test('Mine zeros stay 0 and do not invent iron or stone', () => {
    const state = merchantState();
    const tile = state.territories.get(REACH)!;
    tile.resourceOutput.iron = 0;
    tile.resourceOutput.stone = 0;
    state.territoryInfrastructure.get(REACH)!.mineCompletedAtTick = 1;
    const effective = effectiveResourceOutput(state, tile);
    assert.strictEqual(effective.iron, 0);
    assert.strictEqual(effective.stone, 0);
    assert.strictEqual(tile.resourceOutput.iron, 0);
    assert.strictEqual(tile.resourceOutput.stone, 0);
  });

  test('Farm on a 0-food tile does nothing', () => {
    const state = createLegacySampleMapGameState({ seed: 12, playerFactionId: 'iron_kingdom' });
    const tile = state.territories.get(IRON_EAST)!;
    tile.resourceOutput.food = 0;
    state.territoryInfrastructure.get(IRON_EAST)!.farmCompletedAtTick = 1;
    assert.strictEqual(effectiveResourceOutput(state, tile).food, 0);
  });

  test('accrual and collect use effective Farm output', () => {
    const state = merchantState();
    const tile = state.territories.get(REACH)!;
    const base = { ...tile.resourceOutput };
    completeFarm(state);
    const rec = state.territoryEconomy.get(REACH)!;
    rec.uncollected = { gold: 0, food: 0, iron: 0, wood: 0, stone: 0 };
    rec.lastAccrualTick = state.worldTick;
    state.worldTick += ECONOMY_CONFIG.ticksPerProductionCycle;
    const expected = productionAccrued(effectiveResourceOutput(state, tile), ECONOMY_CONFIG.ticksPerProductionCycle);
    assert.strictEqual(expected.food, Math.floor(base.food * 1.5));
    assert.deepStrictEqual(peekCollectibleResources(state, REACH), expected);
    const beforeFood = state.factions.get(MERCHANT)!.resources.food;
    const collected = collectTerritoryYield(state, {
      factionId: MERCHANT,
      territoryId: REACH,
      playerId: PLAYER_ID,
      consumeGoldenYield: false,
    });
    assert.strictEqual(collected.baseResources.food, expected.food);
    assert.strictEqual(state.factions.get(MERCHANT)!.resources.food, beforeFood + expected.food);
    assert.strictEqual(tile.resourceOutput.food, base.food);
  });

  test('Golden Yield still multiplies the collected effective yield', () => {
    const state = merchantState();
    completeFarm(state);
    const rec = state.territoryEconomy.get(REACH)!;
    rec.uncollected = { gold: 0, food: 0, iron: 0, wood: 0, stone: 0 };
    rec.lastAccrualTick = state.worldTick;
    state.worldTick += ECONOMY_CONFIG.ticksPerProductionCycle;
    const baseYield = peekCollectibleResources(state, REACH);
    state.playerRewards.pendingGoldenYieldEffects.push({
      applicationId: 'gy_farm',
      sessionId: 'sess',
      workoutId: 'wk',
      playerId: PLAYER_ID,
      multiplier: 2,
      effect: 'ONE_TIME_COLLECTION',
      permanence: 'EPHEMERAL',
      consumed: false,
      appliedAtTick: state.worldTick,
      sourcePhysicalOutput: 40,
    });
    const collected = collectTerritoryYield(state, {
      factionId: MERCHANT,
      territoryId: REACH,
      playerId: PLAYER_ID,
      consumeGoldenYield: true,
    });
    assert.strictEqual(collected.multiplier, 2);
    assert.strictEqual(collected.transferredResources.food, baseYield.food * 2);
    assert.strictEqual(collected.effectConsumed, true);
  });

  test('resourceIncome includes effective Farm output', () => {
    const state = merchantState();
    syncAllFactionResourceIncome(state);
    const before = state.factions.get(MERCHANT)!.resourceIncome.food ?? 0;
    const tile = state.territories.get(REACH)!;
    completeFarm(state);
    const after = state.factions.get(MERCHANT)!.resourceIncome.food ?? 0;
    const expectedBump = Math.floor(tile.resourceOutput.food * 1.5) - tile.resourceOutput.food;
    assert.strictEqual(after - before, expectedBump);
    assert.strictEqual(
      deriveFactionResourceIncome(state, MERCHANT).food,
      after,
    );
  });

  test('one Farm per territory; events compound on base then Farm multiplies', () => {
    const state = merchantState();
    const orch = new Orchestrator(state);
    const started = orch.execute(cmdReq('START_CONSTRUCTION', {
      territoryId: REACH,
      factionId: MERCHANT,
      projectType: 'FARM',
      constructionId: 'con_farm_once',
    }));
    assert.strictEqual(started.success, true, started.errors?.[0]?.message);
    const advanced = orch.execute(cmdReq('ADVANCE_WORLD', {
      elapsedTicks: GAMEPLAY_CONFIG.farmConstructionDurationTicks,
    }));
    assert.strictEqual(advanced.success, true, advanced.errors?.[0]?.message);
    const live = orch.getState();
    assert.ok(live.territoryInfrastructure.get(REACH)!.farmCompletedAtTick !== null);
    const again = orch.execute(cmdReq('START_CONSTRUCTION', {
      territoryId: REACH,
      factionId: MERCHANT,
      projectType: 'FARM',
      constructionId: 'con_farm_twice',
    }));
    assert.strictEqual(again.success, false);
    assert.strictEqual(again.errors[0]?.code, ErrorCode.ACTION_NOT_ALLOWED);
    const tile = live.territories.get(REACH)!;
    const authored = tile.resourceOutput.food ?? 0;
    tile.resourceOutput.food = authored + 10;
    const effective = effectiveResourceOutput(live, tile);
    assert.strictEqual(effective.food, (authored + 10) * 1.5);
    assert.strictEqual(tile.resourceOutput.food, authored + 10);
  });

  test('conquest clears developments and leaves authored resourceOutput', () => {
    const state = merchantState();
    const tile = state.territories.get(REACH)!;
    const authored = { ...tile.resourceOutput };
    const infra = state.territoryInfrastructure.get(REACH)!;
    infra.farmCompletedAtTick = 4;
    infra.mineCompletedAtTick = 5;
    infra.lumberCompletedAtTick = 6;
    settleTerritoryOwnershipChange(state, REACH, OTHER, MERCHANT);
    assert.strictEqual(infra.farmCompletedAtTick, null);
    assert.strictEqual(infra.mineCompletedAtTick, null);
    assert.strictEqual(infra.lumberCompletedAtTick, null);
    assert.deepStrictEqual({ ...tile.resourceOutput }, authored);
    assert.strictEqual(effectiveResourceOutput(state, tile).food, authored.food);
  });

  test('public views expose farm/mine/lumber occupancy booleans', () => {
    const state = merchantState();
    completeFarm(state);
    state.territoryInfrastructure.get(REACH)!.lumberCompletedAtTick = state.worldTick;
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('GET_GAME_STATE'));
    assert.strictEqual(res.success, true);
    const view = res.payload.gameState as {
      territories: Record<string, { farm?: boolean; mine?: boolean; lumber?: boolean }>;
      playerGameplay?: {
        infrastructure?: Record<string, { farm: boolean; mine: boolean; lumber: boolean }>;
      };
    };
    assert.strictEqual(view.territories[REACH]!.farm, true);
    assert.strictEqual(view.territories[REACH]!.mine, false);
    assert.strictEqual(view.territories[REACH]!.lumber, true);
    assert.strictEqual(view.playerGameplay!.infrastructure![REACH]!.farm, true);
    assert.strictEqual(view.playerGameplay!.infrastructure![REACH]!.lumber, true);
  });

  test('migrateConstruction keeps FARM and still coerces unknown types to FORTIFICATION', () => {
    const state = merchantState();
    startConstruction(state, {
      factionId: MERCHANT,
      territoryId: REACH,
      projectType: 'FARM',
      projectId: 'con_farm_migrate',
    });
    const decoded = decodePersistable(snapshotGameState(state)) as Record<string, unknown>;
    decoded.schemaVersion = 10;
    const constructions = decoded.constructions as Map<string, Record<string, unknown>>;
    assert.strictEqual(constructions.get('con_farm_migrate')!.projectType, 'FARM');
    constructions.set('con_road_legacy', {
      ...constructions.get('con_farm_migrate')!,
      id: 'con_road_legacy',
      projectType: 'ROAD',
    });
    const migrated = migrateGameStatePayload(decoded);
    const next = migrated.constructions as Map<string, Record<string, unknown>>;
    assert.strictEqual(next.get('con_farm_migrate')!.projectType, 'FARM');
    assert.strictEqual(next.get('con_road_legacy')!.projectType, 'FORTIFICATION');
  });

  test('APPLY_CONSTRUCTION_ACCELERATION reduces Farm remainingTicks without paying cost or Troops', () => {
    const state = merchantState();
    startConstruction(state, {
      factionId: MERCHANT,
      territoryId: REACH,
      projectType: 'FARM',
      projectId: 'con_farm_acc',
    });
    const remainingBefore = state.constructions.get('con_farm_acc')!.remainingTicks;
    assert.strictEqual(remainingBefore, GAMEPLAY_CONFIG.farmConstructionDurationTicks);
    const economyBefore = snapshotResources(state);
    pushWorkers(state, 5);
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('APPLY_CONSTRUCTION_ACCELERATION', { constructionId: 'con_farm_acc' }));
    assert.strictEqual(res.success, true, res.errors?.[0]?.message);
    const live = orch.getState();
    const project = live.constructions.get('con_farm_acc')!;
    assert.strictEqual(project.status, 'in_progress');
    assert.strictEqual(project.remainingTicks, acceleratedRemainingTicks(remainingBefore, 5));
    assert.strictEqual(project.remainingTicks, remainingBefore - 5);
    assert.strictEqual(live.playerRewards.pendingConstructionEffects.length, 0);
    assert.deepStrictEqual(snapshotResources(live), economyBefore);
    assert.strictEqual(live.territoryInfrastructure.get(REACH)!.farmCompletedAtTick, null);
  });

  test('workers can finish a Farm project early and occupy the tile', () => {
    const state = merchantState();
    startConstruction(state, {
      factionId: MERCHANT,
      territoryId: REACH,
      projectType: 'FARM',
      projectId: 'con_farm_finish',
    });
    const remaining = state.constructions.get('con_farm_finish')!.remainingTicks;
    const economyBefore = snapshotResources(state);
    pushWorkers(state, remaining);
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('APPLY_CONSTRUCTION_ACCELERATION', { constructionId: 'con_farm_finish' }));
    assert.strictEqual(res.success, true, res.errors?.[0]?.message);
    const live = orch.getState();
    const project = live.constructions.get('con_farm_finish')!;
    assert.strictEqual(project.status, 'completed');
    assert.strictEqual(project.remainingTicks, 0);
    assert.strictEqual(res.payload.completed, true);
    assert.ok(live.territoryInfrastructure.get(REACH)!.farmCompletedAtTick !== null);
    assert.deepStrictEqual(snapshotResources(live), economyBefore);
  });

  test('workers can finish Mine and Lumber projects on the same existing acceleration command', () => {
    const mineState = merchantState();
    startConstruction(mineState, {
      factionId: MERCHANT,
      territoryId: 'salt_marches',
      projectType: 'MINE',
      projectId: 'con_mine_finish',
    });
    pushWorkers(mineState, mineState.constructions.get('con_mine_finish')!.remainingTicks);
    const mineOrch = new Orchestrator(mineState);
    const mineRes = mineOrch.execute(cmdReq('APPLY_CONSTRUCTION_ACCELERATION', { constructionId: 'con_mine_finish' }));
    assert.strictEqual(mineRes.success, true, mineRes.errors?.[0]?.message);
    assert.strictEqual(mineOrch.getState().constructions.get('con_mine_finish')!.status, 'completed');
    assert.ok(mineOrch.getState().territoryInfrastructure.get('salt_marches')!.mineCompletedAtTick !== null);

    const lumberState = merchantState();
    startConstruction(lumberState, {
      factionId: MERCHANT,
      territoryId: 'merchant_south',
      projectType: 'LUMBER',
      projectId: 'con_lumber_finish',
    });
    pushWorkers(lumberState, lumberState.constructions.get('con_lumber_finish')!.remainingTicks);
    const lumberOrch = new Orchestrator(lumberState);
    const lumberRes = lumberOrch.execute(cmdReq('APPLY_CONSTRUCTION_ACCELERATION', { constructionId: 'con_lumber_finish' }));
    assert.strictEqual(lumberRes.success, true, lumberRes.errors?.[0]?.message);
    assert.strictEqual(lumberOrch.getState().constructions.get('con_lumber_finish')!.status, 'completed');
    assert.ok(lumberOrch.getState().territoryInfrastructure.get('merchant_south')!.lumberCompletedAtTick !== null);
  });

  test('acceleration for the wrong construction id does not consume Farm workers', () => {
    const state = merchantState();
    startConstruction(state, {
      factionId: MERCHANT,
      territoryId: REACH,
      projectType: 'FARM',
      projectId: 'con_farm_keep',
    });
    pushWorkers(state, 8);
    const orch = new Orchestrator(state);
    const missing = orch.execute(cmdReq('APPLY_CONSTRUCTION_ACCELERATION', { constructionId: 'con_missing' }));
    assert.strictEqual(missing.success, false);
    assert.strictEqual(orch.getState().playerRewards.pendingConstructionEffects.length, 1);
    assert.strictEqual(orch.getState().constructions.get('con_farm_keep')!.remainingTicks, GAMEPLAY_CONFIG.farmConstructionDurationTicks);
    assert.strictEqual(orch.getState().territoryInfrastructure.get(REACH)!.farmCompletedAtTick, null);
  });
}
