import {
  BattleInput,
  BattleResult,
  BattleFactor,
  BattleSideBreakdown,
  BattleEvent,
  BattleSide,
  BattleOutcomeType,
  TerritoryOutcome,
  BattleEventType,
  Army,
  Territory,
  TerrainType,
} from '../types';
import { BALANCE, TERRAIN_NAMES } from '../constants/balance';
import { SeededRNG } from '../utils/SeededRNG';

const C = BALANCE.combat;

export interface BattleValidation {
  valid: boolean;
  errors: string[];
}

export class BattleEngine {
  validate(input: BattleInput): BattleValidation {
    const errors: string[] = [];
    if (!input.attackerArmies || input.attackerArmies.length === 0) {
      errors.push('No attacking armies provided');
    } else {
      const totalAttackers = input.attackerArmies.reduce((s, a) => s + a.soldiers + a.knights, 0);
      if (totalAttackers <= 0) errors.push('Attacking armies have zero soldiers/knights');
    }
    const defenderTroops =
      (input.defenderArmies ?? []).reduce((s, a) => s + a.soldiers + a.knights, 0) +
      (input.defenderGarrison ?? 0);
    if (defenderTroops <= 0) errors.push('Defender has no troops to fight with');
    if (!input.territory) errors.push('No territory provided for battle');
    if (!input.attackerFactionId) errors.push('Missing attacker faction');
    if (!input.defenderFactionId) errors.push('Missing defender faction');
    if (input.attackerFactionId === input.defenderFactionId) {
      errors.push('Attacker and defender cannot be the same faction');
    }
    return { valid: errors.length === 0, errors };
  }

  resolve(input: BattleInput): BattleResult {
    const validation = this.validate(input);
    if (!validation.valid) {
      throw new Error(`Battle validation failed: ${validation.errors.join('; ')}`);
    }

    const battleRNG = new SeededRNG(input.seed ^ C.randomness.seedSaltBase);
    const battleId = input.battleId ?? `battle_${input.turn}_${input.attackerFactionId}_${input.defenderFactionId}_${Math.floor(battleRNG.next() * 1e6)}`;
    const events: BattleEvent[] = [];
    const phases: BattleResult['battlePhases'] = [];
    let eventCounter = 0;
    const addEvent = (
      phase: string,
      type: BattleEventType,
      side: BattleSide | 'both',
      message: string,
      impact: number
    ) => {
      events.push({
        id: `evt_${battleId}_${eventCounter++}`,
        turn: input.turn,
        phase,
        type,
        side,
        message,
        impact,
      });
    };

    addEvent('setup', 'phase_start', 'both', `${input.attackerFactionName ?? input.attackerFactionId} marches on ${input.territory.name}.`, 0);

    const attackerTroops = this.sumArmies(input.attackerArmies);
    const defenderFieldTroops = this.sumArmies(input.defenderArmies ?? []);
    const garrisonTroops = input.defenderGarrison ?? 0;
    const totalDefenderUnits = defenderFieldTroops;
    totalDefenderUnits.soldiers += garrisonTroops;

    const { baseStrength: atkBase, factors: atkBaseFactors } = this.calculateBaseStrength(
      input.attackerArmies,
      null,
      'attacker'
    );
    const { baseStrength: defBase, factors: defBaseFactors } = this.calculateBaseStrength(
      input.defenderArmies ?? [],
      garrisonTroops,
      'defender'
    );

    const { effectiveStrength: atkEff, factors: atkFactors } = this.calculateEffectiveStrength(
      atkBase,
      'attacker',
      input,
      attackerTroops,
      battleRNG,
      atkBaseFactors
    );
    const { effectiveStrength: defEff, factors: defFactors } = this.calculateEffectiveStrength(
      defBase,
      'defender',
      input,
      totalDefenderUnits,
      battleRNG,
      defBaseFactors
    );

    let runningAtk = atkEff;
    let runningDef = defEff;
    const phaseScores: number[] = [];
    for (let i = 0; i < C.phases.count; i++) {
      const phaseName = C.phases.names[i];
      const phaseWeight = C.phases.weights[i];
      const phaseRNG = battleRNG.fork(i + 31);

      const phaseAtkMod = 1 + (phaseRNG.next() - 0.5) * 2 * C.randomness.perPhaseRange;
      const phaseDefMod = 1 + (phaseRNG.next() - 0.5) * 2 * C.randomness.perPhaseRange;

      const phaseAtk = runningAtk * phaseAtkMod * phaseWeight;
      const phaseDef = runningDef * phaseDefMod * phaseWeight;
      const phaseAdv = (phaseAtk - phaseDef) / Math.max(1, (phaseAtk + phaseDef) / 2);
      phaseScores.push(phaseAdv);

      this.rollPhaseEvents(phaseName, i, phaseAdv, input, phaseRNG, addEvent);

      phases.push({
        name: phaseName,
        description: this.describePhase(phaseName, phaseAdv, phaseAtkMod, phaseDefMod),
        attackerAdvantage: phaseAdv,
      });

      const attritionAtk = Math.max(0.02, (1 - phaseAtkMod)) * phaseWeight;
      const attritionDef = Math.max(0.02, (1 - phaseDefMod)) * phaseWeight;
      runningAtk *= 1 - attritionAtk;
      runningDef *= 1 - attritionDef;
    }

    const finalAtk = runningAtk;
    const finalDef = runningDef;
    const rawRatio = finalAtk / Math.max(0.001, finalDef);
    const ratio = Math.max(C.numericalAdvantage.minRatio, Math.min(C.numericalAdvantage.maxRatioAdvantage, rawRatio));
    const margin = (finalAtk - finalDef) / Math.max(1, (finalAtk + finalDef) / 2);
    const baseIntensity = (atkEff + defEff) / 2;
    const battleIntensity = Math.min(1, Math.max(0.05,
      baseIntensity / (Math.max(1, atkBase + defBase) * 0.8) + Math.abs(margin) * -0.4 + 0.5
    ));

    let winner: BattleSide | 'draw';
    let loser: BattleSide | 'draw';
    let outcomeType: BattleOutcomeType;
    let territoryOutcome: TerritoryOutcome = 'unchanged';
    let defenderSurrendered = false;

    if (Math.abs(margin) < C.victory.stalemateMaxMargin && Math.abs(ratio - 1) < C.victory.stalemateMaxRatio - 1) {
      winner = 'draw';
      loser = 'draw';
      outcomeType = 'stalemate';
      addEvent('resolution', 'phase_end', 'both', 'Neither side can gain the upper hand; the battle ends in stalemate.', 0);
    } else if (ratio >= 1) {
      winner = 'attacker';
      loser = 'defender';
      if (ratio >= C.victory.decisiveRatioThreshold) {
        outcomeType = 'attacker_decisive_victory';
        addEvent('resolution', 'rout', 'defender', 'The defenders break and flee the field.', 25);
      } else if (ratio >= C.victory.narrowRatioThreshold) {
        outcomeType = 'attacker_narrow_victory';
        addEvent('resolution', 'phase_end', 'both', 'The attackers carry the field after a hard fight.', 10);
      } else {
        outcomeType = 'mutual_heavy_losses';
        addEvent('resolution', 'phase_end', 'both', 'Both forces are spent; the attackers hold the field barely.', 0);
      }
    } else {
      winner = 'defender';
      loser = 'attacker';
      const invRatio = 1 / ratio;
      if (invRatio >= C.victory.decisiveRatioThreshold) {
        outcomeType = 'defender_decisive_victory';
        addEvent('resolution', 'rout', 'attacker', 'The attackers are shattered and driven from the field.', -25);
      } else if (invRatio >= C.victory.narrowRatioThreshold) {
        outcomeType = 'defender_narrow_victory';
        addEvent('resolution', 'heroic_stand', 'defender', 'The defenders stand firm and repel the assault.', 15);
      } else {
        outcomeType = 'mutual_heavy_losses';
        addEvent('resolution', 'phase_end', 'both', 'Both sides bleed each other white; the attackers fall back.', 0);
      }
    }

    const { atkCasualties, defCasualties, atkRemaining, defRemaining, atkTroopBreakdown, defTroopBreakdown, pyrrhicCheck } =
      this.computeCasualties(outcomeType, ratio, battleIntensity, input, attackerTroops, totalDefenderUnits, garrisonTroops, battleRNG);

    if (pyrrhicCheck && outcomeType === 'attacker_narrow_victory') outcomeType = 'attacker_pyrrhic_victory';
    if (pyrrhicCheck && outcomeType === 'defender_narrow_victory') outcomeType = 'defender_pyrrhic_victory';

    if (winner === 'attacker') {
      const neededAdv = input.territory.isCapital
        ? C.victory.captureCapitalRequirement
        : C.victory.captureRequiredAdvantage;
      if (ratio >= neededAdv && atkRemaining.soldiers + atkRemaining.knights > 50) {
        territoryOutcome = 'captured';
        addEvent('resolution', 'breach', 'attacker', `${input.territory.name} falls to the attackers.`, 30);
        if (garrisonTroops > 0 && defCasualties.garrison !== undefined && defCasualties.garrison >= (input.defenderGarrison ?? 0) * 0.9) {
          defenderSurrendered = true;
          addEvent('resolution', 'surrender', 'defender', 'The remaining garrison surrenders.', 10);
        }
      } else {
        territoryOutcome = 'contested';
        addEvent('resolution', 'phase_end', 'both', `The attackers win the field but cannot secure ${input.territory.name}.`, 5);
      }
    } else if (winner === 'defender') {
      territoryOutcome = 'unchanged';
    } else {
      territoryOutcome = 'contested';
    }

    const attackerRouted = outcomeType === 'defender_decisive_victory' || outcomeType === 'defender_pyrrhic_victory';
    const defenderRouted = outcomeType === 'attacker_decisive_victory' || outcomeType === 'attacker_pyrrhic_victory';
    const attackerRetreated = winner === 'defender';
    const defenderRetreated = territoryOutcome === 'captured' && !defenderSurrendered;

    const atkSurvivorsPct = attackerRetreated
      ? Math.min(0.95, C.retreat.baseSurvivalRate
          + ((input.attackerArmies[0]?.morale ?? 50) - 50) * C.retreat.perMoraleSurvival
          + (attackerTroops.knights / Math.max(1, attackerTroops.soldiers + attackerTroops.knights)) * C.retreat.cavalryBoostRetreat
          + (ratio < C.retreat.criticalRetreatThreshold ? -C.retreat.enemyCloseRetreatMalus : 0))
      : undefined;

    const defSurvivorsPct = defenderRetreated
      ? input.territory.terrain === 'fortress' || input.territory.fortification >= 4
        ? C.retreat.fortressGarrisonRetreatSurvival
        : C.retreat.baseSurvivalRate + 0.15
      : undefined;

    const atkMoraleDelta = this.computeMoraleChange(winner, 'attacker', outcomeType, battleIntensity);
    const defMoraleDelta = this.computeMoraleChange(winner, 'defender', outcomeType, battleIntensity);

    const attackerBreakdown: BattleSideBreakdown = {
      side: 'attacker',
      factionId: input.attackerFactionId,
      factionName: input.attackerFactionName ?? input.attackerFactionId,
      baseStrength: atkBase,
      unitBreakdown: { soldiers: attackerTroops.soldiers, knights: attackerTroops.knights, siegeEngines: attackerTroops.siegeEngines },
      factors: atkFactors,
      effectiveStrength: Math.round(finalAtk),
      initialTroops: attackerTroops.soldiers + attackerTroops.knights,
      remainingTroops: Math.max(0, atkRemaining.soldiers + atkRemaining.knights),
      casualties: {
        soldiers: atkCasualties.soldiers,
        knights: atkCasualties.knights,
        siegeEngines: atkCasualties.siegeEngines,
        total: atkCasualties.soldiers + atkCasualties.knights + atkCasualties.siegeEngines,
        casualtyRate: Math.round(((atkCasualties.soldiers + atkCasualties.knights) / Math.max(1, attackerTroops.soldiers + attackerTroops.knights)) * 1000) / 1000,
      },
      moraleChange: atkMoraleDelta,
      routed: attackerRouted,
      retreated: attackerRetreated,
      retreatSurvivorsPct: atkSurvivorsPct,
    };

    const defenderBreakdown: BattleSideBreakdown = {
      side: 'defender',
      factionId: input.defenderFactionId,
      factionName: input.defenderFactionName ?? input.defenderFactionId,
      baseStrength: defBase,
      unitBreakdown: { soldiers: totalDefenderUnits.soldiers, knights: totalDefenderUnits.knights, siegeEngines: totalDefenderUnits.siegeEngines, garrison: garrisonTroops },
      factors: defFactors,
      effectiveStrength: Math.round(finalDef),
      initialTroops: totalDefenderUnits.soldiers + totalDefenderUnits.knights,
      remainingTroops: Math.max(0, defRemaining.soldiers + defRemaining.knights),
      casualties: {
        soldiers: defCasualties.soldiers,
        knights: defCasualties.knights,
        siegeEngines: defCasualties.siegeEngines,
        garrison: defCasualties.garrison,
        total: defCasualties.soldiers + defCasualties.knights + defCasualties.siegeEngines + (defCasualties.garrison ?? 0),
        casualtyRate: Math.round(((defCasualties.soldiers + defCasualties.knights + (defCasualties.garrison ?? 0)) / Math.max(1, totalDefenderUnits.soldiers + totalDefenderUnits.knights)) * 1000) / 1000,
      },
      moraleChange: defMoraleDelta,
      routed: defenderRouted,
      retreated: defenderRetreated,
      retreatSurvivorsPct: defSurvivorsPct,
    };

    const readableLog = this.buildReadableLog(input, { attacker: attackerBreakdown, defender: defenderBreakdown }, outcomeType, territoryOutcome, ratio, margin, events);
    const summary = this.buildSummary(input, outcomeType, territoryOutcome, attackerBreakdown, defenderBreakdown);

    const result: BattleResult = {
      battleId,
      turn: input.turn,
      territoryId: input.territory.id,
      territoryName: input.territory.name,
      seedUsed: input.seed,
      winner,
      loser,
      outcomeType,
      battleIntensity: Math.round(battleIntensity * 1000) / 1000,
      attacker: attackerBreakdown,
      defender: defenderBreakdown,
      territoryOutcome,
      defenderSurrendered,
      events,
      battlePhases: phases,
      effectiveRatio: Math.round(ratio * 1000) / 1000,
      marginOfVictory: Math.round(margin * 1000) / 1000,
      summary,
      readableLog,
    };
    return result;
  }

  private sumArmies(armies: Army[]): { soldiers: number; knights: number; siegeEngines: number } {
    return armies.reduce(
      (acc, a) => ({
        soldiers: acc.soldiers + Math.max(0, a.soldiers),
        knights: acc.knights + Math.max(0, a.knights),
        siegeEngines: acc.siegeEngines + Math.max(0, a.siegeEngines),
      }),
      { soldiers: 0, knights: 0, siegeEngines: 0 }
    );
  }

  private calculateBaseStrength(
    armies: Army[],
    garrison: number | null,
    side: BattleSide
  ): { baseStrength: number; factors: BattleFactor[] } {
    const troops = this.sumArmies(armies);
    const factors: BattleFactor[] = [];
    const soldierStr = troops.soldiers * C.baseStrength.soldier;
    const knightStr = troops.knights * C.baseStrength.knight;
    const siegeStr = troops.siegeEngines * C.baseStrength.siegeEngine;
    let garrisonStr = 0;
    if (garrison && garrison > 0) {
      garrisonStr = garrison * C.baseStrength.garrison;
      if (side === 'defender') garrisonStr *= C.unitType.garrisonBonusWhenDefending;
    }

    factors.push({ factor: 'Infantry', category: 'unit', contribution: soldierStr, description: `${troops.soldiers} soldiers × ${C.baseStrength.soldier}` });
    if (troops.knights > 0) factors.push({ factor: 'Cavalry', category: 'unit', contribution: knightStr, description: `${troops.knights} knights × ${C.baseStrength.knight}` });
    if (troops.siegeEngines > 0) factors.push({ factor: 'Siege', category: 'unit', contribution: siegeStr, description: `${troops.siegeEngines} siege engines × ${C.baseStrength.siegeEngine}` });
    if (garrison && garrison > 0) factors.push({
      factor: 'Garrison', category: 'unit',
      contribution: garrisonStr,
      description: `${garrison} garrison${side === 'defender' ? ' (defensive bonus)' : ''}`,
    });

    const totalBase = soldierStr + knightStr + siegeStr + garrisonStr;
    factors.unshift({ factor: 'Total base strength', category: 'base', contribution: totalBase, description: 'Sum of all unit strengths' });
    return { baseStrength: totalBase, factors };
  }

  private calculateEffectiveStrength(
    baseStrength: number,
    side: BattleSide,
    input: BattleInput,
    units: { soldiers: number; knights: number; siegeEngines: number },
    rng: SeededRNG,
    existingFactors: BattleFactor[]
  ): { effectiveStrength: number; factors: BattleFactor[] } {
    const factors = [...existingFactors];
    let eff = baseStrength;
    const terrain = input.territory.terrain;

    const terrainMod = side === 'attacker'
      ? C.terrain.attackerModifier[terrain as TerrainType] ?? 1
      : C.terrain.defenderModifier[terrain as TerrainType] ?? 1;
    const terrainContrib = Math.round((terrainMod - 1) * baseStrength);
    eff *= terrainMod;
    factors.push({
      factor: `Terrain: ${TERRAIN_NAMES[terrain] ?? terrain}`,
      category: 'terrain',
      contribution: terrainContrib,
      description: side === 'attacker'
        ? `Attacker terrain modifier ×${terrainMod.toFixed(2)}`
        : `Defender terrain modifier ×${terrainMod.toFixed(2)}`,
    });

    const fortLevel = Math.min(C.fortification.maxLevel, input.territory.fortification);
    if (fortLevel > 0 && side === 'defender') {
      const fortMult = 1 + fortLevel * C.fortification.perLevelStrengthBonus;
      const capitalMult = input.territory.isCapital ? C.fortification.capitalBonus : 1;
      const combined = fortMult * capitalMult;
      const fortContrib = Math.round((combined - 1) * baseStrength);
      eff *= combined;
      const structName = (C.fortification.structureNames as Record<string, string>)[String(fortLevel)] ?? `L${fortLevel}`;
      factors.push({
        factor: `Fortification: ${structName}`,
        category: 'fortification',
        contribution: fortContrib,
        description: input.territory.isCapital
          ? `${structName} (L${fortLevel}) ×${fortMult.toFixed(2)} + Capital defense ×${capitalMult.toFixed(2)}`
          : `${structName} (L${fortLevel}) ×${fortMult.toFixed(2)}`,
      });
    }

    if (fortLevel >= 3 && side === 'attacker' && units.siegeEngines < C.siege.minSiegeNeededForFortress) {
      const malus = C.siege.noSiegeFortressMalus;
      const contrib = Math.round((malus - 1) * baseStrength);
      eff *= malus;
      factors.push({
        factor: 'Lacking sufficient siege engines',
        category: 'fortification',
        contribution: contrib,
        description: `Against L${fortLevel} defenses, ${units.siegeEngines} siege engines < ${C.siege.minSiegeNeededForFortress} needed ×${malus.toFixed(2)}`,
      });
    } else if (units.siegeEngines > 0 && side === 'attacker' && fortLevel > 0) {
      const siegeValue = Math.min(1, (units.siegeEngines * C.siege.engineVsFortificationMultiplier) / (fortLevel * C.fortification.perLevelSiegeNeed));
      const siegeMult = 1 + siegeValue * 0.18;
      const contrib = Math.round((siegeMult - 1) * baseStrength);
      eff *= siegeMult;
      factors.push({
        factor: 'Siege engines in action',
        category: 'unit',
        contribution: contrib,
        description: `${units.siegeEngines} engines vs L${fortLevel} walls ×${siegeMult.toFixed(2)}`,
      });
    }

    const densityTerrainSet: ReadonlySet<string> = new Set(['forest', 'mountain', 'fortress', 'river']);
    const openTerrainSet: ReadonlySet<string> = new Set(['plains', 'desert', 'coastal']);
    if (units.knights > 0) {
      if (openTerrainSet.has(terrain) && side === 'attacker') {
        const cavMult = C.unitType.knightVsInfantryOpenTerrainBonus;
        const cavPart = units.knights * C.baseStrength.knight;
        const contrib = Math.round(cavPart * (cavMult - 1));
        eff += contrib;
        factors.push({ factor: 'Cavalry charge (open terrain)', category: 'terrain', contribution: contrib, description: `Open ${TERRAIN_NAMES[terrain]} favors knights ×${cavMult.toFixed(2)}` });
      } else if (densityTerrainSet.has(terrain) && side === 'attacker') {
        const cavMult = C.unitType.knightVsInfantryDenseTerrainMalus;
        const cavPart = units.knights * C.baseStrength.knight;
        const contrib = Math.round(cavPart * (cavMult - 1));
        eff += contrib;
        factors.push({ factor: 'Cavalry hindered (rough terrain)', category: 'terrain', contribution: contrib, description: `${TERRAIN_NAMES[terrain]} disrupts cavalry ×${cavMult.toFixed(2)}` });
      }
    }

    const allArmies = side === 'attacker' ? input.attackerArmies : input.defenderArmies ?? [];
    if (allArmies.length > 0) {
      const morale = allArmies.reduce((s, a) => s + a.morale, 0) / allArmies.length;
      if (morale > 50) {
        const bonus = 1 + ((morale - 50) / 10) * C.morale.highMoraleBonusPer10;
        const contrib = Math.round((bonus - 1) * baseStrength);
        eff *= bonus;
        factors.push({ factor: `High morale (${morale.toFixed(0)})`, category: 'morale', contribution: contrib, description: `Confident troops fight harder ×${bonus.toFixed(2)}` });
      } else if (morale < 50) {
        const penalty = 1 - ((50 - morale) / 10) * C.morale.lowMoralePenaltyPer10;
        const contrib = Math.round((penalty - 1) * baseStrength);
        eff *= penalty;
        factors.push({ factor: `Low morale (${morale.toFixed(0)})`, category: 'morale', contribution: contrib, description: `Shaken troops underperform ×${penalty.toFixed(2)}` });
      }

      const supply = allArmies.reduce((s, a) => s + a.supply, 0) / allArmies.length;
      if (supply < 60) {
        const malus = 1 - ((60 - supply) / 10) * C.supply.lowSupplyPenaltyPer10;
        const contrib = Math.round((malus - 1) * baseStrength);
        eff *= malus;
        factors.push({ factor: `Poor supply (${supply.toFixed(0)})`, category: 'morale', contribution: contrib, description: `Hungry troops fight worse ×${malus.toFixed(2)}` });
      }
    }

    if (side === 'attacker' && input.attackerAggression !== undefined) {
      const aggr = input.attackerAggression;
      const mult = 1 + (aggr - 0.5) * 0.3;
      const contrib = Math.round((mult - 1) * baseStrength);
      if (Math.abs(contrib) > 0.5) {
        eff *= mult;
        factors.push({ factor: `Warlord aggression (${(aggr * 100).toFixed(0)}%)`, category: 'strategic', contribution: contrib, description: `Aggressive leadership ×${mult.toFixed(2)}` });
      }
    }
    if (side === 'defender' && input.defenderDefensiveness !== undefined) {
      const def = input.defenderDefensiveness;
      const mult = 1 + (def - 0.5) * 0.3;
      const contrib = Math.round((mult - 1) * baseStrength);
      if (Math.abs(contrib) > 0.5) {
        eff *= mult;
        factors.push({ factor: `Warlord defensiveness (${(def * 100).toFixed(0)}%)`, category: 'strategic', contribution: contrib, description: `Cautious leadership ×${mult.toFixed(2)}` });
      }
    }

    if (side === 'attacker' && input.strategicAttackerBonus) {
      eff += input.strategicAttackerBonus;
      factors.push({ factor: 'Strategic attacker bonus', category: 'strategic', contribution: input.strategicAttackerBonus, description: 'Pre-battle positional advantage' });
    }
    if (side === 'defender' && input.strategicDefenderBonus) {
      eff += input.strategicDefenderBonus;
      factors.push({ factor: 'Strategic defender bonus', category: 'strategic', contribution: input.strategicDefenderBonus, description: 'Prepared defensive positions' });
    }
    if (side === 'attacker' && input.additionalAttackerModifiers) {
      eff += input.additionalAttackerModifiers;
      factors.push({ factor: 'External modifiers', category: 'strategic', contribution: input.additionalAttackerModifiers, description: 'Simulation-specific modifiers' });
    }
    if (side === 'defender' && input.additionalDefenderModifiers) {
      eff += input.additionalDefenderModifiers;
      factors.push({ factor: 'External modifiers', category: 'strategic', contribution: input.additionalDefenderModifiers, description: 'Simulation-specific modifiers' });
    }

    const rand = (rng.next() - 0.5) * 2 * C.randomness.range;
    const randMult = 1 + rand;
    const randContrib = Math.round(rand * baseStrength);
    eff *= randMult;
    factors.push({
      factor: 'Fortunes of war',
      category: 'random',
      contribution: randContrib,
      description: `Controlled randomness ×${randMult.toFixed(2)} (${rand >= 0 ? '+' : ''}${(rand * 100).toFixed(1)}%)`,
    });

    eff = Math.max(0.001, eff);
    return { effectiveStrength: eff, factors };
  }

  private rollPhaseEvents(
    phaseName: string,
    phaseIdx: number,
    phaseAdv: number,
    input: BattleInput,
    rng: SeededRNG,
    emit: (phase: string, type: BattleEventType, side: BattleSide | 'both', msg: string, impact: number) => void
  ): void {
    const advFavorsAttacker = phaseAdv > 0;
    if (rng.next() < C.battleEvents.flankChance) {
      const side: BattleSide = advFavorsAttacker ? 'attacker' : 'defender';
      emit(phaseName, 'flank', side, side === 'attacker' ? 'Attacking cavalry flanks the defender lines.' : 'Defender sorties flank the besiegers.', (side === 'attacker' ? 1 : -1) * 12);
    }
    if (phaseIdx === 0 && rng.next() < C.battleEvents.ambushChance) {
      const side: BattleSide = advFavorsAttacker ? 'defender' : 'attacker';
      emit(phaseName, 'ambush', side, side === 'attacker' ? 'The attackers ambush advancing defenders.' : 'The defenders spring an ambush.', (side === 'attacker' ? 1 : -1) * 18);
    }
    if (phaseIdx >= 1) {
      const siegeCount = input.attackerArmies.reduce((s, a) => s + a.siegeEngines, 0);
      const breachChance = siegeCount * C.battleEvents.breachChancePerSiege;
      if (input.territory.fortification >= 2 && rng.next() < breachChance) {
        emit(phaseName, 'breach', 'attacker', `Siege engines breach the walls of ${input.territory.name}.`, 20);
      }
      if (rng.next() < C.battleEvents.rallyChance * ((!advFavorsAttacker ? 1 : 0.2))) {
        emit(phaseName, 'rally', 'defender', 'The defenders rally behind their banners.', 10);
      }
    }
    if (phaseIdx === C.phases.count - 1) {
      if (rng.next() < C.battleEvents.heroicStandChance) {
        emit(phaseName, 'heroic_stand', 'defender', 'A heroic stand by the defenders stiffens resistance.', 15);
      }
      if (rng.next() < C.battleEvents.criticalHitChance) {
        const side: BattleSide = advFavorsAttacker ? 'attacker' : 'defender';
        emit(phaseName, 'critical_hit', side, side === 'attacker' ? 'A critical blow shatters the defender center.' : 'Defenders land a crushing counterblow.', (side === 'attacker' ? 1 : -1) * 16);
      }
    }
  }

  private describePhase(name: string, adv: number, atkMod: number, defMod: number): string {
    const who = adv > 0.05 ? 'Attackers gain the edge' : adv < -0.05 ? 'Defenders gain the edge' : 'Both sides are evenly matched';
    return `${who} in this phase (atk luck ×${atkMod.toFixed(2)}, def luck ×${defMod.toFixed(2)}).`;
  }

  private computeCasualties(
    outcomeType: BattleOutcomeType,
    ratio: number,
    intensity: number,
    input: BattleInput,
    atkInit: { soldiers: number; knights: number; siegeEngines: number },
    defInit: { soldiers: number; knights: number; siegeEngines: number },
    garrison: number,
    rng: SeededRNG
  ) {
    const atkWins = outcomeType.startsWith('attacker_') || outcomeType === 'mutual_heavy_losses';
    const defWins = outcomeType.startsWith('defender_') || outcomeType === 'mutual_heavy_losses';
    const attackerIsWinner = outcomeType.startsWith('attacker_');
    const defenderIsWinner = outcomeType.startsWith('defender_');

    let baseAtkCasRate = C.casualties.baseRate * intensity * C.casualties.intensityMultiplier;
    let baseDefCasRate = C.casualties.baseRate * intensity * C.casualties.intensityMultiplier;
    const close = Math.abs(ratio - 1) < 0.3;
    if (close) {
      baseAtkCasRate += C.casualties.closeBattleExtraCasualties;
      baseDefCasRate += C.casualties.closeBattleExtraCasualties;
    }
    if (attackerIsWinner) {
      baseAtkCasRate *= C.casualties.winnerCasualtyMultiplier;
      baseDefCasRate *= C.casualties.loserCasualtyMultiplier;
      if (outcomeType === 'attacker_decisive_victory') baseDefCasRate *= 1.2;
    }
    if (defenderIsWinner) {
      baseDefCasRate *= C.casualties.winnerCasualtyMultiplier;
      baseAtkCasRate *= C.casualties.loserCasualtyMultiplier;
      if (outcomeType === 'defender_decisive_victory') baseAtkCasRate *= C.casualties.routCasualtyMultiplier * 0.3;
    }
    if (outcomeType === 'mutual_heavy_losses') {
      baseAtkCasRate *= 1.2;
      baseDefCasRate *= 1.2;
    }
    const fortLvl = Math.min(C.fortification.maxLevel, input.territory.fortification);
    baseDefCasRate *= Math.max(0.15, 1 - fortLvl * C.casualties.fortificationDefenderCasualtyReduction);

    baseAtkCasRate = Math.max(C.casualties.minCasualtyRate, Math.min(C.casualties.maxCasualtyRate, baseAtkCasRate));
    baseDefCasRate = Math.max(C.casualties.minCasualtyRate, Math.min(C.casualties.maxCasualtyRate, baseDefCasRate));

    baseAtkCasRate += (rng.next() - 0.5) * 0.04;
    baseDefCasRate += (rng.next() - 0.5) * 0.04;

    const splitCas = (totalRate: number, init: { soldiers: number; knights: number; siegeEngines: number }) => {
      const soldierCas = Math.min(init.soldiers, Math.round(init.soldiers * totalRate));
      const knightCas = Math.min(init.knights, Math.round(init.knights * totalRate * 1.2));
      const siegeCas = Math.min(init.siegeEngines, Math.round(init.siegeEngines * totalRate * (attackerIsWinner ? 0.3 : 1.3)));
      return {
        soldiers: soldierCas,
        knights: knightCas,
        siegeEngines: siegeCas,
        totalRate: (soldierCas + knightCas) / Math.max(1, init.soldiers + init.knights),
      };
    };

    const atk = splitCas(baseAtkCasRate, atkInit);
    const def = splitCas(baseDefCasRate, defInit);
    const garrisonCas = Math.min(garrison, Math.round(garrison * baseDefCasRate * (defenderIsWinner ? 0.9 : 1.1)));

    const atkRemaining = {
      soldiers: atkInit.soldiers - atk.soldiers,
      knights: atkInit.knights - atk.knights,
      siegeEngines: atkInit.siegeEngines - atk.siegeEngines,
    };
    const defRemaining = {
      soldiers: defInit.soldiers - def.soldiers - garrisonCas,
      knights: defInit.knights - def.knights,
      siegeEngines: defInit.siegeEngines - def.siegeEngines,
    };

    const winnerCasRate = attackerIsWinner ? atk.totalRate : defenderIsWinner ? def.totalRate : Math.max(atk.totalRate, def.totalRate);
    const pyrrhicCheck =
      (outcomeType === 'attacker_narrow_victory' || outcomeType === 'defender_narrow_victory') &&
      winnerCasRate >= C.victory.pyrrhicWinnerCasualtyRate;

    void atkWins; void defWins;
    return {
      atkCasualties: { soldiers: atk.soldiers, knights: atk.knights, siegeEngines: atk.siegeEngines },
      defCasualties: { soldiers: def.soldiers, knights: def.knights, siegeEngines: def.siegeEngines, garrison: garrisonCas },
      atkRemaining,
      defRemaining,
      atkTroopBreakdown: atk,
      defTroopBreakdown: def,
      pyrrhicCheck,
    };
  }

  private computeMoraleChange(winner: BattleSide | 'draw', side: BattleSide, outcome: BattleOutcomeType, intensity: number): number {
    let base = 0;
    const win = winner === side;
    if (outcome === 'stalemate') base = 0;
    else if (win) {
      if (outcome.includes('decisive')) base = 18;
      else if (outcome.includes('pyrrhic')) base = 2;
      else base = 10;
    } else if (winner === 'draw') base = 0;
    else {
      if (outcome.includes('decisive')) base = -22;
      else if (outcome.includes('pyrrhic')) base = -6;
      else base = -12;
    }
    return Math.round(base * (0.6 + intensity));
  }

  private buildSummary(
    input: BattleInput,
    outcome: BattleOutcomeType,
    territory: TerritoryOutcome,
    atk: BattleSideBreakdown,
    def: BattleSideBreakdown
  ): string {
    const atkName = input.attackerFactionName ?? input.attackerFactionId;
    const defName = input.defenderFactionName ?? input.defenderFactionId;
    const outcomeLabels: Record<BattleOutcomeType, string> = {
      attacker_decisive_victory: `${atkName} wins a decisive victory`,
      attacker_narrow_victory: `${atkName} wins a narrow victory`,
      attacker_pyrrhic_victory: `${atkName} wins a pyrrhic victory`,
      defender_decisive_victory: `${defName} wins a decisive defensive victory`,
      defender_narrow_victory: `${defName} narrowly repels the attack`,
      defender_pyrrhic_victory: `${defName} holds on by a thread (pyrrhic defense)`,
      mutual_heavy_losses: `Both armies suffer heavy losses with no clear winner`,
      stalemate: `The battle ends in stalemate`,
    };
    const terrLabels: Record<TerritoryOutcome, string> = {
      unchanged: `Territory remains with ${defName}.`,
      captured: `${input.territory.name} is captured by ${atkName}.`,
      contested: `${input.territory.name} is contested but not yet captured.`,
      retreat_required: `The attackers are forced to retreat.`,
      surrendered: `The garrison surrenders.`,
    };
    return `${outcomeLabels[outcome]} at ${input.territory.name}. ${terrLabels[territory]} Atk losses: ${atk.casualties.total}; Def losses: ${def.casualties.total}.`;
  }

  private buildReadableLog(
    input: BattleInput,
    sides: { attacker: BattleSideBreakdown; defender: BattleSideBreakdown },
    outcomeType: BattleOutcomeType,
    territoryOutcome: TerritoryOutcome,
    ratio: number,
    margin: number,
    events: BattleEvent[]
  ): string[] {
    const atkName = input.attackerFactionName ?? input.attackerFactionId;
    const defName = input.defenderFactionName ?? input.defenderFactionId;
    const lines: string[] = [];
    lines.push(`=== BATTLE at ${input.territory.name.toUpperCase()} ===`);
    lines.push(`${atkName} (attacker) vs ${defName} (defender)`);
    lines.push(`Terrain: ${TERRAIN_NAMES[input.territory.terrain] ?? input.territory.terrain}  |  Fortification: ${(C.fortification.structureNames as Record<string,string>)[String(input.territory.fortification)]} (L${input.territory.fortification})${input.territory.isCapital ? ' ★ CAPITAL' : ''}`);
    lines.push('');
    lines.push(this.formatSideBreakdown('ATTACKER  EFFECTIVE STRENGTH', sides.attacker));
    lines.push('');
    lines.push(this.formatSideBreakdown('DEFENDER  EFFECTIVE STRENGTH', sides.defender));
    lines.push('');
    lines.push(`Effective strength ratio: ${ratio.toFixed(2)}:1  |  Margin: ${(margin >= 0 ? '+' : '')}${(margin * 100).toFixed(1)}%`);
    lines.push(`Battle intensity: ${(input.territory ? '' : '')}${(sides.attacker.casualties.casualtyRate + sides.defender.casualties.casualtyRate).toFixed(2)} (theoretical)`);
    lines.push('');
    lines.push('OUTCOME:');
    const headline = this.describeOutcomeHeadline(outcomeType, atkName, defName);
    lines.push(`  ${headline}`);
    lines.push(`  Attacker casualties: ${sides.attacker.casualties.soldiers} soldiers, ${sides.attacker.casualties.knights} knights, ${sides.attacker.casualties.siegeEngines} siege  (total: ${sides.attacker.casualties.total})`);
    lines.push(`  Defender casualties: ${sides.defender.casualties.soldiers} soldiers, ${sides.defender.casualties.knights} knights, ${sides.defender.casualties.siegeEngines} siege${sides.defender.casualties.garrison ? `, ${sides.defender.casualties.garrison} garrison` : ''}  (total: ${sides.defender.casualties.total})`);
    lines.push(`  Attacker remaining: ${Math.max(0, sides.attacker.remainingTroops)}  |  Defender remaining: ${Math.max(0, sides.defender.remainingTroops)}${sides.defender.unitBreakdown.garrison ? ` (+${Math.max(0, (sides.defender.unitBreakdown.garrison ?? 0) - (sides.defender.casualties.garrison ?? 0))} garrison)` : ''}`);
    lines.push(`  Territory: ${territoryOutcome.replace(/_/g, ' ').toUpperCase()}`);
    if (sides.attacker.retreated) lines.push(`  Attacker retreats (≈${Math.round((sides.attacker.retreatSurvivorsPct ?? 0) * 100)}% of survivors escape).`);
    if (sides.defender.retreated) lines.push(`  Defender retreats (≈${Math.round((sides.defender.retreatSurvivorsPct ?? 0) * 100)}% of survivors escape).`);
    lines.push('');
    lines.push('BATTLE EVENTS:');
    const notable = events.filter((e) => e.type !== 'phase_start');
    if (notable.length === 0) lines.push('  (no notable events)');
    for (const e of notable.slice(0, 12)) {
      const sideTag = e.side === 'both' ? '·' : e.side === 'attacker' ? '▲' : '▼';
      lines.push(`  [${e.phase}] ${sideTag} ${e.message}`);
    }
    return lines;
  }

  private formatSideBreakdown(header: string, side: BattleSideBreakdown): string {
    const pad = (n: number, w = 7) => (n >= 0 ? '+' : '') + Math.round(n).toString().padStart(w, ' ');
    const lines: string[] = [];
    lines.push(`${header}`);
    lines.push(`  Base:  ${Math.round(side.baseStrength).toString().padStart(8, ' ')}`);
    const contribLines: string[] = [];
    for (const f of side.factors) {
      if (f.factor === 'Total base strength') continue;
      const tag = `[${f.category.substring(0, 3)}]`;
      contribLines.push(`  ${tag} ${f.factor.padEnd(32, ' ')} ${pad(f.contribution)}  ${f.description}`);
    }
    lines.push(...contribLines);
    lines.push(`  TOTAL: ${Math.round(side.effectiveStrength).toString().padStart(8, ' ')}`);
    return lines.join('\n');
  }

  private describeOutcomeHeadline(type: BattleOutcomeType, atkName: string, defName: string): string {
    switch (type) {
      case 'attacker_decisive_victory': return `ATTACKER DECISIVE VICTORY — ${atkName} overwhelms ${defName}.`;
      case 'attacker_narrow_victory': return `ATTACKER NARROW VICTORY — ${atkName} edges out ${defName}.`;
      case 'attacker_pyrrhic_victory': return `ATTACKER PYRRHIC VICTORY — ${atkName} wins at terrible cost.`;
      case 'defender_decisive_victory': return `DEFENDER DECISIVE VICTORY — ${defName} crushes ${atkName}.`;
      case 'defender_narrow_victory': return `DEFENDER NARROW VICTORY — ${defName} repels ${atkName}.`;
      case 'defender_pyrrhic_victory': return `DEFENDER PYRRHIC VICTORY — ${defName} holds but is gutted.`;
      case 'mutual_heavy_losses': return `MUTUAL HEAVY LOSSES — both armies bleed out, no clear victor.`;
      case 'stalemate': return `STALEMATE — neither side can break through.`;
    }
  }

  formatResult(result: BattleResult, includeBreakdown: boolean = true): string {
    const atkName = result.attacker.factionName;
    const defName = result.defender.factionName;
    const outLines: string[] = [];
    outLines.push('══════════════════════════════════════════════════════════════');
    outLines.push(` BATTLE REPORT  ·  ${result.territoryName.toUpperCase()}`);
    outLines.push(` ${atkName} → ${defName}   |   Turn ${result.turn}   |   Seed ${result.seedUsed}`);
    outLines.push('══════════════════════════════════════════════════════════════');
    if (includeBreakdown) {
      outLines.push(...result.readableLog);
    } else {
      const atkCas = result.attacker.casualties.total;
      const defCas = result.defender.casualties.total;
      const atkRem = result.attacker.remainingTroops;
      const defRem = result.defender.remainingTroops;
      const battleType = result.outcomeType.replace(/_/g, ' ').replace(/(^|\s)\S/g, (c) => c.toUpperCase());
      outLines.push(`Result: ${result.winner === 'draw' ? 'STALEMATE' : result.winner === 'attacker' ? 'ATTACKER VICTORY' : 'DEFENDER VICTORY'} (${battleType})`);
      outLines.push('');
      outLines.push(`Attacker: ${atkName}`);
      outLines.push(`  Casualties: ${atkCas}`);
      outLines.push(`  Remaining:  ${atkRem}`);
      outLines.push('');
      outLines.push(`Defender: ${defName}`);
      outLines.push(`  Casualties: ${defCas}`);
      outLines.push(`  Remaining:  ${defRem}${result.defender.unitBreakdown.garrison ? ` (garrison: ${Math.max(0, (result.defender.unitBreakdown.garrison ?? 0) - (result.defender.casualties.garrison ?? 0))})` : ''}`);
      outLines.push('');
      outLines.push(`Territory: ${result.territoryOutcome.toUpperCase().replace(/_/g, ' ')}`);
      if (result.attacker.retreated) outLines.push('Attacker: RETREAT REQUIRED');
    }
    outLines.push('');
    outLines.push(`Summary: ${result.summary}`);
    outLines.push('══════════════════════════════════════════════════════════════');
    return outLines.join('\n');
  }
}
