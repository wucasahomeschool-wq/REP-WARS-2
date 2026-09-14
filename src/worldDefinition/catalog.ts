import * as fs from 'fs';
import * as path from 'path';
import { parseWorldJson } from './parse';
import { WorldDefinition, WorldLoadResult } from './types';

const TINY_RELATIVE = path.join('docs', 'examples', 'world-level1-tiny.json');

export function tinyWorldJsonPath(): string {
  const fromCwd = path.join(process.cwd(), TINY_RELATIVE);
  if (fs.existsSync(fromCwd)) return fromCwd;
  const fromHere = path.resolve(__dirname, '..', '..', TINY_RELATIVE);
  if (fs.existsSync(fromHere)) return fromHere;
  return fromCwd;
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

export function loadTinyWorldDefinition(): WorldLoadResult {
  return loadWorldDefinitionFromFile(tinyWorldJsonPath());
}

export function requireWorldDefinition(result: WorldLoadResult, label = 'world'): WorldDefinition {
  if (!result.ok) {
    const first = result.issues[0]!;
    throw new Error(`${label} rejected: ${first.code}: ${first.message}`);
  }
  return result.definition;
}

/** In-memory catalog. Does not generate worlds. */
export class WorldCatalog {
  private readonly byId = new Map<string, WorldDefinition>();

  register(definition: WorldDefinition): void {
    this.byId.set(definition.worldId, definition);
  }

  get(worldId: string): WorldDefinition | undefined {
    return this.byId.get(worldId);
  }

  load(worldId: string): WorldLoadResult {
    const found = this.byId.get(worldId);
    if (!found) {
      return { ok: false, issues: [{ code: 'catalog.missing', message: `world ${worldId} is not registered` }] };
    }
    return { ok: true, definition: found };
  }

  registerFile(filePath: string): WorldLoadResult {
    const loaded = loadWorldDefinitionFromFile(filePath);
    if (loaded.ok) this.register(loaded.definition);
    return loaded;
  }
}

let defaultCatalog: WorldCatalog | null = null;

export function getDefaultWorldCatalog(): WorldCatalog {
  if (!defaultCatalog) {
    defaultCatalog = new WorldCatalog();
    const loaded = loadTinyWorldDefinition();
    if (loaded.ok) defaultCatalog.register(loaded.definition);
  }
  return defaultCatalog;
}

export function resetDefaultWorldCatalogForTests(): void {
  defaultCatalog = null;
}
