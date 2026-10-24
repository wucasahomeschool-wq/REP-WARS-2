/** Operational bounds for trusted, asynchronous external verification adapters.
 * These are not gameplay timers or authoritative state. */
export interface DependencyLimits {
  maxPending?: number;
  timeoutMs?: number;
}
export type DependencyResult<T> = { ok: true; value: T } | { ok: false };

export function createDependencyBudget(limits: DependencyLimits, defaults: Required<DependencyLimits>) {
  const maxPending = limits.maxPending === undefined ? defaults.maxPending : limits.maxPending;
  const timeoutMs = limits.timeoutMs === undefined ? defaults.timeoutMs : limits.timeoutMs;
  if (!Number.isSafeInteger(maxPending) || maxPending < 1) throw new Error('maxPending must be a positive safe integer');
  // Node clamps larger timers to 1ms. Reject them instead of silently changing the budget.
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new Error('timeoutMs must be an integer between 1 and 2147483647');
  }
  let pending = 0;
  return function run<T>(operation: (signal: AbortSignal) => T | Promise<T>): Promise<DependencyResult<T>> {
    if (pending >= maxPending) return Promise.resolve({ ok: false });
    pending++;
    return new Promise(resolve => {
      const controller = new AbortController();
      const deadline = performance.now() + timeoutMs;
      let responded = false;
      const finish = (result: DependencyResult<T>) => {
        if (responded) return;
        responded = true;
        clearTimeout(timer);
        // A blocked event loop can delay the timer; elapsed results must still
        // fail closed rather than gaining authority ahead of the timer callback.
        const expired = performance.now() >= deadline;
        resolve(expired ? { ok: false } : result);
        if (expired) controller.abort();
      };
      const timer = setTimeout(() => {
        finish({ ok: false });
        controller.abort();
      }, timeoutMs);
      // Keep the slot until the actual operation settles, even after timeout.
      // Otherwise a provider ignoring abort could accumulate unbounded orphans.
      // Both rejection and late fulfillment are consumed; neither can reauthorize.
      Promise.resolve().then(() => operation(controller.signal)).then(value => {
        pending--;
        finish({ ok: true, value });
      }, () => {
        pending--;
        finish({ ok: false });
      });
    });
  };
}
