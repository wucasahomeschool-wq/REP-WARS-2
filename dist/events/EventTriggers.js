"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMMON_ELIGIBILITY = exports.WorldHelperImpl = void 0;
exports.buildConditionContext = buildConditionContext;
exports.buildTriggerFn = buildTriggerFn;
exports.computeFactionStabilityModifier = computeFactionStabilityModifier;
exports.candidateTerritoriesForEvents = candidateTerritoriesForEvents;
const balance_1 = require("../constants/balance");
class WorldHelperImpl {
    constructor(territories, factions, activeEvents) {
        this.territories = territories;
        this.factions = factions;
        this.activeEvents = activeEvents;
    }
    getTerritory(id) {
        return this.territories.get(id);
    }
    getFaction(id) {
        return this.factions.get(id);
    }
    hasActiveEventOn(territoryId, eventTypeId) {
        return this.activeEvents.some(e => e.status === 'active' && e.territoryId === territoryId && e.typeId === eventTypeId);
    }
    getActiveEventsOn(territoryId) {
        return this.activeEvents.filter(e => e.status === 'active' && e.territoryId === territoryId);
    }
    getActiveEventsByFaction(factionId) {
        return this.activeEvents.filter(e => e.status === 'active' && e.factionId === factionId);
    }
    hasActiveEventTypeId(typeId, scope) {
        return this.activeEvents.some(e => {
            if (e.status !== 'active' || e.typeId !== typeId)
                return false;
            if (scope?.territoryId && e.territoryId !== scope.territoryId)
                return false;
            if (scope?.factionId && e.factionId !== scope.factionId)
                return false;
            return true;
        });
    }
    countTerrainNeighbors(territoryId, terrain) {
        const t = this.territories.get(territoryId);
        if (!t)
            return 0;
        let count = 0;
        for (const nid of t.neighboring) {
            const n = this.territories.get(nid);
            if (n && n.terrain === terrain)
                count++;
        }
        return count;
    }
    countHostileBorderNeighbors(territoryId) {
        const t = this.territories.get(territoryId);
        if (!t || !t.owner)
            return 0;
        const myFaction = t.owner;
        let hostile = 0;
        for (const nid of t.neighboring) {
            const n = this.territories.get(nid);
            if (!n)
                continue;
            if (n.owner && n.owner !== myFaction) {
                const rel = this.factions.get(myFaction)?.diplomacy.get(n.owner);
                if (rel && (rel.state === 'hostile' || rel.state === 'at_war' || rel.opinion <= -30)) {
                    hostile++;
                }
            }
        }
        return hostile;
    }
    countControlledTerritories(factionId) {
        let count = 0;
        for (const t of this.territories.values()) {
            if (t.owner === factionId)
                count++;
        }
        return count;
    }
    getTerritoryFoodProduction(t) {
        return t.resourceOutput?.food ?? 0;
    }
    getFactionTotalPopulation(fid) {
        let total = 0;
        for (const t of this.territories.values()) {
            if (t.owner === fid)
                total += t.population;
        }
        return total;
    }
    getFactionResourceRatio(fid, resource) {
        const f = this.factions.get(fid);
        if (!f)
            return 1.0;
        const stock = f.resources[resource] ?? 0;
        const income = f.resourceIncome?.[resource] ?? 0;
        if (income <= 0)
            return 10.0;
        return stock / Math.max(1, income * 5);
    }
    getTerritoryThemeTag(_territoryId) {
        return null;
    }
}
exports.WorldHelperImpl = WorldHelperImpl;
function buildConditionContext(turn, territoryId, factionId, territories, factions, activeEvents, rng) {
    const helper = new WorldHelperImpl(territories, factions, activeEvents);
    return {
        turn,
        territoryId,
        factionId,
        world: { territories, factions, activeEvents },
        helper,
        rng,
    };
}
function buildTriggerFn(params) {
    return (ctx) => {
        let score = {
            eligible: true,
            baseWeight: params.baseWeight,
            reasons: [],
        };
        if (params.eligibility && !params.eligibility(ctx)) {
            score.eligible = false;
            score.reasons.push('Basic eligibility not met');
            return score;
        }
        if (params.modifiers) {
            for (const mod of params.modifiers) {
                if (mod.when(ctx)) {
                    score = mod.apply(score);
                    score.reasons.push(mod.reason(ctx));
                }
            }
        }
        if (params.severityByConditions) {
            for (const sev of params.severityByConditions) {
                if (sev.when(ctx)) {
                    score.severityHint = sev.severity;
                    score.reasons.push(sev.reason(ctx));
                    break;
                }
            }
        }
        if (score.baseWeight <= 0)
            score.eligible = false;
        return score;
    };
}
exports.COMMON_ELIGIBILITY = {
    ownedTerritory: (ctx) => {
        if (!ctx.territoryId)
            return false;
        const t = ctx.helper.getTerritory(ctx.territoryId);
        return !!t && !!t.owner;
    },
    populationThreshold: (minPop) => (ctx) => {
        if (!ctx.territoryId)
            return false;
        const t = ctx.helper.getTerritory(ctx.territoryId);
        return !!t && t.population >= minPop;
    },
    noActiveDuplicate: (typeId) => (ctx) => {
        if (!ctx.territoryId)
            return true;
        return !ctx.helper.hasActiveEventOn(ctx.territoryId, typeId);
    },
    terrainIsOneOf: (terrains) => (ctx) => {
        if (!ctx.territoryId)
            return false;
        const t = ctx.helper.getTerritory(ctx.territoryId);
        return !!t && terrains.includes(t.terrain);
    },
    factionHasStabilityBelow: (threshold) => (ctx) => {
        if (!ctx.factionId)
            return false;
        const f = ctx.helper.getFaction(ctx.factionId);
        return !!f && f.stability < threshold;
    },
    territoryHasActiveEvent: (typeId) => (ctx) => {
        if (!ctx.territoryId)
            return false;
        return ctx.helper.hasActiveEventOn(ctx.territoryId, typeId);
    },
};
function computeFactionStabilityModifier(factionStability) {
    const T = balance_1.BALANCE.events.thresholds;
    if (factionStability <= T.criticalFactionStability) {
        return { weightMult: 3.0, reason: `Critical faction stability (${factionStability})` };
    }
    if (factionStability <= T.lowFactionStability) {
        return { weightMult: 1.8, reason: `Low faction stability (${factionStability})` };
    }
    if (factionStability >= 85) {
        return { weightMult: 0.4, reason: `High faction stability (${factionStability})` };
    }
    return { weightMult: 1.0, reason: '' };
}
function candidateTerritoriesForEvents(territories, activeEvents) {
    const W = balance_1.BALANCE.events.world;
    const out = [];
    for (const [id, t] of territories.entries()) {
        if (!t.owner)
            continue;
        if (t.population < W.territoryChoiceMinPopulation)
            continue;
        const onTerritory = activeEvents.filter(e => e.status === 'active' && e.territoryId === id).length;
        if (onTerritory >= balance_1.BALANCE.events.world.sameTerritoryMaxConcurrentActive)
            continue;
        out.push(id);
    }
    return out;
}
//# sourceMappingURL=EventTriggers.js.map