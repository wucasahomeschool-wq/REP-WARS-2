import { GameState } from '../../types/GameState';
import { ensureCity, syncCityFortification } from '../cities/city';
import { emptyResources } from './config';

/** Seeds city + accrual records for a freshly created canonical GameState. */
export function seedEconomyAndCities(state: GameState): void {
  for (const territory of state.territories.values()) {
    if (!state.territoryEconomy.has(territory.id)) {
      state.territoryEconomy.set(territory.id, {
        territoryId: territory.id,
        lastAccrualTick: state.worldTick,
        uncollected: emptyResources(),
      });
    }
    if (territory.owner) {
      ensureCity(state, territory.id, territory.owner);
      if (territory.fortification > 0) {
        syncCityFortification(state, territory.id, territory.fortification, state.worldTick);
      }
    }
  }
}
