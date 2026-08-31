import { BattleInput, BattleResult } from '../types';
export interface BattleTestReport {
    scenarioName: string;
    result: BattleResult;
    formatted: string;
}
export declare function runBattleTestSuite(opts?: {
    seed?: number;
    verbose?: boolean;
}): BattleTestReport[];
export declare function runSeededReproducibilityTest(): {
    same: boolean;
    result1: BattleResult;
    result2: BattleResult;
    diffSeedResult: BattleResult;
};
export interface DistributionRun {
    outcomes: Record<string, number>;
    attackerWins: number;
    defenderWins: number;
    draws: number;
    avgAtkCas: number;
    avgDefCas: number;
    sampleCount: number;
}
export declare function runStatisticalSample(inputFactory: (s: number) => BattleInput, runs?: number): DistributionRun;
export declare function formatTestSuite(reports: BattleTestReport[]): string;
