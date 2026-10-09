/** INITIAL IMPLEMENTATION TUNING — NOT LOCKED DESIGN.
 * PROVISIONAL IMPLEMENTATION TUNING — PRODUCT CONFIRMATION REQUIRED.
 * Reuse historical bounded Opinion range and supported event magnitudes.
 * Formula/creation/capacity policy still requires product confirmation. */
export const COGNITION_TUNING=Object.freeze({
  opinionRange:100,opinionModifierBound:8,
  goalDefaultPriority:50,
  eventDelta:Object.freeze({attack_received:-40,territory_lost:-25,treaty_signed:30,trade_completed:5}),
});
