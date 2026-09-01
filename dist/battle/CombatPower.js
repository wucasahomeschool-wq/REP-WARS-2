"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.labelForMoraleMultiplier = labelForMoraleMultiplier;
exports.labelForDefenseBonus = labelForDefenseBonus;
exports.sumUnits = sumUnits;
exports.averageMorale = averageMorale;
exports.morale0_100ToMultiplier = morale0_100ToMultiplier;
exports.computeRawUnitPower = computeRawUnitPower;
exports.terrainAndFortToDefenseBonus = terrainAndFortToDefenseBonus;
exports.computeAttackerPower = computeAttackerPower;
exports.computeDefenderPower = computeDefenderPower;
exports.computeWinProbability = computeWinProbability;
exports.computeCasualtyRates = computeCasualtyRates;
exports.computeMilitaryAdvantageRatio = computeMilitaryAdvantageRatio;
const balance_1 = require("../constants/balance");
function labelForMoraleMultiplier(m) {
    const mor = balance_1.BALANCE.combat.morale;
    if (m <= mor.broken + 0.0001)
        return 'Broken';
    if (m <= mor.low + 0.0001)
        return 'Low';
    if (m <= mor.normal + 0.0001)
        return 'Normal';
    if (m <= mor.high + 0.0001)
        return 'High';
    return 'Excellent';
}
function labelForDefenseBonus(d) {
    const def = balance_1.BALANCE.combat.defenseBonus;
    if (d <= def.openGround + 0.001)
        return 'Open Ground';
    if (d <= def.favorableTerrain + 0.005)
        return 'Favorable Terrain';
    if (d <= def.strongTerrain + 0.005)
        return 'Strong Terrain';
    return 'Fortified';
}
function sumUnits(armies, garrison = 0) {
    let s = 0, k = 0, sg = 0;
    for (const a of armies) {
        s += Math.max(0, a.soldiers || 0);
        k += Math.max(0, a.knights || 0);
        sg += Math.max(0, a.siegeEngines || 0);
    }
    return { soldiers: s, knights: k, siegeEngines: sg, garrison: Math.max(0, garrison) };
}
function averageMorale(armies, garrisonFallback = 75) {
    if (armies.length === 0)
        return garrisonFallback;
    const total = armies.reduce((s, a) => s + (a.morale ?? garrisonFallback), 0);
    return total / armies.length;
}
function morale0_100ToMultiplier(morale0_100) {
    return balance_1.BALANCE.combat.moraleToMultiplier(morale0_100);
}
function computeRawUnitPower(units) {
    const US = balance_1.BALANCE.combat.unitStrength;
    const s = units.soldiers * US.soldier;
    const k = units.knights * US.knight;
    const sg = units.siegeEngines * US.siegeEngine;
    const g = (units.garrison ?? 0) * US.garrison;
    return {
        total: s + k + sg + g,
        breakdown: { soldiers: s, knights: k, siegeEngines: sg, garrison: g },
    };
}
function terrainAndFortToDefenseBonus(territory) {
    let defenseBonus = balance_1.BALANCE.combat.terrainToDefenseBonus[territory.terrain] ?? 1.0;
    const fortLvl = Math.max(0, territory.fortification ?? 0);
    if (fortLvl > 0) {
        defenseBonus += fortLvl * balance_1.BALANCE.combat.fortificationPerLevelBonus;
    }
    if (territory.isCapital) {
        defenseBonus *= balance_1.BALANCE.combat.capitalBonus;
    }
    return Math.max(1.0, defenseBonus);
}
function computeAttackerPower(armies, quality = balance_1.BALANCE.combat.qualityDefault) {
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
function computeDefenderPower(armies, garrison, territory, quality = balance_1.BALANCE.combat.qualityDefault) {
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
function computeWinProbability(attackerPower, defenderPower) {
    const ap = Math.max(0.0001, attackerPower);
    const dp = Math.max(0.0001, defenderPower);
    return ap / (ap + dp);
}
function computeCasualtyRates(winnerPower, loserPower, rng) {
    const CC = balance_1.BALANCE.combat.casualties;
    const total = winnerPower + loserPower;
    const powerBalance = total <= 0 ? 0.5 : winnerPower / total;
    const dominance = Math.max(0, Math.min(1, (powerBalance - 0.5) * 2));
    const winnerRange = CC.winnerMaxRate - CC.winnerMinRate;
    const winnerRate = CC.winnerMaxRate - dominance * winnerRange * CC.winnerDominanceScale;
    const loserRange = CC.loserMaxRate - CC.loserMinRate;
    const loserRate = CC.loserMinRate + dominance * loserRange * CC.loserDominanceScale;
    const jitterAmp = CC.randomJitter;
    const wFinal = Math.max(CC.winnerMinRate, Math.min(CC.winnerMaxRate, winnerRate + (rng.next() - 0.5) * 2 * jitterAmp));
    const lFinal = Math.max(CC.loserMinRate, Math.min(CC.loserMaxRate, loserRate + (rng.next() - 0.5) * 2 * jitterAmp));
    return { winnerRate: wFinal, loserRate: lFinal };
}
function computeMilitaryAdvantageRatio(attackerArmies, defenderArmies, defenderGarrison, defenderTerritory) {
    const atk = computeAttackerPower(attackerArmies);
    const def = computeDefenderPower(defenderArmies, defenderGarrison, defenderTerritory);
    const ratio = def.effectivePower === 0 ? 100 : atk.effectivePower / def.effectivePower;
    const advantage = (ratio - 1) * 50;
    const M = balance_1.BALANCE.military;
    const risk = Math.max(0, Math.min(1, 1 - ratio / M.criticalThreatRatio));
    return { ratio, risk, advantageScore: advantage };
}
//# sourceMappingURL=CombatPower.js.map