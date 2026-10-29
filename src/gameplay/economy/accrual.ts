import { TerritoryId } from '../../types';
import { GameState, TerritoryEconomy } from '../../types/GameState';
import { emptyResources } from './config';
import { addResourcesChecked, productionAccruedBetween } from './production';
import { effectiveResourceOutput } from './effectiveOutput';

function createEconomyRecord(territoryId: TerritoryId, lastAccrualTick: number): TerritoryEconomy {
  return {
    territoryId,
    lastAccrualTick,
    uncollected: emptyResources(),
  };
}

/** Unbanked production since the durable accrual watermark. Legacy Food-only
 * watermarks are honored during migration; missing records never backfill. */
export function pendingProduction(state: GameState, territoryId: TerritoryId) {
  const territory = state.territories.get(territoryId);
  const rec = state.territoryEconomy.get(territoryId);
  if (!territory || territory.owner === null || !rec) return emptyResources();
  const output = effectiveResourceOutput(state, territory);
  const extra = productionAccruedBetween(output, rec.lastAccrualTick, state.worldTick);
  if (rec.foodAccrualTick !== undefined) {
    extra.food = productionAccruedBetween({ food: output.food }, Math.max(rec.lastAccrualTick, rec.foodAccrualTick), state.worldTick).food;
  }
  return extra;
}

/** Read-only Golden Yield eligibility basis, including newly earned production.
 * This is NOT a second spendable resource balance. The legacy field name is
 * retained for save/API compatibility; collection can credit only its bonus. */
export function peekCollectibleResources(state: GameState, territoryId: TerritoryId) {
  const territory = state.territories.get(territoryId);
  const rec = state.territoryEconomy.get(territoryId);
  if (!territory || territory.owner === null || !rec) return emptyResources();
  return addResourcesChecked(rec.uncollected, pendingProduction(state, territoryId));
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
  const produced = pendingProduction(state, territoryId);
  const eligible = addResourcesChecked(rec.uncollected, produced);
  const faction=state.factions.get(territory.owner);
  if(!faction)throw new Error('Production owner missing');
  faction.resources=addResourcesChecked(faction.resources,produced);
  rec.uncollected=eligible;
  rec.lastAccrualTick = state.worldTick;
  if(rec.foodAccrualTick!==undefined)rec.foodAccrualTick=state.worldTick;
  return rec;
}

export function persistAllTerritoryAccrual(state: GameState): void {
  for (const territoryId of state.territories.keys()) {
    persistTerritoryAccrual(state, territoryId);
  }
}

/** Compatibility alias; all resource production now goes directly to the bank. */
export function persistTerritoryFoodAccrual(state:GameState,territoryId:TerritoryId):void {
  persistTerritoryAccrual(state,territoryId);
}
