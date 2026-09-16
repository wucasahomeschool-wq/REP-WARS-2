import { FactionId, Resources } from '../../types';
import { GameState } from '../../types/GameState';
import { RESOURCE_KEYS, emptyResources } from './config';
import { effectiveResourceOutput } from './effectiveOutput';

/**
 * Derived per-cycle income **rating** for AI scoring and event triggers.
 *
 * Authoritative production remains:
 *   `Territory.resourceOutput` → `territoryEconomy` → COLLECT → `faction.resources`
 *
 * This field is recomputed from owned tile **effective** output on init,
 * development completion, and ownership changes. Event `resourceOutputPct`
 * without a territory may still mutate `resourceIncome` directly between recomputes.
 */
export function deriveFactionResourceIncome(state: GameState, factionId: FactionId): Partial<Resources> {
  const faction = state.factions.get(factionId);
  if (!faction) return {};
  const out = emptyResources();
  for (const territoryId of faction.territories) {
    const territory = state.territories.get(territoryId);
    if (!territory) continue;
    const effective = effectiveResourceOutput(state, territory);
    for (const key of RESOURCE_KEYS) {
      const raw = effective[key];
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) continue;
      out[key] += Math.floor(raw);
    }
  }
  return out;
}

export function syncFactionResourceIncome(state: GameState, factionId: FactionId): void {
  const faction = state.factions.get(factionId);
  if (!faction) return;
  faction.resourceIncome = deriveFactionResourceIncome(state, factionId);
}

export function syncAllFactionResourceIncome(state: GameState): void {
  for (const factionId of state.allFactionIds) {
    syncFactionResourceIncome(state, factionId);
  }
}
