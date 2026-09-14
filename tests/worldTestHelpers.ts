import { Territory, TerritoryId } from '../src/types';
import { GameState, RuntimeRegion } from '../src/types/GameState';
import { ensureCity } from '../src/gameplay/cities/city';

/** Hand-built test GameState identity. Not an authored production world. */
export function authoredWorldFields(territories: Map<TerritoryId, Territory>): Pick<
  GameState,
  'definitionWorldId' | 'definitionFormatVersion' | 'worldLevel' | 'worldName' | 'regions'
> {
  const byRegion = new Map<string, TerritoryId[]>();
  for (const t of territories.values()) {
    if (!t.regionId) t.regionId = 'r_test';
    const list = byRegion.get(t.regionId) ?? [];
    list.push(t.id);
    byRegion.set(t.regionId, list);
  }
  const regions = new Map<string, RuntimeRegion>();
  for (const [id, territoryIds] of byRegion) {
    regions.set(id, { id, name: id === 'r_test' ? 'Test' : id, territoryIds });
  }
  return {
    definitionWorldId: 'test:fixture',
    definitionFormatVersion: 'legacy-sample-map',
    worldLevel: 1,
    worldName: 'Test Fixture',
    regions,
  };
}

/** Explicit city for fortification/BUILD tests. Does not invent spawn cities. */
export function plantCity(state: GameState, territoryId: string): void {
  const territory = state.territories.get(territoryId);
  if (!territory?.owner) {
    throw new Error(`plantCity: ${territoryId} must exist and have an owner`);
  }
  ensureCity(state, territoryId, territory.owner);
}

/** Keep region membership in sync when a test deletes a territory. */
export function dropTerritoryFromRegions(state: GameState, territoryId: string): void {
  for (const region of state.regions.values()) {
    region.territoryIds = region.territoryIds.filter((id) => id !== territoryId);
  }
}

export function plantOwnedCities(state: GameState): void {
  for (const territory of state.territories.values()) {
    if (territory.owner) ensureCity(state, territory.id, territory.owner);
  }
}
