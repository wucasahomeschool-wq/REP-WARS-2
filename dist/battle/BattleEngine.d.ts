import { BattleInput, BattleResult } from '../types';
export interface BattleValidation {
    valid: boolean;
    errors: string[];
}
export declare class BattleEngine {
    validate(input: BattleInput): BattleValidation;
    resolve(input: BattleInput): BattleResult;
    private sumArmies;
    private calculateBaseStrength;
    private calculateEffectiveStrength;
    private rollPhaseEvents;
    private describePhase;
    private computeCasualties;
    private computeMoraleChange;
    private buildSummary;
    private buildReadableLog;
    private formatSideBreakdown;
    private describeOutcomeHeadline;
    formatResult(result: BattleResult, includeBreakdown?: boolean): string;
}
