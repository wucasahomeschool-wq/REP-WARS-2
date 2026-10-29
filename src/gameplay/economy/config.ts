import { Resources, ResourceType } from '../../types';

/**
 * Prototype economy balance (economy-config.v1).
 *
 * Production is automatically banked and tick-based. `Territory.resourceOutput[r]` is the
 * integer yield of resource `r` produced every `ticksPerProductionCycle`
 * world ticks while the territory is owned. Prototype clock: 1 tick = 1
 * minute, so the default cycle of 60 ticks is one scheduled hour.
 *
 * Production between ticks t0 and t1 is telescoping so chunked world
 * advances match a single jump:
 *   gain[r] = floor(rating[r] * t1 / cycle) - floor(rating[r] * t0 / cycle)

 *
 * Canonical stored reserves live on `WarlordSnapshot.resources`. There is
 * no parallel EconomyState. `GameState.territoryEconomy` retains production
 * watermarks and nonspendable eligibility for a manual Golden Yield bonus.
 *
 * Ownership transfer: banked resources are retained; unused bonus eligibility
 * is cleared; the new owner's production clock starts at the transfer tick;
 * in-progress construction on that territory is cancelled without refund.
 *
 * Prototype 1 allows one in-progress construction per territory/city.
 * No resource caps beyond Number.isSafeInteger.
 */
export const ECONOMY_CONFIG = Object.freeze({
  configVersion: 'economy-config.v1' as const,
  ticksPerProductionCycle: 60,
  /** Legacy fallback per territory/cycle; explicit authored Food upkeep overrides it. */
  foodPerTerritoryPerCycle: 1,
  /** Stability lost per failed Food cycle. Clamp is 0–100. */
  failedFoodCycleStabilityPenalty: 2,
  /** Farm / Mine / Lumber multiplier on matching authored output. Zeros stay 0. */
  developmentOutputMultiplier: 1.5,
});

export type EconomyConfig = typeof ECONOMY_CONFIG;

export const RESOURCE_KEYS: readonly ResourceType[] = ['gold', 'food', 'iron', 'wood', 'stone'];

export function emptyResources(): Resources {
  return { gold: 0, food: 0, iron: 0, wood: 0, stone: 0 };
}

export function cloneResources(resources: Resources): Resources {
  return {
    gold: resources.gold,
    food: resources.food,
    iron: resources.iron,
    wood: resources.wood,
    stone: resources.stone,
  };
}
