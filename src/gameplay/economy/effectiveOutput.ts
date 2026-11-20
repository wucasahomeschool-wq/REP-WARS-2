import { Resources, TerritoryId } from '../../types';
import { GameState, TerritoryInfrastructure, emptyTerritoryInfrastructure } from '../../types/GameState';
import { ECONOMY_CONFIG, RESOURCE_KEYS, emptyResources } from './config';
import {temporaryProductionOutput} from '../../events/productionBonuses';

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
 * Collectible / income rating for one tile. Starts from canonical
 * `resourceOutput` (persistent authoritative production, including legacy
 * applied consequences). Add active event bonuses against that basis, then
 * retain the existing development multipliers. Developments never scale Gold.
 */
export function effectiveResourceOutput(
  state: GameState,
  territory: { id: string; resourceOutput: Partial<Resources> },
): Resources {
  const out = emptyResources();
  // Historical event records can be large. Select the bounded relevant window
  // once for this query rather than rescanning history for every resource.
  const bonuses = state.activeEvents.filter(e => e.productionBonusPolicy && e.territoryId === territory.id
    && state.turn >= e.startedTurn && state.turn < e.expiresTurn);
  for (const key of RESOURCE_KEYS) {
    const raw = territory.resourceOutput[key];
    out[key] = temporaryProductionOutput(typeof raw === 'number' && Number.isFinite(raw) ? raw : 0,
      key, territory.id, state.turn, bonuses);
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
