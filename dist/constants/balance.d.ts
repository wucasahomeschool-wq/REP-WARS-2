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
            readonly hills: 0.12;
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
    readonly combat: {
        readonly baseStrength: {
            readonly soldier: 1;
            readonly knight: 4;
            readonly siegeEngine: 6;
            readonly garrison: 0.85;
        };
        readonly numericalAdvantage: {
            readonly scalingExponent: 0.85;
            readonly maxRatioAdvantage: 2.5;
            readonly minRatio: 0.25;
        };
        readonly terrain: {
            readonly attackerModifier: {
                readonly plains: 1;
                readonly mountain: 0.75;
                readonly forest: 0.88;
                readonly coastal: 0.95;
                readonly desert: 0.97;
                readonly river: 0.82;
                readonly fortress: 0.8;
                readonly hills: 0.92;
            };
            readonly defenderModifier: {
                readonly plains: 1.05;
                readonly mountain: 1.5;
                readonly forest: 1.2;
                readonly coastal: 1.08;
                readonly desert: 1;
                readonly river: 1.3;
                readonly fortress: 1.15;
                readonly hills: 1.28;
            };
            readonly attackerSiegePenaltyPerMountainLevel: 0.05;
            readonly defenderRiverCrossingBonus: 1.18;
        };
        readonly fortification: {
            readonly perLevelStrengthBonus: 0.12;
            readonly perLevelCasualtyReduction: 0.05;
            readonly perLevelSiegeNeed: 2;
            readonly maxLevel: 5;
            readonly capitalBonus: 1.3;
            readonly structureNames: {
                readonly '0': "Undefended";
                readonly '1': "Outpost";
                readonly '2': "Palisade Wall";
                readonly '3': "Stone Walls";
                readonly '4': "Castle";
                readonly '5': "Citadel / Fortress";
            };
        };
        readonly morale: {
            readonly highMoraleBonusPer10: 0.03;
            readonly lowMoralePenaltyPer10: 0.05;
            readonly rallyChancePerPositiveMorale: 0.002;
            readonly routeThreshold: 25;
        };
        readonly supply: {
            readonly lowSupplyPenaltyPer10: 0.02;
            readonly criticalSupplyThreshold: 20;
        };
        readonly siege: {
            readonly engineVsFortificationMultiplier: 1;
            readonly noSiegeFortressMalus: 0.45;
            readonly minSiegeNeededForFortress: 3;
        };
        readonly unitType: {
            readonly knightVsInfantryOpenTerrainBonus: 1.3;
            readonly knightVsInfantryDenseTerrainMalus: 0.8;
            readonly siegeOnlyUsefulAttack: true;
            readonly garrisonBonusWhenDefending: 1.25;
        };
        readonly randomness: {
            readonly range: 0.18;
            readonly perPhaseRange: 0.08;
            readonly seedSaltBase: 982451653;
        };
        readonly casualties: {
            readonly baseRate: 0.18;
            readonly intensityMultiplier: 1.4;
            readonly winnerCasualtyMultiplier: 0.65;
            readonly loserCasualtyMultiplier: 1.25;
            readonly closeBattleExtraCasualties: 0.1;
            readonly routCasualtyMultiplier: 1.9;
            readonly fortificationDefenderCasualtyReduction: 0.06;
            readonly minCasualtyRate: 0.03;
            readonly maxCasualtyRate: 0.95;
            readonly decisiveWinnerSurplusPct: 0.75;
        };
        readonly retreat: {
            readonly baseSurvivalRate: 0.55;
            readonly perMoraleSurvival: 0.003;
            readonly cavalryBoostRetreat: 0.15;
            readonly fortressGarrisonRetreatSurvival: 0.85;
            readonly enemyCloseRetreatMalus: 0.2;
            readonly criticalRetreatThreshold: 0.4;
        };
        readonly victory: {
            readonly decisiveRatioThreshold: 1.7;
            readonly narrowRatioThreshold: 1.1;
            readonly pyrrhicWinnerCasualtyRate: 0.33;
            readonly stalemateMaxRatio: 1.05;
            readonly stalemateMaxMargin: 0.03;
            readonly mutualLossThreshold: 0.45;
            readonly captureRequiredAdvantage: 1.15;
            readonly captureCapitalRequirement: 1.4;
        };
        readonly phases: {
            readonly count: 3;
            readonly names: readonly ["Skirmish Phase", "Main Assault", "Final Clash"];
            readonly weights: readonly [0.25, 0.45, 0.3];
        };
        readonly battleEvents: {
            readonly flankChance: 0.12;
            readonly ambushChance: 0.08;
            readonly breachChancePerSiege: 0.06;
            readonly rallyChance: 0.1;
            readonly heroicStandChance: 0.07;
            readonly criticalHitChance: 0.1;
        };
    };
    readonly mapGen: {
        readonly initial: {
            readonly defaultSeed: 42;
            readonly defaultInitialTerritories: 18;
            readonly defaultInitialRegions: 4;
            readonly defaultStartingTerritoriesPerFaction: 3;
            readonly defaultMinCapitalsDistance: 4;
            readonly defaultFrontierSlotsBuffer: 2;
            readonly maxStartSearchAttempts: 50;
        };
        readonly territory: {
            readonly minNeighbors: 2;
            readonly maxNeighbors: 6;
            readonly avgNeighbors: 3.6;
            readonly neighborConnectJitter: 0.35;
            readonly fortificationCapitalDefault: 4;
            readonly fortificationStartDefault: 1;
            readonly garrisonCapitalBase: 500;
            readonly garrisonStartBase: 180;
            readonly garrisonNeutralBase: 80;
            readonly capitalBaseValueMin: 50;
            readonly capitalBaseValueMax: 75;
            readonly resourceDensityRoll: 0.55;
            readonly minResourcesPerTerritory: 1;
            readonly maxResourcesPerTerritory: 3;
            readonly populationScaleByValue: 500;
            readonly populationJitter: 0.25;
            readonly strategicChokepointBonus: 0.3;
        };
        readonly growth: {
            readonly expansionDefaultTerritories: 4;
            readonly expansionMin: 1;
            readonly expansionMax: 8;
            readonly newRegionEveryNTerritories: 5;
            readonly regionTargetSize: {
                readonly min: 3;
                readonly max: 8;
                readonly ideal: 5;
            };
            readonly frontierConnectionRetries: 12;
            readonly overlapPreventionRadius: 1;
            readonly minConnectsToExisting: 1;
            readonly idealConnectsToExisting: 2;
            readonly crossNeighborChance: 0.35;
        };
        readonly themes: {
            readonly defaultRarity: 1;
            readonly rarityWeightingExponent: 1.2;
            readonly sameThemeBiasWhenAdjacent: 2.5;
            readonly transitionSmoothingFactor: 0.4;
            readonly coastalBiasPlacementBoost: 1.8;
            readonly regionThemePersistence: 0.7;
        };
        readonly naming: {
            readonly disambiguationSalt: 1000;
            readonly nameRetriesUntilUnique: 30;
            readonly capitalSuffixBias: 1.5;
        };
        readonly fogOfWar: {
            readonly defaultRevealRangeFromControl: 1;
            readonly scoutedDecayTurns: 8;
            readonly discoveredNeverForgets: true;
            readonly revealOnConquestRange: 1;
        };
        readonly graph: {
            readonly hexGridPerturbation: 0.45;
            readonly ringPlacementVariance: 0.3;
            readonly neighborDistanceThreshold: 1.9;
            readonly diagonalNeighborThreshold: 1.45;
            readonly minDistanceBetweenCapitals: 3;
        };
        readonly resources: {
            readonly goldBaseWeight: 1;
            readonly foodBaseWeight: 1.4;
            readonly ironBaseWeight: 0.8;
            readonly woodBaseWeight: 1.1;
            readonly stoneBaseWeight: 0.7;
            readonly perResourceJitter: 0.35;
            readonly terrainResourceBoostFactor: 2.2;
        };
    };
};
export declare const ACTION_NAMES: Record<string, string>;
export declare const PERSONALITY_NAMES: Record<string, string>;
export declare const TERRAIN_NAMES: Record<string, string>;
