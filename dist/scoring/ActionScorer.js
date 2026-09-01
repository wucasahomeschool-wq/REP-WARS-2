"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActionScorer = exports.ScoringHelpers = void 0;
const balance_1 = require("../constants/balance");
const PersonalitySystem_1 = require("../personality/PersonalitySystem");
const CombatPower_1 = require("../battle/CombatPower");
const { scoring: S, military: M, territory: T, diplomacy: D, economy: E, risk: R, } = balance_1.BALANCE;
class ScoringHelpers {
    static computeArmyPower(army) {
        return (army.soldiers * M.soldierValue +
            army.knights * M.knightValue +
            army.siegeEngines * M.siegeValue);
    }
    static computeTotalMilitaryPower(myArmies, myTerritories) {
        const mobile = myArmies.reduce((s, a) => s + ScoringHelpers.computeArmyPower(a), 0);
        const garrisons = myTerritories.reduce((s, t) => s + t.garrison * M.soldierValue, 0);
        return mobile + garrisons;
    }
    static computeTerritoryMilitaryDefense(t, garrisonOnly = false) {
        const terrainBonus = 1 + (M.defenderTerrainBonus[t.terrain] || 0);
        const fortBonus = 1 + t.fortification * M.defenderFortificationBonus;
        const troops = garrisonOnly ? t.garrison : t.garrison;
        const defendingArmies = [];
        void defendingArmies;
        return troops * M.soldierValue * terrainBonus * fortBonus;
    }
    static estimateMilitaryAdvantage(attackerArmies, defenderTerritory, _allArmies) {
        const defendingArmies = [];
        const { ratio, advantageScore, risk } = (0, CombatPower_1.computeMilitaryAdvantageRatio)(attackerArmies, defendingArmies, defenderTerritory.garrison, defenderTerritory);
        return { advantage: advantageScore, ratio, risk };
    }
    static evaluateTerritoryValue(t) {
        const resourceVal = Object.entries(t.resourceOutput).reduce((s, [k, v]) => {
            const weight = E[`${k}Weight`] ?? 0.5;
            return s + (v ?? 0) * weight * E.resourceScarcityMultiplier;
        }, 0);
        const popVal = (t.population / 1000) * T.populationValuePerThousand;
        const capitalBonus = t.isCapital ? T.capitalBonus : 0;
        const chokepointBonus = t.neighboring.length >= 4
            ? T.chokepointBonus
            : t.neighboring.length === 3
                ? T.chokepointBonus * 0.5
                : 0;
        return (t.baseValue * T.baseValueWeight +
            resourceVal * T.resourceValueWeight +
            popVal +
            capitalBonus +
            chokepointBonus * T.strategicPositionWeight);
    }
    static evaluateThreat(targetFaction, self, myTerritories, allTerritories) {
        const enemyTerritories = targetFaction.territories
            .map((id) => allTerritories.get(id))
            .filter((t) => !!t);
        let borderThreat = 0;
        for (const myT of myTerritories) {
            for (const nId of myT.neighboring) {
                const n = allTerritories.get(nId);
                if (n && n.owner === targetFaction.id) {
                    borderThreat += ScoringHelpers.evaluateTerritoryValue(n) * 0.3;
                    if (myT.isCapital)
                        borderThreat *= T.capitalThreatMultiplier;
                }
            }
        }
        const powerRatio = self.totalMilitaryPower === 0
            ? 10
            : targetFaction.totalMilitaryPower / self.totalMilitaryPower;
        const powerThreat = (powerRatio - 1) * 40;
        return borderThreat + Math.max(0, powerThreat);
    }
    static getRelationship(self, targetId) {
        return self.diplomacy.get(targetId) ?? null;
    }
    static evaluateRelationshipModifier(rel) {
        if (!rel)
            return 0;
        const opinionScore = (rel.opinion / D.opinionRange) * 30;
        let stateScore = 0;
        switch (rel.state) {
            case 'allied':
                stateScore = 25;
                break;
            case 'friendly':
                stateScore = 10;
                break;
            case 'neutral':
                stateScore = 0;
                break;
            case 'tense':
                stateScore = -10;
                break;
            case 'hostile':
                stateScore = -25;
                break;
            case 'at_war':
                stateScore = -40;
                break;
        }
        const treatyScore = rel.treaties.reduce((s, t) => {
            if (t.type === 'alliance')
                return s + D.allianceValue / 3;
            if (t.type === 'non_aggression')
                return s + D.nonAggressionValue / 3;
            if (t.type === 'trade_agreement')
                return s + D.tradeAgreementValue / 3;
            return s;
        }, 0);
        return opinionScore + stateScore + treatyScore;
    }
    static evaluateResourceNeed(resources, income) {
        const keys = ['gold', 'food', 'iron', 'wood', 'stone'];
        const scarcity = {};
        let totalNeed = 0;
        for (const k of keys) {
            const current = resources[k];
            const inc = income[k] ?? 0;
            const monthsOfSupply = inc > 0 ? current / (inc * 10) : current > 0 ? 2 : 0;
            const sc = Math.max(0, Math.min(1, 1 - monthsOfSupply / 3));
            scarcity[k] = sc;
            const weight = E[`${k}Weight`] ?? 0.5;
            totalNeed += sc * weight;
        }
        return { scarcity, overallNeed: totalNeed / keys.length };
    }
    static computeAverageTerritoryValue(territories) {
        if (territories.length === 0)
            return 0;
        return territories.reduce((s, t) => s + ScoringHelpers.evaluateTerritoryValue(t), 0) / territories.length;
    }
}
exports.ScoringHelpers = ScoringHelpers;
class ActionScorer {
    scoreAllActions(input) {
        const results = [];
        const actions = [
            'ATTACK', 'DEFEND', 'REINFORCE', 'EXPAND', 'SCOUT',
            'BUILD', 'MOVE', 'NEGOTIATE', 'OFFER_PEACE', 'DECLARE_WAR',
            'TRADE', 'RETREAT', 'WAIT',
        ];
        for (const action of actions) {
            const scored = this.scoreAction(action, input);
            results.push(...scored);
        }
        return results.sort((a, b) => b.score - a.score);
    }
    scoreAction(action, input) {
        switch (action) {
            case 'ATTACK': return this.scoreAttack(input);
            case 'DEFEND': return this.scoreDefend(input);
            case 'REINFORCE': return this.scoreReinforce(input);
            case 'EXPAND': return this.scoreExpand(input);
            case 'SCOUT': return this.scoreScout(input);
            case 'BUILD': return this.scoreBuild(input);
            case 'MOVE': return this.scoreMove(input);
            case 'NEGOTIATE': return this.scoreNegotiate(input);
            case 'OFFER_PEACE': return this.scoreOfferPeace(input);
            case 'DECLARE_WAR': return this.scoreDeclareWar(input);
            case 'TRADE': return this.scoreTrade(input);
            case 'RETREAT': return this.scoreRetreat(input);
            case 'WAIT': return this.scoreWait(input);
        }
    }
    baseScored(action, input) {
        const personality = input.ctx.self.personality;
        const base = S.baseScores[action];
        const personalityBias = PersonalitySystem_1.PersonalitySystem.getActionBias(action, personality);
        const randomness = (input.rng.next() - 0.5) * 2 * S.randomnessRange * S.maxFactorWeight;
        const factors = [
            { factor: 'Base score', weight: 1, contribution: base },
            { factor: 'Personality bias', weight: 1, contribution: personalityBias },
            { factor: 'Random variation', weight: 1, contribution: randomness },
        ];
        const reasoning = [];
        if (Math.abs(personalityBias) > 5) {
            const traits = PersonalitySystem_1.PersonalitySystem.describePersonality(personality).slice(0, 2);
            if (traits.length)
                reasoning.push(`${traits.join(', ')} personality`);
        }
        return { base: base + personalityBias + randomness, factors, reasoning };
    }
    scoreAttack(input) {
        const { ctx, turn, rng, memory, goals } = input;
        const results = [];
        const myAvailableArmies = ctx.myArmies.filter((a) => a.soldiers + a.knights > 100);
        for (const targetTerr of ctx.enemyNeighbors) {
            const targetFactionId = targetTerr.owner;
            if (!targetFactionId)
                continue;
            let { base, factors, reasoning } = this.baseScored('ATTACK', input);
            let score = base;
            const targetOwner = ctx.allFactions.get(targetFactionId);
            if (!targetOwner)
                continue;
            const attackingArmies = myAvailableArmies.filter((a) => {
                const armyTerr = ctx.allTerritories.get(a.location);
                return armyTerr?.neighboring.includes(targetTerr.id);
            });
            if (attackingArmies.length === 0)
                continue;
            const { advantage, ratio, risk } = ScoringHelpers.estimateMilitaryAdvantage(attackingArmies, targetTerr, ctx.allArmies);
            score += Math.max(-S.maxFactorWeight, Math.min(S.maxFactorWeight, advantage * M.advantageMultiplier));
            factors.push({ factor: 'Military advantage', weight: M.advantageMultiplier, contribution: advantage * M.advantageMultiplier });
            if (ratio > M.criticalThreatRatio)
                reasoning.push('strong military advantage');
            else if (ratio > M.moderateThreatRatio)
                reasoning.push('moderate military advantage');
            else if (ratio < 1 / M.criticalThreatRatio) {
                reasoning.push('military disadvantage');
                score -= 40;
            }
            const terrValue = ScoringHelpers.evaluateTerritoryValue(targetTerr);
            score += Math.min(S.maxFactorWeight, terrValue * 0.5);
            factors.push({ factor: 'Territory value', weight: T.baseValueWeight, contribution: terrValue * 0.5 });
            if (terrValue > 80)
                reasoning.push('high territory value');
            else if (terrValue > 50)
                reasoning.push('moderate territory value');
            const riskMod = PersonalitySystem_1.PersonalitySystem.getRiskModifier(ctx.self.personality, risk);
            score += riskMod;
            factors.push({ factor: 'Risk assessment', weight: 1, contribution: riskMod });
            if (risk > R.highRisk && ctx.self.personality.riskTolerance < 0.4)
                reasoning.push('too risky');
            const rel = ScoringHelpers.getRelationship(ctx.self, targetFactionId);
            const relMod = ScoringHelpers.evaluateRelationshipModifier(rel);
            score += -relMod * 0.8;
            factors.push({ factor: 'Diplomatic relations', weight: 0.8, contribution: -relMod * 0.8 });
            if (rel?.state === 'at_war')
                reasoning.push('already at war');
            else if (rel?.state === 'allied') {
                score -= 60;
                reasoning.push('would break alliance');
            }
            else if (rel?.state === 'friendly') {
                score -= 20;
                reasoning.push('would betray friendly power');
            }
            const memSummary = memory.summarizeForFaction(targetFactionId, turn);
            const revengeMod = PersonalitySystem_1.PersonalitySystem.getRevengeModifier(ctx.self.personality, memSummary.totalGrievances);
            score += revengeMod;
            factors.push({ factor: 'Historical grievances', weight: 1, contribution: revengeMod });
            if (memSummary.recentAttacks > 0)
                reasoning.push('recent attacks demand response');
            if (memSummary.totalGrievances > 20)
                reasoning.push('long-standing rivalry');
            const goalAlign = goals.evaluateActionAlignment({
                actionType: 'ATTACK', targetFaction: targetFactionId, targetTerritory: targetTerr.id,
                self: ctx.self, currentTurn: turn, allTerritories: ctx.allTerritories,
            });
            score += goalAlign.scoreContribution;
            factors.push({ factor: 'Goal alignment', weight: 1, contribution: goalAlign.scoreContribution });
            for (const g of goalAlign.alignedGoals)
                reasoning.push(`aligns with goal: ${g.type.replace(/_/g, ' ')}`);
            const myNeighbor = targetTerr.neighboring.find((nId) => ctx.self.territories.includes(nId));
            if (myNeighbor) {
                const neighborTerr = ctx.allTerritories.get(myNeighbor);
                if (neighborTerr?.isCapital) {
                    score += T.capitalBonus * 0.3;
                    factors.push({ factor: 'Near capital', weight: 0.3, contribution: T.capitalBonus * 0.3 });
                    reasoning.push('target borders capital');
                }
            }
            score = Math.max(S.minReasonableScore, Math.min(S.maxScore, score));
            results.push({
                action: 'ATTACK', targetId: targetTerr.id, targetName: targetTerr.name,
                score, baseScore: S.baseScores.ATTACK, factorBreakdown: factors, reasoning,
            });
        }
        return results.sort((a, b) => b.score - a.score).slice(0, 3);
    }
    scoreDefend(input) {
        const { ctx, turn, goals } = input;
        const results = [];
        for (const myTerr of ctx.myTerritories) {
            let { base, factors, reasoning } = this.baseScored('DEFEND', input);
            let score = base;
            let borderThreat = 0;
            for (const nId of myTerr.neighboring) {
                const n = ctx.allTerritories.get(nId);
                if (n && n.owner && n.owner !== ctx.self.id) {
                    const owner = ctx.allFactions.get(n.owner);
                    if (owner) {
                        const rel = ctx.self.diplomacy.get(n.owner);
                        const hostile = rel?.state === 'at_war' || rel?.state === 'hostile' || (rel?.opinion ?? 0) < -30;
                        if (hostile)
                            borderThreat += 15;
                    }
                }
            }
            score += Math.min(S.maxFactorWeight, borderThreat);
            factors.push({ factor: 'Border threat', weight: 1, contribution: borderThreat });
            if (borderThreat > 30)
                reasoning.push('high border threat');
            else if (borderThreat > 10)
                reasoning.push('border tensions detected');
            if (myTerr.isCapital) {
                score += T.capitalBonus * 0.5;
                factors.push({ factor: 'Capital defense', weight: 0.5, contribution: T.capitalBonus * 0.5 });
                reasoning.push('protecting capital');
            }
            const terrValue = ScoringHelpers.evaluateTerritoryValue(myTerr);
            score += terrValue * 0.3;
            factors.push({ factor: 'Territory value', weight: 0.3, contribution: terrValue * 0.3 });
            if (terrValue > 100)
                reasoning.push('valuable territory');
            const underdefended = myTerr.garrison < 200 && borderThreat > 10;
            if (underdefended) {
                score += 20;
                factors.push({ factor: 'Underdefended', weight: 1, contribution: 20 });
                reasoning.push('garrison too small for threats');
            }
            const goalAlign = goals.evaluateActionAlignment({
                actionType: 'DEFEND', targetTerritory: myTerr.id,
                self: ctx.self, currentTurn: turn, allTerritories: ctx.allTerritories,
            });
            score += goalAlign.scoreContribution;
            factors.push({ factor: 'Goal alignment', weight: 1, contribution: goalAlign.scoreContribution });
            for (const g of goalAlign.alignedGoals)
                reasoning.push(`aligns with goal: ${g.type.replace(/_/g, ' ')}`);
            if (borderThreat === 0)
                score -= 20;
            score = Math.max(S.minReasonableScore, Math.min(S.maxScore, score));
            results.push({
                action: 'DEFEND', targetId: myTerr.id, targetName: myTerr.name,
                score, baseScore: S.baseScores.DEFEND, factorBreakdown: factors, reasoning,
            });
        }
        return results.sort((a, b) => b.score - a.score).slice(0, 2);
    }
    scoreReinforce(input) {
        const { ctx, turn, goals } = input;
        const results = [];
        const { scarcity, overallNeed } = ScoringHelpers.evaluateResourceNeed(ctx.self.resources, ctx.self.resourceIncome);
        for (const myTerr of ctx.myTerritories) {
            let { base, factors, reasoning } = this.baseScored('REINFORCE', input);
            let score = base;
            const goldOK = ctx.self.resources.gold > 500;
            const foodOK = ctx.self.resources.food > 300;
            const canAfford = goldOK && foodOK;
            if (!canAfford) {
                score -= 30;
                factors.push({ factor: 'Resource constraints', weight: 1, contribution: -30 });
                reasoning.push('insufficient resources');
            }
            else {
                score += 5;
                factors.push({ factor: 'Resources available', weight: 1, contribution: 5 });
            }
            const wantReinforce = myTerr.garrison < 300;
            if (wantReinforce) {
                score += 25;
                factors.push({ factor: 'Garrison weak', weight: 1, contribution: 25 });
                reasoning.push('garrison needs reinforcement');
            }
            if (myTerr.isCapital && myTerr.garrison < 500) {
                score += T.capitalBonus * 0.4;
                factors.push({ factor: 'Capital garrison', weight: 0.4, contribution: T.capitalBonus * 0.4 });
                reasoning.push('capital garrison understrength');
            }
            const goalAlign = goals.evaluateActionAlignment({
                actionType: 'REINFORCE', targetTerritory: myTerr.id,
                self: ctx.self, currentTurn: turn, allTerritories: ctx.allTerritories,
            });
            score += goalAlign.scoreContribution;
            factors.push({ factor: 'Goal alignment', weight: 1, contribution: goalAlign.scoreContribution });
            void scarcity;
            void overallNeed;
            score = Math.max(S.minReasonableScore, Math.min(S.maxScore, score));
            results.push({
                action: 'REINFORCE', targetId: myTerr.id, targetName: myTerr.name,
                score, baseScore: S.baseScores.REINFORCE, factorBreakdown: factors, reasoning,
            });
        }
        return results.sort((a, b) => b.score - a.score).slice(0, 2);
    }
    scoreExpand(input) {
        const { ctx, turn, goals } = input;
        const results = [];
        for (const targetTerr of ctx.unownedNeighbors) {
            let { base, factors, reasoning } = this.baseScored('EXPAND', input);
            let score = base;
            const myPower = ctx.self.totalMilitaryPower;
            const localOpposition = targetTerr.garrison * M.soldierValue;
            const advantage = localOpposition === 0 ? 100 : Math.log2(myPower / localOpposition) * 25;
            score += Math.min(S.maxFactorWeight, advantage);
            factors.push({ factor: 'Expansion advantage', weight: 1, contribution: advantage });
            if (localOpposition === 0)
                reasoning.push('unclaimed territory, no opposition');
            else if (myPower > localOpposition * 5)
                reasoning.push('weak opposition');
            const terrValue = ScoringHelpers.evaluateTerritoryValue(targetTerr);
            score += terrValue * 0.7;
            factors.push({ factor: 'Territory value', weight: T.baseValueWeight, contribution: terrValue * 0.7 });
            if (terrValue > 70)
                reasoning.push('rich unclaimed land');
            const resourceOutput = Object.values(targetTerr.resourceOutput).reduce((s, v) => s + (v ?? 0), 0);
            if (resourceOutput > 10) {
                const { overallNeed } = ScoringHelpers.evaluateResourceNeed(ctx.self.resources, ctx.self.resourceIncome);
                score += overallNeed * 30;
                factors.push({ factor: 'Resource need match', weight: 1, contribution: overallNeed * 30 });
                if (overallNeed > 0.5)
                    reasoning.push('addresses resource shortages');
            }
            const neighborsClaimed = targetTerr.neighboring.filter((nId) => {
                const t = ctx.allTerritories.get(nId);
                return t?.owner && t.owner !== ctx.self.id;
            }).length;
            if (neighborsClaimed > 0) {
                score -= neighborsClaimed * 10;
                factors.push({ factor: 'Competing claims', weight: 1, contribution: -neighborsClaimed * 10 });
                reasoning.push('rival powers also nearby');
            }
            const goalAlign = goals.evaluateActionAlignment({
                actionType: 'EXPAND', targetTerritory: targetTerr.id,
                self: ctx.self, currentTurn: turn, allTerritories: ctx.allTerritories,
            });
            score += goalAlign.scoreContribution;
            factors.push({ factor: 'Goal alignment', weight: 1, contribution: goalAlign.scoreContribution });
            for (const g of goalAlign.alignedGoals)
                reasoning.push(`aligns with goal: ${g.type.replace(/_/g, ' ')}`);
            score = Math.max(S.minReasonableScore, Math.min(S.maxScore, score));
            results.push({
                action: 'EXPAND', targetId: targetTerr.id, targetName: targetTerr.name,
                score, baseScore: S.baseScores.EXPAND, factorBreakdown: factors, reasoning,
            });
        }
        return results.sort((a, b) => b.score - a.score).slice(0, 3);
    }
    scoreScout(input) {
        const { ctx, turn, goals } = input;
        let { base, factors, reasoning } = this.baseScored('SCOUT', input);
        let score = base;
        const candidates = [];
        for (const myT of ctx.myTerritories) {
            for (const nId of myT.neighboring) {
                const t = ctx.allTerritories.get(nId);
                if (t && !ctx.self.knownTerritories.includes(t.id))
                    if (!candidates.find((c) => c.id === t.id))
                        candidates.push(t);
            }
            for (const nId of myT.neighboring) {
                const t = ctx.allTerritories.get(nId);
                if (t && t.scoutedTurnsAgo !== null && t.scoutedTurnsAgo > 5) {
                    if (!candidates.find((c) => c.id === t.id))
                        candidates.push(t);
                }
            }
        }
        if (candidates.length === 0) {
            score -= 20;
            factors.push({ factor: 'No targets', weight: 1, contribution: -20 });
            reasoning.push('all neighbors already known');
            return [{
                    action: 'SCOUT', targetId: null, targetName: null, score,
                    baseScore: S.baseScores.SCOUT, factorBreakdown: factors, reasoning,
                }];
        }
        const results = [];
        for (const t of candidates.slice(0, 3)) {
            let s = score;
            const f = [...factors];
            const r = [...reasoning];
            const unknown = !ctx.self.knownTerritories.includes(t.id);
            s += unknown ? 15 : 5;
            f.push({ factor: unknown ? 'Unknown territory' : 'Stale intel', weight: 1, contribution: unknown ? 15 : 5 });
            const strategic = t.isCapital || t.neighboring.length >= 4;
            if (strategic) {
                s += 10;
                f.push({ factor: 'Strategic location', weight: 1, contribution: 10 });
            }
            const goalAlign = goals.evaluateActionAlignment({
                actionType: 'SCOUT', targetTerritory: t.id,
                self: ctx.self, currentTurn: turn, allTerritories: ctx.allTerritories,
            });
            s += goalAlign.scoreContribution;
            f.push({ factor: 'Goal alignment', weight: 1, contribution: goalAlign.scoreContribution });
            s = Math.max(S.minReasonableScore, Math.min(S.maxScore, s));
            results.push({
                action: 'SCOUT', targetId: t.id, targetName: t.name,
                score: s, baseScore: S.baseScores.SCOUT, factorBreakdown: f, reasoning: r,
            });
        }
        return results.sort((a, b) => b.score - a.score);
    }
    scoreBuild(input) {
        const { ctx, turn, goals } = input;
        const results = [];
        const res = ctx.self.resources;
        const canAffordFortify = res.stone >= 50 && res.gold >= 100;
        for (const myTerr of ctx.myTerritories) {
            let { base, factors, reasoning } = this.baseScored('BUILD', input);
            let score = base;
            if (!canAffordFortify) {
                score -= 25;
                factors.push({ factor: 'Insufficient resources', weight: 1, contribution: -25 });
                reasoning.push('lacking stone/gold');
            }
            else {
                score += 5;
            }
            if (myTerr.fortification < 3) {
                score += (3 - myTerr.fortification) * 10;
                factors.push({ factor: 'Low fortification', weight: 1, contribution: (3 - myTerr.fortification) * 10 });
                reasoning.push('fortification levels low');
            }
            else {
                score -= 10;
            }
            let enemyBorder = 0;
            for (const nId of myTerr.neighboring) {
                const n = ctx.allTerritories.get(nId);
                if (n?.owner && n.owner !== ctx.self.id) {
                    const rel = ctx.self.diplomacy.get(n.owner);
                    if (rel?.state === 'hostile' || rel?.state === 'at_war')
                        enemyBorder += 2;
                    else
                        enemyBorder += 1;
                }
            }
            score += enemyBorder * 8;
            factors.push({ factor: 'Border exposure', weight: 1, contribution: enemyBorder * 8 });
            if (enemyBorder >= 2)
                reasoning.push('border with hostile powers');
            if (myTerr.isCapital) {
                score += 20;
                factors.push({ factor: 'Capital', weight: 1, contribution: 20 });
                reasoning.push('capital should be fortified');
            }
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
            results.push({
                action: 'BUILD', targetId: myTerr.id, targetName: myTerr.name,
                score, baseScore: S.baseScores.BUILD, factorBreakdown: factors, reasoning,
            });
        }
        return results.sort((a, b) => b.score - a.score).slice(0, 2);
    }
    scoreMove(input) {
        const { ctx, rng } = input;
        void rng;
        let { base, factors, reasoning } = this.baseScored('MOVE', input);
        let score = base;
        let bestTarget = null;
        let bestMoveScore = -Infinity;
        for (const army of ctx.myArmies) {
            const currentLoc = ctx.allTerritories.get(army.location);
            if (!currentLoc)
                continue;
            for (const nId of currentLoc.neighboring) {
                const dest = ctx.allTerritories.get(nId);
                if (!dest)
                    continue;
                if (!ctx.self.territories.includes(dest.id) &&
                    !dest.neighboring.some((nn) => ctx.self.territories.includes(nn)))
                    continue;
                let ms = 0;
                if (dest.owner && dest.owner !== ctx.self.id) {
                    const rel = ctx.self.diplomacy.get(dest.owner);
                    if (rel?.state === 'at_war')
                        ms += 20;
                }
                if (dest.owner === ctx.self.id) {
                    let borderThreat = 0;
                    for (const nnId of dest.neighboring) {
                        const nn = ctx.allTerritories.get(nnId);
                        if (nn?.owner && nn.owner !== ctx.self.id)
                            borderThreat += 5;
                    }
                    ms += borderThreat;
                    if (dest.garrison < 150)
                        ms += 15;
                }
                if (dest.isCapital && !ctx.self.territories.includes(dest.id))
                    ms += 30;
                if (ms > bestMoveScore) {
                    bestMoveScore = ms;
                    bestTarget = dest;
                }
            }
        }
        if (bestTarget) {
            score += Math.min(S.maxFactorWeight, bestMoveScore);
            factors.push({ factor: 'Strategic relocation value', weight: 1, contribution: bestMoveScore });
            if (bestMoveScore > 30)
                reasoning.push('high-value repositioning');
        }
        else {
            score -= 15;
        }
        score = Math.max(S.minReasonableScore, Math.min(S.maxScore, score));
        return [{
                action: 'MOVE', targetId: bestTarget?.id ?? null, targetName: bestTarget?.name ?? null,
                score, baseScore: S.baseScores.MOVE, factorBreakdown: factors, reasoning,
            }];
    }
    scoreNegotiate(input) {
        const { ctx, turn, memory, goals } = input;
        const results = [];
        const diplomacies = Array.from(ctx.self.diplomacy.entries())
            .filter(([id]) => id !== ctx.self.id)
            .filter(([id]) => ctx.self.knownFactions.includes(id));
        for (const [targetId, rel] of diplomacies) {
            let { base, factors, reasoning } = this.baseScored('NEGOTIATE', input);
            let score = base;
            if (rel.state === 'allied')
                score -= 10;
            else if (rel.state === 'at_war') {
                score += 5;
                reasoning.push('end war through diplomacy');
            }
            else if (rel.state === 'hostile') {
                score += 15;
                reasoning.push('de-escalate tensions');
            }
            else if (rel.state === 'tense') {
                score += 10;
                reasoning.push('improve strained relations');
            }
            else if (rel.state === 'neutral') {
                score += 10;
                reasoning.push('establish dialogue');
            }
            const trust = memory.summarizeForFaction(targetId, turn).trustLevel;
            const trustMod = PersonalitySystem_1.PersonalitySystem.getDiplomaticTrustModifier(ctx.self.personality, trust);
            score += trustMod;
            factors.push({ factor: 'Past trust', weight: 1, contribution: trustMod });
            const target = ctx.allFactions.get(targetId);
            if (target) {
                const powerBalance = ctx.self.totalMilitaryPower / Math.max(1, target.totalMilitaryPower);
                if (powerBalance < 0.8) {
                    score += 15;
                    reasoning.push('weaker than target, seek diplomatic solution');
                }
                if (powerBalance > 1.2 && ctx.self.personality.diplomacy < 0.4)
                    score -= 10;
            }
            const goalAlign = goals.evaluateActionAlignment({
                actionType: 'NEGOTIATE', targetFaction: targetId,
                self: ctx.self, currentTurn: turn, allTerritories: ctx.allTerritories,
            });
            score += goalAlign.scoreContribution;
            factors.push({ factor: 'Goal alignment', weight: 1, contribution: goalAlign.scoreContribution });
            score = Math.max(S.minReasonableScore, Math.min(S.maxScore, score));
            results.push({
                action: 'NEGOTIATE', targetId, targetName: target?.name ?? targetId,
                score, baseScore: S.baseScores.NEGOTIATE, factorBreakdown: factors, reasoning,
            });
        }
        return results.sort((a, b) => b.score - a.score).slice(0, 3);
    }
    scoreOfferPeace(input) {
        const { ctx, turn, memory } = input;
        const results = [];
        const atWarRelations = Array.from(ctx.self.diplomacy.entries())
            .filter(([id]) => id !== ctx.self.id)
            .filter(([, rel]) => rel.state === 'at_war');
        if (atWarRelations.length === 0) {
            const { base, factors, reasoning } = this.baseScored('OFFER_PEACE', input);
            return [{
                    action: 'OFFER_PEACE', targetId: null, targetName: null,
                    score: base - 50, baseScore: S.baseScores.OFFER_PEACE,
                    factorBreakdown: [...factors, { factor: 'No active wars', weight: 1, contribution: -50 }],
                    reasoning: [...reasoning, 'not currently at war'],
                }];
        }
        for (const [targetId, rel] of atWarRelations) {
            let { base, factors, reasoning } = this.baseScored('OFFER_PEACE', input);
            let score = base;
            const target = ctx.allFactions.get(targetId);
            if (!target)
                continue;
            const myPower = ctx.self.totalMilitaryPower;
            const theirPower = target.totalMilitaryPower;
            const ratio = myPower / Math.max(1, theirPower);
            let warFactor = 0;
            if (ratio < 0.6) {
                warFactor = 30;
                reasoning.push('losing war, seek peace');
            }
            else if (ratio < 0.9) {
                warFactor = 15;
                reasoning.push('stalemate, peace beneficial');
            }
            else if (ratio > 1.3) {
                warFactor = -20;
                reasoning.push('winning, why offer peace?');
            }
            factors.push({ factor: 'War balance', weight: 1, contribution: warFactor });
            score += warFactor;
            const costOfWar = rel.yearsAtWar * 5;
            score += costOfWar;
            factors.push({ factor: 'War exhaustion', weight: 1, contribution: costOfWar });
            if (rel.yearsAtWar > 5)
                reasoning.push('war-weary');
            const mem = memory.summarizeForFaction(targetId, turn);
            if (mem.territoriesLost > mem.territoriesGained) {
                score += 10;
                reasoning.push('lost territory in this war');
            }
            if (rel.treaties.some((t) => t.type === 'alliance')) {
                score += 15;
                reasoning.push('former allies, possible reconciliation');
            }
            score = Math.max(S.minReasonableScore, Math.min(S.maxScore, score));
            results.push({
                action: 'OFFER_PEACE', targetId, targetName: target.name,
                score, baseScore: S.baseScores.OFFER_PEACE, factorBreakdown: factors, reasoning,
            });
        }
        return results.sort((a, b) => b.score - a.score);
    }
    scoreDeclareWar(input) {
        const { ctx, turn, memory, goals } = input;
        const results = [];
        const knownHostiles = ctx.self.knownFactions.filter((id) => id !== ctx.self.id);
        for (const targetId of knownHostiles) {
            const target = ctx.allFactions.get(targetId);
            if (!target)
                continue;
            const rel = ScoringHelpers.getRelationship(ctx.self, targetId);
            if (rel?.state === 'at_war')
                continue;
            let { base, factors, reasoning } = this.baseScored('DECLARE_WAR', input);
            let score = base;
            const powerRatio = ctx.self.totalMilitaryPower / Math.max(1, target.totalMilitaryPower);
            const powerScore = Math.log2(powerRatio) * 35;
            score += Math.max(-S.maxFactorWeight, Math.min(S.maxFactorWeight, powerScore));
            factors.push({ factor: 'Military power balance', weight: 1, contribution: powerScore });
            if (powerRatio > 1.5)
                reasoning.push('significant military superiority');
            else if (powerRatio < 0.8) {
                score -= 25;
                reasoning.push('outmatched militarily');
            }
            const relMod = ScoringHelpers.evaluateRelationshipModifier(rel);
            score += -relMod * 0.9;
            factors.push({ factor: 'Diplomatic state', weight: 0.9, contribution: -relMod * 0.9 });
            if (rel?.state === 'hostile')
                reasoning.push('relations already hostile');
            if (rel?.state === 'allied') {
                score -= 80;
                reasoning.push('would betray alliance');
            }
            if (rel?.state === 'friendly') {
                score -= 30;
                reasoning.push('would betray friendship');
            }
            const hasBorder = ctx.myTerritories.some((t) => t.neighboring.some((nId) => {
                const n = ctx.allTerritories.get(nId);
                return n?.owner === targetId;
            }));
            if (!hasBorder) {
                score -= 30;
                factors.push({ factor: 'No shared border', weight: 1, contribution: -30 });
            }
            else {
                reasoning.push('shared border makes war feasible');
            }
            const mem = memory.summarizeForFaction(targetId, turn);
            let grievanceScore = 0;
            if (mem.totalGrievances > 25) {
                score += 20;
                reasoning.push('history of grievances demands war');
                grievanceScore += 20;
            }
            if (mem.recentAttacks > 0) {
                score += 15;
                reasoning.push('recent attacks justify declaration');
                grievanceScore += 15;
            }
            factors.push({ factor: 'Grievances', weight: 1, contribution: Math.min(20, mem.totalGrievances * 0.5) });
            const numEnemies = Array.from(ctx.self.diplomacy.values()).filter((r) => r.state === 'at_war').length;
            if (numEnemies >= 1 && ctx.self.personality.defensiveness > 0.6) {
                score -= 20 * numEnemies;
                factors.push({ factor: 'Multiple fronts risk', weight: 1, contribution: -20 * numEnemies });
                reasoning.push('already committed elsewhere');
            }
            const goalAlign = goals.evaluateActionAlignment({
                actionType: 'DECLARE_WAR', targetFaction: targetId,
                self: ctx.self, currentTurn: turn, allTerritories: ctx.allTerritories,
            });
            score += goalAlign.scoreContribution;
            factors.push({ factor: 'Goal alignment', weight: 1, contribution: goalAlign.scoreContribution });
            void grievanceScore;
            score = Math.max(S.minReasonableScore, Math.min(S.maxScore, score));
            results.push({
                action: 'DECLARE_WAR', targetId, targetName: target.name,
                score, baseScore: S.baseScores.DECLARE_WAR, factorBreakdown: factors, reasoning,
            });
        }
        return results.sort((a, b) => b.score - a.score).slice(0, 3);
    }
    scoreTrade(input) {
        const { ctx, turn, memory, goals } = input;
        const results = [];
        const { scarcity } = ScoringHelpers.evaluateResourceNeed(ctx.self.resources, ctx.self.resourceIncome);
        const mySurplus = {};
        for (const k of Object.keys(ctx.self.resources)) {
            const inc = ctx.self.resourceIncome[k] ?? 0;
            const supply = inc > 0 ? ctx.self.resources[k] / (inc * 12) : 2;
            if (supply > 2)
                mySurplus[k] = Math.min(1, (supply - 2) / 3);
        }
        const tradePartners = ctx.self.knownFactions.filter((id) => {
            if (id === ctx.self.id)
                return false;
            const rel = ctx.self.diplomacy.get(id);
            return rel?.state !== 'at_war' && rel?.state !== 'hostile';
        });
        for (const targetId of tradePartners) {
            const target = ctx.allFactions.get(targetId);
            if (!target)
                continue;
            let { base, factors, reasoning } = this.baseScored('TRADE', input);
            let score = base;
            const { scarcity: theirScarcity } = ScoringHelpers.evaluateResourceNeed(target.resources, target.resourceIncome);
            let matchScore = 0;
            let hasMatch = false;
            const keys = ['gold', 'food', 'iron', 'wood', 'stone'];
            for (const k of keys) {
                if (mySurplus[k] && theirScarcity[k] > 0.3) {
                    matchScore += mySurplus[k] * theirScarcity[k] * 30;
                    hasMatch = true;
                }
                if (theirScarcity[k] > 0.5 && scarcity[k] < 0.2) {
                    matchScore += 20;
                    hasMatch = true;
                }
            }
            score += matchScore;
            factors.push({ factor: 'Resource complementarity', weight: 1, contribution: matchScore });
            if (hasMatch)
                reasoning.push('complementary resource needs');
            else {
                score -= 15;
            }
            const rel = ScoringHelpers.getRelationship(ctx.self, targetId) ?? null;
            const relMod = ScoringHelpers.evaluateRelationshipModifier(rel);
            score += relMod * 0.6;
            factors.push({ factor: 'Trade relations', weight: 0.6, contribution: relMod * 0.6 });
            if (rel?.state === 'allied')
                reasoning.push('trading with ally');
            if (rel?.treaties.some((t) => t.type === 'trade_agreement')) {
                score += 10;
                reasoning.push('trade agreement in place');
            }
            const mem = memory.summarizeForFaction(targetId, turn);
            if (mem.treatiesBroken > 0) {
                score -= 15 * mem.treatiesBroken;
                reasoning.push('past unreliability');
            }
            if (mem.successfulTrades > 0) {
                score += mem.successfulTrades * 3;
                factors.push({ factor: 'Trade history', weight: 1, contribution: mem.successfulTrades * 3 });
            }
            const goalAlign = goals.evaluateActionAlignment({
                actionType: 'TRADE', targetFaction: targetId,
                self: ctx.self, currentTurn: turn, allTerritories: ctx.allTerritories,
            });
            score += goalAlign.scoreContribution;
            factors.push({ factor: 'Goal alignment', weight: 1, contribution: goalAlign.scoreContribution });
            score = Math.max(S.minReasonableScore, Math.min(S.maxScore, score));
            results.push({
                action: 'TRADE', targetId, targetName: target.name,
                score, baseScore: S.baseScores.TRADE, factorBreakdown: factors, reasoning,
            });
        }
        return results.sort((a, b) => b.score - a.score).slice(0, 3);
    }
    scoreRetreat(input) {
        const { ctx } = input;
        let { base, factors, reasoning } = this.baseScored('RETREAT', input);
        let score = base;
        let worstArmy = null;
        let worstScore = -Infinity;
        for (const army of ctx.myArmies) {
            const loc = ctx.allTerritories.get(army.location);
            if (!loc)
                continue;
            if (loc.owner === ctx.self.id)
                continue;
            let enemyNearby = 0;
            for (const nId of loc.neighboring) {
                const n = ctx.allTerritories.get(nId);
                if (n?.owner && n.owner !== ctx.self.id) {
                    const owner = ctx.allFactions.get(n.owner);
                    if (owner)
                        enemyNearby += owner.totalMilitaryPower;
                }
            }
            const armyPower = ScoringHelpers.computeArmyPower(army);
            const ratio = armyPower / Math.max(1, enemyNearby);
            if (ratio < 0.3 && loc.owner !== ctx.self.id) {
                const s = (0.3 - ratio) * 100;
                if (s > worstScore) {
                    worstScore = s;
                    worstArmy = army;
                }
            }
        }
        if (worstArmy && worstScore > 0) {
            score += worstScore;
            factors.push({ factor: 'Army endangered', weight: 1, contribution: worstScore });
            reasoning.push('army at risk of being trapped');
        }
        else {
            score -= 15;
        }
        score = Math.max(S.minReasonableScore, Math.min(S.maxScore, score));
        return [{
                action: 'RETREAT',
                targetId: worstArmy?.location ?? null,
                targetName: worstArmy ? ctx.allTerritories.get(worstArmy.location)?.name ?? null : null,
                score, baseScore: S.baseScores.RETREAT, factorBreakdown: factors, reasoning,
            }];
    }
    scoreWait(input) {
        const { ctx, turn } = input;
        let { base, factors, reasoning } = this.baseScored('WAIT', input);
        let score = base;
        const recentActions = ctx.self.lastActions.filter((a) => a.turn >= turn - 2);
        const sameActions = recentActions.filter((a) => a.action === 'WAIT').length;
        if (sameActions >= 2) {
            score -= 20;
            factors.push({ factor: 'Consecutive waits', weight: 1, contribution: -20 });
        }
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
            score += 5;
            factors.push({ factor: 'Patient temperament', weight: 1, contribution: 5 });
        }
        score = Math.max(S.minReasonableScore, Math.min(S.maxScore, score));
        return [{
                action: 'WAIT', targetId: null, targetName: null,
                score, baseScore: S.baseScores.WAIT, factorBreakdown: factors, reasoning,
            }];
    }
}
exports.ActionScorer = ActionScorer;
//# sourceMappingURL=ActionScorer.js.map