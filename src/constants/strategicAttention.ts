/** INITIAL IMPLEMENTATION TUNING — NOT LOCKED DESIGN.
 * No progression, emergency overflow, cognition timers or physical modifiers.
 * Persisted capacities/costs survive later configuration changes.
 */
export const STRATEGIC_ATTENTION_TUNING = Object.freeze({
  capacity: 6,
  costs: Object.freeze({ ATTACK: 3, MOVE: 2, RETREAT: 2, BUILD: 1,
    TRADE: 1, OFFER_PEACE: 1, REINFORCE: 0, WAIT: 0 }),
});
