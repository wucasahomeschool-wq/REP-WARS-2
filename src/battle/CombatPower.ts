import { BALANCE } from '../constants/balance';

export interface ArmyLike {
  soldiers: number;
  knights: number;
  siegeEngines?: number;
  morale?: number;
  supply?: number;
}

export interface TerritoryLike {
  terrain: string;
  fortification?: number;
  isCapital?: boolean;
}

export interface UnitBreakdown {
  soldiers: number;
  knights: number;
  siegeEngines: number;
  garrison?: number;
}

export interface CombatPowerBreakdown {
  rawTroops: number;
  quality: number;
  morale: number;
  moraleLabel: string;
  defenseBonus: number;
  defenseLabel: string;
  effectivePower: number;
  unitContribution: {
    soldiers: number;
    knights: number;
    siegeEngines: number;
    garrison?: number;
  };
}

export function labelForMoraleMultiplier(m: number): string {
  const mor = BALANCE.combat.morale;
  if (m <= mor.broken + 0.0001) return 'Broken';
  if (m <= mor.low + 0.0001) return 'Low';
  if (m <= mor.normal + 0.0001) return 'Normal';
  if (m <= mor.high + 0.0001) return 'High';
  return 'Excellent';
}

export function labelForDefenseBonus(d: number): string {
  const def = BALANCE.combat.defenseBonus;
  if (d <= def.openGround + 0.001) return 'Open Ground';
  if (d <= def.favorableTerrain + 0.005) return 'Favorable Terrain';
  if (d <= def.strongTerrain + 0.005) return 'Strong Terrain';
  return 'Fortified';
}

export function sumUnits(
  armies: ArmyLike[],
  garrison: number = 0,
): UnitBreakdown {
  let s = 0, k = 0, sg = 0;
  for (const a of armies) {
    s += Math.max(0, a.soldiers || 0);
    k += Math.max(0, a.knights || 0);
    sg += Math.max(0, a.siegeEngines || 0);
  }
  return { soldiers: s, knights: k, siegeEngines: sg, garrison: Math.max(0, garrison) };
}

export function averageMorale(armies: ArmyLike[], garrisonFallback: number = 75): number {
  if (armies.length === 0) return garrisonFallback;
  const total = armies.reduce((s, a) => s + (a.morale ?? garrisonFallback), 0);
  return total / armies.length;
}

export function morale0_100ToMultiplier(morale0_100: number): number {
  return BALANCE.combat.moraleToMultiplier(morale0_100);
}

export function computeRawUnitPower(units: UnitBreakdown): {
  total: number;
  breakdown: { soldiers: number; knights: number; siegeEngines: number; garrison?: number };
} {
  const US = BALANCE.combat.unitStrength;
  const s = units.soldiers * US.soldier;
  const k = units.knights * US.knight;
  const sg = units.siegeEngines * US.siegeEngine;
  const g = (units.garrison ?? 0) * US.garrison;
  return {
    total: s + k + sg + g,
    breakdown: { soldiers: s, knights: k, siegeEngines: sg, garrison: g },
  };
}

export function terrainAndFortToDefenseBonus(territory: TerritoryLike): number {
  let defenseBonus = BALANCE.combat.terrainToDefenseBonus[territory.terrain] ?? 1.0;
  const fortLvl = Math.max(0, territory.fortification ?? 0);
  if (fortLvl > 0) {
    defenseBonus += fortLvl * BALANCE.combat.fortificationPerLevelBonus;
  }
  if (territory.isCapital) {
    defenseBonus *= BALANCE.combat.capitalBonus;
  }
  return Math.max(1.0, defenseBonus);
}

export function computeAttackerPower(
  armies: ArmyLike[],
  quality: number = BALANCE.combat.qualityDefault,
): CombatPowerBreakdown {
  const units = sumUnits(armies, 0);
  const { total: rawTotal, breakdown } = computeRawUnitPower(units);
  const morale0_100 = averageMorale(armies);
  const moraleMult = morale0_100ToMultiplier(morale0_100);
  const defenseBonus = 1.0;
  const effectivePower = rawTotal * quality * moraleMult * defenseBonus;
  return {
    rawTroops: units.soldiers + units.knights,
    quality,
    morale: moraleMult,
    moraleLabel: labelForMoraleMultiplier(moraleMult),
    defenseBonus,
    defenseLabel: 'Attacker (none)',
    effectivePower: Math.max(0.0001, effectivePower),
    unitContribution: breakdown,
  };
}

export function computeDefenderPower(
  armies: ArmyLike[],
  garrison: number,
  territory: TerritoryLike,
  quality: number = BALANCE.combat.qualityDefault,
): CombatPowerBreakdown {
  const units = sumUnits(armies, garrison);
  const { total: rawTotal, breakdown } = computeRawUnitPower(units);
  const armiesForMorale = armies.length > 0 ? armies : [{
    soldiers: garrison, knights: 0, siegeEngines: 0, morale: 75,
  }];
  const morale0_100 = averageMorale(armiesForMorale);
  const moraleMult = morale0_100ToMultiplier(morale0_100);
  const defenseBonus = terrainAndFortToDefenseBonus(territory);
  const effectivePower = rawTotal * quality * moraleMult * defenseBonus;
  return {
    rawTroops: units.soldiers + units.knights + (units.garrison ?? 0),
    quality,
    morale: moraleMult,
    moraleLabel: labelForMoraleMultiplier(moraleMult),
    defenseBonus,
    defenseLabel: labelForDefenseBonus(defenseBonus),
    effectivePower: Math.max(0.0001, effectivePower),
    unitContribution: breakdown,
  };
}

export function computeWinProbability(
  attackerPower: number,
  defenderPower: number,
): number {
  const ap = Math.max(0.0001, attackerPower);
  const dp = Math.max(0.0001, defenderPower);
  return ap / (ap + dp);
}

export function computeCasualtyRates(
  winnerPower: number,
  loserPower: number,
  rng: { next: () => number },
): { winnerRate: number; loserRate: number } {
  const CC = BALANCE.combat.casualties;
  const total = winnerPower + loserPower;
  const powerBalance = total <= 0 ? 0.5 : winnerPower / total;
  const dominance = Math.max(0, Math.min(1, (powerBalance - 0.5) * 2));

  const winnerRange = CC.winnerMaxRate - CC.winnerMinRate;
  const winnerRate = CC.winnerMaxRate - dominance * winnerRange * CC.winnerDominanceScale;

  const loserRange = CC.loserMaxRate - CC.loserMinRate;
  const loserRate = CC.loserMinRate + dominance * loserRange * CC.loserDominanceScale;

  const jitterAmp = CC.randomJitter;
  const wFinal = Math.max(CC.winnerMinRate, Math.min(CC.winnerMaxRate,
    winnerRate + (rng.next() - 0.5) * 2 * jitterAmp));
  const lFinal = Math.max(CC.loserMinRate, Math.min(CC.loserMaxRate,
    loserRate + (rng.next() - 0.5) * 2 * jitterAmp));
  return { winnerRate: wFinal, loserRate: lFinal };
}

export function computeMilitaryAdvantageRatio(
  attackerArmies: ArmyLike[],
  defenderArmies: ArmyLike[],
  defenderGarrison: number,
  defenderTerritory: TerritoryLike,
): { ratio: number; risk: number; advantageScore: number } {
  const atk = computeAttackerPower(attackerArmies);
  const def = computeDefenderPower(defenderArmies, defenderGarrison, defenderTerritory);
  const ratio = def.effectivePower === 0 ? 100 : atk.effectivePower / def.effectivePower;
  const advantage = (ratio - 1) * 50;
  const M = BALANCE.military;
  const risk = Math.max(0, Math.min(1, 1 - ratio / M.criticalThreatRatio));
  return { ratio, risk, advantageScore: advantage };
}
