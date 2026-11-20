import {ActiveEvent, ConsequenceDelta} from './EventModel';
import {Resources} from '../types';

/** Positive production bonuses have a lifetime; resource grants and adverse
 * consequences retain their existing settlement rules. Never undo legacy output. */
export function withoutProductionBonuses(consequences: ConsequenceDelta[]): ConsequenceDelta[] {
  return consequences.map(c => {
    const delta = {...c.delta};
    if (delta.resourceOutputPct) delta.resourceOutputPct = Object.fromEntries(
      Object.entries(delta.resourceOutputPct).filter(([, pct]) => pct! <= 0));
    if (delta.foodProductionPct !== undefined && delta.foodProductionPct > 0) delete delta.foodProductionPct;
    return {...c, delta};
  });
}

/** Decimal rationals avoid order-dependent floating-point summation/rounding.
 * Uses the persisted number's decimal value; no new balance precision or cap. */
function rational(value: number): [bigint, bigint] {
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid event production amount');
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  const scale = fraction.length - Number(exponent);
  const numerator = BigInt(whole + fraction);
  return scale >= 0 ? [numerator, 10n ** BigInt(scale)] : [numerator * 10n ** BigInt(-scale), 1n];
}

/** Capture authored decimal products without binary multiplication artifacts
 * (e.g. 30% × 3 is 90%, not 89.99999999999999%). No coefficient changes. */
export function productionBonusProduct(...parts: number[]): number {
  let numerator = 1n, denominator = 1n;
  for (const part of parts) { const [n, d] = rational(part); numerator *= n; denominator *= d; }
  return Number(numerator) / Number(denominator);
}

/** Derived view only: canonical authority is the event's persisted terms/window.
 * Duplicate occurrences of one type never stack; the latest occurrence wins.
 * Normal activation already prevents duplicate active types. Sorting also makes
 * defensive handling of duplicate input independent of persisted array order. */
export function temporaryProductionOutput(
  base: number, resource: keyof Resources, territoryId: string, turn: number, events: ActiveEvent[],
): number {
  const byType = new Map<string, ActiveEvent>();
  for (const event of events) {
    if (!event.productionBonusPolicy || event.territoryId !== territoryId
      || turn < event.startedTurn || turn >= event.expiresTurn
      || (event.productionBonusPolicy === 'active-v1' && event.status !== 'active')) continue;
    const previous = byType.get(event.typeId);
    if (!previous || previous.startedTurn < event.startedTurn
      || (previous.startedTurn === event.startedTurn && previous.instanceId < event.instanceId)) byType.set(event.typeId, event);
  }
  let numerator = 1n, denominator = 1n, modified = false;
  for (const event of byType.values()) for (const c of event.consequences) {
    if (c.territoryId !== territoryId) continue;
    for (const pct of [c.delta.resourceOutputPct?.[resource], resource === 'food' ? c.delta.foodProductionPct : undefined]) {
      if (pct === undefined || pct <= 0) continue;
      const [n, d] = rational(pct);
      numerator = numerator * d + n * denominator; denominator *= d; modified = true;
    }
  }
  if (!modified) return base;
  const [n, d] = rational(base), divisor = d * denominator;
  const rounded = (2n * n * numerator + divisor) / (2n * divisor);
  const output = Number(rounded);
  if (!Number.isSafeInteger(output)) throw new Error('Event production exceeds safe integer precision');
  return output;
}
