import { Resources } from '../../types';
import { OrchestrationError, ErrorCode } from '../../orchestration/errors';
import { ECONOMY_CONFIG, EconomyConfig, RESOURCE_KEYS, emptyResources } from './config';

/**
 * gain[r] = floor(rating[r] * toTick / cycle) - floor(rating[r] * fromTick / cycle)
 *
 * Telescoping so 32+32 ticks equals one 64-tick jump. Command handlers
 * never embed production rates.
 */
export function productionAccruedBetween(
  resourceOutput: Partial<Resources>,
  fromTick: number,
  toTick: number,
  config: EconomyConfig = ECONOMY_CONFIG,
): Resources {
  const out = emptyResources();
  if (!Number.isFinite(fromTick) || !Number.isFinite(toTick)) {
    throw new OrchestrationError(ErrorCode.INVALID_GAME_STATE, 'Invalid production tick range');
  }
  const start = Math.max(0, Math.min(Math.floor(fromTick), Number.MAX_SAFE_INTEGER));
  const end = Math.max(0, Math.min(Math.floor(toTick), Number.MAX_SAFE_INTEGER));
  if (end <= start) return out;
  const cycle = config.ticksPerProductionCycle;
  if (!Number.isInteger(cycle) || cycle <= 0) {
    throw new OrchestrationError(ErrorCode.INVALID_GAME_STATE, 'Economy production cycle is invalid');
  }
  for (const key of RESOURCE_KEYS) {
    const raw = resourceOutput[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) continue;
    const rating = Math.floor(raw);
    if (rating <= 0) continue;
    const atEnd = Number((BigInt(rating) * BigInt(end)) / BigInt(cycle));
    const atStart = Number((BigInt(rating) * BigInt(start)) / BigInt(cycle));
    const gain = atEnd - atStart;
    out[key] = Number.isSafeInteger(gain) && gain >= 0 ? gain : Number.MAX_SAFE_INTEGER;
  }
  return out;
}

/** Production over `elapsedTicks` starting at tick 0. */
export function productionAccrued(
  resourceOutput: Partial<Resources>,
  elapsedTicks: number,
  config: EconomyConfig = ECONOMY_CONFIG,
): Resources {
  return productionAccruedBetween(resourceOutput, 0, elapsedTicks, config);
}

export function addResourcesClamped(base: Resources, delta: Resources): Resources {
  const out = emptyResources();
  for (const key of RESOURCE_KEYS) {
    const left = base[key];
    const right = delta[key];
    if (!Number.isFinite(left) || !Number.isFinite(right) || left < 0 || right < 0) {
      throw new OrchestrationError(ErrorCode.INVALID_GAME_STATE, `Corrupted economy values for ${key}`);
    }
    const sum = left + right;
    if (!Number.isFinite(sum) || sum < 0) {
      throw new OrchestrationError(ErrorCode.INVALID_GAME_STATE, `Economy overflow for ${key}`);
    }
    out[key] = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(sum));
  }
  return out;
}

export function addResourcesChecked(base: Resources, delta: Resources): Resources {
  const out = emptyResources();
  for (const key of RESOURCE_KEYS) {
    const next = base[key] + delta[key];
    if (!Number.isSafeInteger(next) || next < 0) {
      throw new OrchestrationError(ErrorCode.INVALID_GAME_STATE, `Collection would overflow safe ${key} storage`);
    }
    out[key] = next;
  }
  return out;
}

export function scaleResources(amount: Resources, multiplier: number): Resources {
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    throw new OrchestrationError(ErrorCode.INVALID_GAME_STATE, `Invalid collection multiplier ${String(multiplier)}`);
  }
  const out = emptyResources();
  for (const key of RESOURCE_KEYS) {
    const scaled = Math.floor(amount[key] * multiplier);
    if (!Number.isSafeInteger(scaled) || scaled < 0) {
      throw new OrchestrationError(ErrorCode.INVALID_GAME_STATE, `Scaled ${key} is not a safe integer`);
    }
    out[key] = scaled;
  }
  return out;
}

export function resourcesTotal(amount: Resources): number {
  return RESOURCE_KEYS.reduce((sum, key) => sum + amount[key], 0);
}
