import { MemoryEntry, MemoryEventType, FactionId, TerritoryId } from '../types';
import { BALANCE } from '../constants/balance';

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

export class MemorySystem {
  private entries: MemoryEntry[] = [];
  private nextId = 0;

  addEntry(
    turn: number,
    type: MemoryEventType,
    withFaction: FactionId | null,
    territory: TerritoryId | null,
    magnitude: number,
    details: Record<string, unknown> = {}
  ): MemoryEntry {
    const entry: MemoryEntry = {
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

  getEntries(filters?: {
    type?: MemoryEventType;
    withFaction?: FactionId;
    territory?: TerritoryId;
    minTurn?: number;
    maxTurn?: number;
    maxEntries?: number;
  }): MemoryEntry[] {
    let result = [...this.entries];

    if (filters?.type) result = result.filter((e) => e.type === filters.type);
    if (filters?.withFaction) result = result.filter((e) => e.withFaction === filters.withFaction);
    if (filters?.territory) result = result.filter((e) => e.territory === filters.territory);
    if (filters?.minTurn !== undefined) result = result.filter((e) => e.turn >= filters.minTurn!);
    if (filters?.maxTurn !== undefined) result = result.filter((e) => e.turn <= filters.maxTurn!);

    result.sort((a, b) => b.turn - a.turn);

    if (filters?.maxEntries !== undefined) {
      result = result.slice(0, filters.maxEntries);
    }

    return result;
  }

  getCurrentEntries(): MemoryEntry[] {
    return [...this.entries];
  }

  summarizeForFaction(targetFaction: FactionId, currentTurn: number): MemorySummary {
    const relevant = this.entries.filter((e) => e.withFaction === targetFaction);
    const halfLife = BALANCE.memory.eventDecayHalfLifeTurns;

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
    let lastAllianceStart: number | null = null;
    let lastPeaceStart: number | null = null;
    let lastWarStart: number | null = null;

    for (const entry of relevant) {
      const age = currentTurn - entry.turn;
      const decay = Math.pow(0.5, age / halfLife);
      const weightedMag = entry.magnitude * decay;

      switch (entry.type) {
        case 'attack_received':
        case 'war_declared':
          totalGrievances += weightedMag;
          if (age <= 5) recentAttacks++;
          if (entry.type === 'war_declared') lastWarStart = entry.turn;
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
          if (entry.details.type === 'alliance') lastAllianceStart = entry.turn;
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

  getGrievanceScore(faction: FactionId, currentTurn: number): number {
    const summary = this.summarizeForFaction(faction, currentTurn);
    return summary.totalGrievances - summary.totalFavors * 0.6;
  }

  private trimMemory(): void {
    if (this.entries.length > 200) {
      this.entries = this.entries.slice(-200);
    }
  }

  mergeFrom(other: MemoryEntry[]): void {
    for (const entry of other) {
      const exists = this.entries.some((e) => e.id === entry.id);
      if (!exists) {
        this.entries.push(entry);
        const parsed = parseInt(entry.id.replace('mem_', ''));
        if (!isNaN(parsed) && parsed >= this.nextId) this.nextId = parsed + 1;
      }
    }
    this.trimMemory();
  }
}
