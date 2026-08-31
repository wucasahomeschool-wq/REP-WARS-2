import { StrategicGoal, GoalType, FactionId, TerritoryId, ResourceType, WarlordSnapshot, Territory } from '../types';
export interface GoalAlignmentResult {
    alignedGoals: StrategicGoal[];
    misalignedGoals: StrategicGoal[];
    scoreContribution: number;
    relevantGoals: {
        goal: StrategicGoal;
        alignment: 'aligned' | 'misaligned' | 'neutral';
    }[];
}
export declare class GoalSystem {
    private goals;
    private nextId;
    constructor(initialGoals?: StrategicGoal[]);
    addGoal(params: {
        type: GoalType;
        priority: number;
        targetFaction?: FactionId | null;
        targetTerritory?: TerritoryId | null;
        targetRegion?: string | null;
        targetResource?: ResourceType | null;
        progress?: number;
        targetProgress?: number;
        deadlineTurn?: number | null;
        createdTurn: number;
    }): StrategicGoal;
    getActiveGoals(currentTurn: number): StrategicGoal[];
    getAllGoals(): StrategicGoal[];
    updateProgress(goalId: string, delta: number): boolean;
    removeGoal(goalId: string): boolean;
    evaluateActionAlignment(params: {
        actionType: string;
        targetFaction?: FactionId | null;
        targetTerritory?: TerritoryId | null;
        self: WarlordSnapshot;
        currentTurn: number;
        allTerritories: Map<TerritoryId, Territory>;
    }): GoalAlignmentResult;
    private checkAlignment;
    static generateInitialGoals(personalityType: string, factionId: FactionId, currentTurn: number, rng: {
        nextInt: (min: number, max: number) => number;
        next: () => number;
    }): StrategicGoal[];
    private trimGoals;
}
