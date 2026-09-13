import { persistAllTerritoryAccrual } from './accrual';
import { progressAllConstructions } from '../construction/progress';
import { GameState } from '../../types/GameState';

/**
 * One catch-up pass after world time jumps. Not an inner per-tick loop.
 * Accrual and construction remaining time are computed from last-progress
 * stamps, so offline hours/days collapse into a single update.
 */
export function progressWorldEconomy(state: GameState): void {
  persistAllTerritoryAccrual(state);
  progressAllConstructions(state);
}
