import { GameState } from '../types/GameState';

/**
 * Real duration of one world tick.
 *
 * The economy config documents the prototype clock as 1 tick = 1 minute.
 * Workout session time already falls back to `worldTick * 60_000`.
 * This is that same duration, in UTC epoch milliseconds.
 */
export const WORLD_TICK_DURATION_MS = 60_000;

const EXPLICIT_OFFSET = /(?:[zZ]|[+-]\d{2}:\d{2})$/;

export interface WorldClockAdvance {
  previousTick: number;
  worldTick: number;
  elapsedTicks: number;
  lastProcessedAtMs: number;
  remainderMs: number;
  advanced: boolean;
}

/** Production observation of the current UTC instant. Tests pass an explicit timestamp instead. */
export function currentUtcNowMs(): number {
  return Date.now();
}

/**
 * Convert an explicit UTC instant to epoch milliseconds.
 * Numbers are already epoch milliseconds. Strings must include `Z` or a
 * numeric offset so the result does not depend on the machine timezone.
 */
export function utcEpochMs(now: number | string | Date): number {
  if (typeof now === 'number') {
    if (!Number.isInteger(now)) {
      throw new Error('World clock timestamps must be integer epoch milliseconds');
    }
    return now;
  }
  if (now instanceof Date) {
    const ms = now.getTime();
    if (!Number.isInteger(ms)) throw new Error('World clock timestamp is not a valid UTC instant');
    return ms;
  }
  if (typeof now === 'string') {
    if (!EXPLICIT_OFFSET.test(now.trim())) {
      throw new Error('World clock timestamps must include a UTC offset');
    }
    const ms = Date.parse(now);
    if (!Number.isInteger(ms)) throw new Error('World clock timestamp is not a valid UTC instant');
    return ms;
  }
  throw new Error('World clock timestamp is not a valid UTC instant');
}

/** Whole ticks contained in the real interval. Never fractional. Never loops. */
export function elapsedWholeTicks(lastProcessedAtMs: number, nowMs: number): number {
  const elapsedMs = nowMs - lastProcessedAtMs;
  if (elapsedMs <= 0) return 0;
  const ticks = Math.floor(elapsedMs / WORLD_TICK_DURATION_MS);
  if (!Number.isSafeInteger(ticks)) {
    throw new Error('Elapsed world ticks exceed a safe integer');
  }
  return ticks;
}

/**
 * Move the authoritative tick forward by whole elapsed minutes.
 * Does not run AI, events, construction, or catch-up. A future scheduler
 * reads `elapsedTicks` and decides what work to perform.
 *
 * A null watermark anchors at `now` and adds zero ticks.
 * The same timestamp, or any remainder shorter than one tick, does not move
 * `worldTick`. Time earlier than the watermark does not rewind it.
 */
export function advanceAuthoritativeWorldClock(state: GameState, now: number | string | Date): WorldClockAdvance {
  const nowMs = utcEpochMs(now);
  const previousTick = state.worldTick;
  if (state.lastProcessedAtMs === null) {
    state.lastProcessedAtMs = nowMs;
    return {
      previousTick,
      worldTick: previousTick,
      elapsedTicks: 0,
      lastProcessedAtMs: nowMs,
      remainderMs: 0,
      advanced: false,
    };
  }
  const elapsedTicks = elapsedWholeTicks(state.lastProcessedAtMs, nowMs);
  const remainderMs = nowMs - state.lastProcessedAtMs - elapsedTicks * WORLD_TICK_DURATION_MS;
  if (elapsedTicks === 0) {
    return {
      previousTick,
      worldTick: previousTick,
      elapsedTicks: 0,
      lastProcessedAtMs: state.lastProcessedAtMs,
      remainderMs: Math.max(0, remainderMs),
      advanced: false,
    };
  }
  const worldTick = previousTick + elapsedTicks;
  if (!Number.isSafeInteger(worldTick)) {
    throw new Error('Authoritative world tick exceeds a safe integer');
  }
  state.worldTick = worldTick;
  state.lastProcessedAtMs += elapsedTicks * WORLD_TICK_DURATION_MS;
  return {
    previousTick,
    worldTick,
    elapsedTicks,
    lastProcessedAtMs: state.lastProcessedAtMs,
    remainderMs,
    advanced: true,
  };
}
