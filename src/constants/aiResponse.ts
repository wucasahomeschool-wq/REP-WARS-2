/** Locked cognition authoring ranges (Source of Truth §19). */
export const RESPONSE_TIMING=Object.freeze({critical:[1000,2000,5],urgent:[2000,5000,10]} as const);
/** PROVISIONAL IMPLEMENTATION POLICY — PRODUCT CONFIRMATION REQUIRED.
 * INITIAL IMPLEMENTATION TUNING — NOT LOCKED DESIGN.
 * Severity/meaningfulness are factual thresholds, not preference scores.
 * Required thought bypasses capacity; a CRITICAL survival intervention may
 * temporarily occupy at most two additional units, owned by its operation.
 */
export const RESPONSE_POLICY=Object.freeze({
  emergencyExtraCapacity:2,
  criticalArrivalTicks:1, urgentArrivalTicks:3, materialTroopBatch:50,
  severityOrder:{CRITICAL:0,URGENT:1,REQUIRED:2,RECOVERY:3},
  irreversibility:{incoming:1,routine:0},
});
