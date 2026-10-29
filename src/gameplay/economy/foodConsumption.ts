import {reservedResource} from '../trade/resources';
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

/** Shared factual demand for upkeep, AI observation and resource valuation. */
export function empireFoodDemand(state:GameState,factionId:string):number {
  if(foodConsumptionDisabled(state))return 0;
  const owned=[...state.territories.values()].filter(t=>t.owner===factionId);
  if(!owned.length)return 0;
  const demand=state.empireFoodBaselinePerCycle+owned.reduce((n,t)=>n+(t.foodUpkeep??ECONOMY_CONFIG.foodPerTerritoryPerCycle),0);
  if(!Number.isSafeInteger(demand))throw new Error('Food demand overflow');return demand;
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
    const owned=[...state.territories.values()].filter(t=>t.owner===factionId);
    if(owned.length===0)continue;
    const demandPerCycle = empireFoodDemand(state,factionId);
    if(!Number.isSafeInteger(demandPerCycle)||!Number.isSafeInteger(demandPerCycle*cycles))throw new Error('Food demand overflow');
    const foodBefore = Math.max(0, faction.resources.food);
    const stabilityBefore = faction.stability;
    const reserved=reservedResource(state,factionId,'food');
    const applied = applyFactionCycles(Math.max(0,foodBefore-reserved), stabilityBefore, demandPerCycle, cycles);
    faction.resources.food = applied.foodAfter+reserved;
    faction.stability = applied.stabilityAfter;
    factions.push({
      factionId,
      demandPerCycle,
      cycles,
      demand: demandPerCycle * cycles,
      paid: applied.paid,
      failedCycles: applied.failedCycles,
      foodBefore,
      foodAfter: faction.resources.food,
      stabilityBefore,
      stabilityAfter: applied.stabilityAfter,
    });
  }

  state.lastFoodConsumptionTick = toTick;
  return { cycles, gated: false, fromTick, toTick, factions };
}
