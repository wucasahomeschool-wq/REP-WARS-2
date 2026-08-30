import { Personality, PersonalityType, ActionType } from '../types';
export declare class PersonalitySystem {
    static createPreset(type: PersonalityType): Personality;
    static randomizePreset(base: PersonalityType, variance: number | undefined, rng: {
        next: () => number;
    }): Personality;
    static getActionBias(action: ActionType, personality: Personality): number;
    static getRiskModifier(personality: Personality, estimatedRisk: number): number;
    static getRevengeModifier(personality: Personality, historicalGrievances: number): number;
    static getDiplomaticTrustModifier(personality: Personality, targetTrustworthiness: number): number;
    static describePersonality(p: Personality): string[];
}
