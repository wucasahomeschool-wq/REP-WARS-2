"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BattleEngine = void 0;
const balance_1 = require("../constants/balance");
const SeededRNG_1 = require("../utils/SeededRNG");
const CombatPower_1 = require("./CombatPower");
class BattleEngine {
    validate(input) {
        const errors = [];
        const totalAttackers = (input.attackerArmies ?? []).reduce((s, a) => s + Math.max(0, a.soldiers) + Math.max(0, a.knights), 0);
        if (totalAttackers <= 0)
            errors.push('Attacking armies have zero troops');
        const defenderField = (input.defenderArmies ?? []).reduce((s, a) => s + Math.max(0, a.soldiers) + Math.max(0, a.knights), 0);
        const defenderGarrison = Math.max(0, input.defenderGarrison ?? 0);
        if (defenderField + defenderGarrison <= 0)
            errors.push('Defender has no troops');
        if (!input.territory?.id)
            errors.push('No territory provided for battle');
        if (!input.attackerFactionId)
            errors.push('Missing attacker faction');
        if (!input.defenderFactionId)
            errors.push('Missing defender faction');
        if (input.attackerFactionId === input.defenderFactionId) {
            errors.push('Attacker and defender cannot be the same faction');
        }
        return { valid: errors.length === 0, errors };
    }
    resolve(input) {
        const validation = this.validate(input);
        if (!validation.valid) {
            throw new Error(`Battle validation failed: ${validation.errors.join('; ')}`);
        }
        const C = balance_1.BALANCE.combat;
        const rng = new SeededRNG_1.SeededRNG((input.seed >>> 0) ^ C.randomness.seedSaltBase);
        const battleId = input.battleId ??
            `battle_${input.turn}_${input.attackerFactionId}_${input.defenderFactionId}_${Math.floor(rng.next() * 1e6)}`;
        const events = [];
        let evId = 0;
        const emit = (phase, type, side, message, impact = 0) => {
            events.push({
                id: `evt_${battleId}_${evId++}`,
                turn: input.turn,
                phase, type, side, message, impact,
            });
        };
        const atkName = input.attackerFactionName ?? input.attackerFactionId;
        const defName = input.defenderFactionName ?? input.defenderFactionId;
        emit('setup', 'phase_start', 'both', `${atkName} marches on ${input.territory.name}.`, 0);
        const atkQuality = input.attackerQuality ?? C.qualityDefault;
        const defQuality = input.defenderQuality ?? C.qualityDefault;
        const atkInit = (0, CombatPower_1.sumUnits)(input.attackerArmies, 0);
        const defInit = (0, CombatPower_1.sumUnits)(input.defenderArmies ?? [], input.defenderGarrison ?? 0);
        let atkPower = (0, CombatPower_1.computeAttackerPower)(input.attackerArmies, atkQuality);
        let defPower = (0, CombatPower_1.computeDefenderPower)(input.defenderArmies ?? [], input.defenderGarrison ?? 0, input.territory, defQuality);
        if (input.strategicAttackerBonus)
            atkPower.effectivePower += input.strategicAttackerBonus;
        if (input.strategicDefenderBonus)
            defPower.effectivePower += input.strategicDefenderBonus;
        if (input.additionalAttackerModifiers)
            atkPower.effectivePower += input.additionalAttackerModifiers;
        if (input.additionalDefenderModifiers)
            defPower.effectivePower += input.additionalDefenderModifiers;
        atkPower.effectivePower = Math.max(0.0001, atkPower.effectivePower);
        defPower.effectivePower = Math.max(0.0001, defPower.effectivePower);
        const winProb = (0, CombatPower_1.computeWinProbability)(atkPower.effectivePower, defPower.effectivePower);
        const powerRatio = atkPower.effectivePower / defPower.effectivePower;
        const roll = rng.next();
        const total = atkPower.effectivePower + defPower.effectivePower;
        const dominance = Math.max(atkPower.effectivePower, defPower.effectivePower) / Math.max(0.0001, total);
        const rawAdvantage = (atkPower.effectivePower - defPower.effectivePower) / Math.max(0.0001, total);
        const relativeAdvantage = Math.abs(rawAdvantage);
        let winner;
        let loser;
        let isStalemate = false;
        if (Math.abs(roll - winProb) < 1e-9 && winProb === 0.5) {
            isStalemate = true;
            winner = roll < 0.5 ? 'attacker' : 'defender';
            loser = winner === 'attacker' ? 'defender' : 'attacker';
        }
        else {
            winner = roll < winProb ? 'attacker' : 'defender';
            loser = winner === 'attacker' ? 'defender' : 'attacker';
        }
        const winnerPower = winner === 'attacker' ? atkPower.effectivePower : defPower.effectivePower;
        const loserPower = loser === 'attacker' ? atkPower.effectivePower : defPower.effectivePower;
        const CC = C.casualties;
        const isCloseBattle = Math.abs(winProb - 0.5) < CC.closeBattleThreshold;
        const { winnerRate: wBase, loserRate: lBase } = (0, CombatPower_1.computeCasualtyRates)(winnerPower, loserPower, rng);
        let winnerCasRate = wBase;
        let loserCasRate = lBase;
        if (isCloseBattle) {
            winnerCasRate = Math.min(CC.winnerMaxRate, winnerCasRate + CC.closeBattleExtraWinner);
            loserCasRate = Math.min(CC.loserMaxRate, loserCasRate + CC.closeBattleExtraLoser);
        }
        winnerCasRate = Math.max(CC.winnerMinRate, Math.min(CC.winnerMaxRate, winnerCasRate));
        loserCasRate = Math.max(CC.loserMinRate, Math.min(CC.loserMaxRate, loserCasRate));
        const atkCasRate = winner === 'attacker' ? winnerCasRate : loserCasRate;
        const defCasRate = winner === 'defender' ? winnerCasRate : loserCasRate;
        const atkCas = splitCasualties(atkInit, atkCasRate);
        const defCas = splitCasualties(defInit, defCasRate);
        const atkRemaining = {
            soldiers: Math.max(0, atkInit.soldiers - atkCas.soldiers),
            knights: Math.max(0, atkInit.knights - atkCas.knights),
            siegeEngines: Math.max(0, atkInit.siegeEngines - atkCas.siegeEngines),
        };
        const defRemainingUnits = {
            soldiers: Math.max(0, defInit.soldiers - defCas.soldiers),
            knights: Math.max(0, defInit.knights - defCas.knights),
            siegeEngines: Math.max(0, defInit.siegeEngines - defCas.siegeEngines),
        };
        const garrisonLeft = Math.max(0, (defInit.garrison ?? 0) - (defCas.garrison ?? 0));
        const pyrrhicRate = winner === 'attacker' ? atkCas.casualtyRate : defCas.casualtyRate;
        const isPyrrhic = pyrrhicRate >= C.victory.pyrrhicWinnerCasualtyThreshold;
        const V = C.victory;
        let outcomeType;
        if (isStalemate) {
            outcomeType = 'stalemate';
            emit('resolution', 'phase_end', 'both', 'Neither side can gain the upper hand; stalemate.', 0);
        }
        else if (winner === 'attacker') {
            if (isPyrrhic)
                outcomeType = 'attacker_pyrrhic_victory';
            else if (relativeAdvantage >= V.decisiveWinnerMinAdvantage)
                outcomeType = 'attacker_decisive_victory';
            else if (relativeAdvantage <= V.narrowWinnerMaxAdvantage)
                outcomeType = 'attacker_narrow_victory';
            else
                outcomeType = 'attacker_narrow_victory';
            if (outcomeType === 'attacker_decisive_victory') {
                emit('resolution', 'rout', 'defender', 'The defenders break and flee the field.', 25);
            }
            else if (outcomeType === 'attacker_pyrrhic_victory') {
                emit('resolution', 'phase_end', 'both', 'Attackers win at devastating cost.', 5);
            }
            else {
                emit('resolution', 'phase_end', 'both', 'The attackers carry the field after a hard fight.', 10);
            }
        }
        else {
            if (isPyrrhic)
                outcomeType = 'defender_pyrrhic_victory';
            else if (relativeAdvantage >= V.decisiveWinnerMinAdvantage)
                outcomeType = 'defender_decisive_victory';
            else if (relativeAdvantage <= V.narrowWinnerMaxAdvantage)
                outcomeType = 'defender_narrow_victory';
            else
                outcomeType = 'defender_narrow_victory';
            if (outcomeType === 'defender_decisive_victory') {
                emit('resolution', 'rout', 'attacker', 'The attackers are shattered and driven off.', -25);
            }
            else if (outcomeType === 'defender_pyrrhic_victory') {
                emit('resolution', 'phase_end', 'both', 'Defenders hold but suffer crippling losses.', -5);
            }
            else {
                emit('resolution', 'heroic_stand', 'defender', 'The defenders stand firm and repel the assault.', 15);
            }
        }
        let territoryOutcome;
        let defenderSurrendered = false;
        const neededAdv = input.territory.isCapital
            ? V.captureCapitalRequiredWinnerAdvantage
            : V.captureRequiredWinnerAdvantage;
        const minRemain = V.captureMinAttackerRemainingRatio;
        const atkRemCount = atkRemaining.soldiers + atkRemaining.knights;
        const atkInitCount = atkInit.soldiers + atkInit.knights;
        if (outcomeType === 'stalemate') {
            territoryOutcome = 'contested';
        }
        else if (winner === 'attacker') {
            const attackerHasEnough = atkInitCount === 0 ? false : (atkRemCount / Math.max(1, atkInitCount)) >= minRemain;
            if (relativeAdvantage >= neededAdv && attackerHasEnough) {
                territoryOutcome = 'captured';
                emit('resolution', 'breach', 'attacker', `${input.territory.name} falls to the attackers.`, 30);
                const totalDefInit = (defInit.garrison ?? 0) + defInit.soldiers + defInit.knights;
                const totalDefCas = defCas.total;
                if (totalDefInit > 0 && totalDefCas / totalDefInit >= 0.9) {
                    defenderSurrendered = true;
                    emit('resolution', 'surrender', 'defender', 'The remaining garrison surrenders.', 10);
                }
            }
            else {
                territoryOutcome = 'contested';
                emit('resolution', 'phase_end', 'both', `Attackers win the field but cannot secure ${input.territory.name}.`, 5);
            }
        }
        else {
            territoryOutcome = 'unchanged';
        }
        const attackerRouted = outcomeType === 'defender_decisive_victory';
        const defenderRouted = outcomeType === 'attacker_decisive_victory';
        const attackerRetreated = winner === 'defender' && !isStalemate;
        const defenderRetreated = territoryOutcome === 'captured' && !defenderSurrendered;
        const atkSurvPct = attackerRetreated
            ? retreatSurvival(input.attackerArmies[0], C)
            : undefined;
        const defSurvPct = defenderRetreated
            ? (input.territory.terrain === 'fortress' || (input.territory.fortification ?? 0) >= 4
                ? C.retreat.fortressGarrisonRetreatSurvival
                : C.retreat.baseSurvivalRate + 0.15)
            : undefined;
        const atkMorale = computeMoraleDelta(isStalemate ? 'draw' : winner, 'attacker', outcomeType, C);
        const defMorale = computeMoraleDelta(isStalemate ? 'draw' : winner, 'defender', outcomeType, C);
        const attackerBreakdown = {
            side: 'attacker',
            factionId: input.attackerFactionId,
            factionName: atkName,
            power: atkPower,
            effectivePower: Math.round(atkPower.effectivePower),
            unitBreakdown: { ...atkInit },
            initialTroops: atkInit.soldiers + atkInit.knights,
            remainingTroops: atkRemaining.soldiers + atkRemaining.knights,
            remaining: atkRemaining,
            casualties: { ...atkCas, total: atkCas.total, casualtyRate: round3(atkCas.casualtyRate) },
            moraleChange: atkMorale,
            routed: attackerRouted,
            retreated: attackerRetreated,
            retreatSurvivorsPct: atkSurvPct,
        };
        const defenderBreakdown = {
            side: 'defender',
            factionId: input.defenderFactionId,
            factionName: defName,
            power: defPower,
            effectivePower: Math.round(defPower.effectivePower),
            unitBreakdown: { ...defInit, garrison: defInit.garrison ?? 0 },
            initialTroops: defInit.soldiers + defInit.knights + (defInit.garrison ?? 0),
            remainingTroops: defRemainingUnits.soldiers + defRemainingUnits.knights + garrisonLeft,
            remaining: { ...defRemainingUnits, garrison: garrisonLeft },
            casualties: {
                ...defCas,
                total: defCas.total,
                casualtyRate: round3(defCas.casualtyRate),
            },
            moraleChange: defMorale,
            routed: defenderRouted,
            retreated: defenderRetreated,
            retreatSurvivorsPct: defSurvPct,
        };
        const calculation = {
            attacker: {
                rawTroops: atkPower.rawTroops,
                quality: atkPower.quality,
                morale: atkPower.morale,
                moraleLabel: atkPower.moraleLabel,
                effectivePower: atkPower.effectivePower,
            },
            defender: {
                rawTroops: defPower.rawTroops,
                quality: defPower.quality,
                morale: defPower.morale,
                moraleLabel: defPower.moraleLabel,
                defenseBonus: defPower.defenseBonus,
                defenseLabel: defPower.defenseLabel,
                effectivePower: defPower.effectivePower,
            },
            powerRatio: round3(powerRatio),
            attackerWinProbability: round3(winProb),
            randomRoll: round3(roll),
            winner,
            attackerCasualties: { count: atkCas.total, rate: round3(atkCas.casualtyRate) },
            defenderCasualties: { count: defCas.total, rate: round3(defCas.casualtyRate) },
            attackerRemaining: attackerBreakdown.remainingTroops,
            defenderRemaining: defenderBreakdown.remainingTroops,
        };
        const readableLog = this.buildReadableLog(input, attackerBreakdown, defenderBreakdown, outcomeType, territoryOutcome, winProb, powerRatio, roll, relativeAdvantage, events, calculation);
        const summary = this.buildSummary(input, outcomeType, territoryOutcome, attackerBreakdown, defenderBreakdown);
        const margin = (atkPower.effectivePower - defPower.effectivePower) /
            Math.max(0.0001, (atkPower.effectivePower + defPower.effectivePower) / 2);
        return {
            battleId,
            turn: input.turn,
            territoryId: input.territory.id,
            territoryName: input.territory.name,
            seedUsed: input.seed,
            winner: isStalemate ? 'draw' : winner,
            loser: isStalemate ? 'draw' : loser,
            outcomeType,
            attackerWinProbability: round3(winProb),
            randomRoll: round3(roll),
            effectivePowerRatio: round3(powerRatio),
            battleIntensity: round3((atkCas.casualtyRate + defCas.casualtyRate) / 2),
            attacker: attackerBreakdown,
            defender: defenderBreakdown,
            territoryOutcome,
            defenderSurrendered,
            events,
            battlePhases: [],
            effectiveRatio: round3(powerRatio),
            marginOfVictory: round3(margin),
            summary,
            readableLog,
            calculation,
        };
    }
    formatResult(result, includeBreakdown = true) {
        const out = [];
        out.push('══════════════════════════════════════════════════════════════');
        out.push(` BATTLE REPORT  ·  ${result.territoryName.toUpperCase()}`);
        out.push(` ${result.attacker.factionName} → ${result.defender.factionName}`
            + `   |   Turn ${result.turn}   |   Seed ${result.seedUsed}`);
        out.push('══════════════════════════════════════════════════════════════');
        if (includeBreakdown) {
            out.push(...result.readableLog);
        }
        else {
            const atkCas = result.attacker.casualties.total;
            const defCas = result.defender.casualties.total;
            const atkRem = result.attacker.remainingTroops;
            const defRem = result.defender.remainingTroops;
            const battleType = result.outcomeType.replace(/_/g, ' ')
                .replace(/(^|\s)\S/g, (c) => c.toUpperCase());
            out.push(`Result: ${result.winner === 'draw' ? 'STALEMATE' : result.winner === 'attacker' ? 'ATTACKER VICTORY' : 'DEFENDER VICTORY'} (${battleType})`);
            out.push('');
            out.push(`Attacker: ${result.attacker.factionName}`);
            out.push(`  Casualties: ${atkCas}`);
            out.push(`  Remaining:  ${atkRem}`);
            out.push('');
            out.push(`Defender: ${result.defender.factionName}`);
            out.push(`  Casualties: ${defCas}`);
            out.push(`  Remaining:  ${defRem}`);
            out.push('');
            out.push(`Territory: ${result.territoryOutcome.toUpperCase().replace(/_/g, ' ')}`);
        }
        out.push('');
        out.push(`Summary: ${result.summary}`);
        out.push('══════════════════════════════════════════════════════════════');
        return out.join('\n');
    }
    buildSummary(input, outcome, territory, atk, def) {
        const atkName = input.attackerFactionName ?? input.attackerFactionId;
        const defName = input.defenderFactionName ?? input.defenderFactionId;
        const labels = {
            attacker_decisive_victory: `${atkName} wins a decisive victory`,
            attacker_narrow_victory: `${atkName} wins a narrow victory`,
            attacker_pyrrhic_victory: `${atkName} wins a pyrrhic victory`,
            defender_decisive_victory: `${defName} wins a decisive defensive victory`,
            defender_narrow_victory: `${defName} narrowly repels the attack`,
            defender_pyrrhic_victory: `${defName} holds on by a thread (pyrrhic defense)`,
            mutual_heavy_losses: `Both armies suffer heavy losses with no clear winner`,
            stalemate: `The battle ends in stalemate`,
        };
        const terrLabels = {
            unchanged: `Territory remains with ${defName}.`,
            captured: `${input.territory.name} is captured by ${atkName}.`,
            contested: `${input.territory.name} is contested but not yet captured.`,
        };
        return `${labels[outcome]} at ${input.territory.name}. ${terrLabels[territory]} Atk losses: ${atk.casualties.total}; Def losses: ${def.casualties.total}.`;
    }
    buildReadableLog(input, atk, def, outcomeType, territoryOutcome, winProb, powerRatio, roll, relativeAdvantage, events, calc) {
        const atkName = atk.factionName;
        const defName = def.factionName;
        const L = [];
        L.push(`=== BATTLE at ${input.territory.name.toUpperCase()} ===`);
        L.push(`${atkName} (attacker) vs ${defName} (defender)`);
        const terrName = balance_1.TERRAIN_NAMES[input.territory.terrain] ?? input.territory.terrain;
        const fortStr = balance_1.BALANCE.combat.fortificationPerLevelBonus;
        L.push(`Terrain: ${terrName}  |  Fortification: L${input.territory.fortification}`
            + `${input.territory.isCapital ? ' ★ CAPITAL (×' + balance_1.BALANCE.combat.capitalBonus.toFixed(2) + ')' : ''}`);
        L.push('');
        L.push('── ATTACKER POWER CALCULATION ──');
        L.push(`  Raw troops:     ${calc.attacker.rawTroops}`);
        L.push(`  Quality:        ×${calc.attacker.quality.toFixed(2)}`);
        L.push(`  Morale:         ×${calc.attacker.morale.toFixed(2)}  (${calc.attacker.moraleLabel})`);
        L.push(`  → EFFECTIVE POWER: ${Math.round(calc.attacker.effectivePower).toLocaleString()}`);
        L.push('');
        L.push('── DEFENDER POWER CALCULATION ──');
        L.push(`  Raw troops:     ${calc.defender.rawTroops}`);
        L.push(`  Quality:        ×${calc.defender.quality.toFixed(2)}`);
        L.push(`  Morale:         ×${calc.defender.morale.toFixed(2)}  (${calc.defender.moraleLabel})`);
        L.push(`  Defense bonus:  ×${calc.defender.defenseBonus.toFixed(2)}  (${calc.defender.defenseLabel})`);
        L.push(`  → EFFECTIVE POWER: ${Math.round(calc.defender.effectivePower).toLocaleString()}`);
        L.push('');
        L.push('── WIN PROBABILITY ──');
        L.push(`  Power ratio (A:D): ${powerRatio.toFixed(3)} : 1`);
        L.push(`  Attacker win probability: ${(winProb * 100).toFixed(1)}%`);
        L.push(`  Random roll: ${roll.toFixed(3)}  (need < ${winProb.toFixed(3)} for attacker win)`);
        L.push(`  → ${calc.winner.toUpperCase()} WINS  (relative advantage ${(relativeAdvantage * 100).toFixed(1)}%)`);
        L.push('');
        L.push('── CASUALTIES ──');
        L.push(`  Attacker: ${calc.attackerCasualties.count.toLocaleString()} of ${calc.attacker.rawTroops.toLocaleString()}` +
            `  (${(calc.attackerCasualties.rate * 100).toFixed(1)}%)  →  Remaining: ${calc.attackerRemaining.toLocaleString()}`);
        L.push(`  Defender: ${calc.defenderCasualties.count.toLocaleString()} of ${calc.defender.rawTroops.toLocaleString()}` +
            `  (${(calc.defenderCasualties.rate * 100).toFixed(1)}%)  →  Remaining: ${calc.defenderRemaining.toLocaleString()}`);
        L.push('');
        L.push('OUTCOME:');
        L.push(`  ${describeOutcome(outcomeType, atkName, defName)}`);
        L.push(`  Territory: ${territoryOutcome.replace(/_/g, ' ').toUpperCase()}`);
        if (atk.retreated)
            L.push(`  Attacker retreats (≈${Math.round((atk.retreatSurvivorsPct ?? 0) * 100)}% of survivors escape).`);
        if (def.retreated)
            L.push(`  Defender retreats (≈${Math.round((def.retreatSurvivorsPct ?? 0) * 100)}% of survivors escape).`);
        L.push('');
        L.push('BATTLE EVENTS:');
        const notable = events.filter((e) => e.type !== 'phase_start');
        if (notable.length === 0)
            L.push('  (no notable events)');
        for (const e of notable.slice(0, 12)) {
            const tag = e.side === 'both' ? '·' : e.side === 'attacker' ? '▲' : '▼';
            L.push(`  [${e.phase}] ${tag} ${e.message}`);
        }
        return L;
    }
}
exports.BattleEngine = BattleEngine;
function splitCasualties(init, rate) {
    const soldiers = Math.min(init.soldiers, Math.round(init.soldiers * rate));
    const knights = Math.min(init.knights, Math.round(init.knights * rate));
    const siegeEngines = Math.min(init.siegeEngines, Math.round(init.siegeEngines * rate));
    const garrison = init.garrison !== undefined
        ? Math.min(init.garrison, Math.round(init.garrison * rate))
        : undefined;
    const totalTroops = init.soldiers + init.knights + (init.garrison ?? 0);
    const totalCas = soldiers + knights + (garrison ?? 0);
    const actualRate = totalTroops === 0 ? 0 : totalCas / totalTroops;
    return { soldiers, knights, siegeEngines, garrison, total: soldiers + knights + siegeEngines + (garrison ?? 0), casualtyRate: actualRate };
}
function computeMoraleDelta(winner, side, outcome, C) {
    const M = C.moraleDelta;
    if (outcome === 'stalemate')
        return M.draw;
    const won = winner === side;
    if (won) {
        switch (outcome) {
            case 'attacker_decisive_victory':
            case 'defender_decisive_victory':
                return M.decisiveWin;
            case 'attacker_narrow_victory':
            case 'defender_narrow_victory':
                return M.normalWin;
            case 'attacker_pyrrhic_victory':
            case 'defender_pyrrhic_victory':
                return M.pyrrhicWin;
            default: return M.narrowWin;
        }
    }
    else {
        switch (outcome) {
            case 'attacker_decisive_victory':
            case 'defender_decisive_victory':
                return M.decisiveLoss;
            case 'attacker_narrow_victory':
            case 'defender_narrow_victory':
                return M.normalLoss;
            case 'attacker_pyrrhic_victory':
            case 'defender_pyrrhic_victory':
                return M.pyrrhicLoss;
            default: return M.narrowLoss;
        }
    }
}
function retreatSurvival(army, C) {
    if (!army)
        return C.retreat.baseSurvivalRate;
    const cavBoost = (army.knights || 0) > 0
        ? C.retreat.cavalryBoostRetreat *
            Math.min(1, (army.knights || 0) / Math.max(1, (army.soldiers || 0) + (army.knights || 0)))
        : 0;
    const pct = C.retreat.baseSurvivalRate
        + (((army.morale ?? 75) - 50) * C.retreat.perMoraleSurvival)
        + cavBoost;
    return Math.max(0.05, Math.min(0.95, pct));
}
function round3(x) {
    return Math.round(x * 1000) / 1000;
}
function describeOutcome(type, atkName, defName) {
    switch (type) {
        case 'attacker_decisive_victory': return `ATTACKER DECISIVE VICTORY — ${atkName} overwhelms ${defName}.`;
        case 'attacker_narrow_victory': return `ATTACKER NARROW VICTORY — ${atkName} edges out ${defName}.`;
        case 'attacker_pyrrhic_victory': return `ATTACKER PYRRHIC VICTORY — ${atkName} wins at terrible cost.`;
        case 'defender_decisive_victory': return `DEFENDER DECISIVE VICTORY — ${defName} crushes ${atkName}.`;
        case 'defender_narrow_victory': return `DEFENDER NARROW VICTORY — ${defName} repels ${atkName}.`;
        case 'defender_pyrrhic_victory': return `DEFENDER PYRRHIC VICTORY — ${defName} holds but is gutted.`;
        case 'mutual_heavy_losses': return `MUTUAL HEAVY LOSSES — no clear victor.`;
        case 'stalemate': return `STALEMATE — neither side can break through.`;
    }
}
//# sourceMappingURL=BattleEngine.js.map