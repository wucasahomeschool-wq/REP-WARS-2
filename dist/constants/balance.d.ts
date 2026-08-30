export declare const BALANCE: {
    readonly scoring: {
        readonly baseScores: {
            readonly ATTACK: 40;
            readonly DEFEND: 30;
            readonly REINFORCE: 25;
            readonly EXPAND: 35;
            readonly SCOUT: 15;
            readonly BUILD: 20;
            readonly MOVE: 10;
            readonly NEGOTIATE: 20;
            readonly OFFER_PEACE: 25;
            readonly DECLARE_WAR: 30;
            readonly TRADE: 20;
            readonly RETREAT: 15;
            readonly WAIT: 5;
        };
        readonly maxFactorWeight: 30;
        readonly randomnessRange: 0.15;
        readonly tiebreakerRandomness: 0.05;
        readonly minReasonableScore: -100;
        readonly maxScore: 200;
    };
    readonly military: {
        readonly advantageMultiplier: 1.5;
        readonly defenderFortificationBonus: 0.3;
        readonly defenderTerrainBonus: {
            readonly plains: 0;
            readonly forest: 0.1;
            readonly coastal: 0.05;
            readonly river: 0.15;
            readonly mountain: 0.25;
            readonly desert: -0.05;
            readonly fortress: 0.4;
        };
        readonly moraleModifier: 0.005;
        readonly supplyModifier: 0.003;
        readonly siegeValue: 2.5;
        readonly knightValue: 3;
        readonly soldierValue: 1;
        readonly armyToGarrisonRatio: 1.5;
        readonly criticalThreatRatio: 1.8;
        readonly moderateThreatRatio: 1.3;
    };
    readonly territory: {
        readonly baseValueWeight: 1;
        readonly resourceValueWeight: 1.2;
        readonly strategicPositionWeight: 1.5;
        readonly chokepointBonus: 25;
        readonly capitalBonus: 50;
        readonly capitalThreatMultiplier: 2.5;
        readonly borderTerritoryBonus: 10;
        readonly populationValuePerThousand: 2;
        readonly fortificationCostPerLevel: {
            readonly gold: 100;
            readonly stone: 50;
            readonly iron: 20;
        };
    };
    readonly diplomacy: {
        readonly opinionRange: 100;
        readonly opinionAttackImpact: -40;
        readonly opinionTerritoryLossImpact: -25;
        readonly opinionTreatyBreakImpact: -50;
        readonly opinionTradeImpact: 5;
        readonly opinionAllianceImpact: 30;
        readonly treatyHonorBonus: 8;
        readonly trustDecayPerTurn: 0.5;
        readonly allianceValue: 30;
        readonly nonAggressionValue: 15;
        readonly tradeAgreementValue: 10;
        readonly warDeclarationOpinionHit: -30;
        readonly peaceOfferReciprocity: 0.7;
    };
    readonly economy: {
        readonly goldWeight: 1;
        readonly foodWeight: 0.8;
        readonly ironWeight: 1.2;
        readonly woodWeight: 0.6;
        readonly stoneWeight: 0.5;
        readonly resourceScarcityMultiplier: 1.5;
        readonly buildEconomyThreshold: 0.3;
        readonly tradeSurplusThreshold: 0.5;
        readonly reinforcementCostPerSoldier: {
            readonly gold: 5;
            readonly food: 3;
        };
    };
    readonly personality: {
        readonly modifierRange: 2;
        readonly extremePersonalityBonus: 1.5;
        readonly riskPenaltyMultiplier: 10;
    };
    readonly memory: {
        readonly recentEventWeight: 1;
        readonly eventDecayHalfLifeTurns: 15;
        readonly maxMemoryEntriesPerFaction: 20;
        readonly revengeBaseModifier: 0.4;
        readonly trustworthinessImpact: 0.6;
    };
    readonly goals: {
        readonly maxActiveGoals: 5;
        readonly highPriorityThreshold: 80;
        readonly mediumPriorityThreshold: 40;
        readonly goalAlignmentBonus: 20;
        readonly goalMisalignmentPenalty: 15;
        readonly progressBonusFactor: 0.3;
    };
    readonly risk: {
        readonly unacceptableRisk: 0.7;
        readonly highRisk: 0.5;
        readonly moderateRisk: 0.3;
        readonly lowRisk: 0.15;
        readonly riskPenaltyBase: 15;
    };
    readonly simulate: {
        readonly defaultTurns: 30;
        readonly defaultSeed: 42;
        readonly warlordDecisionDelayMs: 0;
    };
};
export declare const ACTION_NAMES: Record<string, string>;
export declare const PERSONALITY_NAMES: Record<string, string>;
export declare const TERRAIN_NAMES: Record<string, string>;
