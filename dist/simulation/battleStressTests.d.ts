import { LabParams, formatBatchStats, BatchStats } from './battleTests';
export interface RatioScenario {
    label: string;
    params: LabParams;
    expected?: {
        minAttackerWinRate?: number;
        maxAttackerWinRate?: number;
        maxAttackerCasRate?: number;
        minDefenderCasRate?: number;
    };
}
export interface PropertyCheckResult {
    name: string;
    passed: boolean;
    detail: string;
    violationValues?: {
        step: number;
        before: number;
        after: number;
    }[];
}
export declare const EXTREME_RATIO_SCENARIOS: RatioScenario[];
export declare const EQUAL_FORCE_SCENARIOS: RatioScenario[];
export declare const RATIO_SCENARIOS: RatioScenario[];
export interface StressReport {
    label: string;
    runs: number;
    stats: BatchStats;
    checksPassed: boolean;
    checks: {
        name: string;
        passed: boolean;
        actual: number;
        threshold: number;
        direction: 'gte' | 'lte';
    }[];
}
export declare function runStressScenario(scenario: RatioScenario, runs?: number, seedBase?: number): StressReport;
export declare function assertAttackerTroopMonotonicity(runsPerStep?: number, seedBase?: number): PropertyCheckResult;
export declare function assertAttackerMoraleMonotonicity(runsPerStep?: number, seedBase?: number): PropertyCheckResult;
export declare function assertDefenseBonusMonotonicity(runsPerStep?: number, seedBase?: number): PropertyCheckResult;
export declare function runFullStressSuite(runsPerScenario?: number): {
    extremeReports: StressReport[];
    equalReports: StressReport[];
    ratioReports: StressReport[];
    properties: PropertyCheckResult[];
    overallPass: boolean;
    summary: string;
};
export declare function formatStressCsvReport(suite: ReturnType<typeof runFullStressSuite>): string;
export { formatBatchStats };
