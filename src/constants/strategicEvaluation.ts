/** INITIAL IMPLEMENTATION TUNING — NOT LOCKED DESIGN.
 * Dimension scales normalize facts; they are not market exchange rates. */
export const STRATEGIC_EVALUATION_TUNING = Object.freeze({
  contributionBound: 100, comparisonBound: 400,
  minimumCommitmentAdvantage: 5, nearTieBand: 2,
  powerScale: 300, territoryScale: 10, resourceScale: 8,
  timingScaleTicks: 30, productionHorizonCycles: 6,
  infrastructureUnits: 2, connectivityUnits: 1, dependencyUnits: 2,
  battleWeight: 35, territoryWeight: 25, positionWeight: 30,
  dangerWeight: 30, buildBenefitWeight: 70, buildCostWeight: 25,
  timingWeight: 5, attentionWeight: 5, uncertaintyWeight: 10,
  modifierBound: 8, modifierStackBound: 12, goalScale: 30,
  scarcityThresholdUtility: 2,
});
