import { Territory, TerritoryId } from '../../types';
import { GameState } from '../../types/GameState';
import { cityIdFor } from '../cities/city';
import { GAMEPLAY_CONFIG } from '../config';
import { withTerritoryBattleLabel } from '../../worldDefinition/display';

export function cityCombatModifiersEnabled(state: GameState): boolean {
  return typeof state.worldLevel === 'number' && state.worldLevel >= 2;
}

export function territoryHasCity(state: GameState, territoryId: TerritoryId): boolean {
  return state.cities.has(cityIdFor(territoryId));
}

/**
 * City presence factor for military defense. Fort % stays in CombatPower.
 * Level 1 (`worldLevel < 2`) is always 1.0 so scripted tutorial battles
 * keep their existing outcomes.
 */
export function combatDefenseMultiplier(state: GameState, territoryId: TerritoryId): number {
  if (!cityCombatModifiersEnabled(state) || !territoryHasCity(state, territoryId)) {
    return GAMEPLAY_CONFIG.citylessCombatDefenseFactor;
  }
  return GAMEPLAY_CONFIG.cityCombatDefenseFactor;
}

/**
 * Multiplier applied to stored DEFENSE workout `defensePower` when assembling
 * the virtual defender. Does not change fitness conversion.
 */
export function defenseWorkoutMultiplier(state: GameState, territoryId: TerritoryId): number {
  if (!cityCombatModifiersEnabled(state) || !territoryHasCity(state, territoryId)) {
    return GAMEPLAY_CONFIG.citylessDefenseWorkoutFactor;
  }
  const fort = Math.max(0, state.territories.get(territoryId)?.fortification ?? 0);
  return Math.min(
    GAMEPLAY_CONFIG.defenseWorkoutMultiplierCap,
    GAMEPLAY_CONFIG.cityDefenseWorkoutBase + GAMEPLAY_CONFIG.defenseWorkoutFortBonusPerLevel * fort,
  );
}

/** BattleEngine territory view: region label + gated City combat flags. */
export function withTerritoryCombatView<T extends Territory>(
  state: GameState,
  territory: T,
): T & { name: string; hasCity: boolean; cityDefenseFactor: number } {
  return {
    ...withTerritoryBattleLabel(state, territory),
    hasCity: cityCombatModifiersEnabled(state) && territoryHasCity(state, territory.id),
    cityDefenseFactor: combatDefenseMultiplier(state, territory.id),
  };
}
