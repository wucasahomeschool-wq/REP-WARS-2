import { FactionId, TerritoryId, Resources, Territory, WarlordSnapshot } from '../types';
import { ActiveEvent, WorldHelper, ConditionContext, EventConditionFn, TriggerScore, EventSeverity } from './EventModel';
import { SeededRNG } from '../utils/SeededRNG';
export declare class WorldHelperImpl implements WorldHelper {
    private territories;
    private factions;
    private activeEvents;
    constructor(territories: Map<TerritoryId, Territory>, factions: Map<FactionId, WarlordSnapshot>, activeEvents: ActiveEvent[]);
    getTerritory(id: TerritoryId): Territory | undefined;
    getFaction(id: FactionId): WarlordSnapshot | undefined;
    hasActiveEventOn(territoryId: TerritoryId, eventTypeId: string): boolean;
    getActiveEventsOn(territoryId: TerritoryId): ActiveEvent[];
    getActiveEventsByFaction(factionId: FactionId): ActiveEvent[];
    hasActiveEventTypeId(typeId: string, scope?: {
        territoryId?: TerritoryId;
        factionId?: FactionId;
    }): boolean;
    countTerrainNeighbors(territoryId: TerritoryId, terrain: string): number;
    countHostileBorderNeighbors(territoryId: TerritoryId): number;
    countControlledTerritories(factionId: FactionId): number;
    getTerritoryFoodProduction(t: Territory): number;
    getFactionTotalPopulation(fid: FactionId): number;
    getFactionResourceRatio(fid: FactionId, resource: keyof Resources): number;
    getTerritoryThemeTag(_territoryId: TerritoryId): string | null;
}
export declare function buildConditionContext(turn: number, territoryId: TerritoryId | null, factionId: FactionId | null, territories: Map<TerritoryId, Territory>, factions: Map<FactionId, WarlordSnapshot>, activeEvents: ActiveEvent[], rng: SeededRNG): ConditionContext;
type TriggerBuilderParams = {
    baseWeight: number;
    eligibility?: (ctx: ConditionContext) => boolean;
    modifiers?: Array<{
        when: (ctx: ConditionContext) => boolean;
        apply: (score: TriggerScore) => TriggerScore;
        reason: (ctx: ConditionContext) => string;
    }>;
    severityByConditions?: Array<{
        when: (ctx: ConditionContext) => boolean;
        severity: EventSeverity;
        reason: (ctx: ConditionContext) => string;
    }>;
};
export declare function buildTriggerFn(params: TriggerBuilderParams): EventConditionFn;
export declare const COMMON_ELIGIBILITY: {
    ownedTerritory: (ctx: ConditionContext) => boolean;
    populationThreshold: (minPop: number) => (ctx: ConditionContext) => boolean;
    noActiveDuplicate: (typeId: string) => (ctx: ConditionContext) => boolean;
    terrainIsOneOf: (terrains: string[]) => (ctx: ConditionContext) => boolean;
    factionHasStabilityBelow: (threshold: number) => (ctx: ConditionContext) => boolean;
    territoryHasActiveEvent: (typeId: string) => (ctx: ConditionContext) => boolean;
};
export declare function computeFactionStabilityModifier(factionStability: number): {
    weightMult: number;
    reason: string;
};
export declare function candidateTerritoriesForEvents(territories: Map<TerritoryId, Territory>, activeEvents: ActiveEvent[]): TerritoryId[];
export {};
