import * as fs from 'fs';
import * as path from 'path';
import { parseWorldJson } from './parse';
import { WorldDefinition, WorldLoadResult, WorldValidationIssue } from './types';
import {
  DEFAULT_PRODUCTION_WORLD_ID,
  FIXTURE_TINY_WORLD_RELATIVE_PATH,
  PRODUCTION_LEVEL_1_RELATIVE_PATH,
  PRODUCTION_LEVEL_2_RELATIVE_PATH,
  FIXTURE_WORLD_REGISTRATIONS,
  PRODUCTION_WORLD_REGISTRATIONS,
  WorldFileRegistration,
} from './worldConfig';

export {
  DEFAULT_PRODUCTION_WORLD_ID,
  FIXTURE_TINY_WORLD_ID,
  FIXTURE_TINY_WORLD_RELATIVE_PATH,
  PRODUCTION_LEVEL_1_WORLD_ID,
  PRODUCTION_LEVEL_1_RELATIVE_PATH,
  PRODUCTION_LEVEL_2_WORLD_ID,
  PRODUCTION_LEVEL_2_RELATIVE_PATH,
  FIXTURE_WORLD_REGISTRATIONS,
  PRODUCTION_WORLD_REGISTRATIONS,
} from './worldConfig';
export type { WorldFileRegistration, WorldRegistrationRole } from './worldConfig';

const REPO_ROOT_FROM_HERE = path.resolve(__dirname, '..', '..');

export function resolveWorldFilePath(relativePath: string): string {
  const normalized = relativePath.split(/[/\\]/).join(path.sep);
  const fromCwd = path.join(process.cwd(), normalized);
  if (fs.existsSync(fromCwd)) return fromCwd;
  const fromRepo = path.join(REPO_ROOT_FROM_HERE, normalized);
  if (fs.existsSync(fromRepo)) return fromRepo;
  return fromCwd;
}

export function tinyWorldJsonPath(): string {
  return resolveWorldFilePath(FIXTURE_TINY_WORLD_RELATIVE_PATH);
}

export function productionLevel1JsonPath(): string {
  return resolveWorldFilePath(PRODUCTION_LEVEL_1_RELATIVE_PATH);
}

export function productionLevel2JsonPath(): string {
  return resolveWorldFilePath(PRODUCTION_LEVEL_2_RELATIVE_PATH);
}

export function loadWorldDefinitionFromFile(filePath: string): WorldLoadResult {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unreadable file';
    return { ok: false, issues: [{ code: 'json.unreadable', message }] };
  }
  return parseWorldJson(text);
}

/** Fixture helper. Production code should use WorldCatalog.registerFile / load. */
export function loadTinyWorldDefinition(): WorldLoadResult {
  return loadWorldDefinitionFromFile(tinyWorldJsonPath());
}

/** Production Level 1 helper. Runtime still loads through WorldCatalog. */
export function loadProductionLevel1Definition(): WorldLoadResult {
  return loadWorldDefinitionFromFile(productionLevel1JsonPath());
}

/** Production Level 2 helper. Runtime still loads through WorldCatalog. */
export function loadProductionLevel2Definition(): WorldLoadResult {
  return loadWorldDefinitionFromFile(productionLevel2JsonPath());
}

export function formatWorldLoadFailure(
  worldId: string,
  result: Extract<WorldLoadResult, { ok: false }>,
  extra?: { filePath?: string },
): string {
  const first: WorldValidationIssue = result.issues[0] ?? { code: 'catalog.unknown', message: 'unknown failure' };
  const where = extra?.filePath ? ` (file ${extra.filePath})` : '';
  return `configured world ${worldId}${where} could not be loaded: ${first.code}: ${first.message}`;
}

export function requireWorldDefinition(result: WorldLoadResult, label = 'world'): WorldDefinition {
  if (!result.ok) {
    throw new Error(formatWorldLoadFailure(label, result));
  }
  return result.definition;
}

/** Legacy SAMPLE_MAP / hand-built test fixtures are not authored worlds. */
export function isLegacyDefinitionWorldId(worldId: string | null | undefined): boolean {
  if (!worldId) return true;
  return worldId.startsWith('legacy:') || worldId.startsWith('test:');
}

/** In-memory catalog. Does not generate worlds or scan directories. */
export class WorldCatalog {
  private readonly byId = new Map<string, WorldDefinition>();

  register(definition: WorldDefinition): void {
    this.byId.set(definition.worldId, definition);
  }

  get(worldId: string): WorldDefinition | undefined {
    return this.byId.get(worldId);
  }

  has(worldId: string): boolean {
    return this.byId.has(worldId);
  }

  registeredIds(): string[] {
    return [...this.byId.keys()].sort();
  }

  load(worldId: string): WorldLoadResult {
    if (isLegacyDefinitionWorldId(worldId)) {
      return {
        ok: false,
        issues: [{
          code: 'catalog.legacy',
          message: `${worldId} is a legacy/test fixture, not an authored WorldDefinition`,
        }],
      };
    }
    const found = this.byId.get(worldId);
    if (!found) {
      return {
        ok: false,
        issues: [{
          code: 'catalog.missing',
          message: `world ${worldId} is not registered`,
        }],
      };
    }
    return { ok: true, definition: found };
  }

  /**
   * Load one JSON file, validate, and register under its authored worldId.
   * Pass expectedWorldId to reject a file whose identity does not match.
   */
  registerFile(filePath: string, expectedWorldId?: string): WorldLoadResult {
    const loaded = loadWorldDefinitionFromFile(filePath);
    if (!loaded.ok) return loaded;
    if (expectedWorldId && loaded.definition.worldId !== expectedWorldId) {
      return {
        ok: false,
        issues: [{
          code: 'catalog.world_id_mismatch',
          message: `file worldId ${loaded.definition.worldId} does not match registration ${expectedWorldId}`,
        }],
      };
    }
    this.register(loaded.definition);
    return loaded;
  }
}

export interface CreateWorldCatalogOptions {
  /** Default true. Fixture worlds are test/dev only. */
  includeFixtures?: boolean;
  includeProduction?: boolean;
}

function registerAll(
  catalog: WorldCatalog,
  registrations: readonly WorldFileRegistration[],
): void {
  for (const reg of registrations) {
    const filePath = resolveWorldFilePath(reg.relativePath);
    const loaded = catalog.registerFile(filePath, reg.worldId);
    if (!loaded.ok) {
      throw new Error(formatWorldLoadFailure(reg.worldId, loaded, { filePath }));
    }
    if (loaded.definition.level !== reg.level) {
      throw new Error(
        `configured world ${reg.worldId} level ${loaded.definition.level} does not match registration ${reg.level}`,
      );
    }
  }
}

/**
 * Build a catalog from the explicit registration lists in worldConfig.
 * Does not discover JSON files. Does not fall back to SAMPLE_MAP.
 */
export function createWorldCatalog(options: CreateWorldCatalogOptions = {}): WorldCatalog {
  const catalog = new WorldCatalog();
  if (options.includeProduction !== false) {
    registerAll(catalog, PRODUCTION_WORLD_REGISTRATIONS);
  }
  if (options.includeFixtures !== false) {
    registerAll(catalog, FIXTURE_WORLD_REGISTRATIONS);
  }
  return catalog;
}

/** Production registrations only. Does not include fixture worlds. */
export function createProductionWorldCatalog(): WorldCatalog {
  return createWorldCatalog({ includeProduction: true, includeFixtures: false });
}

let defaultCatalog: WorldCatalog | null = null;

/**
 * Runtime catalog: production worlds plus explicitly listed fixtures.
 * Fails closed if a listed file is missing, malformed, or invalid, or if
 * DEFAULT_PRODUCTION_WORLD_ID is not registered after those lists load.
 */
export function getDefaultWorldCatalog(): WorldCatalog {
  if (!defaultCatalog) {
    defaultCatalog = createWorldCatalog({ includeProduction: true, includeFixtures: true });
    const selected = defaultCatalog.load(DEFAULT_PRODUCTION_WORLD_ID);
    if (!selected.ok) {
      throw new Error(formatWorldLoadFailure(DEFAULT_PRODUCTION_WORLD_ID, selected));
    }
  }
  return defaultCatalog;
}

export function resetDefaultWorldCatalogForTests(): void {
  defaultCatalog = null;
}

/** Resolve immutable authored geography for a persisted/runtime world identity. */
export function resolveWorldDefinition(
  worldId: string,
  catalog: WorldCatalog = getDefaultWorldCatalog(),
): WorldLoadResult {
  return catalog.load(worldId);
}
