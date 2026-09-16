import { PRODUCTION_WORLD_REGISTRATIONS, WorldFileRegistration } from './worldConfig';

/**
 * Next production world after `currentLevel`, from the explicit registration
 * list. Does not hard-code world IDs or territory geometry.
 */
export function findNextProductionWorldRegistration(
  currentLevel: number,
): WorldFileRegistration | null {
  const matches = PRODUCTION_WORLD_REGISTRATIONS.filter((reg) => reg.level === currentLevel + 1);
  if (matches.length === 0) return null;
  return [...matches].sort((a, b) => a.worldId.localeCompare(b.worldId))[0] ?? null;
}
