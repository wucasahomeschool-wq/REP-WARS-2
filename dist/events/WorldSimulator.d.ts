import { FactionId, TerritoryId, Resources, Territory, WarlordSnapshot } from '../types';
import { ActiveEvent, ConsequenceDelta, HistoryEntry, WorldStepInput, WorldStepOutput } from './EventModel';
export declare class ConsequenceApplier {
    territories: Map<TerritoryId, Territory>;
    factions: Map<FactionId, WarlordSnapshot>;
    applied: string[];
    constructor(territories: Map<TerritoryId, Territory>, factions: Map<FactionId, WarlordSnapshot>);
    applyDelta(c: ConsequenceDelta): string | null;
    applyMany(cs: ConsequenceDelta[]): string[];
    canAfford(cost: Partial<Resources> | undefined, factionId: FactionId): boolean;
    payCost(cost: Partial<Resources> | undefined, factionId: FactionId): void;
}
export declare class WorldSimulator {
    private applier;
    simulate(input: WorldStepInput): WorldStepOutput;
    private _seedChainDelays;
    private _buildCtx;
    resolveChoice(input: WorldStepInput & {
        activeEventInstanceId: string;
        choiceId: string;
    }): {
        updatedActive: ActiveEvent[];
        updatedHistory: HistoryEntry[];
        mutatedTerritories: Map<TerritoryId, Territory>;
        mutatedFactions: Map<FactionId, WarlordSnapshot>;
        messages: string[];
        paidCost: Partial<Resources> | undefined;
        choiceTakenMessage: string;
    };
}
