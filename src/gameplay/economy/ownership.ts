import { FactionId, TerritoryId } from '../../types';
import { GameState } from '../../types/GameState';
import { removeCity } from '../cities/city';
import { emptyResources } from './config';
import { persistTerritoryAccrual } from './accrual';

/**
 * Ownership-transfer settlement:
 * 1. Stop the previous owner's production clock.
 * 2. Forfeit uncollected yield.
 * 3. Cancel in-progress construction without refund.
 * 4. Destroy any city on the territory. The new owner receives bare land.
 */
export function settleTerritoryOwnershipChange(
  state: GameState,
  territoryId: TerritoryId,
  _newOwner: FactionId | null,
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
  removeCity(state, territoryId);
  const territory = state.territories.get(territoryId);
  if (territory) {
    territory.fortification = 0;
    territory.garrison = 0;
  }
}
