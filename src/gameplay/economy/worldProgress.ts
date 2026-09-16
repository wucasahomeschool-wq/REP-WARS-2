import { persistAllTerritoryAccrual } from './accrual';
import { consumeEmpireFood } from './foodConsumption';
import { progressAllConstructions } from '../construction/progress';
import { GameState } from '../../types/GameState';
import type { FoodConsumptionResult } from './foodConsumption';

/**
 * One catch-up pass after world time jumps. Not an inner per-tick loop.
 * Accrual, Food consume, and construction remaining time use last-progress
 * stamps, so offline hours/days collapse into a single update.
 * Order: persist accrual → Food consume → constructions.
 */
export function progressWorldEconomy(state: GameState): FoodConsumptionResult {
  persistAllTerritoryAccrual(state);
  const food = consumeEmpireFood(state);
  progressAllConstructions(state);
  return food;
}
