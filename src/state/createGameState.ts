/**
 * DETERMINISTIC GAMESTATE INITIALIZATION.
 *
 * Production path:
 *   WorldCatalog.load(worldId)
 *     → WorldValidator
 *     → createGameStateFromWorld()
 *
 * There is no SAMPLE_MAP fallback. Missing/invalid authored worlds throw.
 * SAMPLE_MAP remains an explicit LEGACY TEST FIXTURE via
 * `createLegacySampleMapGameState`.
 */
import { AICommitment, FactionId } from '../types';
import { GameState, GAME_STATE_SCHEMA_VERSION, RuntimeRegion, emptyWorldClock, emptyRewardApplicationState } from '../types/GameState';
import { BALANCE } from '../constants/balance';
import { MapTerritorySpec, SAMPLE_MAP, SimulationBuilder, WARLORD_SPECS, WarlordSpec } from '../simulation/SampleMap';
import { seedTerritoryEconomy } from '../gameplay/economy/seed';
import { syncAllFactionResourceIncome } from '../gameplay/economy/resourceIncome';
import { bindLevelAnchors } from '../gameplay/anchors';
import {
  createGameStateFromWorld,
  DEFAULT_PRODUCTION_WORLD_ID,
  LEGACY_SAMPLE_REGION_ID,
  LEGACY_SAMPLE_WORLD_ID,
  formatWorldLoadFailure,
  WorldCatalog,
  WorldDefinition,
  getDefaultWorldCatalog,
} from '../worldDefinition';

export interface CreateGameStateOptions {
  seed?: number;
  /** Defaults to the authored world player faction. */
  playerFactionId?: FactionId | null;
  /** Authored world id. Defaults to `DEFAULT_PRODUCTION_WORLD_ID` from worldConfig. */
  worldId?: string;
  /** Explicit definition (tests). Still must be a valid WorldDefinition. */
  world?: WorldDefinition;
  /** Override the default catalog. Callers must not parse JSON ad hoc. */
  catalog?: WorldCatalog;
}

/** LEGACY TEST FIXTURE ONLY. Not accepted by production `createGameState()`. */
export interface CreateLegacySampleMapOptions {
  seed?: number;
  playerFactionId?: FactionId | null;
  mapSpecs?: MapTerritorySpec[];
  warlordSpecs?: WarlordSpec[];
}

function attachLegacyRegions(state: GameState): void {
  const region: RuntimeRegion = {
    id: LEGACY_SAMPLE_REGION_ID,
    name: 'Legacy Sample Map',
    territoryIds: [...state.territories.keys()],
  };
  state.regions.set(region.id, region);
  for (const t of state.territories.values()) {
    t.regionId = LEGACY_SAMPLE_REGION_ID;
  }
  const allIds = [...state.territories.keys()];
  for (const f of state.factions.values()) {
    f.knownTerritories = [...allIds];
    f.knownFactions = [...state.allFactionIds];
  }
}

/**
 * LEGACY TEST FIXTURE. Not the production authored-world path.
 * Isolated regression geography (SAMPLE_MAP / WARLORD_SPECS).
 */
export function createLegacySampleMapGameState(options: CreateLegacySampleMapOptions = {}): GameState {
  const seed = options.seed ?? BALANCE.simulate.defaultSeed;
  const mapSpecs = options.mapSpecs ?? SAMPLE_MAP;
  const warlordSpecs = options.warlordSpecs ?? WARLORD_SPECS;
  const { gameState: snapshot } = SimulationBuilder.buildFromSpecs(mapSpecs, warlordSpecs, seed);
  const commitments = new Map<FactionId, AICommitment | null>();
  for (const fid of snapshot.allFactionIds) {
    commitments.set(fid, null);
  }
  const state: GameState = {
    schemaVersion: GAME_STATE_SCHEMA_VERSION,
    turn: snapshot.turn,
    ...emptyWorldClock(),
    worldSeed: seed,
    factions: snapshot.factions,
    allFactionIds: [...snapshot.allFactionIds],
    playerFactionId: options.playerFactionId ?? null,
    definitionWorldId: LEGACY_SAMPLE_WORLD_ID,
    definitionFormatVersion: 'legacy-sample-map',
    worldLevel: 1,
    worldName: 'Legacy Sample Map',
    regions: new Map(),
    territories: snapshot.territories,
    armies: snapshot.armies,
    commitments,
    activeEvents: [],
    eventHistory: [],
    ...emptyRewardApplicationState(),
  };
  attachLegacyRegions(state);
  seedTerritoryEconomy(state);
  syncAllFactionResourceIncome(state);
  bindLevelAnchors(state);
  return state;
}

/**
 * Production initializer. Always uses WorldCatalog + WorldDefinition.
 * Never falls back to SAMPLE_MAP or an empty replacement world.
 */
export function createGameState(options: CreateGameStateOptions = {}): GameState {
  if (options.world) {
    return createGameStateFromWorld(options.world, options);
  }
  const catalog = options.catalog ?? getDefaultWorldCatalog();
  const worldId = options.worldId ?? DEFAULT_PRODUCTION_WORLD_ID;
  const loaded = catalog.load(worldId);
  if (!loaded.ok) {
    throw new Error(formatWorldLoadFailure(worldId, loaded));
  }
  return createGameStateFromWorld(loaded.definition, options);
}
