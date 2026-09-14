import { GameState } from '../../types/GameState';
import { emptyResources } from './config';

/** Seed per-territory accrual ledgers. Does not create cities. */
export function seedTerritoryEconomy(state: GameState): void {
  for (const territory of state.territories.values()) {
    if (!state.territoryEconomy.has(territory.id)) {
      state.territoryEconomy.set(territory.id, {
        territoryId: territory.id,
        lastAccrualTick: state.worldTick,
        uncollected: emptyResources(),
      });
    }
  }
}

/** @deprecated Use seedTerritoryEconomy. Cities are never created at spawn. */
export function seedEconomyAndCities(state: GameState): void {
  seedTerritoryEconomy(state);
}
