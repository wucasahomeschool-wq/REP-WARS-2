/**
 * Injectable session clock. Workout session logic takes numeric timestamps
 * from a clock rather than calling Date.now() directly, so tests can control time.
 */

export interface SessionClock {
  now(): number;
}

export function systemClock(): SessionClock {
  return { now: () => Date.now() };
}

export class AdjustableClock implements SessionClock {
  constructor(private current: number = 0) {}

  now(): number {
    return this.current;
  }

  set(ms: number): void {
    this.current = ms;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}
