/**
 * CANONICAL STATE TYPES — this file is the single authoritative home for
 * core Rep Wars game-state entities (Territory, Army, WarlordSnapshot,
 * Resources, diplomacy, map/world state, IDs, etc.). Engines import these
 * types rather than redeclaring their own copies of the same concept.
 *
 * Engine-specific input/output DTOs (e.g. `BattleEngine`'s `BattleInput` /
 * `BattleResult`, `WorldSimulator`'s `WorldStepInput` / `WorldStepOutput`)
 * intentionally live next to their engine, not here — they are shaped for
 * one engine's call boundary and are allowed to differ from the canonical
 * entities they are built from/apply back onto.
 *
 * See docs/CANONICAL_STATE_ARCHITECTURE.md for the full map of canonical
 * types vs. engine DTOs vs. deferred concepts, and for the forward-looking
 * (not yet wired up) `GameState` container type in `./GameState.ts`.
 */
export type FactionId = string;
export type TerritoryId = string;
export type ArmyId = string;
export type PersonalityType = 'defensive' | 'aggressive' | 'expansionist' | 'opportunistic' | 'diplomatic' | 'economic';
export type FortificationTier = 0 | 1 | 2 | 3 | 4 | 5;
export type BattleSide = 'attacker' | 'defender';
/**
 * `mutual_heavy_losses` was removed (BATTLE ENGINE CORRECTNESS PASS): the
 * resolver's if/else chain never actually produced it — every branch
 * resolves to a decisive/narrow/pyrrhic victory for one side, or
 * `stalemate`. It was dead vocabulary with no producer. See
 * docs/BATTLE_ENGINE_CORRECTNESS.md.
 */
export type BattleOutcomeType = 'attacker_decisive_victory' | 'attacker_narrow_victory' | 'attacker_pyrrhic_victory' | 'defender_decisive_victory' | 'defender_narrow_victory' | 'defender_pyrrhic_victory' | 'stalemate';
/**
 * `retreat_required` and `surrendered` were removed (BATTLE ENGINE
 * CORRECTNESS PASS): `BattleEngine.resolve()` only ever assigns
 * `'unchanged' | 'captured' | 'contested'` to `territoryOutcome` — these two
 * variants had no producer. `retreat_required` also directly contradicted
 * the no-retreat rule (armies are eliminated, not forced to retreat). The
 * distinct "defender surrendered" concept lives on as the dedicated
 * `BattleResult.defenderSurrendered` boolean, not as a `territoryOutcome`
 * value. See docs/BATTLE_ENGINE_CORRECTNESS.md.
 */
export type TerritoryOutcome = 'unchanged' | 'captured' | 'contested';
/**
 * `retreat` was removed (BATTLE ENGINE CORRECTNESS PASS): no code path ever
 * emitted a `retreat` battle event, and under the no-retreat rule a losing
 * army is eliminated rather than retreating, so keeping the literal around
 * invited exactly that contradiction to be reintroduced later. `surrender`
 * is kept — it describes a garrison laying down arms/being captured (still
 * eliminated as a fighting force), not troops escaping.
 */
export type BattleEventType = 'phase_start' | 'first_strike' | 'charge' | 'rally' | 'rout' | 'breach' | 'flank' | 'ambush' | 'heroic_stand' | 'surrender' | 'phase_end' | 'critical_hit';
export type ActionType = 'ATTACK' | 'DEFEND' | 'REINFORCE' | 'EXPAND' | 'SCOUT' | 'BUILD' | 'MOVE' | 'NEGOTIATE' | 'OFFER_PEACE' | 'DECLARE_WAR' | 'TRADE' | 'RETREAT' | 'WAIT';
/**
 * AI commitment lifecycle (AI COMMITMENT & AMBITION PASS).
 *
 * `pending` is reserved for a future decide-vs-commit split; `decide()`
 * currently creates commitments already in `committed`. The future
 * Orchestrator moves `committed` → `executing` and later completes,
 * interrupts, or fails them. Terminal states are `completed`,
 * `interrupted`, and `failed`.
 */
export type CommitmentStatus = 'pending' | 'committed' | 'executing' | 'completed' | 'interrupted' | 'failed';
export type CommitmentId = string;
export type TerrainType = 'plains' | 'mountain' | 'hills' | 'forest' | 'coastal' | 'desert' | 'river' | 'fortress';
export type ResourceType = 'gold' | 'food' | 'iron' | 'wood' | 'stone';
export type RelationshipState = 'allied' | 'friendly' | 'neutral' | 'tense' | 'hostile' | 'at_war';
export type TreatyType = 'alliance' | 'non_aggression' | 'trade_agreement' | 'vassalage';
/**
 * `action_failed` added (AI RUNTIME INTEGRATION PASS) — the one new
 * memory type this pass introduces, deliberately generic (not one type
 * per failing action) so a failed ATTACK/EXPAND/MOVE/commitment records
 * *something* self-referential (`withFaction: null`) instead of nothing.
 * It does not feed `summarizeForFaction` (which is specifically about
 * relations with ANOTHER faction) — it exists so failures are visible in
 * `MemorySystem.getEntries()`/tests, not silently dropped. See
 * docs/AI_RUNTIME_INTEGRATION.md, "Memory / outcome feedback".
 */
export type MemoryEventType = 'attack_received' | 'attack_made' | 'territory_lost' | 'territory_gained' | 'treaty_broken' | 'treaty_signed' | 'trade_completed' | 'alliance_formed' | 'alliance_broken' | 'major_victory' | 'major_defeat' | 'peace_offered' | 'war_declared' | 'battle_won' | 'battle_lost' | 'action_failed';
export type GoalType = 'control_region' | 'dominant_faction' | 'protect_territory' | 'destroy_rival' | 'expand_to_resources' | 'prepare_for_invasion' | 'economic_growth' | 'form_alliance' | 'break_siege';
export interface Resources {
    gold: number;
    food: number;
    iron: number;
    wood: number;
    stone: number;
}
export type ArmyMovementStatus = 'moving' | 'arrived' | 'interrupted' | 'cancelled';

/**
 * In-transit logistics for one army. Territory-to-territory only (adjacency
 * graph). `null` / omitted on `Army.movement` means the army is stationary.
 * See docs/ARMY_MOVEMENT_ARCHITECTURE.md.
 */
export interface ArmyMovement {
    originTerritoryId: TerritoryId;
    destinationTerritoryId: TerritoryId;
    startedAtTick: number;
    durationTicks: number;
    status: ArmyMovementStatus;
    /** AI MOVE/RETREAT commitment this march fulfills; null for player MOVE. */
    commitmentId: string | null;
}

export interface Army {
    id: ArmyId;
    owner: FactionId;
    /** Current territory. Stays at origin until movement arrives. */
    location: TerritoryId;
    soldiers: number;
    knights: number;
    siegeEngines: number;
    morale: number;
    supply: number;
    /** Stationary when null/omitted. Does not change territory ownership. */
    movement?: ArmyMovement | null;
    /**
     * Pending strategic attack (Phase 15). Survives arrival after the
     * march to a legal staging tile is cleared. Null/omitted = none.
     * Terminal plans are cleared, not left on the army.
     */
    attackIntent?: StrategicAttackIntent | null;
}

export type StrategicAttackIntentStatus = 'pending_movement' | 'ready';

/**
 * Canonical "what is this army trying to do after it arrives?"
 * Live statuses only. See docs/STRATEGIC_ATTACK_ARCHITECTURE.md.
 */
export interface StrategicAttackIntent {
    targetTerritoryId: TerritoryId;
    stagingTerritoryId: TerritoryId;
    createdAtTick: number;
    status: StrategicAttackIntentStatus;
    /** AI ATTACK commitment id; null for player ATTACK. */
    commitmentId: string | null;
    /** Frozen when the attack is issued so delayed battles do not depend on later EventEngine turns. */
    battleSeed: number;
    /** When set, BattleEngine uses only this army (banked troop commitment). */
    onlyArmyId?: string | null;
    /** When set, delayed/immediate resolve waits for invasion defense. */
    holdForInvasionId?: string | null;
}
export interface Territory {
    id: TerritoryId;
    name: string;
    owner: FactionId | null;
    terrain: TerrainType;
    neighboring: TerritoryId[];
    population: number;
    baseValue: number;
    resourceOutput: Partial<Resources>;
    fortification: number;
    garrison: number;
    isCapital: boolean;
    isKnown: boolean;
    scoutedTurnsAgo: number | null;
}
export interface DiplomaticRelationship {
    target: FactionId;
    state: RelationshipState;
    opinion: number;
    treaties: Treaty[];
    yearsAtPeace: number;
    yearsAtWar: number;
}
export interface Treaty {
    type: TreatyType;
    with: FactionId;
    signedTurn: number;
    expiresTurn: number | null;
    terms: Record<string, number | string>;
}
export interface MemoryEntry {
    id: string;
    turn: number;
    type: MemoryEventType;
    withFaction: FactionId | null;
    territory: TerritoryId | null;
    magnitude: number;
    details: Record<string, unknown>;
}
export interface StrategicGoal {
    id: string;
    type: GoalType;
    priority: number;
    targetFaction: FactionId | null;
    targetTerritory: TerritoryId | null;
    targetRegion: string | null;
    targetResource: ResourceType | null;
    progress: number;
    targetProgress: number;
    deadlineTurn: number | null;
    createdTurn: number;
}
export interface Personality {
    type: PersonalityType;
    aggression: number;
    defensiveness: number;
    expansionism: number;
    opportunism: number;
    diplomacy: number;
    economics: number;
    riskTolerance: number;
    patience: number;
    forgivingness: number;
    loyalty: number;
}
/**
 * Ambition is NOT a personality trait. Personality chooses *which* kinds of
 * actions a warlord prefers; ambition scales *how persistently* they pursue
 * long-term goals once those tendencies are applied. Range `[0, 1]`; the
 * scoring default is `BALANCE.ambition.defaultValue` (0.5), at which
 * ambition contributes nothing extra so pre-ambition scores are unchanged.
 */
export interface AICommitment {
    id: CommitmentId;
    warlordId: FactionId;
    action: ActionType;
    targetId: string | null;
    targetName: string | null;
    status: CommitmentStatus;
    createdTurn: number;
    originatingGoalId: string | null;
    reason: string[];
    priority: number;
    score: number;
    confidence: number;
    personalityBias: number;
    ambitionInfluence: number;
    factorBreakdown: {
        factor: string;
        weight: number;
        contribution: number;
    }[];
    /** Why this commitment entered its current status (especially terminal). */
    statusReason: string | null;
    /**
     * World tick when this commitment became active. Filled by the
     * Continuous World Engine (provisional timing). Optional so older
     * fixtures and DecisionEngine-created commitments still type-check
     * until stamped.
     */
    startedAtTick?: number | null;
    /**
     * PROVISIONAL required duration in world ticks before execution.
     * `0` means immediately resolvable (ATTACK). Not a travel formula.
     */
    durationTicks?: number;
    /** How the engine decides the commitment is ready to execute. */
    completionCondition?: 'duration_elapsed';
}
export interface WarlordSnapshot {
    id: FactionId;
    name: string;
    personality: Personality;
    /**
     * Intensity/persistence toward long-term goals. Independent of
     * `personality`. See `AICommitment` / `BALANCE.ambition`.
     */
    ambition: number;
    territories: TerritoryId[];
    armies: ArmyId[];
    totalMilitaryPower: number;
    resources: Resources;
    resourceIncome: Partial<Resources>;
    diplomacy: Map<FactionId, DiplomaticRelationship>;
    memory: MemoryEntry[];
    goals: StrategicGoal[];
    currentThreats: FactionId[];
    knownFactions: FactionId[];
    knownTerritories: TerritoryId[];
    lastActions: {
        turn: number;
        action: ActionType;
        target: string | null;
    }[];
    reputation: number;
    stability: number;
}
export interface GameStateSnapshot {
    turn: number;
    factions: Map<FactionId, WarlordSnapshot>;
    territories: Map<TerritoryId, Territory>;
    armies: Map<ArmyId, Army>;
    allFactionIds: FactionId[];
    /**
     * Optional Phase 17I attack eligibility. Omitted in hand-built scorer
     * snapshots (no extra restrictions). Populated from canonical GameState
     * by `toDecisionEngineSnapshot`.
     */
    attackRestrictions?: {
        playerFactionId: FactionId | null;
        worldTick: number;
        lastPlayerWorkoutCompletedAtTick: number | null;
        playerPaused: boolean;
        attackerRecoveryUntilTick: Map<FactionId, number>;
        attackerContinuationUntilTick: Map<FactionId, number>;
    };
}
export interface ScoredAction {
    action: ActionType;
    targetId: string | null;
    targetName: string | null;
    score: number;
    baseScore: number;
    weight?: number;
    factorBreakdown: {
        factor: string;
        weight: number;
        contribution: number;
    }[];
    reasoning: string[];
}
export interface Decision {
    warlordId: FactionId;
    warlordName: string;
    turn: number;
    action: ActionType;
    targetId: string | null;
    targetName: string | null;
    reasoning: string[];
    score: number;
    topAlternatives: ScoredAction[];
    confidence: number;
    /** Present on DecisionEngine.decide() results; optional for test/harness-constructed decisions. */
    commitment?: AICommitment | null;
    isNewCommitment?: boolean;
    originatingGoalId?: string | null;
    ambitionInfluence?: number;
    personalityBias?: number;
}
export interface ActionContext {
    self: WarlordSnapshot;
    gameState: GameStateSnapshot;
    allTerritories: Map<TerritoryId, Territory>;
    allArmies: Map<ArmyId, Army>;
    allFactions: Map<FactionId, WarlordSnapshot>;
    myTerritories: Territory[];
    myArmies: Army[];
    myNeighboringTerritories: Territory[];
    unownedNeighbors: Territory[];
    enemyNeighbors: Territory[];
    friendlyNeighbors: Territory[];
    knownEnemies: FactionId[];
    knownAllies: FactionId[];
    knownNeutrals: FactionId[];
}
/**
 * NOTE ON BATTLE TYPES:
 * `BattleInput`/`BattleResult`/`BattleSideBreakdown`/`BattleEvent`/`BattleFactor`
 * used to be re-declared here as an early draft. That draft was never wired
 * up to `BattleEngine` (which grew its own, richer versions of the same
 * names — e.g. its `BattleSideBreakdown` also carries `remaining`/`power`
 * fields this draft never had) and had drifted out of sync with it. The
 * draft has been removed; `BattleEngine`'s versions in
 * `src/battle/BattleEngine.ts` are the authoritative engine DTOs for battle
 * resolution. The shared literal-union vocabulary below (`BattleSide`,
 * `BattleOutcomeType`, `TerritoryOutcome`, `BattleEventType`) IS still
 * canonical and is imported by `BattleEngine` so both places agree on the
 * same string literals instead of redeclaring them. See
 * docs/CANONICAL_STATE_ARCHITECTURE.md.
 */
export type VisibilityState = 'unknown' | 'discovered' | 'scouted' | 'controlled';
export type RegionId = string;
export type ThemeId = string;
export type CoordinateKey = string;
export interface ThemeDefinition {
    id: ThemeId;
    name: string;
    description?: string;
    environmentalTag?: string;
    preferredTerrain: {
        terrain: TerrainType;
        weight: number;
    }[];
    terrainDistributionWeights: Record<TerrainType, number>;
    naming: {
        prefixes: string[];
        roots: string[];
        suffixes: string[];
        formatWeights: {
            prefixRoot: number;
            rootSuffix: number;
            prefixRootSuffix: number;
            standaloneRoot: number;
            compound: number;
        };
        capitalNameChance: number;
    };
    resourceTendencies: Partial<Record<ResourceType, number>>;
    strategicTendency: number;
    baseValueRange: [number, number];
    populationRange: [number, number];
    garrisonRange: [number, number];
    fortificationWeights: Record<number, number>;
    capitalBonus: boolean;
    isCoastalBias: boolean;
    borderSizePreference: {
        min: number;
        max: number;
        avg: number;
    };
    rarity: number;
    allowedAdjacentThemes: ThemeId[];
}
export interface Region {
    id: RegionId;
    name: string;
    themeId: ThemeId;
    territories: TerritoryId[];
    centerTerritoryId: TerritoryId | null;
    seed: number;
    createdAt: number;
    isCapitalRegion?: boolean;
}
export interface MapWorldState {
    worldSeed: number;
    turn: number;
    territories: Map<TerritoryId, Territory>;
    regions: Map<RegionId, Region>;
    themes: Map<ThemeId, ThemeDefinition>;
    graphMeta: {
        nextTerritoryIndex: number;
        nextRegionIndex: number;
        generatedTerritoriesCount: number;
        generatedRegionsCount: number;
        frontierTerritories: Set<TerritoryId>;
        coordToTerritory: Map<CoordinateKey, TerritoryId>;
        territoryPos: Map<TerritoryId, {
            q: number;
            r: number;
        }>;
    };
    generationSalt: number;
}
export interface PlayerVisibilityMap {
    owner: FactionId;
    visibility: Map<TerritoryId, {
        state: VisibilityState;
        lastUpdatedTurn: number;
        turnsSinceSeen: number | null;
        revealedBy: 'control' | 'scout' | 'diplomacy' | 'event' | null;
    }>;
    knownThemes: Set<ThemeId>;
    knownRegions: Set<RegionId>;
}
export interface InitialWorldParams {
    worldSeed: number;
    playerFactionIds: FactionId[];
    startingTerritoriesPerFaction?: number;
    initialTerritoryCount?: number;
    initialRegionCount?: number;
    themes?: ThemeDefinition[];
    ensureCoastalStart?: boolean;
    minCapitalsDistance?: number;
}
export interface ExpansionRequest {
    worldState: MapWorldState;
    fromFrontierTerritoryId: TerritoryId;
    newTerritoryCount: number;
    ownerFaction?: FactionId | null;
    themeHint?: ThemeId | null;
    adjacentOnly?: boolean;
    salt?: number;
    preferUnusedThemes?: ThemeId[] | null;
}
export interface ExpansionResult {
    newTerritories: Territory[];
    updatedFrontierTerritories: TerritoryId[];
    newRegions: Region[];
    newConnections: {
        from: TerritoryId;
        to: TerritoryId;
    }[];
    newlyAdjacentExistingTerritories: TerritoryId[];
    generatedFor: TerritoryId;
    validation: {
        allConnected: boolean;
        noIsolated: boolean;
        noOverwrites: boolean;
        frontierCount: number;
    };
}
export interface ScoutResult {
    fromTerritoryId: TerritoryId;
    range: number;
    revealedTerritories: {
        id: TerritoryId;
        fromState: VisibilityState;
        toState: VisibilityState;
        distance: number;
    }[];
    newlyDiscovered: TerritoryId[];
    newlyScouted: TerritoryId[];
}
export interface MapGenerationReport {
    territoryCount: number;
    regionCount: number;
    frontierCount: number;
    terrainDistribution: Record<string, number>;
    themeDistribution: Record<string, number>;
    perFactionStart?: Record<FactionId, {
        capital: TerritoryId;
        territoryCount: number;
    }>;
}

/**
 * Plain-data bridge shape between a territory source (hand-authored
 * `SAMPLE_MAP` or a generated `MapWorldState` via `MapEngine.toTerritorySpecs`)
 * and `SimulationBuilder.buildFromSpecs`, which turns specs into canonical
 * `Territory` map entries. This used to be declared separately (and
 * identically) in both `src/simulation/SampleMap.ts` and as an unnamed
 * inline return type on `MapEngine.toTerritorySpecs` — both now use this
 * single definition.
 */
export interface MapTerritorySpec {
    id: string;
    name: string;
    terrain: Territory['terrain'];
    neighbors: string[];
    population: number;
    baseValue: number;
    resourceOutput: Partial<Resources>;
    fortification: number;
    garrison: number;
    isCapital: boolean;
    owner: string | null;
}
