import { WorldDefinition, WorldLoadResult, WORLD_FORMAT_VERSION } from './types';
import { validateWorldDefinition } from './validate';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Parse unknown JSON into a WorldDefinition and validate.
 * Never invents a replacement world.
 */
export function loadWorldDefinition(raw: unknown): WorldLoadResult {
  const rec = asRecord(raw);
  if (!rec) {
    return { ok: false, issues: [{ code: 'json.not_object', message: 'World JSON must be an object' }] };
  }
  if (rec.formatVersion !== WORLD_FORMAT_VERSION) {
    return {
      ok: false,
      issues: [{
        code: 'format.unsupported',
        message: `formatVersion must be ${WORLD_FORMAT_VERSION}`,
      }],
    };
  }
  const definition = rec as unknown as WorldDefinition;
  if (!Array.isArray(definition.startingDiplomacy)) definition.startingDiplomacy = [];
  if (!Array.isArray(definition.containedWorlds)) definition.containedWorlds = [];
  const issues = validateWorldDefinition(definition);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, definition };
}

export function parseWorldJson(text: string): WorldLoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'invalid JSON';
    return { ok: false, issues: [{ code: 'json.parse', message }] };
  }
  return loadWorldDefinition(raw);
}
