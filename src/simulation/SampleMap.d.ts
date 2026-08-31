import { Territory, GameStateSnapshot, RelationshipState, PersonalityType, Resources } from '../types';
import { WarlordState } from '../engine/DecisionEngine';
export interface MapTerritorySpec {
    id: string;
    name: string;
    terrain: Territory['terrain'];
    neighbors: string[];
    population: number;
    baseValue: number;
    resourceOutput: Partial<Resources>;
    fortification: number;
    garrison: number;
    isCapital: boolean;
    owner: string | null;
}
export interface WarlordSpec {
    id: string;
    name: string;
    personality: PersonalityType;
    personalityVariant: number;
    startingTerritories: string[];
    startingArmy: {
        soldiers: number;
        knights: number;
        siege: number;
    };
    startingResources: Resources;
    startingIncome: Partial<Resources>;
    relationships: {
        target: string;
        state: RelationshipState;
        opinion: number;
    }[];
}
export declare const SAMPLE_MAP: MapTerritorySpec[];
export declare const WARLORD_SPECS: WarlordSpec[];
export declare class SimulationBuilder {
    static buildFromSpecs(mapSpecs: MapTerritorySpec[], warlordSpecs: WarlordSpec[], seed?: number): {
        gameState: GameStateSnapshot;
        warlordStates: Map<string, WarlordState>;
    };
}
