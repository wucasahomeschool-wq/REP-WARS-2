"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DecisionEngine = exports.WarlordState = void 0;
const balance_1 = require("../constants/balance");
const SeededRNG_1 = require("../utils/SeededRNG");
const MemorySystem_1 = require("../memory/MemorySystem");
const GoalSystem_1 = require("../goals/GoalSystem");
const ActionScorer_1 = require("../scoring/ActionScorer");
class WarlordState {
    constructor(snapshot, memory, goals) {
        this.snapshot = snapshot;
        this.memory = memory ?? new MemorySystem_1.MemorySystem();
        this.goals = goals ?? new GoalSystem_1.GoalSystem(this.snapshot.goals);
        this.memory.mergeFrom(this.snapshot.memory);
    }
    static buildContext(self, gameState) {
        const allTerritories = gameState.territories;
        const allArmies = gameState.armies;
        const allFactions = gameState.factions;
        const myTerritories = self.territories
            .map((id) => allTerritories.get(id))
            .filter((t) => !!t);
        const myArmies = self.armies
            .map((id) => allArmies.get(id))
            .filter((a) => !!a);
        const knownTerritories = self.knownTerritories
            .map((id) => allTerritories.get(id))
            .filter((t) => !!t);
        const myNeighborIds = new Set();
        for (const t of myTerritories) {
            for (const nId of t.neighboring)
                myNeighborIds.add(nId);
        }
        const myNeighboringTerritories = Array.from(myNeighborIds)
            .map((id) => allTerritories.get(id))
            .filter((t) => !!t);
        const unownedNeighbors = myNeighboringTerritories.filter((t) => t.owner === null);
        const enemyNeighbors = myNeighboringTerritories.filter((t) => {
            if (!t.owner || t.owner === self.id)
                return false;
            const rel = self.diplomacy.get(t.owner);
            return rel?.state === 'at_war' || rel?.state === 'hostile' || (rel?.opinion ?? 0) < -20;
        });
        const friendlyNeighbors = myNeighboringTerritories.filter((t) => {
            if (!t.owner || t.owner === self.id)
                return false;
            const rel = self.diplomacy.get(t.owner);
            return rel?.state === 'allied' || rel?.state === 'friendly' || (rel?.opinion ?? 0) > 20;
        });
        const knownEnemies = [];
        const knownAllies = [];
        const knownNeutrals = [];
        for (const id of self.knownFactions) {
            if (id === self.id)
                continue;
            const rel = self.diplomacy.get(id);
            if (!rel) {
                knownNeutrals.push(id);
                continue;
            }
            if (rel.state === 'at_war' || rel.state === 'hostile')
                knownEnemies.push(id);
            else if (rel.state === 'allied' || rel.state === 'friendly')
                knownAllies.push(id);
            else
                knownNeutrals.push(id);
        }
        return {
            self,
            gameState,
            allTerritories,
            allArmies,
            allFactions,
            myTerritories,
            myArmies,
            myNeighboringTerritories,
            unownedNeighbors,
            enemyNeighbors,
            friendlyNeighbors,
            knownEnemies,
            knownAllies,
            knownNeutrals,
        };
    }
}
exports.WarlordState = WarlordState;
class DecisionEngine {
    constructor(seed) {
        this.scorer = new ActionScorer_1.ActionScorer();
        this.rng = new SeededRNG_1.SeededRNG(seed ?? balance_1.BALANCE.simulate.defaultSeed);
    }
    resetSeed(seed) {
        this.rng = new SeededRNG_1.SeededRNG(seed);
    }
    getRNG() {
        return this.rng;
    }
    decide(warlord, gameState, turn) {
        const self = warlord.snapshot;
        const ctx = WarlordState.buildContext(self, gameState);
        const factionRNG = this.rng.fork(hashFactionId(self.id) ^ turn);
        const scorerInput = {
            ctx,
            turn,
            rng: factionRNG,
            memory: warlord.memory,
            goals: warlord.goals,
        };
        const allScored = this.scorer.scoreAllActions(scorerInput);
        if (allScored.length === 0) {
            return {
                warlordId: self.id,
                warlordName: self.name,
                turn,
                action: 'WAIT',
                targetId: null,
                targetName: null,
                reasoning: ['No available actions'],
                score: 0,
                topAlternatives: [],
                confidence: 0,
            };
        }
        const { selected, alternatives, confidence } = this.selectWithRandomness(allScored, factionRNG);
        const finalReasoning = [...selected.reasoning];
        if (finalReasoning.length === 0) {
            finalReasoning.push('default strategy');
        }
        const topAlternatives = alternatives.slice(0, 5);
        return {
            warlordId: self.id,
            warlordName: self.name,
            turn,
            action: selected.action,
            targetId: selected.targetId,
            targetName: selected.targetName,
            reasoning: finalReasoning,
            score: selected.score,
            topAlternatives,
            confidence,
        };
    }
    selectWithRandomness(scored, rng) {
        const sorted = [...scored].sort((a, b) => b.score - a.score);
        const maxScore = sorted[0].score;
        const minScore = sorted[sorted.length - 1].score;
        const spread = Math.max(1, maxScore - minScore);
        const normalized = sorted.map((s) => {
            const norm = 0.1 + ((s.score - minScore) / spread) * 0.9;
            return { ...s, weight: Math.pow(norm, 2.5) };
        });
        const tieThreshold = balance_1.BALANCE.scoring.tiebreakerRandomness * spread;
        const candidates = normalized.filter((s) => s.score >= maxScore - tieThreshold);
        let selected;
        let confidence;
        if (candidates.length === 1) {
            selected = candidates[0];
            confidence = Math.min(0.95, 0.5 + (maxScore - (sorted[1]?.score ?? maxScore - 10)) / spread);
        }
        else {
            const totalWeight = candidates.reduce((s, c) => s + c.weight, 0);
            let r = rng.next() * totalWeight;
            selected = candidates[0];
            for (const c of candidates) {
                r -= c.weight;
                if (r <= 0) {
                    selected = c;
                    break;
                }
            }
            confidence = (selected.weight ?? 0) / totalWeight;
        }
        const alternatives = sorted.filter((s) => s !== selected);
        return { selected, alternatives, confidence };
    }
    decideAll(warlords, gameState, turn, factionOrder) {
        const order = factionOrder ?? Array.from(warlords.keys()).sort();
        const results = [];
        for (const id of order) {
            const ws = warlords.get(id);
            if (!ws)
                continue;
            results.push(this.decide(ws, gameState, turn));
        }
        return results;
    }
    formatDecision(decision, verbose = false) {
        const target = decision.targetName ? ` ${decision.targetName}` : '';
        const reason = decision.reasoning.length > 0
            ? decision.reasoning.slice(0, 5).join(', ')
            : 'no specific reason';
        let output = `${decision.warlordName.toUpperCase()}:\n  Decision: ${decision.action}${target}\n  Reason: ${reason}.`;
        if (verbose) {
            output += `\n  Score: ${decision.score.toFixed(1)} | Confidence: ${(decision.confidence * 100).toFixed(0)}%`;
            if (decision.topAlternatives.length > 0) {
                output += '\n  Alternatives:';
                for (const alt of decision.topAlternatives.slice(0, 3)) {
                    const tn = alt.targetName ? ` ${alt.targetName}` : '';
                    output += `\n    - ${alt.action}${tn} (${alt.score.toFixed(1)})`;
                }
            }
        }
        return output;
    }
    formatTurnReport(turn, decisions, verbose = false) {
        const lines = [];
        lines.push('');
        lines.push('='.repeat(50));
        lines.push(`TURN ${turn}`);
        lines.push('='.repeat(50));
        for (const d of decisions) {
            lines.push(this.formatDecision(d, verbose));
            lines.push('');
        }
        return lines.join('\n');
    }
}
exports.DecisionEngine = DecisionEngine;
function hashFactionId(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) {
        h = ((h << 5) - h) + id.charCodeAt(i);
        h |= 0;
    }
    return h >>> 0;
}
//# sourceMappingURL=DecisionEngine.js.map