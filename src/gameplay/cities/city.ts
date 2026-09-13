import { FactionId, TerritoryId } from '../../types';
import { City, CityId, GameState } from '../../types/GameState';

export function cityIdFor(territoryId: TerritoryId): CityId {
  return `city_${territoryId}`;
}

/** Prototype 1: one city per owned territory. Fortification level stays on the territory. */
export function ensureCity(state: GameState, territoryId: TerritoryId, factionId: FactionId): City {
  const id = cityIdFor(territoryId);
  const existing = state.cities.get(id);
  if (existing) {
    existing.factionId = factionId;
    existing.territoryId = territoryId;
    return existing;
  }
  const city: City = {
    id,
    territoryId,
    factionId,
    buildings: [],
  };
  state.cities.set(id, city);
  return city;
}

export function removeCity(state: GameState, territoryId: TerritoryId): void {
  state.cities.delete(cityIdFor(territoryId));
}

export function syncCityFortification(
  state: GameState,
  territoryId: TerritoryId,
  level: number,
  completedAtTick: number,
): void {
  const territory = state.territories.get(territoryId);
  if (!territory?.owner) return;
  const city = ensureCity(state, territoryId, territory.owner);
  const existing = city.buildings.find((building) => building.type === 'FORTIFICATION');
  if (existing) {
    existing.level = level;
    existing.completedAtTick = completedAtTick;
    return;
  }
  if (level > 0) {
    city.buildings.push({
      type: 'FORTIFICATION',
      level,
      completedAtTick,
    });
  }
}
