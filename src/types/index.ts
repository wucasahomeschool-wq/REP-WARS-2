export type FactionId = string;
export type TerritoryId = string;
export type ArmyId = string;

export type PersonalityType =
  | 'defensive'
  | 'aggressive'
  | 'expansionist'
  | 'opportunistic'
  | 'diplomatic'
  | 'economic';

export type FortificationTier = 0 | 1 | 2 | 3 | 4 | 5;
export type BattleSide = 'attacker' | 'defender';
export type BattleOutcomeType =
  | 'attacker_decisive_victory'
  | 'attacker_narrow_victory'
  | 'attacker_pyrrhic_victory'
  | 'defender_decisive_victory'
  | 'defender_narrow_victory'
  | 'defender_pyrrhic_victory'
  | 'mutual_heavy_losses'
  | 'stalemate';

export type TerritoryOutcome =
  | 'unchanged'
  | 'captured'
  | 'contested'
  | 'retreat_required'
  | 'surrendered';

export type BattleEventType =
  | 'phase_start'
  | 'first_strike'
  | 'charge'
  | 'rally'
  | 'rout'
  | 'breach'
  | 'flank'
  | 'ambush'
  | 'heroic_stand'
  | 'retreat'
  | 'surrender'
  | 'phase_end'
  | 'critical_hit';

export type ActionType =
  | 'ATTACK'
  | 'DEFEND'
  | 'REINFORCE'
  | 'EXPAND'
  | 'SCOUT'
  | 'BUILD'
  | 'MOVE'
  | 'NEGOTIATE'
  | 'OFFER_PEACE'
  | 'DECLARE_WAR'
  | 'TRADE'
  | 'RETREAT'
  | 'WAIT';

export type TerrainType =
  | 'plains'
  | 'mountain'
  | 'hills'
  | 'forest'
  | 'coastal'
  | 'desert'
  | 'river'
  | 'fortress';

export type ResourceType =
  | 'gold'
  | 'food'
  | 'iron'
  | 'wood'
  | 'stone';

export type RelationshipState =
  | 'allied'
  | 'friendly'
  | 'neutral'
  | 'tense'
  | 'hostile'
  | 'at_war';

export type TreatyType =
  | 'alliance'
  | 'non_aggression'
  | 'trade_agreement'
  | 'vassalage';

export type MemoryEventType =
  | 'attack_received'
  | 'attack_made'
  | 'territory_lost'
  | 'territory_gained'
  | 'treaty_broken'
  | 'treaty_signed'
  | 'trade_completed'
  | 'alliance_formed'
  | 'alliance_broken'
  | 'major_victory'
  | 'major_defeat'
  | 'peace_offered'
  | 'war_declared'
  | 'battle_won'
  | 'battle_lost';

export type GoalType =
  | 'control_region'
  | 'dominant_faction'
  | 'protect_territory'
  | 'destroy_rival'
  | 'expand_to_resources'
  | 'prepare_for_invasion'
  | 'economic_growth'
  | 'form_alliance'
  | 'break_siege';

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
  lastActions: { turn: number; action: ActionType; target: string | null }[];
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
  factorBreakdown: { factor: string; weight: number; contribution: number }[];
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

export interface BattleFactor {
  factor: string;
  category: 'base' | 'terrain' | 'fortification' | 'unit' | 'morale' | 'strategic' | 'random' | 'position';
  contribution: number;
  description: string;
}

export interface BattleSideBreakdown {
  side: BattleSide;
  factionId: FactionId;
  factionName: string;
  baseStrength: number;
  unitBreakdown: { soldiers: number; knights: number; siegeEngines: number; garrison?: number };
  factors: BattleFactor[];
  effectiveStrength: number;
  initialTroops: number;
  remainingTroops: number;
  casualties: {
    soldiers: number;
    knights: number;
    siegeEngines: number;
    garrison?: number;
    total: number;
    casualtyRate: number;
  };
  moraleChange: number;
  routed: boolean;
  retreated: boolean;
  retreatSurvivorsPct?: number;
}

export interface BattleEvent {
  id: string;
  turn: number;
  phase: string;
  type: BattleEventType;
  side: BattleSide | 'both';
  message: string;
  impact: number;
}

export interface BattleInput {
  battleId?: string;
  turn: number;
  attackerFactionId: FactionId;
  attackerFactionName?: string;
  defenderFactionId: FactionId;
  defenderFactionName?: string;
  attackerArmies: Army[];
  defenderArmies?: Army[];
  defenderGarrison?: number;
  territory: Territory;
  additionalAttackerModifiers?: number;
  additionalDefenderModifiers?: number;
  strategicAttackerBonus?: number;
  strategicDefenderBonus?: number;
  attackerAggression?: number;
  defenderDefensiveness?: number;
  seed: number;
}

export interface BattleResult {
  battleId: string;
  turn: number;
  territoryId: TerritoryId;
  territoryName: string;
  seedUsed: number;
  winner: BattleSide | 'draw';
  loser: BattleSide | 'draw';
  outcomeType: BattleOutcomeType;
  battleIntensity: number;
  attacker: BattleSideBreakdown;
  defender: BattleSideBreakdown;
  territoryOutcome: TerritoryOutcome;
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
}

export type VisibilityState = 'unknown' | 'discovered' | 'scouted' | 'controlled';
export type RegionId = string;
export type ThemeId = string;
export type CoordinateKey = string;

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  description?: string;
  environmentalTag?: string;
  preferredTerrain: { terrain: TerrainType; weight: number }[];
  terrainDistributionWeights: Record<TerrainType, number>;
  naming: {
    prefixes: string[];
    roots: string[];
    suffixes: string[];
    formatWeights: { prefixRoot: number; rootSuffix: number; prefixRootSuffix: number; standaloneRoot: number; compound: number };
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
  borderSizePreference: { min: number; max: number; avg: number };
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
    territoryPos: Map<TerritoryId, { q: number; r: number }>;
  };
  generationSalt: number;
}

export interface PlayerVisibilityMap {
  owner: FactionId;
  visibility: Map<TerritoryId, { state: VisibilityState; lastUpdatedTurn: number; turnsSinceSeen: number | null; revealedBy: 'control' | 'scout' | 'diplomacy' | 'event' | null }>;
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
  newConnections: { from: TerritoryId; to: TerritoryId }[];
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
  revealedTerritories: { id: TerritoryId; fromState: VisibilityState; toState: VisibilityState; distance: number }[];
  newlyDiscovered: TerritoryId[];
  newlyScouted: TerritoryId[];
}

export interface MapGenerationReport {
  territoryCount: number;
  regionCount: number;
  frontierCount: number;
  terrainDistribution: Record<string, number>;
  themeDistribution: Record<string, number>;
  perFactionStart?: Record<FactionId, { capital: TerritoryId; territoryCount: number }>;
}
