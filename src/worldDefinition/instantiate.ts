import { Army, DiplomaticRelationship, FactionId, Personality, Territory, WarlordSnapshot } from '../types';
import {
  GAME_STATE_SCHEMA_VERSION,
  GameState,
  RuntimeRegion,
  emptyRewardApplicationState,
  emptyWorldClock,
} from '../types/GameState';
import { PersonalitySystem } from '../personality/PersonalitySystem';
import { GoalSystem } from '../goals/GoalSystem';
import { seedTerritoryEconomy } from '../gameplay/economy/seed';
import { syncAllFactionResourceIncome } from '../gameplay/economy/resourceIncome';
import { bindLevelAnchors } from '../gameplay/anchors';
import { bindLevel1Tutorial } from '../gameplay/tutorial/level1';
import { WorldDefinition, WorldFactionDefinition } from './types';
import { assertValidWorld } from './validate';
import { assertWorldIdentity } from './identity';

export const LEGACY_SAMPLE_WORLD_ID = 'legacy:sample-map';
export const LEGACY_SAMPLE_REGION_ID = 'r_legacy_sample';

function emptyPersonality(): Personality {
  return PersonalitySystem.fromTraits({
    aggression: 0.5,
    defensiveness: 0.5,
    expansionism: 0.5,
    opportunism: 0.5,
    diplomacy: 0.5,
    economics: 0.5,
    riskTolerance: 0.5,
    patience: 0.5,
    forgivingness: 0.5,
    loyalty: 0.5,
  });
}

function personalityForFaction(faction: WorldFactionDefinition): { personality: Personality; ambition: number } {
  if (faction.role === 'player' || !faction.personality) {
    return { personality: emptyPersonality(), ambition: 0.5 };
  }
  return {
    personality: PersonalitySystem.fromTraits(faction.personality.traits),
    ambition: faction.personality.ambition,
  };
}

export interface CreateGameStateFromWorldOptions {
  seed?: number;
  playerFactionId?: FactionId | null;
}

/**
 * Build runtime GameState from an authored WorldDefinition.
 * Does not invent geography, adjacency, owners, or AI personalities.
 * Creates no cities and no territory fog.
 */
export function createGameStateFromWorld(
  definition: WorldDefinition,
  options: CreateGameStateFromWorldOptions = {},
): GameState {
  assertValidWorld(definition);
  const seed = options.seed ?? 0;
  const territories = new Map<string, Territory>();
  const allTerritoryIds = definition.territories.map((t) => t.id);
  for (const t of definition.territories) {
    territories.set(t.id, {
      id: t.id,
      owner: t.startingOwnerFactionId,
      regionId: t.regionId,
      terrain: t.terrain,
      neighboring: [...t.neighborIds],
      population: 0,
      baseValue: 0,
      resourceOutput: { ...t.resourceOutput },
      fortification: 0,
      garrison: 0,
    });
  }

  const regions = new Map<string, RuntimeRegion>();
  for (const r of definition.regions) {
    regions.set(r.id, {
      id: r.id,
      name: r.name,
      territoryIds: [...r.territoryIds],
    });
  }

  const armies = new Map<string, Army>();
  const factions = new Map<string, WarlordSnapshot>();
  const factionIds = definition.factions.map((f) => f.id);
  let armySeq = 0;

  for (const spec of definition.factions) {
    const { personality, ambition } = personalityForFaction(spec);
    const diplomacy = new Map<string, DiplomaticRelationship>();
    for (const rel of definition.startingDiplomacy) {
      if (rel.a === spec.id) {
        diplomacy.set(rel.b, {
          target: rel.b,
          state: rel.state,
          opinion: rel.opinion,
          treaties: [],
          yearsAtPeace: rel.state === 'at_war' ? 0 : 10,
          yearsAtWar: rel.state === 'at_war' ? 2 : 0,
        });
      } else if (rel.b === spec.id) {
        diplomacy.set(rel.a, {
          target: rel.a,
          state: rel.state,
          opinion: rel.opinion,
          treaties: [],
          yearsAtPeace: rel.state === 'at_war' ? 0 : 10,
          yearsAtWar: rel.state === 'at_war' ? 2 : 0,
        });
      }
    }
    for (const fid of factionIds) {
      if (fid !== spec.id && !diplomacy.has(fid)) {
        diplomacy.set(fid, {
          target: fid,
          state: 'neutral',
          opinion: 0,
          treaties: [],
          yearsAtPeace: 5,
          yearsAtWar: 0,
        });
      }
    }

    const owned = definition.territories
      .filter((t) => t.startingOwnerFactionId === spec.id)
      .map((t) => t.id);
    const myArmyIds: string[] = [];
    const troops = spec.startingArmy;
    if (troops.soldiers + troops.knights + troops.siegeEngines > 0) {
      const armyId = `army_${armySeq++}`;
      armies.set(armyId, {
        id: armyId,
        owner: spec.id,
        location: troops.locationTerritoryId,
        soldiers: troops.soldiers,
        knights: troops.knights,
        siegeEngines: troops.siegeEngines,
        morale: 85,
        supply: 80,
        movement: null,
        attackIntent: null,
      });
      myArmyIds.push(armyId);
    }

    const homeRegion = definition.territories.find((t) => t.id === spec.homeTerritoryId)?.regionId ?? null;
    const rivalFactionIds = [...diplomacy.entries()]
      .filter(([, rel]) => rel.state === 'hostile' || rel.state === 'at_war' || rel.state === 'tense' || rel.opinion < -30)
      .map(([id]) => id);
    const allianceCandidateIds = [...diplomacy.entries()]
      .filter(([, rel]) => rel.state === 'allied' || rel.state === 'friendly' || rel.state === 'neutral')
      .map(([id]) => id)
      .filter((id) => id !== spec.id);

    const goals = spec.role === 'ai'
      ? GoalSystem.generateInitialGoals(personality.type, spec.id, 0, { next: () => 0.5, nextInt: () => 0 }, {
        otherFactionIds: factionIds.filter((id) => id !== spec.id),
        rivalFactionIds,
        allianceCandidateIds,
        homeRegionId: homeRegion,
      })
      : [];

    const snapshot: WarlordSnapshot = {
      id: spec.id,
      name: spec.name,
      personality,
      ambition,
      territories: owned,
      armies: myArmyIds,
      totalMilitaryPower: troops.soldiers + troops.knights * 3,
      resources: { ...spec.startingResources },
      resourceIncome: {},
      diplomacy,
      memory: [],
      goals,
      currentThreats: [],
      knownFactions: [...factionIds],
      knownTerritories: [...allTerritoryIds],
      lastActions: [],
      reputation: 50,
      stability: 70,
    };
    factions.set(spec.id, snapshot);
  }

  const commitments = new Map<FactionId, null>();
  for (const fid of factionIds) commitments.set(fid, null);

  const playerFactionId = options.playerFactionId === undefined
    ? definition.playerFactionId
    : options.playerFactionId;

  const state: GameState = {
    schemaVersion: GAME_STATE_SCHEMA_VERSION,
    turn: 0,
    ...emptyWorldClock(),
    worldSeed: seed,
    factions,
    allFactionIds: [...factionIds],
    playerFactionId,
    definitionWorldId: definition.worldId,
    definitionFormatVersion: definition.formatVersion,
    worldLevel: definition.level,
    worldName: definition.name,
    regions,
    territories,
    armies,
    commitments,
    activeEvents: [],
    eventHistory: [],
    ...emptyRewardApplicationState(),
  };
  seedTerritoryEconomy(state);
  syncAllFactionResourceIncome(state);
  bindLevelAnchors(state, definition);
  bindLevel1Tutorial(state);
  assertWorldIdentity(state, definition);
  return state;
}

/**
 * Rebind authored immutable facts from WorldDefinition onto GameState.
 * GameState remains the mutable overlay; catalog geography/personality
 * cannot silently drift after save/load.
 */
export function applyImmutableWorldDefinition(state: GameState, definition: WorldDefinition): void {
  assertValidWorld(definition);
  const authoredTerritoryIds = definition.territories.map((t) => t.id).sort();
  const runtimeTerritoryIds = [...state.territories.keys()].sort();
  if (authoredTerritoryIds.join('\0') !== runtimeTerritoryIds.join('\0')) {
    throw new Error(
      `world ${definition.worldId} territory graph does not match persisted GameState`,
    );
  }
  for (const spec of definition.factions) {
    if (!state.factions.has(spec.id)) {
      throw new Error(`world ${definition.worldId} is missing authored faction ${spec.id}`);
    }
  }

  state.definitionWorldId = definition.worldId;
  state.definitionFormatVersion = definition.formatVersion;
  state.worldLevel = definition.level;
  state.worldName = definition.name;

  const regions = new Map<string, RuntimeRegion>();
  for (const r of definition.regions) {
    regions.set(r.id, {
      id: r.id,
      name: r.name,
      territoryIds: [...r.territoryIds],
    });
  }
  state.regions = regions;

  for (const tDef of definition.territories) {
    const tile = state.territories.get(tDef.id)!;
    tile.regionId = tDef.regionId;
    tile.terrain = tDef.terrain;
    tile.neighboring = [...tDef.neighborIds];
    tile.resourceOutput = { ...tDef.resourceOutput };
  }

  const allTerritoryIds = definition.territories.map((t) => t.id);
  for (const spec of definition.factions) {
    const faction = state.factions.get(spec.id)!;
    const { personality, ambition } = personalityForFaction(spec);
    faction.name = spec.name;
    faction.personality = personality;
    faction.ambition = ambition;
    faction.knownTerritories = [...allTerritoryIds];
    faction.knownFactions = [...definition.factions.map((f) => f.id)];
  }
  bindLevelAnchors(state, definition);
  bindLevel1Tutorial(state);
  assertWorldIdentity(state, definition);
}
