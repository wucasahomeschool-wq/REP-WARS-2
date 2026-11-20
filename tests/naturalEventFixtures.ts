import {BALANCE} from '../src/constants/balance';

/** Synchronous component isolation only. Does not disable active-event effects,
 * expiry, or any production runtime hook. Never wrap normal-world acceptance. */
export function withoutNewNaturalEvents<T>(check: () => T): T {
  const limit = BALANCE.events.world.maxEventsPerTurn;
  BALANCE.events.world.maxEventsPerTurn = 0;
  try { return check(); } finally { BALANCE.events.world.maxEventsPerTurn = limit; }
}
