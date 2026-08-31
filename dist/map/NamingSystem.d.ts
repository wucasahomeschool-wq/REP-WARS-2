import { ThemeDefinition } from '../types';
export declare class NamingSystem {
    private usedNames;
    private rng;
    constructor(seed: number);
    reset(): void;
    private pick;
    private weightedFormat;
    generateTerritoryName(theme: ThemeDefinition, opts?: {
        isCapital?: boolean;
        disambiguationAttempt?: number;
    }): string;
    generateRegionName(theme: ThemeDefinition, additionalRoots?: string[], seedSalt?: number): string;
    generateCapitalName(theme: ThemeDefinition): string;
}
