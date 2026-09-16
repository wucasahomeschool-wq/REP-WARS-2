import { Resources, TerritoryId } from '../../types';
import { GameState, TerritoryInfrastructure, emptyTerritoryInfrastructure } from '../../types/GameState';
import { ECONOMY_CONFIG, RESOURCE_KEYS, emptyResources } from './config';

export function ensureTerritoryInfrastructure(state: GameState, territoryId: TerritoryId): TerritoryInfrastructure {
  let rec = state.territoryInfrastructure.get(territoryId);
  if (!rec) {
    rec = emptyTerritoryInfrastructure(territoryId);
    state.territoryInfrastructure.set(territoryId, rec);
  }
  return rec;
}

export function clearTerritoryInfrastructure(state: GameState, territoryId: TerritoryId): void {
  const rec = ensureTerritoryInfrastructure(state, territoryId);
  rec.farmCompletedAtTick = null;
  rec.mineCompletedAtTick = null;
  rec.lumberCompletedAtTick = null;
}

function scaleMatchingOutput(raw: number, multiplier: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return 0;
  return raw * multiplier;
}

/**
 * Collectible / income rating for one tile. Starts from authored
 * `resourceOutput` (events already applied) and multiplies matching
 * keys when a development occupies the tile. Gold is never scaled.
 */
export function effectiveResourceOutput(
  state: GameState,
  territory: { id: string; resourceOutput: Partial<Resources> },
): Resources {
  const out = emptyResources();
  for (const key of RESOURCE_KEYS) {
    const raw = territory.resourceOutput[key];
    out[key] = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  }
  const infra = state.territoryInfrastructure.get(territory.id);
  if (!infra) return out;
  const multiplier = ECONOMY_CONFIG.developmentOutputMultiplier;
  if (infra.farmCompletedAtTick !== null) {
    out.food = scaleMatchingOutput(out.food, multiplier);
  }
  if (infra.mineCompletedAtTick !== null) {
    out.iron = scaleMatchingOutput(out.iron, multiplier);
    out.stone = scaleMatchingOutput(out.stone, multiplier);
  }
  if (infra.lumberCompletedAtTick !== null) {
    out.wood = scaleMatchingOutput(out.wood, multiplier);
  }
  return out;
}
