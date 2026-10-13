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
  if(rec.foodAccrualTick!==undefined)extra.food=productionAccruedBetween({food:effectiveResourceOutput(state,territory).food},Math.max(rec.lastAccrualTick,rec.foodAccrualTick),state.worldTick).food;
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

/** Narrow local Food availability for recruitment. Other resources retain their
 * existing lazy accrual/collection behavior and stamps. No bank transfer. */
export function persistTerritoryFoodAccrual(state:GameState,territoryId:TerritoryId):void {
  const t=state.territories.get(territoryId);
  const rec=state.territoryEconomy.get(territoryId)??persistTerritoryAccrual(state,territoryId);
  if(t?.owner) {
    const extra=productionAccruedBetween({food:effectiveResourceOutput(state,t).food},Math.max(rec.lastAccrualTick,rec.foodAccrualTick??rec.lastAccrualTick),state.worldTick);
    rec.uncollected=addResourcesClamped(rec.uncollected,extra);
  }
  rec.foodAccrualTick=state.worldTick;
}
