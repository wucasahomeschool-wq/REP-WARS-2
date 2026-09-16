import { GameState } from '../../types/GameState';
import { ECONOMY_CONFIG } from './config';

export interface FoodConsumptionFactionResult {
  factionId: string;
  demandPerCycle: number;
  cycles: number;
  demand: number;
  paid: number;
  failedCycles: number;
  foodBefore: number;
  foodAfter: number;
  stabilityBefore: number;
  stabilityAfter: number;
}

export interface FoodConsumptionResult {
  cycles: number;
  gated: boolean;
  fromTick: number;
  toTick: number;
  factions: FoodConsumptionFactionResult[];
}

function emptyResult(fromTick: number, toTick: number, cycles: number, gated: boolean): FoodConsumptionResult {
  return { cycles, gated, fromTick, toTick, factions: [] };
}

function clampStability(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * Food consume is skipped on the Level 1 tutorial (`worldLevel < 2`).
 * The consumption clock still advances so enabling it later does not
 * back-charge gated time.
 */
export function foodConsumptionDisabled(state: GameState): boolean {
  const level = state.worldLevel;
  return typeof level !== 'number' || level < 2;
}

function applyFactionCycles(
  foodBefore: number,
  stabilityBefore: number,
  demandPerCycle: number,
  cycles: number,
): { foodAfter: number; stabilityAfter: number; paid: number; failedCycles: number } {
  const demand = demandPerCycle * cycles;
  if (demandPerCycle <= 0 || cycles <= 0) {
    return { foodAfter: foodBefore, stabilityAfter: stabilityBefore, paid: 0, failedCycles: 0 };
  }
  if (foodBefore >= demand) {
    return {
      foodAfter: foodBefore - demand,
      stabilityAfter: stabilityBefore,
      paid: demand,
      failedCycles: 0,
    };
  }
  const fullCyclesPaid = Math.floor(foodBefore / demandPerCycle);
  const failedCycles = cycles - fullCyclesPaid;
  return {
    foodAfter: 0,
    stabilityAfter: clampStability(
      stabilityBefore - ECONOMY_CONFIG.failedFoodCycleStabilityPenalty * failedCycles,
    ),
    paid: Math.max(0, foodBefore),
    failedCycles,
  };
}

/**
 * Telescoping banked-Food consume aligned to the production cycle.
 * Pays from `faction.resources.food` only. Uncollected tile Food is ignored.
 * One pass: cycle count is `floor(to/cycle) - floor(from/cycle)`.
 */
export function consumeEmpireFood(state: GameState): FoodConsumptionResult {
  const fromTick = state.lastFoodConsumptionTick;
  const toTick = state.worldTick;
  const cycle = ECONOMY_CONFIG.ticksPerProductionCycle;
  const cycles = Math.max(0, Math.floor(toTick / cycle) - Math.floor(fromTick / cycle));
  const gated = foodConsumptionDisabled(state);

  if (cycles <= 0) {
    state.lastFoodConsumptionTick = toTick;
    return emptyResult(fromTick, toTick, 0, gated);
  }

  if (gated) {
    state.lastFoodConsumptionTick = toTick;
    return emptyResult(fromTick, toTick, cycles, true);
  }

  const factions: FoodConsumptionFactionResult[] = [];
  for (const factionId of state.allFactionIds) {
    const faction = state.factions.get(factionId);
    if (!faction) continue;
    const demandPerCycle = faction.territories.length * ECONOMY_CONFIG.foodPerTerritoryPerCycle;
    const foodBefore = Math.max(0, faction.resources.food);
    const stabilityBefore = faction.stability;
    const applied = applyFactionCycles(foodBefore, stabilityBefore, demandPerCycle, cycles);
    faction.resources.food = applied.foodAfter;
    faction.stability = applied.stabilityAfter;
    factions.push({
      factionId,
      demandPerCycle,
      cycles,
      demand: demandPerCycle * cycles,
      paid: applied.paid,
      failedCycles: applied.failedCycles,
      foodBefore,
      foodAfter: applied.foodAfter,
      stabilityBefore,
      stabilityAfter: applied.stabilityAfter,
    });
  }

  state.lastFoodConsumptionTick = toTick;
  return { cycles, gated: false, fromTick, toTick, factions };
}
