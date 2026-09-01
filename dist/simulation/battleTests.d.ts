import { BattleInput, BattleResult } from '../battle/BattleEngine';
export interface LabParams {
    attackerTroops: number;
    attackerKnights?: number;
    attackerSiege?: number;
    attackerQuality: number;
    attackerMorale: number;
    defenderTroops: number;
    defenderKnights?: number;
    defenderSiege?: number;
    defenderGarrison?: number;
    defenderQuality: number;
    defenderMorale: number;
    terrain: string;
    fortification?: number;
    isCapital?: boolean;
    defenseBonusOverride?: number;
}
export interface BatchStats {
    runs: number;
    attackerWins: number;
    defenderWins: number;
    draws: number;
    attackerWinRate: number;
    defenderWinRate: number;
    drawRate: number;
    avgAttackerCasualties: number;
    avgDefenderCasualties: number;
    avgAttackerCasRate: number;
    avgDefenderCasRate: number;
    avgRemainingAttacker: number;
    avgRemainingDefender: number;
    outcomes: Record<string, number>;
}
export interface ScenarioReport {
    scenarioName: string;
    result: BattleResult;
    formatted: string;
}
export declare function buildLabInput(params: LabParams, seed?: number): BattleInput;
export declare function runBattleLabSingle(params: LabParams, seed?: number): {
    result: BattleResult;
    formatted: string;
};
export declare function runBattleLabBatch(params: LabParams, runs?: number, seedBase?: number): BatchStats;
export declare function formatBatchStats(label: string, stats: BatchStats): string;
export declare function runBattleTestSuite(opts?: {
    seed?: number;
    verbose?: boolean;
}): ScenarioReport[];
export declare function runSeededReproducibilityTest(): {
    same: boolean;
    result1: BattleResult;
    result2: BattleResult;
    diffSeedResult: BattleResult;
};
export declare function runStatisticalSample(inputFactory: (seed: number) => BattleInput, runs?: number): {
    outcomes: Record<string, number>;
    attackerWins: number;
    defenderWins: number;
    draws: number;
    avgAtkCas: number;
    avgDefCas: number;
    sampleCount: number;
};
export declare function formatTestSuite(reports: ScenarioReport[]): string;
