import { MemoryEntry, MemoryEventType, FactionId, TerritoryId } from '../types';
export interface MemorySummary {
    totalGrievances: number;
    totalFavors: number;
    recentAttacks: number;
    treatiesBroken: number;
    treatiesHonored: number;
    successfulTrades: number;
    territoriesLost: number;
    territoriesGained: number;
    victoriesVs: number;
    defeatsVs: number;
    allianceDuration: number;
    peaceDuration: number;
    warDuration: number;
    trustLevel: number;
}
export declare class MemorySystem {
    private entries;
    private nextId;
    addEntry(turn: number, type: MemoryEventType, withFaction: FactionId | null, territory: TerritoryId | null, magnitude: number, details?: Record<string, unknown>): MemoryEntry;
    getEntries(filters?: {
        type?: MemoryEventType;
        withFaction?: FactionId;
        territory?: TerritoryId;
        minTurn?: number;
        maxTurn?: number;
        maxEntries?: number;
    }): MemoryEntry[];
    getCurrentEntries(): MemoryEntry[];
    summarizeForFaction(targetFaction: FactionId, currentTurn: number): MemorySummary;
    getGrievanceScore(faction: FactionId, currentTurn: number): number;
    private trimMemory;
    mergeFrom(other: MemoryEntry[]): void;
}
