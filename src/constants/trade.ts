/** LOCKED Temporal V2 process timing. */
export const TRADE_TIMING = Object.freeze({initiationOnlineMs:2000,initiationOfflineMs:60000,loadOnlineMs:10000,loadOfflineMs:60000,unloadOnlineMs:5000,unloadOfflineMs:30000});
/** PROVISIONAL IMPLEMENTATION POLICY — PRODUCT CONFIRMATION REQUIRED.
 * No Trade-specific response ranges are authored in the final Source of Truth.
 * Reuse proposal-response timing, centrally, without treating it as doctrine. */
export const TRADE_RESPONSE_POLICY = Object.freeze({onlineMinMs:3000,onlineMaxMs:8000,offlineDivisor:10,playerOnlineMs:300000,playerOfflineMs:7200000});
/** INITIAL IMPLEMENTATION TUNING — NOT LOCKED DESIGN. One exchange per ordered
 * resource pair, capped meaningful quantity, no exchange-rate doctrine. */
export const TRADE_TUNING = Object.freeze({batch:50,resourceWeight:100});
