import { GameState } from '../types/GameState';
import { Territory, TerritoryId } from '../types';

/** Player-facing geography is the region name, never a territory title. */
export function regionDisplayName(state: GameState, territoryId: TerritoryId): string {
  const territory = state.territories.get(territoryId);
  if (!territory) return territoryId;
  return state.regions.get(territory.regionId)?.name ?? territory.regionId;
}

/** BattleEngine still wants a display label; this is the region name, not a tile title. */
export function withTerritoryBattleLabel<T extends Territory>(
  state: GameState,
  territory: T,
): T & { name: string } {
  return { ...territory, name: regionDisplayName(state, territory.id) };
}
