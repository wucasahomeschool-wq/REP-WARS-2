import { TerritoryId } from '../../types';
import { GameState, TerritoryEconomy } from '../../types/GameState';
import { emptyResources } from './config';
import { addResourcesClamped, productionAccruedBetween } from './production';
import { effectiveResourceOutput } from './effectiveOutput';

function createEconomyRecord(territoryId: TerritoryId, lastAccrualTick: number): TerritoryEconomy {
  return {
    territoryId,
    lastAccrualTick,
    uncollected: emptyResources(),
  };
}

/**
 * Read-only collectible yield: stored uncollected + production since
 * lastAccrualTick. Missing records do not backfill from world start.
 */
export function peekCollectibleResources(state: GameState, territoryId: TerritoryId) {
  const territory = state.territories.get(territoryId);
  if (!territory || territory.owner === null) return emptyResources();
  const rec = state.territoryEconomy.get(territoryId);
  if (!rec) return emptyResources();
  const extra = productionAccruedBetween(effectiveResourceOutput(state, territory), rec.lastAccrualTick, state.worldTick);
  return addResourcesClamped(rec.uncollected, extra);
}

export function persistTerritoryAccrual(state: GameState, territoryId: TerritoryId): TerritoryEconomy {
  const territory = state.territories.get(territoryId);
  let rec = state.territoryEconomy.get(territoryId);
  if (!rec) {
    rec = createEconomyRecord(territoryId, state.worldTick);
    state.territoryEconomy.set(territoryId, rec);
  }
  if (!territory || territory.owner === null) {
    rec.uncollected = emptyResources();
    rec.lastAccrualTick = state.worldTick;
    return rec;
  }
  rec.uncollected = peekCollectibleResources(state, territoryId);
  rec.lastAccrualTick = state.worldTick;
  return rec;
}

export function persistAllTerritoryAccrual(state: GameState): void {
  for (const territoryId of state.territories.keys()) {
    persistTerritoryAccrual(state, territoryId);
  }
}
