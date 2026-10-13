/** LOCKED Temporal V2 process durations, in milliseconds. */
export const PEACE_TIMING = Object.freeze({
  initiationOnlineMs:1000, initiationOfflineMs:30000,
  responseOnlineMinMs:3000, responseOnlineMaxMs:8000, responseOfflineDivisor:10,
  playerResponseOnlineMs:300000, playerResponseOfflineMs:7200000,
  finalizationOnlineMs:2000, finalizationOfflineMs:10000,
});
/** INITIAL IMPLEMENTATION TUNING — NOT LOCKED DESIGN.
 * No authored Peace term existed. Treaty expiry is a REAL_WORLD deadline;
 * initial 24-hour term is not a final balance rule. No auto-attack at expiry.
 */
export const PEACE_TUNING = Object.freeze({ treatyDurationMs:86400000, warPositionWeight:70 });
