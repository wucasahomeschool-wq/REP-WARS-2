import { MapWorldState, InitialWorldParams, ExpansionRequest, ExpansionResult, PlayerVisibilityMap, ScoutResult, ThemeDefinition, ThemeId, Territory, TerritoryId, Region, RegionId, MapGenerationReport, FactionId } from '../types';
export declare class MapEngine {
    private naming;
    private C;
    constructor(namingSeed?: number);
    resetNameTracker(): void;
    private pickTheme;
    private weightedTerrain;
    private fabricateTerritory;
    private weightedResource;
    private bidirConnect;
    private computeNeighborsFor;
    private refreshFrontier;
    private ensureNeighborsSane;
    createEmptyWorld(worldSeed: number, themes?: ThemeDefinition[]): MapWorldState;
    generateInitialWorld(params: InitialWorldParams): {
        world: MapWorldState;
        playerCapitals: Map<FactionId, TerritoryId>;
        visibility: Map<FactionId, PlayerVisibilityMap>;
    };
    expandFromFrontier(req: ExpansionRequest): ExpansionResult;
    regionFor(world: MapWorldState, tid: TerritoryId): RegionId | null;
    regionForObj(world: MapWorldState, tid: TerritoryId): Region | null;
    themeFor(world: MapWorldState, tid: TerritoryId): ThemeId | null;
    revealNeighbors(world: MapWorldState, tid: TerritoryId, visibility: PlayerVisibilityMap, range?: number, revealedBy?: 'control' | 'scout' | 'diplomacy' | 'event'): {
        newly: TerritoryId[];
        advanced: TerritoryId[];
    };
    recomputeVisibilityFor(world: MapWorldState, faction: FactionId, visibility: PlayerVisibilityMap): void;
    createVisibilityMapFor(world: MapWorldState, faction: FactionId): PlayerVisibilityMap;
    revealTerritories(world: MapWorldState, origin: TerritoryId, range: number, visibility: PlayerVisibilityMap, revealedBy?: 'scout' | 'diplomacy' | 'event'): ScoutResult;
    generateReport(world: MapWorldState, capitals?: Map<FactionId, TerritoryId>): MapGenerationReport;
    renderWorldText(world: MapWorldState, visibility?: PlayerVisibilityMap, faction?: FactionId): string;
    renderTerritoryTable(world: MapWorldState, visibility?: PlayerVisibilityMap): string;
    validateWorld(world: MapWorldState): {
        noIsolated: boolean;
        allBidirectional: boolean;
        allInRegions: boolean;
        noDuplicateNames: boolean;
        summary: string;
    };
    toTerritorySpecs(world: MapWorldState): Array<{
        id: string;
        name: string;
        terrain: Territory['terrain'];
        neighbors: string[];
        population: number;
        baseValue: number;
        resourceOutput: Partial<Territory['resourceOutput']>;
        fortification: number;
        garrison: number;
        isCapital: boolean;
        owner: string | null;
    }>;
    collectFactionTerritoryIds(world: MapWorldState, factionId: FactionId): TerritoryId[];
    collectAdjacentFrontiers(world: MapWorldState, factionId: FactionId): TerritoryId[];
}
