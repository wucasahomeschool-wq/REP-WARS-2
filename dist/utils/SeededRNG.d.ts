export declare class SeededRNG {
    private state;
    private originalSeed;
    constructor(seed: number);
    private mixSeed;
    next(): number;
    nextInt(min: number, max: number): number;
    nextFloat(min: number, max: number): number;
    pick<T>(arr: T[]): T;
    weightedPick<T>(items: {
        value: T;
        weight: number;
    }[]): T;
    chance(probability: number): boolean;
    shuffle<T>(arr: T[]): T[];
    reset(): SeededRNG;
    getSeed(): number;
    fork(extraSalt: number): SeededRNG;
    reseed(seed: number): void;
}
