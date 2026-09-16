/**
 * Authoritative world-selection and registration lists (Phase 17Q).
 *
 * This is the ONLY place production/runtime code should name a selected
 * world ID or a world JSON path. Game systems load through WorldCatalog;
 * they do not discover files or hard-code Ember Atoll.
 *
 * A world is available because it was deliberately listed here (or
 * registered with WorldCatalog.register / registerFile). The catalog
 * never recursively scans directories.
 */
export type WorldRegistrationRole = 'production' | 'fixture';

export interface WorldFileRegistration {
  worldId: string;
  relativePath: string;
  role: WorldRegistrationRole;
  /** Authored campaign level. Must match the JSON `level` field. */
  level: number;
}

/**
 * Tiny authored world used by tests. Not the shipped Level 1 map.
 * Do not copy this ID elsewhere in src/ — import the constant.
 */
export const FIXTURE_TINY_WORLD_ID = 'w_ember_atoll';

/** Canonical fixture file. Map Assistant `--validate` uses this same path. */
export const FIXTURE_TINY_WORLD_RELATIVE_PATH = 'docs/examples/world-level1-tiny.json';

/**
 * Worlds registered for tests and development. Explicit list only.
 */
export const FIXTURE_WORLD_REGISTRATIONS: readonly WorldFileRegistration[] = [
  {
    worldId: FIXTURE_TINY_WORLD_ID,
    relativePath: FIXTURE_TINY_WORLD_RELATIVE_PATH,
    role: 'fixture',
    level: 1,
  },
];

/**
 * Authored production Level 1 (`worlds/level-1.json`).
 * The Map Assistant export used `worldId: "Level 1"`; registration must match.
 */
export const PRODUCTION_LEVEL_1_WORLD_ID = 'Level 1';
export const PRODUCTION_LEVEL_1_RELATIVE_PATH = 'worlds/level-1.json';

/**
 * Temporary production Level 2 prototype (`worlds/level-2.json`).
 * Geometry lives only in that JSON. Campaign code resolves the next world
 * by authored `level`, not by hard-coded territory IDs.
 */
export const PRODUCTION_LEVEL_2_WORLD_ID = 'Level 2';
export const PRODUCTION_LEVEL_2_RELATIVE_PATH = 'worlds/level-2.json';

/**
 * Worlds registered as production content.
 * Ember Atoll is a fixture and must not be listed here.
 * New games still start at DEFAULT_PRODUCTION_WORLD_ID (Level 1).
 */
export const PRODUCTION_WORLD_REGISTRATIONS: readonly WorldFileRegistration[] = [
  {
    worldId: PRODUCTION_LEVEL_1_WORLD_ID,
    relativePath: PRODUCTION_LEVEL_1_RELATIVE_PATH,
    role: 'production',
    level: 1,
  },
  {
    worldId: PRODUCTION_LEVEL_2_WORLD_ID,
    relativePath: PRODUCTION_LEVEL_2_RELATIVE_PATH,
    role: 'production',
    level: 2,
  },
];

/**
 * World ID used for new player games (`createGameState()`, `initializePlayerWorld()`).
 *
 * Invalid/missing IDs fail closed — there is no SAMPLE_MAP / Ember fallback
 * to a different world.
 */
export const DEFAULT_PRODUCTION_WORLD_ID = PRODUCTION_LEVEL_1_WORLD_ID;
