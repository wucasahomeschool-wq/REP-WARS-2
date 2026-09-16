import { OrchestrationError, ErrorCode } from '../orchestration/errors';
import { PRODUCTION_WORLD_REGISTRATIONS, WorldFileRegistration } from './worldConfig';

/**
 * Next production world after `currentLevel`, from the explicit registration
 * list. Does not hard-code world IDs or territory geometry.
 *
 * Zero matches → no next world.
 * Exactly one match → that registration.
 * Two or more matches → configuration error (never silently pick one).
 */
export function findNextProductionWorldRegistration(
  currentLevel: number,
  registrations: readonly WorldFileRegistration[] = PRODUCTION_WORLD_REGISTRATIONS,
): WorldFileRegistration | null {
  const matches = registrations.filter((reg) => reg.level === currentLevel + 1);
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new OrchestrationError(
      ErrorCode.INVALID_GAME_STATE,
      `Multiple production worlds are registered at campaign level ${currentLevel + 1}`,
      {
        reason: 'next_world_ambiguous',
        currentLevel,
        nextLevel: currentLevel + 1,
        worldIds: matches.map((reg) => reg.worldId),
      },
    );
  }
  return matches[0] ?? null;
}
