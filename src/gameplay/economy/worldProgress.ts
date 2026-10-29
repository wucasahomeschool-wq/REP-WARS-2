import { persistAllTerritoryAccrual } from './accrual';
import { consumeEmpireFood } from './foodConsumption';
import { progressAllConstructions } from '../construction/progress';
import { GameState } from '../../types/GameState';
import type { FoodConsumptionResult } from './foodConsumption';

/**
 * Settle economy at the current authoritative boundary. Durable progress stamps
 * prevent duplicate effects. The world runner supplies intermediate production,
 * upkeep and construction boundaries during catch-up; this reducer does not
 * replace that ordering with one aggregate offline update.
 * Order: persist accrual → Food consume → constructions.
 */
export function progressWorldEconomy(state: GameState): FoodConsumptionResult {
  if(state.levelDefeat.status==='defeated'){const fromTick=state.lastFoodConsumptionTick;state.lastFoodConsumptionTick=state.worldTick;return {cycles:0,gated:true,fromTick,toTick:state.worldTick,factions:[]};}
  persistAllTerritoryAccrual(state);
  const food = consumeEmpireFood(state);
  progressAllConstructions(state);
  return food;
}
