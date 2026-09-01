export declare const BALANCE: {
    scoring: {
        baseScores: {
            ATTACK: number;
            DEFEND: number;
            REINFORCE: number;
            EXPAND: number;
            SCOUT: number;
            BUILD: number;
            MOVE: number;
            NEGOTIATE: number;
            OFFER_PEACE: number;
            DECLARE_WAR: number;
            TRADE: number;
            RETREAT: number;
            WAIT: number;
        };
        maxFactorWeight: number;
        randomnessRange: number;
        tiebreakerRandomness: number;
        minReasonableScore: number;
        maxScore: number;
    };
    military: {
        advantageMultiplier: number;
        defenderFortificationBonus: number;
        defenderTerrainBonus: Record<string, number>;
        moraleModifier: number;
        supplyModifier: number;
        siegeValue: number;
        knightValue: number;
        soldierValue: number;
        armyToGarrisonRatio: number;
        criticalThreatRatio: number;
        moderateThreatRatio: number;
    };
    territory: {
        baseValueWeight: number;
        resourceValueWeight: number;
        strategicPositionWeight: number;
        chokepointBonus: number;
        capitalBonus: number;
        capitalThreatMultiplier: number;
        borderTerritoryBonus: number;
        populationValuePerThousand: number;
        fortificationCostPerLevel: {
            gold: number;
            stone: number;
            iron: number;
        };
    };
    diplomacy: {
        opinionRange: number;
        opinionAttackImpact: number;
        opinionTerritoryLossImpact: number;
        opinionTreatyBreakImpact: number;
        opinionTradeImpact: number;
        opinionAllianceImpact: number;
        treatyHonorBonus: number;
        trustDecayPerTurn: number;
        allianceValue: number;
        nonAggressionValue: number;
        tradeAgreementValue: number;
        warDeclarationOpinionHit: number;
        peaceOfferReciprocity: number;
    };
    economy: {
        goldWeight: number;
        foodWeight: number;
        ironWeight: number;
        woodWeight: number;
        stoneWeight: number;
        resourceScarcityMultiplier: number;
        buildEconomyThreshold: number;
        tradeSurplusThreshold: number;
        reinforcementCostPerSoldier: {
            gold: number;
            food: number;
        };
    };
    personality: {
        modifierRange: number;
        extremePersonalityBonus: number;
        riskPenaltyMultiplier: number;
    };
    memory: {
        recentEventWeight: number;
        eventDecayHalfLifeTurns: number;
        maxMemoryEntriesPerFaction: number;
        revengeBaseModifier: number;
        trustworthinessImpact: number;
    };
    goals: {
        maxActiveGoals: number;
        highPriorityThreshold: number;
        mediumPriorityThreshold: number;
        goalAlignmentBonus: number;
        goalMisalignmentPenalty: number;
        progressBonusFactor: number;
    };
    risk: {
        unacceptableRisk: number;
        highRisk: number;
        moderateRisk: number;
        lowRisk: number;
        riskPenaltyBase: number;
    };
    simulate: {
        defaultTurns: number;
        defaultSeed: number;
        warlordDecisionDelayMs: number;
    };
    combat: {
        unitStrength: {
            soldier: number;
            knight: number;
            siegeEngine: number;
            garrison: number;
        };
        morale: {
            broken: number;
            low: number;
            normal: number;
            high: number;
            excellent: number;
        };
        defenseBonus: {
            openGround: number;
            favorableTerrain: number;
            strongTerrain: number;
            fortified: number;
        };
        terrainToDefenseBonus: Record<string, number>;
        fortificationPerLevelBonus: number;
        capitalBonus: number;
        qualityDefault: number;
        moraleToMultiplier(morale0_100: number): number;
        casualties: {
            winnerBaseRate: number;
            loserBaseRate: number;
            winnerDominanceScale: number;
            loserDominanceScale: number;
            winnerMinRate: number;
            winnerMaxRate: number;
            loserMinRate: number;
            loserMaxRate: number;
            closeBattleExtraWinner: number;
            closeBattleExtraLoser: number;
            closeBattleThreshold: number;
            randomJitter: number;
        };
        randomness: {
            seedSaltBase: number;
            upsetRange: number;
        };
        victory: {
            narrowWinnerMaxAdvantage: number;
            decisiveWinnerMinAdvantage: number;
            pyrrhicWinnerCasualtyThreshold: number;
            captureRequiredWinnerAdvantage: number;
            captureCapitalRequiredWinnerAdvantage: number;
            captureMinAttackerRemainingRatio: number;
        };
        retreat: {
            baseSurvivalRate: number;
            perMoraleSurvival: number;
            cavalryBoostRetreat: number;
            fortressGarrisonRetreatSurvival: number;
        };
        moraleDelta: {
            narrowWin: number;
            normalWin: number;
            decisiveWin: number;
            pyrrhicWin: number;
            narrowLoss: number;
            normalLoss: number;
            decisiveLoss: number;
            pyrrhicLoss: number;
            draw: number;
        };
    };
    mapGen: {
        initial: {
            defaultSeed: number;
            defaultInitialTerritories: number;
            defaultInitialRegions: number;
            defaultStartingTerritoriesPerFaction: number;
            defaultMinCapitalsDistance: number;
            defaultFrontierSlotsBuffer: number;
            maxStartSearchAttempts: number;
        };
        territory: {
            minNeighbors: number;
            maxNeighbors: number;
            avgNeighbors: number;
            neighborConnectJitter: number;
            fortificationCapitalDefault: number;
            fortificationStartDefault: number;
            garrisonCapitalBase: number;
            garrisonStartBase: number;
            garrisonNeutralBase: number;
            capitalBaseValueMin: number;
            capitalBaseValueMax: number;
            resourceDensityRoll: number;
            minResourcesPerTerritory: number;
            maxResourcesPerTerritory: number;
            populationScaleByValue: number;
            populationJitter: number;
            strategicChokepointBonus: number;
        };
        growth: {
            expansionDefaultTerritories: number;
            expansionMin: number;
            expansionMax: number;
            newRegionEveryNTerritories: number;
            regionTargetSize: {
                min: number;
                max: number;
                ideal: number;
            };
            frontierConnectionRetries: number;
            overlapPreventionRadius: number;
            minConnectsToExisting: number;
            idealConnectsToExisting: number;
            crossNeighborChance: number;
        };
        themes: {
            defaultRarity: number;
            rarityWeightingExponent: number;
            sameThemeBiasWhenAdjacent: number;
            transitionSmoothingFactor: number;
            coastalBiasPlacementBoost: number;
            regionThemePersistence: number;
        };
        naming: {
            disambiguationSalt: number;
            nameRetriesUntilUnique: number;
            capitalSuffixBias: number;
        };
        fogOfWar: {
            defaultRevealRangeFromControl: number;
            scoutedDecayTurns: number;
            discoveredNeverForgets: boolean;
            revealOnConquestRange: number;
        };
        graph: {
            hexGridPerturbation: number;
            ringPlacementVariance: number;
            neighborDistanceThreshold: number;
            diagonalNeighborThreshold: number;
            minDistanceBetweenCapitals: number;
        };
        resources: {
            goldBaseWeight: number;
            foodBaseWeight: number;
            ironBaseWeight: number;
            woodBaseWeight: number;
            stoneBaseWeight: number;
            perResourceJitter: number;
            terrainResourceBoostFactor: number;
        };
    };
    events: {
        world: {
            maxEventsPerTurn: number;
            sameEventCooldownTurns: number;
            sameTerritoryMaxConcurrentActive: number;
            territoryChoiceMinPopulation: number;
            rngSalt: number;
        };
        severityWeights: Record<string, number>;
        severityConsequenceScales: Record<string, number>;
        defaultEventDuration: {
            min: number;
            max: number;
        };
        thresholds: {
            lowFactionStability: number;
            criticalFactionStability: number;
            lowTerritoryStability: number;
            criticalTerritoryStability: number;
            lowFoodRatio: number;
            criticalFoodRatio: number;
            lowPopulationForAgriculturalVulnerability: number;
            highTax: number;
            goodProsperityRatio: number;
            greatProsperityRatio: number;
            strongTradeAccessNeighbors: number;
            weakTradeAccessNeighbors: number;
            borderHostileNeighbors: number;
            desertionGarrisonLowMorale: number;
        };
        trigger: {
            drought: {
                baseWeight: number;
                plainsBoost: number;
                desertBoost: number;
            };
            flood: {
                baseWeight: number;
                riverBoost: number;
                coastalBoost: number;
            };
            storm: {
                baseWeight: number;
                coastalBoost: number;
            };
            harshWinter: {
                baseWeight: number;
                mountainBoost: number;
                hillsBoost: number;
            };
            resourceDiscovery: {
                baseWeight: number;
                noResourceTerritoryBoost: number;
            };
            foodShortage: {
                baseWeight: number;
                droughtActiveBoost: number;
                lowFoodReserveBoost: number;
            };
            famine: {
                baseWeight: number;
                foodShortageActiveBoost: number;
                criticalFoodBoost: number;
            };
            prosperity: {
                baseWeight: number;
                goodTradeBoost: number;
                stableBoost: number;
            };
            tradeBoom: {
                baseWeight: number;
                coastalBoost: number;
                manyNeighborsBoost: number;
            };
            unrest: {
                baseWeight: number;
                stabilityLowBoost: number;
                highTaxBoost: number;
                famineActiveBoost: number;
            };
            rebellion: {
                baseWeight: number;
                unrestActiveBoost: number;
                stabilityCriticalBoost: number;
            };
            borderTension: {
                baseWeight: number;
                hostileNeighborBoost: number;
            };
        };
        chain: {
            droughtToFoodShortageProb: number;
            droughtToFoodShortageDelayMin: number;
            foodShortageToFamineProb: number;
            foodShortageToFamineDelayMin: number;
            famineToUnrestProb: number;
            famineToUnrestDelayMin: number;
            unrestToRebellionProb: number;
            unrestToRebellionDelayMin: number;
        };
        consequenceMagnitudes: {
            droughtFoodProductionPctPerSeverity: number;
            droughtInfrastructurePctPerSeverity: number;
            floodPopulationPctPerSeverity: number;
            floodInfrastructurePctPerSeverity: number;
            floodFoodProductionPctPerSeverity: number;
            stormFoodProductionPctPerSeverity: number;
            stormGarrisonDeltaAbsPerSeverity: number;
            harshWinterStabilityDeltaPerSeverity: number;
            harshWinterFoodProductionPctPerSeverity: number;
            resourceDiscoveryGoldPerSeverity: number;
            resourceDiscoveryResourceBoostPct: number;
            foodShortageStabilityDeltaPerSeverity: number;
            foodShortagePopulationDeltaAbsPerSeverity: number;
            foodShortageMoraleDeltaArmy: number;
            famineStabilityDeltaPerSeverity: number;
            faminePopulationDeltaAbsPerSeverity: number;
            famineMoraleDeltaArmy: number;
            prosperityStabilityDeltaPerSeverity: number;
            prosperityResourceGainPerSeverity: {
                gold: number;
                food: number;
            };
            tradeBoomGoldPerSeverity: number;
            tradeBoomFoodPerSeverity: number;
            unrestStabilityDeltaPerSeverity: number;
            unrestGarrisonMoraleDelta: number;
            rebellionStabilityDeltaPerSeverity: number;
            rebellionGarrisonDeltaPerSeverity: number;
            borderTensionGarrisonMoraleDelta: number;
            borderTensionStabilityDelta: number;
        };
        choices: {
            importFoodCostGoldPerSeverity: Record<string, number>;
            importFoodStabilityRestore: number;
            emergencyReservesFoodCostPerSeverity: Record<string, number>;
            emergencyReservesStabilityRestore: number;
            reduceTaxesGoldPenaltyPerSeverity: Record<string, number>;
            reduceTaxesStabilityRestore: number;
            ignoreFamineStabilityPenaltyPerSeverity: Record<string, number>;
            ignoreFamineChainProbBoost: number;
            sendTroopsGarrisonCostPerSeverity: number;
            sendTroopsStabilityRestorePerSeverity: number;
        };
    };
};
export declare const ACTION_NAMES: {
    ATTACK: string;
    DEFEND: string;
    REINFORCE: string;
    EXPAND: string;
    SCOUT: string;
    BUILD: string;
    MOVE: string;
    NEGOTIATE: string;
    OFFER_PEACE: string;
    DECLARE_WAR: string;
    TRADE: string;
    RETREAT: string;
    WAIT: string;
};
export declare const PERSONALITY_NAMES: {
    defensive: string;
    aggressive: string;
    expansionist: string;
    opportunistic: string;
    diplomatic: string;
    economic: string;
};
export declare const TERRAIN_NAMES: Record<string, string>;
