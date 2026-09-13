/**
 * Authoritative simulation time. Production would bind this to a server clock
 * converted into worldTick. Tests inject a fixed tick. Clients cannot choose
 * a target beyond this value.
 */
import { PersistenceError } from './errors';

export interface WorldTimeAuthority {
  currentWorldTick(): number;
}

export class FixedWorldTimeAuthority implements WorldTimeAuthority {
  constructor(private tick: number) {}

  setTick(tick: number): void {
    if (!Number.isInteger(tick) || tick < 0) {
      throw new Error(`Invalid world tick ${String(tick)}`);
    }
    this.tick = tick;
  }

  currentWorldTick(): number {
    return this.tick;
  }
}

export function resolveAuthoritativeTargetTick(input: {
  authority: WorldTimeAuthority;
  requestedTick?: number;
  currentTick: number;
}): number {
  const authorized = input.authority.currentWorldTick();
  if (!Number.isInteger(authorized) || authorized < 0) {
    throw new PersistenceError(
      'persistence.time_unavailable',
      'World time authority returned an invalid tick',
      { authorized },
    );
  }
  if (authorized < input.currentTick) {
    throw new PersistenceError(
      'persistence.time_unauthorized',
      'Authoritative clock is behind persisted worldTick; refusing to rewind',
      { authorized, currentTick: input.currentTick },
    );
  }
  if (input.requestedTick === undefined) {
    return authorized;
  }
  if (!Number.isInteger(input.requestedTick) || input.requestedTick < 0) {
    throw new PersistenceError(
      'persistence.time_unauthorized',
      'Requested targetWorldTick must be a non-negative integer',
      { requestedTick: input.requestedTick },
    );
  }
  if (input.requestedTick > authorized) {
    throw new PersistenceError(
      'persistence.time_unauthorized',
      'Requested targetWorldTick is beyond the authoritative clock',
      { requestedTick: input.requestedTick, authorized },
    );
  }
  if (input.requestedTick < input.currentTick) {
    throw new PersistenceError(
      'persistence.time_unauthorized',
      'Requested targetWorldTick would rewind persisted worldTick',
      { requestedTick: input.requestedTick, currentTick: input.currentTick },
    );
  }
  return input.requestedTick;
}
