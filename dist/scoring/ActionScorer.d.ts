import { ActionContext, Army, DiplomaticRelationship, FactionId, Resources, ScoredAction, Territory, WarlordSnapshot } from '../types';
import { MemorySystem } from '../memory/MemorySystem';
import { GoalSystem } from '../goals/GoalSystem';
import { SeededRNG } from '../utils/SeededRNG';
export declare class ScoringHelpers {
    static computeArmyPower(army: Army): number;
    static computeTotalMilitaryPower(myArmies: Army[], myTerritories: Territory[]): number;
    static computeTerritoryMilitaryDefense(t: Territory, garrisonOnly?: boolean): number;
    static estimateMilitaryAdvantage(attackerArmies: Army[], defenderTerritory: Territory, _allArmies: Map<string, Army>): {
        advantage: number;
        ratio: number;
        risk: number;
    };
    static evaluateTerritoryValue(t: Territory): number;
    static evaluateThreat(targetFaction: WarlordSnapshot, self: WarlordSnapshot, myTerritories: Territory[], allTerritories: Map<string, Territory>): number;
    static getRelationship(self: WarlordSnapshot, targetId: FactionId): DiplomaticRelationship | null;
    static evaluateRelationshipModifier(rel: DiplomaticRelationship | null): number;
    static evaluateResourceNeed(resources: Resources, income: Partial<Resources>): {
        scarcity: Record<string, number>;
        overallNeed: number;
    };
    static computeAverageTerritoryValue(territories: Territory[]): number;
}
export interface ScorerInput {
    ctx: ActionContext;
    turn: number;
    rng: SeededRNG;
    memory: MemorySystem;
    goals: GoalSystem;
}
export declare class ActionScorer {
    scoreAllActions(input: ScorerInput): ScoredAction[];
    private scoreAction;
    private baseScored;
    private scoreAttack;
    private scoreDefend;
    private scoreReinforce;
    private scoreExpand;
    private scoreScout;
    private scoreBuild;
    private scoreMove;
    private scoreNegotiate;
    private scoreOfferPeace;
    private scoreDeclareWar;
    private scoreTrade;
    private scoreRetreat;
    private scoreWait;
}
