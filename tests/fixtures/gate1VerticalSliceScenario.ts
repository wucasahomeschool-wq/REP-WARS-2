/**
 * Gate 1 Phase 1A — deterministic vertical-slice scenario (test/dev only).
 *
 * Builds real GameState through WorldDefinition → createGameStateFromWorld.
 * Not registered in production catalogs. Do not import from production boot.
 */
import * as fs from 'fs';
import {
  AUTHORED_V2_FIXTURE_CATALOG_ID,
  AUTHORED_V2_FIXTURE_CATALOG_VERSION,
  compileAuthoringDocument,
  createGameStateFromWorld,
  overwriteGameState,
  parseWorldJson,
  requireWorldDefinition,
  resolveWorldFilePath,
  sampleAuthoringDocumentV2,
} from '../../src';
import type { GameState, RuntimeWorkoutCatalog, WorldDefinition } from '../../src';

/** Authored Gate 1 miniature world. Not Ember Atoll, not production Level 1. */
export const VERTICAL_SLICE_WORLD_ID = 'w_gate1_vertical_slice';
export const VERTICAL_SLICE_WORLD_RELATIVE_PATH = 'tests/fixtures/worlds/gate1-vertical-slice.json';
export const VERTICAL_SLICE_WORLD_NAME = 'Gate 1 Vertical Slice';
export const VERTICAL_SLICE_WORLD_LEVEL = 1;

/** Explicit command/player identity for later Gate 1 phases. */
export const VERTICAL_SLICE_PLAYER_ID = 'player_gate1_vertical_slice';
export const VERTICAL_SLICE_PLAYER_FACTION_ID = 'f_player';
export const VERTICAL_SLICE_AI_1_FACTION_ID = 'f_ai_1';
export const VERTICAL_SLICE_AI_2_FACTION_ID = 'f_ai_2';

export const VERTICAL_SLICE_TERRITORY_A = 't_a';
export const VERTICAL_SLICE_TERRITORY_B = 't_b';
export const VERTICAL_SLICE_TERRITORY_C = 't_c';
export const VERTICAL_SLICE_TERRITORY_D = 't_d';

/** Fixed seed for createGameStateFromWorld. Not used as gameplay RNG input. */
export const VERTICAL_SLICE_SEED = 0;

/** Initial banked Troops — Phase 1B earns the first Troops via workout. */
export const VERTICAL_SLICE_INITIAL_BANKED_TROOPS = 0;

/** AI starting army values mirrored from the authored world JSON. */
export const VERTICAL_SLICE_AI_1_ARMY = {
  soldiers: 220,
  knights: 20,
  siegeEngines: 0,
  locationTerritoryId: VERTICAL_SLICE_TERRITORY_B,
} as const;

export const VERTICAL_SLICE_AI_2_ARMY = {
  soldiers: 180,
  knights: 15,
  siegeEngines: 0,
  locationTerritoryId: VERTICAL_SLICE_TERRITORY_D,
} as const;

/** Adjacent enemies the player can legally attack from t_a. */
export const VERTICAL_SLICE_PLAYER_ADJACENT_ENEMIES = [
  VERTICAL_SLICE_TERRITORY_B,
  VERTICAL_SLICE_TERRITORY_C,
] as const;

/** Additional enemy (AI_2) for later target-selection coverage. */
export const VERTICAL_SLICE_SECONDARY_ENEMY_TERRITORY = VERTICAL_SLICE_TERRITORY_D;

/** Existing test-only v2 workout fixture — referenced, never auto-installed. */
export const VERTICAL_SLICE_WORKOUT_CATALOG_ID = AUTHORED_V2_FIXTURE_CATALOG_ID;
export const VERTICAL_SLICE_WORKOUT_CATALOG_VERSION = AUTHORED_V2_FIXTURE_CATALOG_VERSION;

export interface VerticalSliceScenario {
  /** Fresh authoritative GameState for the Gate 1 miniature world. */
  state: GameState;
  /** Immutable authored definition used to build `state`. */
  definition: WorldDefinition;
  playerId: typeof VERTICAL_SLICE_PLAYER_ID;
  playerFactionId: typeof VERTICAL_SLICE_PLAYER_FACTION_ID;
  worldId: typeof VERTICAL_SLICE_WORLD_ID;
  seed: typeof VERTICAL_SLICE_SEED;
  /** Compiled test fixture catalog. Not installed into production runtime. */
  workoutCatalog: RuntimeWorkoutCatalog;
}

let cachedDefinition: WorldDefinition | null = null;

export function verticalSliceWorldJsonPath(): string {
  return resolveWorldFilePath(VERTICAL_SLICE_WORLD_RELATIVE_PATH);
}

/** Load + validate the Gate 1 authored world. Cached; never mutated by callers. */
export function loadVerticalSliceWorldDefinition(): WorldDefinition {
  if (cachedDefinition) return cachedDefinition;
  const filePath = verticalSliceWorldJsonPath();
  const text = fs.readFileSync(filePath, 'utf8');
  const loaded = parseWorldJson(text);
  cachedDefinition = requireWorldDefinition(loaded, VERTICAL_SLICE_WORLD_ID);
  return cachedDefinition;
}

/**
 * Compile the existing test-only v2 workout fixture catalog.
 * Does NOT call installAuthoredWorkoutCatalog — Phase 1B tests install locally.
 */
export function compileVerticalSliceWorkoutCatalog(): RuntimeWorkoutCatalog {
  const compiled = compileAuthoringDocument(sampleAuthoringDocumentV2());
  if (!compiled.ok || !compiled.catalog) {
    const detail = compiled.issues.map((i) => i.message).join('; ') || 'compile failed';
    throw new Error(`Gate 1 vertical-slice workout fixture invalid: ${detail}`);
  }
  return compiled.catalog;
}

/** Create a fresh GameState for the Gate 1 vertical-slice world. */
export function createVerticalSliceGameState(): GameState {
  return createGameStateFromWorld(loadVerticalSliceWorldDefinition(), {
    seed: VERTICAL_SLICE_SEED,
    playerFactionId: VERTICAL_SLICE_PLAYER_FACTION_ID,
  });
}

/**
 * Full scenario bundle: fresh GameState + identity constants + workout fixture.
 * Isolated from production boot / default catalog / catalog installation.
 */
export function createVerticalSliceScenario(): VerticalSliceScenario {
  return {
    state: createVerticalSliceGameState(),
    definition: loadVerticalSliceWorldDefinition(),
    playerId: VERTICAL_SLICE_PLAYER_ID,
    playerFactionId: VERTICAL_SLICE_PLAYER_FACTION_ID,
    worldId: VERTICAL_SLICE_WORLD_ID,
    seed: VERTICAL_SLICE_SEED,
    workoutCatalog: compileVerticalSliceWorkoutCatalog(),
  };
}

/**
 * Restore known initial state.
 * - No target: returns a brand-new scenario (same as create).
 * - With target GameState: overwrites in place (clears mutations / sessions).
 */
export function resetVerticalSliceScenario(target?: GameState): VerticalSliceScenario {
  const scenario = createVerticalSliceScenario();
  if (target) {
    overwriteGameState(target, scenario.state);
    scenario.state = target;
  }
  return scenario;
}

/** Test helper: clear the definition cache (does not touch production catalogs). */
export function clearVerticalSliceDefinitionCacheForTests(): void {
  cachedDefinition = null;
}
