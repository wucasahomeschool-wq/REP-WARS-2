/** INITIAL IMPLEMENTATION TUNING — NOT LOCKED DESIGN. No scoring coefficients. */
export const STRATEGIC_PRESSURE_TUNING = Object.freeze({
  maximum: 100_000, ready: 10_000, unitsPerOnlineSecond: 100,
  successfulInitiationRelief: 8_000, waitRelief: 3_000,
  goalAmplifierNumerator: 125, goalAmplifierDenominator: 100,
  credibleForceRatioNumerator: 3, credibleForceRatioDenominator: 4,
});
/** Locked timing/rate rules, deliberately separate from initial pressure tuning. */
export const PROACTIVE_TEMPORAL_RULES = Object.freeze({
  pressureOfflineDivisor: 50,
  waitOnlineMs: 2_000, waitOfflineMs: 60_000,
  spacingOnlineMinMs: 45_000, spacingOnlineMaxMs: 75_000, spacingOfflineDivisor: 100,
  deliberation: { routine: [6_000,10_000,50], standard: [12_000,20_000,50], major: [25_000,40_000,60] },
});
