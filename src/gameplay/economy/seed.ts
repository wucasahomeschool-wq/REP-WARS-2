import { emptyTerritoryInfrastructure, GameState } from '../../types/GameState';
import { emptyResources } from './config';

/** Seed per-territory accrual ledgers and empty development occupancy. Does not create cities or Farms. */
export function seedTerritoryEconomy(state: GameState): void {
  for (const territory of state.territories.values()) {
    if (!state.territoryEconomy.has(territory.id)) {
      state.territoryEconomy.set(territory.id, {
        territoryId: territory.id,
        lastAccrualTick: state.worldTick,
        uncollected: emptyResources(),
      });
    }
    if (!state.territoryInfrastructure.has(territory.id)) {
      state.territoryInfrastructure.set(territory.id, emptyTerritoryInfrastructure(territory.id));
    }
  }
}

/** @deprecated Use seedTerritoryEconomy. Cities are never created at spawn. */
export function seedEconomyAndCities(state: GameState): void {
  seedTerritoryEconomy(state);
}
