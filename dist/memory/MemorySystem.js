"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemorySystem = void 0;
const balance_1 = require("../constants/balance");
class MemorySystem {
    constructor() {
        this.entries = [];
        this.nextId = 0;
    }
    addEntry(turn, type, withFaction, territory, magnitude, details = {}) {
        const entry = {
            id: `mem_${this.nextId++}`,
            turn,
            type,
            withFaction,
            territory,
            magnitude,
            details,
        };
        this.entries.push(entry);
        this.trimMemory();
        return entry;
    }
    getEntries(filters) {
        let result = [...this.entries];
        if (filters?.type)
            result = result.filter((e) => e.type === filters.type);
        if (filters?.withFaction)
            result = result.filter((e) => e.withFaction === filters.withFaction);
        if (filters?.territory)
            result = result.filter((e) => e.territory === filters.territory);
        if (filters?.minTurn !== undefined)
            result = result.filter((e) => e.turn >= filters.minTurn);
        if (filters?.maxTurn !== undefined)
            result = result.filter((e) => e.turn <= filters.maxTurn);
        result.sort((a, b) => b.turn - a.turn);
        if (filters?.maxEntries !== undefined) {
            result = result.slice(0, filters.maxEntries);
        }
        return result;
    }
    getCurrentEntries() {
        return [...this.entries];
    }
    summarizeForFaction(targetFaction, currentTurn) {
        const relevant = this.entries.filter((e) => e.withFaction === targetFaction);
        const halfLife = balance_1.BALANCE.memory.eventDecayHalfLifeTurns;
        let totalGrievances = 0;
        let totalFavors = 0;
        let recentAttacks = 0;
        let treatiesBroken = 0;
        let treatiesHonored = 0;
        let successfulTrades = 0;
        let territoriesLost = 0;
        let territoriesGained = 0;
        let victoriesVs = 0;
        let defeatsVs = 0;
        let lastAllianceStart = null;
        let lastPeaceStart = null;
        let lastWarStart = null;
        for (const entry of relevant) {
            const age = currentTurn - entry.turn;
            const decay = Math.pow(0.5, age / halfLife);
            const weightedMag = entry.magnitude * decay;
            switch (entry.type) {
                case 'attack_received':
                case 'war_declared':
                    totalGrievances += weightedMag;
                    if (age <= 5)
                        recentAttacks++;
                    if (entry.type === 'war_declared')
                        lastWarStart = entry.turn;
                    break;
                case 'territory_lost':
                    totalGrievances += weightedMag * 1.5;
                    territoriesLost++;
                    break;
                case 'treaty_broken':
                    totalGrievances += weightedMag * 2;
                    treatiesBroken++;
                    break;
                case 'alliance_broken':
                    totalGrievances += weightedMag * 2.5;
                    treatiesBroken++;
                    break;
                case 'attack_made':
                case 'major_victory':
                case 'battle_won':
                    victoriesVs++;
                    break;
                case 'major_defeat':
                case 'battle_lost':
                    defeatsVs++;
                    break;
                case 'territory_gained':
                    territoriesGained++;
                    break;
                case 'treaty_signed':
                    treatiesHonored++;
                    if (entry.details.type === 'alliance')
                        lastAllianceStart = entry.turn;
                    break;
                case 'alliance_formed':
                    totalFavors += weightedMag;
                    treatiesHonored++;
                    lastAllianceStart = entry.turn;
                    break;
                case 'trade_completed':
                    totalFavors += weightedMag;
                    successfulTrades++;
                    break;
                case 'peace_offered':
                    totalFavors += weightedMag * 0.5;
                    lastPeaceStart = entry.turn;
                    break;
            }
        }
        const allianceDuration = lastAllianceStart ? currentTurn - lastAllianceStart : 0;
        const peaceDuration = lastPeaceStart ? currentTurn - lastPeaceStart : 0;
        const warDuration = lastWarStart ? currentTurn - lastWarStart : 0;
        const maxMag = Math.max(1, totalGrievances + totalFavors);
        const trustLevel = totalFavors / maxMag;
        return {
            totalGrievances,
            totalFavors,
            recentAttacks,
            treatiesBroken,
            treatiesHonored,
            successfulTrades,
            territoriesLost,
            territoriesGained,
            victoriesVs,
            defeatsVs,
            allianceDuration,
            peaceDuration,
            warDuration,
            trustLevel,
        };
    }
    getGrievanceScore(faction, currentTurn) {
        const summary = this.summarizeForFaction(faction, currentTurn);
        return summary.totalGrievances - summary.totalFavors * 0.6;
    }
    trimMemory() {
        if (this.entries.length > 200) {
            this.entries = this.entries.slice(-200);
        }
    }
    mergeFrom(other) {
        for (const entry of other) {
            const exists = this.entries.some((e) => e.id === entry.id);
            if (!exists) {
                this.entries.push(entry);
                const parsed = parseInt(entry.id.replace('mem_', ''));
                if (!isNaN(parsed) && parsed >= this.nextId)
                    this.nextId = parsed + 1;
            }
        }
        this.trimMemory();
    }
}
exports.MemorySystem = MemorySystem;
//# sourceMappingURL=MemorySystem.js.map