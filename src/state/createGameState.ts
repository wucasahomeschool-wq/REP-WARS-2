/**
 * DETERMINISTIC GAMESTATE INITIALIZATION.
 *
 * Production default: authored WorldDefinition (docs/examples/world-level1-tiny.json).
 * SAMPLE_MAP remains an explicit LEGACY TEST FIXTURE via
 * `createLegacySampleMapGameState` / `mapSpecs`+`warlordSpecs`.
 */
import { AICommitment, FactionId } from '../types';
import { GameState, GAME_STATE_SCHEMA_VERSION, RuntimeRegion, emptyWorldClock, emptyRewardApplicationState } from '../types/GameState';
import { BALANCE } from '../constants/balance';
import { MapTerritorySpec, SAMPLE_MAP, SimulationBuilder, WARLORD_SPECS, WarlordSpec } from '../simulation/SampleMap';
import { seedTerritoryEconomy } from '../gameplay/economy/seed';
import {
  createGameStateFromWorld,
  LEGACY_SAMPLE_REGION_ID,
  LEGACY_SAMPLE_WORLD_ID,
  loadTinyWorldDefinition,
  requireWorldDefinition,
  WorldDefinition,
} from '../worldDefinition';

export interface CreateGameStateOptions {
  seed?: number;
  /** Defaults to the authored world player faction when using WorldDefinition. */
  playerFactionId?: FactionId | null;
  /**
   * LEGACY TEST FIXTURE ONLY. Providing mapSpecs/warlordSpecs uses SAMPLE_MAP
   * simulation builder instead of authored JSON.
   */
  mapSpecs?: MapTerritorySpec[];
  warlordSpecs?: WarlordSpec[];
  world?: WorldDefinition;
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
 */
export function createLegacySampleMapGameState(options: CreateGameStateOptions = {}): GameState {
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
  return state;
}

/**
 * Production initializer. Uses authored WorldDefinition unless SAMPLE_MAP
 * fixture specs are explicitly passed.
 */
export function createGameState(options: CreateGameStateOptions = {}): GameState {
  if (options.mapSpecs || options.warlordSpecs) {
    return createLegacySampleMapGameState(options);
  }
  if (options.world) {
    return createGameStateFromWorld(options.world, options);
  }
  const definition = requireWorldDefinition(loadTinyWorldDefinition(), 'production world');
  return createGameStateFromWorld(definition, options);
}
