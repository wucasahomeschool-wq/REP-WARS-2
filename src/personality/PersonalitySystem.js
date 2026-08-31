"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PersonalitySystem = void 0;
const balance_1 = require("../constants/balance");
const PERSONALITY_PRESETS = {
    defensive: {
        aggression: 0.2,
        defensiveness: 0.95,
        expansionism: 0.25,
        opportunism: 0.3,
        diplomacy: 0.5,
        economics: 0.55,
        riskTolerance: 0.15,
        patience: 0.8,
        forgivingness: 0.4,
        loyalty: 0.75,
    },
    aggressive: {
        aggression: 0.95,
        defensiveness: 0.3,
        expansionism: 0.7,
        opportunism: 0.7,
        diplomacy: 0.2,
        economics: 0.35,
        riskTolerance: 0.75,
        patience: 0.25,
        forgivingness: 0.15,
        loyalty: 0.3,
    },
    expansionist: {
        aggression: 0.6,
        defensiveness: 0.35,
        expansionism: 0.95,
        opportunism: 0.6,
        diplomacy: 0.35,
        economics: 0.65,
        riskTolerance: 0.55,
        patience: 0.5,
        forgivingness: 0.35,
        loyalty: 0.45,
    },
    opportunistic: {
        aggression: 0.55,
        defensiveness: 0.45,
        expansionism: 0.55,
        opportunism: 0.95,
        diplomacy: 0.5,
        economics: 0.55,
        riskTolerance: 0.65,
        patience: 0.35,
        forgivingness: 0.5,
        loyalty: 0.25,
    },
    diplomatic: {
        aggression: 0.25,
        defensiveness: 0.6,
        expansionism: 0.3,
        opportunism: 0.4,
        diplomacy: 0.95,
        economics: 0.6,
        riskTolerance: 0.25,
        patience: 0.85,
        forgivingness: 0.75,
        loyalty: 0.85,
    },
    economic: {
        aggression: 0.2,
        defensiveness: 0.5,
        expansionism: 0.5,
        opportunism: 0.45,
        diplomacy: 0.55,
        economics: 0.95,
        riskTolerance: 0.2,
        patience: 0.8,
        forgivingness: 0.55,
        loyalty: 0.6,
    },
};
const ACTION_PERSONALITY_BIAS = {
    ATTACK: 'aggression',
    DEFEND: 'defensiveness',
    REINFORCE: 'defensiveness',
    EXPAND: 'expansionism',
    SCOUT: 'opportunism',
    BUILD: 'economics',
    MOVE: 'aggression',
    NEGOTIATE: 'diplomacy',
    OFFER_PEACE: 'diplomacy',
    DECLARE_WAR: 'aggression',
    TRADE: 'economics',
    RETREAT: 'defensiveness',
    WAIT: 'patience',
};
class PersonalitySystem {
    static createPreset(type) {
        return {
            type,
            ...PERSONALITY_PRESETS[type],
        };
    }
    static randomizePreset(base, variance = 0.15, rng) {
        const preset = PERSONALITY_PRESETS[base];
        const result = { type: base };
        for (const key of Object.keys(preset)) {
            const baseValue = preset[key];
            const delta = (rng.next() - 0.5) * 2 * variance;
            result[key] = Math.max(0, Math.min(1, baseValue + delta));
        }
        return result;
    }
    static getActionBias(action, personality) {
        const trait = ACTION_PERSONALITY_BIAS[action];
        const traitValue = personality[trait] ?? 0.5;
        const bias = (traitValue - 0.5) * 2;
        return bias * balance_1.BALANCE.personality.modifierRange;
    }
    static getRiskModifier(personality, estimatedRisk) {
        const riskAcceptance = personality.riskTolerance;
        const excessRisk = Math.max(0, estimatedRisk - riskAcceptance);
        const deficitRisk = Math.max(0, riskAcceptance - estimatedRisk);
        const penalty = -excessRisk * balance_1.BALANCE.personality.riskPenaltyMultiplier * balance_1.BALANCE.scoring.maxFactorWeight;
        const bonus = deficitRisk * 0.3 * balance_1.BALANCE.scoring.maxFactorWeight;
        return penalty + bonus;
    }
    static getRevengeModifier(personality, historicalGrievances) {
        const forgiveness = 1 - personality.forgivingness;
        return historicalGrievances * forgiveness * balance_1.BALANCE.memory.revengeBaseModifier;
    }
    static getDiplomaticTrustModifier(personality, targetTrustworthiness) {
        const loyaltyFactor = personality.loyalty;
        const opinionBias = (targetTrustworthiness - 0.5) * 2;
        return opinionBias * loyaltyFactor * balance_1.BALANCE.memory.trustworthinessImpact * balance_1.BALANCE.scoring.maxFactorWeight / 5;
    }
    static describePersonality(p) {
        const traits = [];
        if (p.aggression > 0.75)
            traits.push('highly aggressive');
        else if (p.aggression > 0.55)
            traits.push('somewhat aggressive');
        else if (p.aggression < 0.25)
            traits.push('very peaceful');
        else if (p.aggression < 0.4)
            traits.push('generally peaceful');
        if (p.defensiveness > 0.75)
            traits.push('strongly defensive');
        else if (p.defensiveness > 0.55)
            traits.push('cautious');
        if (p.expansionism > 0.75)
            traits.push('expansion-minded');
        if (p.opportunism > 0.75)
            traits.push('opportunistic');
        if (p.diplomacy > 0.75)
            traits.push('diplomatic');
        if (p.economics > 0.75)
            traits.push('economy-focused');
        if (p.riskTolerance > 0.7)
            traits.push('risk-tolerant');
        else if (p.riskTolerance < 0.3)
            traits.push('risk-averse');
        if (p.patience > 0.75)
            traits.push('patient');
        else if (p.patience < 0.25)
            traits.push('impulsive');
        return traits.length > 0 ? traits : ['balanced'];
    }
}
exports.PersonalitySystem = PersonalitySystem;
//# sourceMappingURL=PersonalitySystem.js.map