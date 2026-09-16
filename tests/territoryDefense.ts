import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  BattleEngine,
  BattleInput,
  GAMEPLAY_CONFIG,
  combatDefenseMultiplier,
  computeDefenderPower,
  createActiveInvasion,
  createLegacySampleMapGameState,
  cityCombatModifiersEnabled,
  cityPresenceDefenseFactor,
  defenseWorkoutMultiplier,
  resolveInvasionBattle,
  terrainAndFortToDefenseBonus,
  withTerritoryCombatView,
} from '../src';
import type { GameState } from '../src';
import { plantCity } from './worldTestHelpers';

export interface TerritoryDefenseTestApi {
  test: (name: string, fn: () => void) => void;
}

const PLAYER_FACTION = 'iron_kingdom';
const OTHER_FACTION = 'celestial_theocracy';
const TARGET = 'eastern_hills';
const HOME = 'iron_kingdom_east';

class RecordingBattleEngine extends BattleEngine {
  readonly inputs: BattleInput[] = [];
  resolve(input: BattleInput) {
    this.inputs.push({
      ...input,
      attackerArmies: input.attackerArmies.map((army) => ({ ...army })),
      defenderArmies: (input.defenderArmies ?? []).map((army) => ({ ...army })),
    });
    return super.resolve(input);
  }
}

function placeArmyOn(state: GameState, factionId: string, territoryId: string, soldiers = 400): void {
  const army = [...state.armies.values()].find((a) => a.owner === factionId);
  assert.ok(army, `expected an army for ${factionId}`);
  army.location = territoryId;
  army.soldiers = soldiers;
  army.knights = 0;
  army.movement = null;
  army.attackIntent = null;
}

function seedDefenseBattle(state: GameState, defensePower: number): string {
  const invasionId = 'inv_city_def';
  placeArmyOn(state, OTHER_FACTION, TARGET, 120);
  const attacker = [...state.armies.values()].find((a) => a.owner === OTHER_FACTION)!;
  attacker.attackIntent = {
    targetTerritoryId: HOME,
    stagingTerritoryId: attacker.location,
    createdAtTick: state.worldTick,
    status: 'ready',
    commitmentId: null,
    battleSeed: 1,
    holdForInvasionId: invasionId,
    onlyArmyId: attacker.id,
  };
  const invasion = createActiveInvasion({
    id: invasionId,
    defenderFactionId: PLAYER_FACTION,
    attackerFactionId: OTHER_FACTION,
    territoryId: HOME,
    startedAtTick: state.worldTick,
    notifiedAtTick: state.worldTick,
    responseDeadlineTick: state.worldTick + 30,
    attackingArmyIds: [attacker.id],
    battleSeed: 1,
    status: 'defense_in_progress',
  });
  invasion.defenseMobilization = {
    applicationId: 'app_def',
    sessionId: 'wses_def',
    workoutId: 'wk_def',
    playerId: 'player_1',
    defensePower,
    attachedAtTick: state.worldTick,
    workoutStartedAtTick: state.worldTick,
    sourcePhysicalOutput: defensePower,
  };
  state.activeInvasions.set(invasion.id, invasion);
  return invasionId;
}

function virtualDefenderSoldiers(input: BattleInput): number {
  const virtual = (input.defenderArmies ?? []).find(
    (army) => army.knights === 0 && (army.siegeEngines ?? 0) === 0 && army.morale === 80,
  );
  assert.ok(virtual, 'expected virtual defender assembled from defensePower');
  return virtual.soldiers;
}

export function registerTerritoryDefenseTests({ test }: TerritoryDefenseTestApi): void {
  test('City combat modifiers are gated off at worldLevel 1', () => {
    const state = createLegacySampleMapGameState({ seed: 4, playerFactionId: PLAYER_FACTION });
    plantCity(state, HOME);
    assert.strictEqual(state.worldLevel, 1);
    assert.strictEqual(cityCombatModifiersEnabled(state), false);
    assert.strictEqual(combatDefenseMultiplier(state, HOME), GAMEPLAY_CONFIG.citylessCombatDefenseFactor);
    assert.strictEqual(defenseWorkoutMultiplier(state, HOME), GAMEPLAY_CONFIG.citylessDefenseWorkoutFactor);
  });

  test('cityless territory stays 1.0 combat and workout at worldLevel 2', () => {
    const state = createLegacySampleMapGameState({ seed: 4, playerFactionId: PLAYER_FACTION });
    state.worldLevel = 2;
    assert.strictEqual(combatDefenseMultiplier(state, HOME), GAMEPLAY_CONFIG.citylessCombatDefenseFactor);
    assert.strictEqual(defenseWorkoutMultiplier(state, HOME), GAMEPLAY_CONFIG.citylessDefenseWorkoutFactor);
  });

  test('City combat factor is 1.25 at worldLevel 2', () => {
    const state = createLegacySampleMapGameState({ seed: 4, playerFactionId: PLAYER_FACTION });
    state.worldLevel = 2;
    plantCity(state, HOME);
    assert.strictEqual(combatDefenseMultiplier(state, HOME), GAMEPLAY_CONFIG.cityCombatDefenseFactor);
    assert.strictEqual(combatDefenseMultiplier(state, HOME), 1.25);
  });

  test('DEFENSE workout multiplier is 1.5 at City fort 0 and caps at 2.0', () => {
    const state = createLegacySampleMapGameState({ seed: 4, playerFactionId: PLAYER_FACTION });
    state.worldLevel = 2;
    plantCity(state, HOME);
    const tile = state.territories.get(HOME)!;
    tile.fortification = 0;
    assert.strictEqual(defenseWorkoutMultiplier(state, HOME), GAMEPLAY_CONFIG.cityDefenseWorkoutBase);
    tile.fortification = 5;
    assert.strictEqual(
      defenseWorkoutMultiplier(state, HOME),
      GAMEPLAY_CONFIG.cityDefenseWorkoutBase + GAMEPLAY_CONFIG.defenseWorkoutFortBonusPerLevel * 5,
    );
    assert.strictEqual(defenseWorkoutMultiplier(state, HOME), GAMEPLAY_CONFIG.defenseWorkoutMultiplierCap);
    tile.fortification = 8;
    assert.strictEqual(defenseWorkoutMultiplier(state, HOME), GAMEPLAY_CONFIG.defenseWorkoutMultiplierCap);
  });

  test('CombatPower omits City factor unless hasCity or cityDefenseFactor is set', () => {
    const armies = [{ soldiers: 100, knights: 0, siegeEngines: 0, morale: 80 }];
    const plains = { terrain: 'plains', fortification: 0 };
    const cityless = computeDefenderPower(armies, 0, plains);
    const unlabeled = computeDefenderPower(armies, 0, { ...plains, hasCity: false });
    const withCity = computeDefenderPower(armies, 0, {
      ...plains,
      hasCity: true,
      cityDefenseFactor: GAMEPLAY_CONFIG.cityCombatDefenseFactor,
    });
    assert.strictEqual(cityPresenceDefenseFactor(plains), 1);
    assert.strictEqual(cityless.effectivePower, unlabeled.effectivePower);
    assert.ok(Math.abs(withCity.effectivePower / cityless.effectivePower - 1.25) < 1e-9);
    assert.strictEqual(withCity.defenseBonus, cityless.defenseBonus);
  });

  test('CombatPower keeps terrain plus fort bonus separate from City 1.25', () => {
    const armies = [{ soldiers: 50, knights: 0, siegeEngines: 0, morale: 80 }];
    const fortified = { terrain: 'plains', fortification: 2, hasCity: true, cityDefenseFactor: 1.25 };
    const cityless = { terrain: 'plains', fortification: 2 };
    const bonus = terrainAndFortToDefenseBonus(fortified);
    assert.strictEqual(bonus, terrainAndFortToDefenseBonus(cityless));
    assert.ok(bonus > 1);
    const withCity = computeDefenderPower(armies, 0, fortified);
    const without = computeDefenderPower(armies, 0, cityless);
    assert.strictEqual(withCity.defenseBonus, without.defenseBonus);
    assert.ok(Math.abs(withCity.effectivePower / without.effectivePower - 1.25) < 1e-9);
  });

  test('BattleEngine and CombatPower do not import GameState', () => {
    const battleSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'battle', 'BattleEngine.ts'), 'utf8');
    const combatSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'battle', 'CombatPower.ts'), 'utf8');
    assert.ok(!/types\/GameState/.test(battleSrc));
    assert.ok(!/types\/GameState/.test(combatSrc));
    assert.ok(!/from ['"]\.\.\/gameplay/.test(battleSrc));
    assert.ok(!/from ['"]\.\.\/gameplay/.test(combatSrc));
  });

  test('withTerritoryCombatView fills gated City flags for BattleInput', () => {
    const state = createLegacySampleMapGameState({ seed: 4, playerFactionId: PLAYER_FACTION });
    plantCity(state, HOME);
    const gated = withTerritoryCombatView(state, state.territories.get(HOME)!);
    assert.strictEqual(gated.hasCity, false);
    assert.strictEqual(gated.cityDefenseFactor, 1);
    state.worldLevel = 2;
    const live = withTerritoryCombatView(state, state.territories.get(HOME)!);
    assert.strictEqual(live.hasCity, true);
    assert.strictEqual(live.cityDefenseFactor, 1.25);
  });

  test('invasion virtual defender multiplies stored defensePower at worldLevel 2', () => {
    const state = createLegacySampleMapGameState({ seed: 4, playerFactionId: PLAYER_FACTION });
    state.worldLevel = 2;
    plantCity(state, HOME);
    state.territories.get(HOME)!.fortification = 0;
    const invasionId = seedDefenseBattle(state, 100);
    const battle = new RecordingBattleEngine();
    resolveInvasionBattle(state, battle, invasionId, 'defense_battle');
    assert.strictEqual(battle.inputs.length, 1);
    assert.strictEqual(virtualDefenderSoldiers(battle.inputs[0]!), 150);
    assert.strictEqual(battle.inputs[0]!.territory.hasCity, true);
    assert.strictEqual(battle.inputs[0]!.territory.cityDefenseFactor, 1.25);
  });

  test('Level 1 invasion does not apply City combat or workout multipliers', () => {
    const state = createLegacySampleMapGameState({ seed: 4, playerFactionId: PLAYER_FACTION });
    plantCity(state, HOME);
    state.territories.get(HOME)!.fortification = 5;
    const invasionId = seedDefenseBattle(state, 100);
    const battle = new RecordingBattleEngine();
    resolveInvasionBattle(state, battle, invasionId, 'defense_battle');
    assert.strictEqual(state.worldLevel, 1);
    assert.strictEqual(battle.inputs.length, 1);
    assert.strictEqual(virtualDefenderSoldiers(battle.inputs[0]!), 100);
    assert.strictEqual(battle.inputs[0]!.territory.hasCity, false);
    assert.strictEqual(battle.inputs[0]!.territory.cityDefenseFactor, 1);
  });
}
