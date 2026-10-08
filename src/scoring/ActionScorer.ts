import { AIConcretePlan, AttackPlan, BuildPlan, MovePlan, RetreatPlan, planTargetId, comparePlanIds, cloneConcretePlan } from '../types/AIConcretePlan';
import { generateConcretePlans, assessConcretePlanFeasibility } from '../engine/concretePlans';
import { BALANCE } from '../constants/balance';
import { PersonalitySystem } from '../personality/PersonalitySystem';
import {
  ActionContext,
  ActionType,
  Army,
  DiplomaticRelationship,
  FactionId,
  Resources,
  ScoredAction,
  ScoredConcretePlan,
  Territory,
  WarlordSnapshot,
} from '../types';
import { MemorySystem } from '../memory/MemorySystem';
import { GoalSystem } from '../goals/GoalSystem';
import { SeededRNG } from '../utils/SeededRNG';
import { computeMilitaryAdvantageRatio } from '../battle/CombatPower';

const {
  scoring: S,
  military: M,
  territory: T,
  diplomacy: D,
  economy: E,
  risk: R,
} = BALANCE;

export class ScoringHelpers {
  static computeArmyPower(army: Army): number {
    return (
      army.soldiers * M.soldierValue +
      army.knights * M.knightValue +
      army.siegeEngines * M.siegeValue
    );
  }

  static computeTotalMilitaryPower(myArmies: Army[], myTerritories: Territory[]): number {
    const mobile = myArmies.reduce((s, a) => s + ScoringHelpers.computeArmyPower(a), 0);
    const garrisons = myTerritories.reduce((s, t) => s + t.garrison * M.soldierValue, 0);
    return mobile + garrisons;
  }

  /**
   * NOTE (AI DECISION CORRECTNESS PASS): this helper is currently unused by
   * `ActionScorer` (no scoring path calls it) and has never been wired up
   * to an armies map, so — like the old `estimateMilitaryAdvantage` below —
   * it cannot see any defending field army, only `t.garrison`. It is also
   * missing an actual `garrisonOnly` branch (`troops` was `garrisonOnly ?
   * t.garrison : t.garrison`, i.e. always the garrison either way). Left
   * in place for API compatibility (it is re-exported via `ScoringHelpers`)
   * but documented rather than "fixed" blind, since no current caller and
   * no test exercises a specific intended behavior for it. Do not treat
   * this as a model for new local-defense calculations — see
   * `computeLocalHostilePower` and `estimateMilitaryAdvantage` for the
   * corrected pattern that actually consults field armies.
   */
  static computeTerritoryMilitaryDefense(t: Territory, garrisonOnly: boolean = false): number {
    const terrainBonus = 1 + (M.defenderTerrainBonus[t.terrain] || 0);
    const fortBonus = 1 + t.fortification * M.defenderFortificationBonus;
    const troops = garrisonOnly ? t.garrison : t.garrison;
    return troops * M.soldierValue * terrainBonus * fortBonus;
  }

  /**
   * AI DECISION CORRECTNESS PASS — bug fix: this used to hard-code
   * `defendingArmies = []` and ignore the `allArmies` parameter entirely
   * (it was even named `_allArmies` to silence the unused-parameter
   * warning). That meant `scoreAttack()` always evaluated an attack as if
   * the target territory had NO field army defending it — only its
   * `garrison` counted — so a heavily-defended target with a large enemy
   * army stationed on it could be scored as an easy attack.
   *
   * Fix: derive the defending armies from the existing `allArmies` state
   * (already passed in — this needed no new state) by taking every army
   * whose `location` is the target territory. This mirrors how
   * `BattleEngine`/`CombatPower.computeDefenderPower` already combine
   * garrison + stationed field armies; the AI now estimates advantage
   * against the same forces that would actually defend if a real battle
   * were resolved. See docs/AI_DECISION_CORRECTNESS.md.
   */
  static estimateMilitaryAdvantage(
    attackerArmies: Army[],
    defenderTerritory: Territory,
    allArmies: Map<string, Army>,
  ): { advantage: number; ratio: number; risk: number } {
    const defendingArmies: Army[] = Array.from(allArmies.values()).filter(
      (a) => a.location === defenderTerritory.id,
    );
    const { ratio, advantageScore, risk } = computeMilitaryAdvantageRatio(
      attackerArmies,
      defendingArmies,
      defenderTerritory.garrison,
      defenderTerritory,
    );
    return { advantage: advantageScore, ratio, risk };
  }

  /**
   * AI DECISION CORRECTNESS PASS — local threat helper.
   *
   * Returns a simple, explainable "how much military force is actually
   * sitting at/around this specific hostile territory" figure: garrison
   * power of that one territory plus the power of any field armies
   * currently located there. Deliberately does NOT use the owning
   * faction's empire-wide `totalMilitaryPower` — a faction can be huge
   * overall while having nothing stationed near a given border, and that
   * should not read as a local threat (see docs/AI_DECISION_CORRECTNESS.md,
   * "Local threat calculation").
   */
  static computeLocalHostilePower(hostileTerritory: Territory, allArmies: Map<string, Army>): number {
    const garrisonPower = hostileTerritory.garrison * M.soldierValue;
    let fieldArmyPower = 0;
    for (const army of allArmies.values()) {
      if (army.location === hostileTerritory.id) {
        fieldArmyPower += ScoringHelpers.computeArmyPower(army);
      }
    }
    return garrisonPower + fieldArmyPower;
  }

  /**
   * True when any owned territory faces local hostile force that outmatches
   * the troops actually standing there. Used to suppress offensive ambition
   * bonuses so high ambition cannot ignore an immediate survival threat.
   * Local only — empire-wide power is ignored. Capital status is not used.
   */
  static factionUnderImmediateThreat(ctx: ActionContext): boolean {
    for (const myTerr of ctx.myTerritories) {
      let hostilePower = 0;
      for (const nId of myTerr.neighboring) {
        const n = ctx.allTerritories.get(nId);
        if (!n?.owner || n.owner === ctx.self.id)
          continue;
        const rel = ctx.self.diplomacy.get(n.owner);
        const hostile = rel?.state === 'at_war' || rel?.state === 'hostile' || (rel?.opinion ?? 0) < -30;
        if (!hostile)
          continue;
        hostilePower += ScoringHelpers.computeLocalHostilePower(n, ctx.allArmies);
      }
      let mine = myTerr.garrison * M.soldierValue;
      for (const a of ctx.myArmies) {
        if (a.location === myTerr.id)
          mine += ScoringHelpers.computeArmyPower(a);
      }
      if (hostilePower > mine * 1.5)
        return true;
      if (myTerr && hostilePower > mine)
        return true;
    }
    return false;
  }

  /**
   * ENGINE EXECUTION CONSISTENCY PASS — shared "which of my armies are
   * physically positioned to act against this territory" helper.
   *
   * Used by BOTH `scoreAttack` (below) AND `src/simulation/cli.ts`'s
   * ATTACK execution, so the AI's decision and the harness's execution
   * can never silently disagree about which armies count as "locally
   * available" for a given target. No strength/eligibility filtering
   * here — that is action-specific (e.g. `scoreAttack` additionally
   * requires >100 soldiers+knights before treating an army as attack-worthy).
   */
  static armiesBorderingTerritory(
    myArmies: Army[],
    allTerritories: Map<string, Territory>,
    targetTerritoryId: string,
  ): Army[] {
    return myArmies.filter((a) => {
      const armyTerr = allTerritories.get(a.location);
      return armyTerr?.neighboring.includes(targetTerritoryId) ?? false;
    });
  }

  /**
   * ENGINE EXECUTION CONSISTENCY PASS — shared "local/usable military
   * strength against a neighboring target" helper, used by ATTACK scoring.
   * Distant armies that are not adjacent to the target do not count.
   *
   * = power of my armies stationed in a territory bordering the target
   * + garrison power of my own territories bordering the target.
   * Deliberately excludes anything not adjacent to the target. Phase 14
   * adjacent-hop movement does not make distant armies usable here;
   * scoring does not invent a second travel model.
   */
  static computeLocalUsableMilitaryPower(
    selfId: FactionId,
    myArmies: Army[],
    allTerritories: Map<string, Territory>,
    targetTerritoryId: string,
  ): number {
    const target = allTerritories.get(targetTerritoryId);
    if (!target) return 0;
    const localArmies = ScoringHelpers.armiesBorderingTerritory(myArmies, allTerritories, targetTerritoryId);
    const localArmyPower = localArmies.reduce((s, a) => s + ScoringHelpers.computeArmyPower(a), 0);
    const localBorderingOwned = target.neighboring
      .map((id) => allTerritories.get(id))
      .filter((t): t is Territory => !!t && t.owner === selfId);
    const localGarrisonPower = localBorderingOwned.reduce((s, t) => s + t.garrison * M.soldierValue, 0);
    return localArmyPower + localGarrisonPower;
  }

  static evaluateTerritoryValue(t: Territory): number {
    const resourceVal = Object.entries(t.resourceOutput).reduce((s, [k, v]) => {
      const weight = (E as any)[`${k}Weight`] ?? 0.5;
      return s + (v ?? 0) * weight * E.resourceScarcityMultiplier;
    }, 0);
    const popVal = (t.population / 1000) * T.populationValuePerThousand;
    const chokepointBonus = t.neighboring.length >= 4
      ? T.chokepointBonus
      : t.neighboring.length === 3
      ? T.chokepointBonus * 0.5
      : 0;
    return (
      t.baseValue * T.baseValueWeight +
      resourceVal * T.resourceValueWeight +
      popVal +
      chokepointBonus * T.strategicPositionWeight
    );
  }

  /**
   * NOTE (AI DECISION CORRECTNESS PASS): this helper is currently unused by
   * `ActionScorer.scoreDefend()` — that method has its own inline border
   * threat calculation, now driven by `computeLocalHostilePower` (see
   * below/docs/AI_DECISION_CORRECTNESS.md). `evaluateThreat` here also
   * mixes a per-border-territory term with `targetFaction.totalMilitaryPower
   * / self.totalMilitaryPower` (empire-wide power), which has the same
   * "distant army counted as local" issue called out for expansion scoring.
   * Left as-is (not called, so not currently causing bad decisions) but
   * documented rather than silently relied upon; do not wire this into new
   * scoring without addressing the empire-wide term first.
   */
  static evaluateThreat(
    targetFaction: WarlordSnapshot,
    self: WarlordSnapshot,
    myTerritories: Territory[],
    allTerritories: Map<string, Territory>,
  ): number {
    const enemyTerritories = targetFaction.territories
      .map((id) => allTerritories.get(id))
      .filter((t): t is Territory => !!t);
    let borderThreat = 0;
    for (const myT of myTerritories) {
      for (const nId of myT.neighboring) {
        const n = allTerritories.get(nId);
        if (n && n.owner === targetFaction.id) {
          borderThreat += ScoringHelpers.evaluateTerritoryValue(n) * 0.3;
        }
      }
    }
    const powerRatio = self.totalMilitaryPower === 0
      ? 10
      : targetFaction.totalMilitaryPower / self.totalMilitaryPower;
    const powerThreat = (powerRatio - 1) * 40;
    return borderThreat + Math.max(0, powerThreat);
  }

  static getRelationship(self: WarlordSnapshot, targetId: FactionId): DiplomaticRelationship | null {
    return self.diplomacy.get(targetId) ?? null;
  }

  static evaluateRelationshipModifier(rel: DiplomaticRelationship | null): number {
    if (!rel) return 0;
    const opinionScore = (rel.opinion / D.opinionRange) * 30;
    let stateScore = 0;
    switch (rel.state) {
      case 'allied': stateScore = 25; break;
      case 'friendly': stateScore = 10; break;
      case 'neutral': stateScore = 0; break;
      case 'tense': stateScore = -10; break;
      case 'hostile': stateScore = -25; break;
      case 'at_war': stateScore = -40; break;
    }
    const treatyScore = rel.treaties.reduce((s, t) => {
      if (t.type === 'alliance') return s + D.allianceValue / 3;
      if (t.type === 'non_aggression') return s + D.nonAggressionValue / 3;
      if (t.type === 'trade_agreement') return s + D.tradeAgreementValue / 3;
      return s;
    }, 0);
    return opinionScore + stateScore + treatyScore;
  }

  static evaluateResourceNeed(
    resources: Resources,
    income: Partial<Resources>,
  ): { scarcity: Record<string, number>; overallNeed: number } {
    const keys: (keyof Resources)[] = ['gold', 'food', 'iron', 'wood', 'stone'];
    const scarcity: Record<string, number> = {};
    let totalNeed = 0;
    for (const k of keys) {
      const current = resources[k];
      const inc = income[k] ?? 0;
      const monthsOfSupply = inc > 0 ? current / (inc * 10) : current > 0 ? 2 : 0;
      const sc = Math.max(0, Math.min(1, 1 - monthsOfSupply / 3));
      scarcity[k] = sc;
      const weight = (E as any)[`${k}Weight`] ?? 0.5;
      totalNeed += sc * weight;
    }
    return { scarcity, overallNeed: totalNeed / keys.length };
  }

  static computeAverageTerritoryValue(territories: Territory[]): number {
    if (territories.length === 0) return 0;
    return territories.reduce((s, t) => s + ScoringHelpers.evaluateTerritoryValue(t), 0) / territories.length;
  }
}

export interface ScorerInput {
  ctx: ActionContext;
  turn: number;
  rng: SeededRNG;
  memory: MemorySystem;
  goals: GoalSystem;
}

interface FactorEntry { factor: string; weight: number; contribution: number; }

export class ActionScorer {
  scoreAllActions(input: ScorerInput): ScoredConcretePlan[] {
    return this.scorePlans(generateConcretePlans(input.ctx.gameState, input.ctx.self.id), input);
  }

  scorePlans(plans: readonly AIConcretePlan[], input: ScorerInput): ScoredConcretePlan[] {
    const results = [...plans].sort((a, b) => comparePlanIds(a.id, b.id)).map(plan => this.scorePlan(plan, input));
    this.applyAmbitionModifiers(results, input);
    return results.sort((a, b) => b.score - a.score || comparePlanIds(a.plan!.id, b.plan!.id));
  }

  scorePlan(plan: AIConcretePlan, input: ScorerInput): ScoredConcretePlan {
    if (plan.factionId !== input.ctx.self.id || !assessConcretePlanFeasibility(plan, input.ctx.gameState).feasible)
      throw new Error(`Invalid concrete scoring input ${plan.id}`);
    let scored: ScoredAction;
    switch (plan.action) {
      case 'ATTACK': scored = this.scoreAttack(input, plan); break;
      case 'BUILD': scored = this.scoreBuild(input, plan); break;
      case 'MOVE': scored = this.scoreMove(input, plan)[0]!; break;
      case 'RETREAT': scored = this.scoreRetreat(input, plan)[0]!; break;
      case 'WAIT': scored = this.scoreWait(input)[0]!; break;
      default: throw new Error(`No operational candidate source for ${plan.action}`);
    }
    if (!scored) throw new Error(`Invalid concrete scoring input ${plan.id}`);
    return { ...scored, plan: cloneConcretePlan(plan), targetId: planTargetId(plan) };
  }

  /**
   * Ambition layers on top of existing goal alignment and personality.
   * At `BALANCE.ambition.defaultValue` (0.5) every extra is 0.
   * Under immediate local threat, the strategic-push bonus on ATTACK is skipped.
   */
  private applyAmbitionModifiers(results: ScoredAction[], input: ScorerInput): void {
    const ambition = input.ctx.self.ambition;
    const delta = ambition - BALANCE.ambition.defaultValue;
    const threatened = ScoringHelpers.factionUnderImmediateThreat(input.ctx);
    for (const scored of results) {
      const goalFactor = scored.factorBreakdown.find((f) => f.factor === 'Goal alignment');
      const goalContribution = goalFactor?.contribution ?? 0;
      const ambitionGoal = (goalContribution !== 0)
        ? goalContribution * delta * BALANCE.ambition.goalPersistenceScale
        : 0;
      const offensivePush = scored.action === 'ATTACK';
      const strategicPush = (!threatened && offensivePush)
        ? delta * BALANCE.ambition.strategicPushWeight
        : 0;
      const total = ambitionGoal + strategicPush;
      if (total === 0)
        continue;
      scored.score += total;
      if (ambitionGoal !== 0) {
        scored.factorBreakdown.push({ factor: 'Ambition (goal persistence)', weight: 1, contribution: ambitionGoal });
        if (Math.abs(ambitionGoal) > 0.5) {
          scored.reasoning.push(delta > 0
            ? 'high ambition persists toward goals'
            : 'low ambition deprioritizes long-term goals');
        }
      }
      if (strategicPush !== 0) {
        scored.factorBreakdown.push({ factor: 'Ambition (strategic push)', weight: 1, contribution: strategicPush });
      }
      scored.score = Math.max(S.minReasonableScore, Math.min(S.maxScore, scored.score));
    }
  }

  private baseScored(action: ActionType, input: ScorerInput): {
    base: number;
    factors: FactorEntry[];
    reasoning: string[];
  } {
    const personality = input.ctx.self.personality;
    const base = S.baseScores[action];
    const personalityBias = PersonalitySystem.getActionBias(action, personality);
    const randomness = (input.rng.next() - 0.5) * 2 * S.randomnessRange * S.maxFactorWeight;
    const factors: FactorEntry[] = [
      { factor: 'Base score', weight: 1, contribution: base },
      { factor: 'Personality bias', weight: 1, contribution: personalityBias },
      { factor: 'Random variation', weight: 1, contribution: randomness },
    ];
    const reasoning: string[] = [];
    if (Math.abs(personalityBias) > 5) {
      const traits = PersonalitySystem.describePersonality(personality).slice(0, 2);
      if (traits.length) reasoning.push(`${traits.join(', ')} personality`);
    }
    return { base: base + personalityBias + randomness, factors, reasoning };
  }

  private scoreAttack(input: ScorerInput, plan: AttackPlan): ScoredAction {
    const { ctx, turn, memory, goals } = input;
    const targetTerr = ctx.allTerritories.get(plan.targetTerritoryId)!;
    const targetFactionId = targetTerr.owner!;
    let { base, factors, reasoning } = this.baseScored('ATTACK', input);
    let score = base;
    const isStaging = plan.originTerritoryId !== plan.stagingTerritoryId;
    const attackingArmies = [ctx.allArmies.get(plan.armyId)!];
    const { advantage, ratio, risk } = ScoringHelpers.estimateMilitaryAdvantage(
      attackingArmies, targetTerr, ctx.allArmies,
    );
    score += Math.max(-S.maxFactorWeight, Math.min(S.maxFactorWeight, advantage * M.advantageMultiplier));
    factors.push({ factor: 'Military advantage', weight: M.advantageMultiplier, contribution: advantage * M.advantageMultiplier });
    if (ratio > M.criticalThreatRatio) reasoning.push('strong military advantage');
    else if (ratio > M.moderateThreatRatio) reasoning.push('moderate military advantage');
    else if (ratio < 1 / M.criticalThreatRatio) { reasoning.push('military disadvantage'); score -= 40; }
    const terrValue = ScoringHelpers.evaluateTerritoryValue(targetTerr);
    score += Math.min(S.maxFactorWeight, terrValue * 0.5);
    factors.push({ factor: 'Territory value', weight: T.baseValueWeight, contribution: terrValue * 0.5 });
    if (terrValue > 80) reasoning.push('high territory value');
    else if (terrValue > 50) reasoning.push('moderate territory value');
    const riskMod = PersonalitySystem.getRiskModifier(ctx.self.personality, risk);
    score += riskMod;
    factors.push({ factor: 'Risk assessment', weight: 1, contribution: riskMod });
    if (risk > R.highRisk && ctx.self.personality.riskTolerance < 0.4) reasoning.push('too risky');
    const rel = ScoringHelpers.getRelationship(ctx.self, targetFactionId);
    const relMod = ScoringHelpers.evaluateRelationshipModifier(rel);
    score += -relMod * 0.8;
    factors.push({ factor: 'Diplomatic relations', weight: 0.8, contribution: -relMod * 0.8 });
    if (rel?.state === 'at_war') reasoning.push('already at war');
    else if (rel?.state === 'allied') { score -= 60; reasoning.push('would break alliance'); }
    else if (rel?.state === 'friendly') { score -= 20; reasoning.push('would betray friendly power'); }
    const memSummary = memory.summarizeForFaction(targetFactionId, turn);
    const revengeMod = PersonalitySystem.getRevengeModifier(ctx.self.personality, memSummary.totalGrievances);
    score += revengeMod;
    factors.push({ factor: 'Historical grievances', weight: 1, contribution: revengeMod });
    if (memSummary.recentAttacks > 0) reasoning.push('recent attacks demand response');
    if (memSummary.totalGrievances > 20) reasoning.push('long-standing rivalry');
    const goalAlign = goals.evaluateActionAlignment({
      actionType: 'ATTACK', targetFaction: targetFactionId, targetTerritory: targetTerr.id,
      self: ctx.self, currentTurn: turn, allTerritories: ctx.allTerritories,
    });
    score += goalAlign.scoreContribution;
    factors.push({ factor: 'Goal alignment', weight: 1, contribution: goalAlign.scoreContribution });
    for (const g of goalAlign.alignedGoals) reasoning.push(`aligns with goal: ${g.type.replace(/_/g, ' ')}`);
    if (isStaging) {
      score -= S.stagingAttackPenalty;
      factors.push({ factor: 'Requires staging march', weight: 1, contribution: -S.stagingAttackPenalty });
      reasoning.push('requires marching to a staging territory first');
    }
    score = Math.max(S.minReasonableScore, Math.min(S.maxScore, score));
    return {
      action: 'ATTACK', targetId: targetTerr.id, targetName: targetTerr.id,
      score, baseScore: S.baseScores.ATTACK, factorBreakdown: factors, reasoning,
    };
  }

  private scoreBuild(input: ScorerInput, plan: BuildPlan): ScoredAction {
    const { ctx, turn, goals } = input;
    const myTerr = ctx.allTerritories.get(plan.territoryId)!;
    let { base, factors, reasoning } = this.baseScored('BUILD', input);
    let score = base;
    score += 5; // Feasible generator already checks exact current cost.
    if (plan.projectType === 'FORTIFICATION') {
      const fortScore = myTerr.fortification < 3 ? (3 - myTerr.fortification) * 10 : -10;
      score += fortScore;
      factors.push({ factor: 'Low fortification', weight: 1, contribution: fortScore });
    }
    reasoning.push(`construct ${plan.projectType.toLowerCase()}`);
    let enemyBorder = 0;
    for (const nId of myTerr.neighboring) {
      const n = ctx.allTerritories.get(nId);
      if (n?.owner && n.owner !== ctx.self.id) {
        const rel = ctx.self.diplomacy.get(n.owner);
        if (rel?.state === 'hostile' || rel?.state === 'at_war') enemyBorder += 2;
        else enemyBorder += 1;
      }
    }
    score += enemyBorder * 8;
    factors.push({ factor: 'Border exposure', weight: 1, contribution: enemyBorder * 8 });
    if (enemyBorder >= 2) reasoning.push('border with hostile powers');
    const terrValue = ScoringHelpers.evaluateTerritoryValue(myTerr);
    score += terrValue * 0.2;
    factors.push({ factor: 'Territory value', weight: 0.2, contribution: terrValue * 0.2 });
    const goalAlign = goals.evaluateActionAlignment({
      actionType: 'BUILD', targetTerritory: myTerr.id,
      self: ctx.self, currentTurn: turn, allTerritories: ctx.allTerritories,
    });
    score += goalAlign.scoreContribution;
    factors.push({ factor: 'Goal alignment', weight: 1, contribution: goalAlign.scoreContribution });
    score = Math.max(S.minReasonableScore, Math.min(S.maxScore, score));
    return {
      action: 'BUILD', targetId: myTerr.id, targetName: myTerr.id,
      score, baseScore: S.baseScores.BUILD, factorBreakdown: factors, reasoning,
    };
  }

  private scoreMove(input: ScorerInput, plan: MovePlan): ScoredAction[] {
    const { ctx } = input;
    const dest = ctx.allTerritories.get(plan.destinationTerritoryId)!;
    const { base, factors, reasoning } = this.baseScored('MOVE', input);
    let relocation = 0;
    if (dest.owner && dest.owner !== ctx.self.id && ctx.self.diplomacy.get(dest.owner)?.state === 'at_war') relocation += 20;
    if (dest.owner === ctx.self.id) {
      for (const id of dest.neighboring) {
        const neighbor = ctx.allTerritories.get(id);
        if (neighbor?.owner && neighbor.owner !== ctx.self.id) relocation += 5;
      }
      if (dest.garrison < 150) relocation += 15;
    }
    const alignment = input.goals.evaluateActionAlignment({ actionType: 'MOVE', targetTerritory: dest.id,
      self: ctx.self, currentTurn: input.turn, allTerritories: ctx.allTerritories });
    factors.push({ factor: 'Strategic relocation value', weight: 1, contribution: relocation },
      { factor: 'Goal alignment', weight: 1, contribution: alignment.scoreContribution });
    if (relocation > 30) reasoning.push('high-value repositioning');
    return [{ action: 'MOVE', targetId: dest.id, targetName: dest.id,
      score: Math.max(S.minReasonableScore, Math.min(S.maxScore, base + Math.min(S.maxFactorWeight, relocation) + alignment.scoreContribution)),
      baseScore: S.baseScores.MOVE, factorBreakdown: factors, reasoning }];
  }

  private scoreRetreat(input: ScorerInput, plan: RetreatPlan): ScoredAction[] {
    const { ctx, turn, goals } = input;
    let { base, factors, reasoning } = this.baseScored('RETREAT', input);
    let score = base;
    const army = ctx.allArmies.get(plan.armyId)!;
    const loc = ctx.allTerritories.get(plan.originTerritoryId)!;
    // Eligibility already guarantees non-owned origin and legal owned fallback.
    let enemyNearby = 0;
    for (const nId of loc.neighboring) {
      const neighbor = ctx.allTerritories.get(nId);
      if (neighbor?.owner && neighbor.owner !== ctx.self.id)
        enemyNearby += ctx.allFactions.get(neighbor.owner)?.totalMilitaryPower ?? 0;
    }
    const ratio = ScoringHelpers.computeArmyPower(army) / Math.max(1, enemyNearby);
    const danger = (0.3 - ratio) * 100;
    if (danger > 0) {
      score += danger;
      factors.push({ factor: 'Army endangered', weight: 1, contribution: danger });
      reasoning.push('reposition army off non-owned ground (strategic, not battle retreat)');
    } else { score -= 15; }
    const goalAlign = goals.evaluateActionAlignment({
      actionType: 'RETREAT', targetTerritory: plan.originTerritoryId,
      self: ctx.self, currentTurn: turn, allTerritories: ctx.allTerritories,
    });
    score += goalAlign.scoreContribution;
    factors.push({ factor: 'Goal alignment', weight: 1, contribution: goalAlign.scoreContribution });
    score = Math.max(S.minReasonableScore, Math.min(S.maxScore, score));
    return [{
      action: 'RETREAT',
      targetId: plan.originTerritoryId,
      targetName: plan.originTerritoryId,
      score, baseScore: S.baseScores.RETREAT, factorBreakdown: factors, reasoning,
    }];
  }

  private scoreWait(input: ScorerInput): ScoredAction[] {
    const { ctx, turn } = input;
    let { base, factors, reasoning } = this.baseScored('WAIT', input);
    let score = base;
    const recentActions = ctx.self.lastActions.filter((a) => a.turn >= turn - 2);
    const sameActions = recentActions.filter((a) => a.action === 'WAIT').length;
    if (sameActions >= 2) { score -= 20; factors.push({ factor: 'Consecutive waits', weight: 1, contribution: -20 }); }
    const { overallNeed } = ScoringHelpers.evaluateResourceNeed(ctx.self.resources, ctx.self.resourceIncome);
    if (overallNeed > 0.6) {
      score += overallNeed * 20;
      factors.push({ factor: 'Recovering resources', weight: 1, contribution: overallNeed * 20 });
      reasoning.push('conserving resources for recovery');
    }
    const lowArmy = ctx.myArmies.reduce((s, a) => s + a.soldiers + a.knights, 0) < 1000;
    if (lowArmy && ctx.self.resources.gold < 500) {
      score += 15;
      factors.push({ factor: 'Rebuilding strength', weight: 1, contribution: 15 });
      reasoning.push('building up forces before acting');
    }
    if (ctx.self.personality.patience > 0.7) {
      score += 5; factors.push({ factor: 'Patient temperament', weight: 1, contribution: 5 });
    }
    const goalAlign = input.goals.evaluateActionAlignment({
      actionType: 'WAIT',
      self: ctx.self, currentTurn: turn, allTerritories: ctx.allTerritories,
    });
    score += goalAlign.scoreContribution;
    factors.push({ factor: 'Goal alignment', weight: 1, contribution: goalAlign.scoreContribution });
    score = Math.max(S.minReasonableScore, Math.min(S.maxScore, score));
    return [{
      action: 'WAIT', targetId: null, targetName: null,
      score, baseScore: S.baseScores.WAIT, factorBreakdown: factors, reasoning,
    }];
  }
}
