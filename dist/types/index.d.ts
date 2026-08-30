export type FactionId = string;
export type TerritoryId = string;
export type ArmyId = string;
export type PersonalityType = 'defensive' | 'aggressive' | 'expansionist' | 'opportunistic' | 'diplomatic' | 'economic';
export type ActionType = 'ATTACK' | 'DEFEND' | 'REINFORCE' | 'EXPAND' | 'SCOUT' | 'BUILD' | 'MOVE' | 'NEGOTIATE' | 'OFFER_PEACE' | 'DECLARE_WAR' | 'TRADE' | 'RETREAT' | 'WAIT';
export type TerrainType = 'plains' | 'mountain' | 'forest' | 'coastal' | 'desert' | 'river' | 'fortress';
export type ResourceType = 'gold' | 'food' | 'iron' | 'wood' | 'stone';
export type RelationshipState = 'allied' | 'friendly' | 'neutral' | 'tense' | 'hostile' | 'at_war';
export type TreatyType = 'alliance' | 'non_aggression' | 'trade_agreement' | 'vassalage';
export type MemoryEventType = 'attack_received' | 'attack_made' | 'territory_lost' | 'territory_gained' | 'treaty_broken' | 'treaty_signed' | 'trade_completed' | 'alliance_formed' | 'alliance_broken' | 'major_victory' | 'major_defeat' | 'peace_offered' | 'war_declared' | 'battle_won' | 'battle_lost';
export type GoalType = 'control_region' | 'dominant_faction' | 'protect_territory' | 'destroy_rival' | 'expand_to_resources' | 'prepare_for_invasion' | 'economic_growth' | 'form_alliance' | 'break_siege';
export interface Resources {
    gold: number;
    food: number;
    iron: number;
    wood: number;
    stone: number;
}
export interface Army {
    id: ArmyId;
    owner: FactionId;
    location: TerritoryId;
    soldiers: number;
    knights: number;
    siegeEngines: number;
    morale: number;
    supply: number;
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
export interface WarlordSnapshot {
    id: FactionId;
    name: string;
    personality: Personality;
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
