/** INITIAL IMPLEMENTATION TUNING — NOT LOCKED DESIGN.
 * No authored recruitment rate/City recruitment effect existed before Phase G.
 * Rates are per earned simulation tick, never per real-time/presence second.
 */
export const RECRUITMENT_TUNING = Object.freeze({
  troopsPerSimulationTick: 1,
  /** Legacy fixture/migration reference; NOT charged by empire-bank recruitment. */
  foodPerTroop: 1,
  completedCityRateMultiplier: 2,
  meaningfulBatch: 50,
  /** Comparator normalization weight for consumed local reserve flexibility. */
  reserveFlexibilityWeight: 5,
});

/** Legacy local-pool initiation compatibility only. Bank deployment is immediate. */
export const REINFORCE_INITIATION = Object.freeze({initiationOnlineMs:1000,initiationOfflineMs:10000});
