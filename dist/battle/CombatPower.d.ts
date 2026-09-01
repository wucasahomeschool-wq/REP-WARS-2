export interface ArmyLike {
    soldiers: number;
    knights: number;
    siegeEngines?: number;
    morale?: number;
    supply?: number;
}
export interface TerritoryLike {
    terrain: string;
    fortification?: number;
    isCapital?: boolean;
}
export interface UnitBreakdown {
    soldiers: number;
    knights: number;
    siegeEngines: number;
    garrison?: number;
}
export interface CombatPowerBreakdown {
    rawTroops: number;
    quality: number;
    morale: number;
    moraleLabel: string;
    defenseBonus: number;
    defenseLabel: string;
    effectivePower: number;
    unitContribution: {
        soldiers: number;
        knights: number;
        siegeEngines: number;
        garrison?: number;
    };
}
export declare function labelForMoraleMultiplier(m: number): string;
export declare function labelForDefenseBonus(d: number): string;
export declare function sumUnits(armies: ArmyLike[], garrison?: number): UnitBreakdown;
export declare function averageMorale(armies: ArmyLike[], garrisonFallback?: number): number;
export declare function morale0_100ToMultiplier(morale0_100: number): number;
export declare function computeRawUnitPower(units: UnitBreakdown): {
    total: number;
    breakdown: {
        soldiers: number;
        knights: number;
        siegeEngines: number;
        garrison?: number;
    };
};
export declare function terrainAndFortToDefenseBonus(territory: TerritoryLike): number;
export declare function computeAttackerPower(armies: ArmyLike[], quality?: number): CombatPowerBreakdown;
export declare function computeDefenderPower(armies: ArmyLike[], garrison: number, territory: TerritoryLike, quality?: number): CombatPowerBreakdown;
export declare function computeWinProbability(attackerPower: number, defenderPower: number): number;
export declare function computeCasualtyRates(winnerPower: number, loserPower: number, rng: {
    next: () => number;
}): {
    winnerRate: number;
    loserRate: number;
};
export declare function computeMilitaryAdvantageRatio(attackerArmies: ArmyLike[], defenderArmies: ArmyLike[], defenderGarrison: number, defenderTerritory: TerritoryLike): {
    ratio: number;
    risk: number;
    advantageScore: number;
};
