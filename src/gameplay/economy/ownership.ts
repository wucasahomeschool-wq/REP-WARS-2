import { FactionId, TerritoryId } from '../../types';
import { GameState } from '../../types/GameState';
import { ensureCity, removeCity, syncCityFortification } from '../cities/city';
import { emptyResources } from './config';
import { persistTerritoryAccrual } from './accrual';

/**
 * Apply the Prototype 1 ownership-transfer settlement:
 * 1. Stop the previous owner's production clock (lastAccrualTick = now).
 * 2. Forfeit uncollected yield. It is not deposited into either reserve.
 * 3. Cancel in-progress construction on the territory without refund.
 * 4. Reassign or create the city for the new owner; remove it if unowned.
 *
 * Call after `territory.owner` and faction territory lists are updated.
 */
export function settleTerritoryOwnershipChange(
  state: GameState,
  territoryId: TerritoryId,
  newOwner: FactionId | null,
): void {
  persistTerritoryAccrual(state, territoryId);
  const rec = state.territoryEconomy.get(territoryId);
  if (rec) {
    rec.uncollected = emptyResources();
    rec.lastAccrualTick = state.worldTick;
  }
  for (const [id, project] of [...state.constructions.entries()]) {
    if (project.territoryId === territoryId && project.status === 'in_progress') {
      state.constructions.delete(id);
    }
  }
  if (newOwner) {
    ensureCity(state, territoryId, newOwner);
    const territory = state.territories.get(territoryId);
    if (territory && territory.fortification > 0) {
      syncCityFortification(state, territoryId, territory.fortification, state.worldTick);
    }
  } else {
    removeCity(state, territoryId);
  }
}
