import { ArmyLike, CombatPowerBreakdown, TerritoryLike, UnitBreakdown } from './CombatPower';
export interface BattleInput {
    turn: number;
    seed: number;
    battleId?: string;
    attackerFactionId: string;
    attackerFactionName?: string;
    defenderFactionId: string;
    defenderFactionName?: string;
    attackerArmies: ArmyLike[];
    defenderArmies?: ArmyLike[];
    defenderGarrison?: number;
    territory: TerritoryLike & {
        id: string;
        name: string;
        owner?: string | null;
        fortification: number;
        isCapital?: boolean;
        garrison?: number;
    };
    attackerAggression?: number;
    defenderDefensiveness?: number;
    strategicAttackerBonus?: number;
    strategicDefenderBonus?: number;
    additionalAttackerModifiers?: number;
    additionalDefenderModifiers?: number;
    attackerQuality?: number;
    defenderQuality?: number;
}
export interface CasualtyBreakdown {
    soldiers: number;
    knights: number;
    siegeEngines: number;
    garrison?: number;
    total: number;
    casualtyRate: number;
}
export interface BattleSideBreakdown {
    side: 'attacker' | 'defender';
    factionId: string;
    factionName: string;
    power: CombatPowerBreakdown;
    effectivePower: number;
    unitBreakdown: UnitBreakdown;
    initialTroops: number;
    remainingTroops: number;
    remaining: UnitBreakdown;
    casualties: CasualtyBreakdown;
    moraleChange: number;
    routed: boolean;
    retreated: boolean;
    retreatSurvivorsPct?: number;
}
export interface BattleResult {
    battleId: string;
    turn: number;
    territoryId: string;
    territoryName: string;
    seedUsed: number;
    winner: 'attacker' | 'defender' | 'draw';
    loser: 'attacker' | 'defender' | 'draw';
    outcomeType: 'attacker_decisive_victory' | 'attacker_narrow_victory' | 'attacker_pyrrhic_victory' | 'defender_decisive_victory' | 'defender_narrow_victory' | 'defender_pyrrhic_victory' | 'mutual_heavy_losses' | 'stalemate';
    attackerWinProbability: number;
    randomRoll: number;
    effectivePowerRatio: number;
    battleIntensity: number;
    attacker: BattleSideBreakdown;
    defender: BattleSideBreakdown;
    territoryOutcome: 'unchanged' | 'captured' | 'contested' | 'retreat_required' | 'surrendered';
    defenderSurrendered: boolean;
    events: BattleEvent[];
    battlePhases: {
        name: string;
        description: string;
        attackerAdvantage: number;
    }[];
    effectiveRatio: number;
    marginOfVictory: number;
    summary: string;
    readableLog: string[];
    calculation: BattleCalculation;
}
export interface BattleCalculation {
    attacker: {
        rawTroops: number;
        quality: number;
        morale: number;
        moraleLabel: string;
        effectivePower: number;
    };
    defender: {
        rawTroops: number;
        quality: number;
        morale: number;
        moraleLabel: string;
        defenseBonus: number;
        defenseLabel: string;
        effectivePower: number;
    };
    powerRatio: number;
    attackerWinProbability: number;
    randomRoll: number;
    winner: 'attacker' | 'defender';
    attackerCasualties: {
        count: number;
        rate: number;
    };
    defenderCasualties: {
        count: number;
        rate: number;
    };
    attackerRemaining: number;
    defenderRemaining: number;
}
export interface BattleEvent {
    id: string;
    turn: number;
    phase: string;
    type: string;
    side: 'attacker' | 'defender' | 'both';
    message: string;
    impact: number;
}
export interface BattleValidation {
    valid: boolean;
    errors: string[];
}
export declare class BattleEngine {
    validate(input: BattleInput): BattleValidation;
    resolve(input: BattleInput): BattleResult;
    formatResult(result: BattleResult, includeBreakdown?: boolean): string;
    private buildSummary;
    private buildReadableLog;
}
