import { BALANCE, TERRAIN_NAMES } from '../constants/balance';
import { SeededRNG } from '../utils/SeededRNG';
import { BattleEventType, BattleOutcomeType, BattleSide, TerritoryOutcome } from '../types';
import {
  ArmyLike,
  CombatPowerBreakdown,
  TerritoryLike,
  UnitBreakdown,
  computeAttackerPower,
  computeDefenderPower,
  computeWinProbability,
  computeCasualtyRates,
  sumUnits,
} from './CombatPower';

/** Region display name when provided; otherwise the stable territory id. */
function battlePlaceName(territory: { id: string; name?: string }): string {
  return territory.name && territory.name.length > 0 ? territory.name : territory.id;
}

/**
 * Battle-specific input DTO. Deliberately NOT the canonical `Army`/`Territory`
 * types (see `../types`) — this is what BattleEngine actually needs to
 * resolve combat, expressed via the minimal `ArmyLike`/`TerritoryLike`
 * shapes from `./CombatPower`. A real `Army`/`Territory` object satisfies
 * these structurally, so callers can pass canonical entities straight in
 * without an adapter step.
 *
 * Participant-agnostic: there is no player vs AI field. PLAYER→AI, AI→PLAYER,
 * and AI→AI battles use this same input and `BattleEngine.resolve()`.
 */
export interface BattleInput {
  turn: number;
  seed: number;
  battleId?: string;
  attackerFactionId: string;
  attackerFactionName?: string;
  defenderFactionId: string;
  defenderFactionName?: string;
  attackerArmies: ArmyLike[];
  defenderArmies?: ArmyLike[];
  defenderGarrison?: number;
  territory: TerritoryLike & {
    id: string;
    /** Optional display label (region name). Falls back to territory id. */
    name?: string;
    owner?: string | null;
    fortification: number;
    garrison?: number;
  };
  attackerAggression?: number;
  defenderDefensiveness?: number;
  strategicAttackerBonus?: number;
  strategicDefenderBonus?: number;
  additionalAttackerModifiers?: number;
  additionalDefenderModifiers?: number;
  attackerQuality?: number;
  defenderQuality?: number;
}

/**
 * Casualty accounting for one side.
 *
 * IMPORTANT — siege engines are tracked SEPARATELY from "troops":
 *  - `soldiers` / `knights` / `garrison`: per-category casualty counts.
 *  - `siegeEngines`: siege-engine casualties, kept out of `total`/
 *    `casualtyRate` on purpose (see below).
 *  - `total` / `casualtyRate`: TROOP casualties only (soldiers + knights +
 *    garrison). These are the aggregate counterparts of
 *    `BattleSideBreakdown.initialTroops`/`remainingTroops`, which are also
 *    troop-only — so `remainingTroops + total === initialTroops` always
 *    holds. Siege engines are intentionally excluded so `total` doesn't mix
 *    two differently-scaled unit categories into one number (previously,
 *    a battle with 10 soldiers + 100 siege engines could report
 *    `total: 37` against `initialTroops: 10`, i.e. more "casualties" than
 *    troops that ever existed — that bug is what this shape fixes).
 *  - `siegeCasualtyRate`: siege engines destroyed / initial siege engines
 *    (0 if the side had none), the siege-only counterpart of `casualtyRate`.
 */
export interface CasualtyBreakdown {
  soldiers: number;
  knights: number;
  siegeEngines: number;
  garrison?: number;
  /** Troop casualties only (soldiers + knights + garrison) — excludes siegeEngines. */
  total: number;
  /** Troop casualty rate only (total / initialTroops) — excludes siegeEngines. */
  casualtyRate: number;
  /** Siege-engine casualty rate (siegeEngines / initial siege engines), tracked separately from troop casualtyRate. */
  siegeCasualtyRate: number;
}

export interface BattleSideBreakdown {
  side: BattleSide;
  factionId: string;
  factionName: string;
  power: CombatPowerBreakdown;
  effectivePower: number;
  unitBreakdown: UnitBreakdown;
  /** Initial troop count (soldiers + knights [+ garrison for defender]). Deliberately excludes siege engines — see `initialSiegeEngines`. */
  initialTroops: number;
  /** Remaining troop count after casualties. Under the no-retreat rule, this is 0 for the losing side (see `BattleResult`/docs/BATTLE_ENGINE_CORRECTNESS.md). */
  remainingTroops: number;
  /** Initial siege engine count, tracked separately from `initialTroops`. */
  initialSiegeEngines: number;
  /** Remaining siege engines after casualties. 0 for the losing side under the no-retreat rule. */
  remainingSiegeEngines: number;
  remaining: UnitBreakdown;
  casualties: CasualtyBreakdown;
  moraleChange: number;
  /** True for the losing side of a decisive victory. Narrative-only flavor flag; does not imply any surviving remnant — see `remainingTroops`. */
  routed: boolean;
}

export interface BattleResult {
  battleId: string;
  turn: number;
  territoryId: string;
  territoryName: string;
  seedUsed: number;
  winner: BattleSide | 'draw';
  loser: BattleSide | 'draw';
  outcomeType: BattleOutcomeType;
  attackerWinProbability: number;
  randomRoll: number;
  effectivePowerRatio: number;
  battleIntensity: number;
  attacker: BattleSideBreakdown;
  defender: BattleSideBreakdown;
  territoryOutcome: TerritoryOutcome;
  /**
   * True when the territory was captured (i.e. `territoryOutcome ===
   * 'captured'`). Under the no-retreat rule the defender is always fully
   * eliminated when captured, so this is now a narrative-only alias for
   * that fact rather than an independently-computed threshold — kept as
   * its own field for API stability and because `formatResult`/callers key
   * off it for "surrender" flavor text, but it never contradicts
   * `territoryOutcome`.
   */
  defenderSurrendered: boolean;
  events: BattleEvent[];
  battlePhases: {
    name: string;
    description: string;
    attackerAdvantage: number;
  }[];
  effectiveRatio: number;
  marginOfVictory: number;
  summary: string;
  readableLog: string[];
  calculation: BattleCalculation;
}

export interface BattleCalculation {
  attacker: {
    rawTroops: number;
    quality: number;
    morale: number;
    moraleLabel: string;
    effectivePower: number;
  };
  defender: {
    rawTroops: number;
    quality: number;
    morale: number;
    moraleLabel: string;
    defenseBonus: number;
    defenseLabel: string;
    effectivePower: number;
  };
  powerRatio: number;
  attackerWinProbability: number;
  randomRoll: number;
  winner: 'attacker' | 'defender';
  attackerCasualties: { count: number; rate: number };
  defenderCasualties: { count: number; rate: number };
  attackerRemaining: number;
  defenderRemaining: number;
}

export interface BattleEvent {
  id: string;
  turn: number;
  phase: string;
  type: BattleEventType;
  side: BattleSide | 'both';
  message: string;
  impact: number;
}

export interface BattleValidation {
  valid: boolean;
  errors: string[];
}

/** Sole authority for combat math. Does not know or care which faction is the player. */
export class BattleEngine {
  validate(input: BattleInput): BattleValidation {
    const errors: string[] = [];
    const totalAttackers = (input.attackerArmies ?? []).reduce(
      (s, a) => s + Math.max(0, a.soldiers) + Math.max(0, a.knights), 0,
    );
    if (totalAttackers <= 0) errors.push('Attacking armies have zero troops');
    const defenderField = (input.defenderArmies ?? []).reduce(
      (s, a) => s + Math.max(0, a.soldiers) + Math.max(0, a.knights), 0,
    );
    const defenderGarrison = Math.max(0, input.defenderGarrison ?? 0);
    if (defenderField + defenderGarrison <= 0) errors.push('Defender has no troops');
    if (!input.territory?.id) errors.push('No territory provided for battle');
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

    const C = BALANCE.combat;
    const rng = new SeededRNG((input.seed >>> 0) ^ C.randomness.seedSaltBase);
    const battleId = input.battleId ??
      `battle_${input.turn}_${input.attackerFactionId}_${input.defenderFactionId}_${Math.floor(rng.next() * 1e6)}`;

    const events: BattleEvent[] = [];
    let evId = 0;
    const emit = (phase: string, type: BattleEventType, side: BattleSide | 'both', message: string, impact: number = 0) => {
      events.push({
        id: `evt_${battleId}_${evId++}`,
        turn: input.turn,
        phase, type, side, message, impact,
      });
    };

    const atkName = input.attackerFactionName ?? input.attackerFactionId;
    const defName = input.defenderFactionName ?? input.defenderFactionId;
    emit('setup', 'phase_start', 'both',
      `${atkName} marches on ${battlePlaceName(input.territory)}.`, 0);

    const atkQuality = input.attackerQuality ?? C.qualityDefault;
    const defQuality = input.defenderQuality ?? C.qualityDefault;

    const atkInit = sumUnits(input.attackerArmies, 0);
    const defInit = sumUnits(input.defenderArmies ?? [], input.defenderGarrison ?? 0);

    let atkPower = computeAttackerPower(input.attackerArmies, atkQuality);
    let defPower = computeDefenderPower(
      input.defenderArmies ?? [],
      input.defenderGarrison ?? 0,
      input.territory,
      defQuality,
    );

    if (input.strategicAttackerBonus) atkPower.effectivePower += input.strategicAttackerBonus;
    if (input.strategicDefenderBonus) defPower.effectivePower += input.strategicDefenderBonus;
    if (input.additionalAttackerModifiers) atkPower.effectivePower += input.additionalAttackerModifiers;
    if (input.additionalDefenderModifiers) defPower.effectivePower += input.additionalDefenderModifiers;
    atkPower.effectivePower = Math.max(0.0001, atkPower.effectivePower);
    defPower.effectivePower = Math.max(0.0001, defPower.effectivePower);

    const winProb = computeWinProbability(atkPower.effectivePower, defPower.effectivePower);
    const powerRatio = atkPower.effectivePower / defPower.effectivePower;
    const roll = rng.next();
    const total = atkPower.effectivePower + defPower.effectivePower;
    const dominance = Math.max(atkPower.effectivePower, defPower.effectivePower) / Math.max(0.0001, total);
    const rawAdvantage = (atkPower.effectivePower - defPower.effectivePower) / Math.max(0.0001, total);
    const relativeAdvantage = Math.abs(rawAdvantage);

    let winner: 'attacker' | 'defender';
    let loser: 'attacker' | 'defender';
    let isStalemate = false;
    if (Math.abs(roll - winProb) < 1e-9 && winProb === 0.5) {
      isStalemate = true;
      winner = roll < 0.5 ? 'attacker' : 'defender';
      loser = winner === 'attacker' ? 'defender' : 'attacker';
    } else {
      winner = roll < winProb ? 'attacker' : 'defender';
      loser = winner === 'attacker' ? 'defender' : 'attacker';
    }

    const winnerPower = winner === 'attacker' ? atkPower.effectivePower : defPower.effectivePower;
    const loserPower = loser === 'attacker' ? atkPower.effectivePower : defPower.effectivePower;

    const CC = C.casualties;
    const isCloseBattle = Math.abs(winProb - 0.5) < CC.closeBattleThreshold;
    const { winnerRate: wBase, loserRate: lBase } = computeCasualtyRates(winnerPower, loserPower, rng);

    let winnerCasRate = wBase;
    let loserCasRate = lBase;
    if (isCloseBattle) {
      winnerCasRate = Math.min(CC.winnerMaxRate, winnerCasRate + CC.closeBattleExtraWinner);
      loserCasRate = Math.min(CC.loserMaxRate, loserCasRate + CC.closeBattleExtraLoser);
    }
    winnerCasRate = Math.max(CC.winnerMinRate, Math.min(CC.winnerMaxRate, winnerCasRate));
    loserCasRate = Math.max(CC.loserMinRate, Math.min(CC.loserMaxRate, loserCasRate));

    // NO-RETREAT RULE: the side that loses the battle is eliminated outright
    // (casualty rate 1.0, every unit category — troops, siege, garrison)
    // rather than retreating with survivors. This only applies when there
    // is an actual winner/loser. The `isStalemate` branch above is a
    // near-unreachable exact-tie edge case with no "loser" by definition —
    // it keeps the original graduated winner/loser rate split unchanged.
    const atkCasRate = isStalemate
      ? (winner === 'attacker' ? winnerCasRate : loserCasRate)
      : (winner === 'attacker' ? winnerCasRate : 1);
    const defCasRate = isStalemate
      ? (winner === 'defender' ? winnerCasRate : loserCasRate)
      : (winner === 'defender' ? winnerCasRate : 1);

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
    let outcomeType: BattleResult['outcomeType'];
    if (isStalemate) {
      outcomeType = 'stalemate';
      emit('resolution', 'phase_end', 'both',
        'Neither side can gain the upper hand; stalemate.', 0);
    } else if (winner === 'attacker') {
      // NOTE: the narrow-victory branch below is reached both when
      // `relativeAdvantage` is small (<= narrowWinnerMaxAdvantage) AND as
      // the fallback for the "moderate" range between narrow and decisive
      // thresholds — there is no distinct label for that middle range in
      // `BattleOutcomeType`, so both collapse to "narrow" (unchanged from
      // the original resolver; the two branches always produced the same
      // value, so this is a no-op cleanup, not a behavior change).
      if (isPyrrhic) outcomeType = 'attacker_pyrrhic_victory';
      else if (relativeAdvantage >= V.decisiveWinnerMinAdvantage) outcomeType = 'attacker_decisive_victory';
      else outcomeType = 'attacker_narrow_victory';
      if (outcomeType === 'attacker_decisive_victory') {
        emit('resolution', 'rout', 'defender', 'The defenders are routed and annihilated — no retreat.', 25);
      } else if (outcomeType === 'attacker_pyrrhic_victory') {
        emit('resolution', 'phase_end', 'both', 'Attackers win at devastating cost; the defending force is wiped out.', 5);
      } else {
        emit('resolution', 'phase_end', 'both', 'The attackers carry the field after a hard fight; the defending force is destroyed.', 10);
      }
    } else {
      if (isPyrrhic) outcomeType = 'defender_pyrrhic_victory';
      else if (relativeAdvantage >= V.decisiveWinnerMinAdvantage) outcomeType = 'defender_decisive_victory';
      else outcomeType = 'defender_narrow_victory';
      if (outcomeType === 'defender_decisive_victory') {
        emit('resolution', 'rout', 'attacker', 'The attacking army is shattered and destroyed — no retreat.', -25);
      } else if (outcomeType === 'defender_pyrrhic_victory') {
        emit('resolution', 'phase_end', 'both', 'Defenders hold but suffer crippling losses; the attacking force is destroyed.', -5);
      } else {
        emit('resolution', 'heroic_stand', 'defender', 'The defenders stand firm and repel the assault; the attacking force is destroyed.', 15);
      }
    }

    let territoryOutcome: 'unchanged' | 'captured' | 'contested';
    let defenderSurrendered = false;
    const neededAdv = V.captureRequiredWinnerAdvantage;
    const minRemain = V.captureMinAttackerRemainingRatio;
    const atkRemCount = atkRemaining.soldiers + atkRemaining.knights;
    const atkInitCount = atkInit.soldiers + atkInit.knights;

    if (outcomeType === 'stalemate') {
      territoryOutcome = 'contested';
    } else if (winner === 'attacker') {
      const attackerHasEnough = atkInitCount === 0 ? false : (atkRemCount / Math.max(1, atkInitCount)) >= minRemain;
      if (relativeAdvantage >= neededAdv && attackerHasEnough) {
        territoryOutcome = 'captured';
        emit('resolution', 'breach', 'attacker', `${battlePlaceName(input.territory)} falls to the attackers.`, 30);
        // Under the no-retreat rule the defender (loser) is always fully
        // eliminated — see `defCasRate` above, forced to 1.0 whenever
        // attacker wins. So "did the garrison collapse" is no longer an
        // independent probabilistic threshold (it used to check
        // `totalDefCas / totalDefInit >= 0.9`, which is now trivially
        // always true); it's a direct alias for "territory captured".
        // Kept as its own field/event for API stability and narrative
        // flavor — it never contradicts `territoryOutcome`.
        defenderSurrendered = true;
        emit('resolution', 'surrender', 'defender', 'The defending garrison is captured; resistance ends.', 10);
      } else {
        territoryOutcome = 'contested';
        emit('resolution', 'phase_end', 'both',
          `Attackers win the field but cannot secure ${battlePlaceName(input.territory)}.`, 5);
      }
    } else {
      territoryOutcome = 'unchanged';
    }

    // `routed` is a narrative flavor flag for the losing side of a decisive
    // victory. It does NOT imply any surviving remnant — under the
    // no-retreat rule the loser's `remainingTroops`/`remainingSiegeEngines`
    // are 0 regardless of whether the loss was decisive, narrow, or
    // pyrrhic (see `atkCasRate`/`defCasRate` above). There is no
    // corresponding "retreated" concept anymore: armies do not retreat.
    const attackerRouted = outcomeType === 'defender_decisive_victory';
    const defenderRouted = outcomeType === 'attacker_decisive_victory';

    const atkMorale = computeMoraleDelta(isStalemate ? 'draw' : winner, 'attacker', outcomeType, C);
    const defMorale = computeMoraleDelta(isStalemate ? 'draw' : winner, 'defender', outcomeType, C);

    const attackerBreakdown: BattleSideBreakdown = {
      side: 'attacker',
      factionId: input.attackerFactionId,
      factionName: atkName,
      power: atkPower,
      effectivePower: Math.round(atkPower.effectivePower),
      unitBreakdown: { ...atkInit },
      initialTroops: atkInit.soldiers + atkInit.knights,
      remainingTroops: atkRemaining.soldiers + atkRemaining.knights,
      initialSiegeEngines: atkInit.siegeEngines,
      remainingSiegeEngines: atkRemaining.siegeEngines,
      remaining: atkRemaining,
      casualties: {
        ...atkCas,
        total: atkCas.total,
        casualtyRate: round3(atkCas.casualtyRate),
        siegeCasualtyRate: round3(atkCas.siegeCasualtyRate),
      },
      moraleChange: atkMorale,
      routed: attackerRouted,
    };

    const defenderBreakdown: BattleSideBreakdown = {
      side: 'defender',
      factionId: input.defenderFactionId,
      factionName: defName,
      power: defPower,
      effectivePower: Math.round(defPower.effectivePower),
      unitBreakdown: { ...defInit, garrison: defInit.garrison ?? 0 },
      initialTroops: defInit.soldiers + defInit.knights + (defInit.garrison ?? 0),
      remainingTroops: defRemainingUnits.soldiers + defRemainingUnits.knights + garrisonLeft,
      initialSiegeEngines: defInit.siegeEngines,
      remainingSiegeEngines: defRemainingUnits.siegeEngines,
      remaining: { ...defRemainingUnits, garrison: garrisonLeft },
      casualties: {
        ...defCas,
        total: defCas.total,
        casualtyRate: round3(defCas.casualtyRate),
        siegeCasualtyRate: round3(defCas.siegeCasualtyRate),
      },
      moraleChange: defMorale,
      routed: defenderRouted,
    };

    const calculation: BattleCalculation = {
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

    const readableLog = this.buildReadableLog(
      input, attackerBreakdown, defenderBreakdown,
      outcomeType, territoryOutcome, winProb, powerRatio, roll, relativeAdvantage, events, calculation,
    );
    const summary = this.buildSummary(input, outcomeType, territoryOutcome, attackerBreakdown, defenderBreakdown);

    const margin = (atkPower.effectivePower - defPower.effectivePower) /
      Math.max(0.0001, (atkPower.effectivePower + defPower.effectivePower) / 2);
    return {
      battleId,
      turn: input.turn,
      territoryId: input.territory.id,
      territoryName: battlePlaceName(input.territory),
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

  formatResult(result: BattleResult, includeBreakdown: boolean = true): string {
    const out: string[] = [];
    out.push('══════════════════════════════════════════════════════════════');
    out.push(` BATTLE REPORT  ·  ${result.territoryName.toUpperCase()}`);
    out.push(` ${result.attacker.factionName} → ${result.defender.factionName}`
      + `   |   Turn ${result.turn}   |   Seed ${result.seedUsed}`);
    out.push('══════════════════════════════════════════════════════════════');
    if (includeBreakdown) {
      out.push(...result.readableLog);
    } else {
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

  private buildSummary(
    input: BattleInput,
    outcome: BattleResult['outcomeType'],
    territory: BattleResult['territoryOutcome'],
    atk: BattleSideBreakdown,
    def: BattleSideBreakdown,
  ): string {
    const atkName = input.attackerFactionName ?? input.attackerFactionId;
    const defName = input.defenderFactionName ?? input.defenderFactionId;
    const labels: Record<string, string> = {
      attacker_decisive_victory: `${atkName} wins a decisive victory`,
      attacker_narrow_victory: `${atkName} wins a narrow victory`,
      attacker_pyrrhic_victory: `${atkName} wins a pyrrhic victory`,
      defender_decisive_victory: `${defName} wins a decisive defensive victory`,
      defender_narrow_victory: `${defName} narrowly repels the attack`,
      defender_pyrrhic_victory: `${defName} holds on by a thread (pyrrhic defense)`,
      stalemate: `The battle ends in stalemate`,
    };
    const terrLabels: Record<string, string> = {
      unchanged: `Territory remains with ${defName}.`,
      captured: `${battlePlaceName(input.territory)} is captured by ${atkName}.`,
      contested: `${battlePlaceName(input.territory)} is contested but not yet captured.`,
    };
    return `${labels[outcome]} at ${battlePlaceName(input.territory)}. ${terrLabels[territory]} Atk losses: ${atk.casualties.total}; Def losses: ${def.casualties.total}.`;
  }

  private buildReadableLog(
    input: BattleInput,
    atk: BattleSideBreakdown,
    def: BattleSideBreakdown,
    outcomeType: BattleResult['outcomeType'],
    territoryOutcome: BattleResult['territoryOutcome'],
    winProb: number,
    powerRatio: number,
    roll: number,
    relativeAdvantage: number,
    events: BattleEvent[],
    calc: BattleCalculation,
  ): string[] {
    const atkName = atk.factionName;
    const defName = def.factionName;
    const L: string[] = [];
    L.push(`=== BATTLE at ${battlePlaceName(input.territory).toUpperCase()} ===`);
    L.push(`${atkName} (attacker) vs ${defName} (defender)`);
    const terrName = TERRAIN_NAMES[input.territory.terrain] ?? input.territory.terrain;
    const fortStr = BALANCE.combat.fortificationPerLevelBonus;
    L.push(`Terrain: ${terrName}  |  Fortification: L${input.territory.fortification}`);
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
    if (atk.initialSiegeEngines > 0 || def.initialSiegeEngines > 0) {
      // Siege engines are tracked separately from the troop casualties
      // above — see `CasualtyBreakdown` doc comment.
      L.push(`  Siege engines — Attacker: ${(atk.initialSiegeEngines - atk.remainingSiegeEngines).toLocaleString()} of ${atk.initialSiegeEngines.toLocaleString()} lost` +
        `;  Defender: ${(def.initialSiegeEngines - def.remainingSiegeEngines).toLocaleString()} of ${def.initialSiegeEngines.toLocaleString()} lost`);
    }
    L.push('');
    L.push('OUTCOME:');
    L.push(`  ${describeOutcome(outcomeType, atkName, defName)}`);
    L.push(`  Territory: ${territoryOutcome.replace(/_/g, ' ').toUpperCase()}`);
    // NO-RETREAT RULE: the losing side is eliminated, not withdrawn. There
    // is no "loser" (and thus nothing to eliminate) in the stalemate case.
    if (outcomeType !== 'stalemate') {
      const loserName = calc.winner === 'attacker' ? defName : atkName;
      L.push(`  ${loserName}'s forces are eliminated — Rep Wars armies do not retreat.`);
    }
    L.push('');
    L.push('BATTLE EVENTS:');
    const notable = events.filter((e) => e.type !== 'phase_start');
    if (notable.length === 0) L.push('  (no notable events)');
    for (const e of notable.slice(0, 12)) {
      const tag = e.side === 'both' ? '·' : e.side === 'attacker' ? '▲' : '▼';
      L.push(`  [${e.phase}] ${tag} ${e.message}`);
    }
    return L;
  }
}

function splitCasualties(init: UnitBreakdown, rate: number): CasualtyBreakdown {
  const soldiers = Math.min(init.soldiers, Math.round(init.soldiers * rate));
  const knights = Math.min(init.knights, Math.round(init.knights * rate));
  const siegeEngines = Math.min(init.siegeEngines, Math.round(init.siegeEngines * rate));
  const garrison = init.garrison !== undefined
    ? Math.min(init.garrison, Math.round(init.garrison * rate))
    : undefined;
  // `total`/`casualtyRate` are TROOP-ONLY (soldiers + knights + garrison) —
  // siege engines are intentionally excluded and reported separately via
  // `siegeEngines`/`siegeCasualtyRate` instead of being mixed into the same
  // aggregate. See `CasualtyBreakdown` doc comment for why.
  const totalTroops = init.soldiers + init.knights + (init.garrison ?? 0);
  const totalTroopCas = soldiers + knights + (garrison ?? 0);
  const casualtyRate = totalTroops === 0 ? 0 : totalTroopCas / totalTroops;
  const siegeCasualtyRate = init.siegeEngines === 0 ? 0 : siegeEngines / init.siegeEngines;
  return { soldiers, knights, siegeEngines, garrison, total: totalTroopCas, casualtyRate, siegeCasualtyRate };
}

function computeMoraleDelta(
  winner: 'attacker' | 'defender' | 'draw',
  side: 'attacker' | 'defender',
  outcome: BattleResult['outcomeType'],
  C: typeof BALANCE.combat,
): number {
  const M = C.moraleDelta;
  if (outcome === 'stalemate') return M.draw;
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
  } else {
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

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function describeOutcome(
  type: BattleResult['outcomeType'],
  atkName: string,
  defName: string,
): string {
  switch (type) {
    case 'attacker_decisive_victory': return `ATTACKER DECISIVE VICTORY — ${atkName} overwhelms ${defName}.`;
    case 'attacker_narrow_victory': return `ATTACKER NARROW VICTORY — ${atkName} edges out ${defName}.`;
    case 'attacker_pyrrhic_victory': return `ATTACKER PYRRHIC VICTORY — ${atkName} wins at terrible cost.`;
    case 'defender_decisive_victory': return `DEFENDER DECISIVE VICTORY — ${defName} crushes ${atkName}.`;
    case 'defender_narrow_victory': return `DEFENDER NARROW VICTORY — ${defName} repels ${atkName}.`;
    case 'defender_pyrrhic_victory': return `DEFENDER PYRRHIC VICTORY — ${defName} holds but is gutted.`;
    case 'stalemate': return `STALEMATE — neither side can break through.`;
  }
}
