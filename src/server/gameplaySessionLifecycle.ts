import { randomUUID } from 'node:crypto';
import { GameState } from '../types/GameState';
import { insertGameplaySessionLease, replaceGameplaySessionLease } from '../state/gameplaySessionLeases';
import {
  endGameplaySessionLease,
  openGameplaySessionLease,
  renewGameplaySessionLeaseAtSequence,
  type GameplaySessionLease,
} from '../world/presenceLeases';
import { PlayerWorldPersistence } from './persistencePort';

/**
 * Server gameplay-session lifecycle.
 *
 * The resolved playerId is the current development identity boundary.
 * It is not production authentication. Every lease is stored on that
 * player's GameState row. A session id never selects another player's world.
 *
 * Receipt time is supplied by the caller and must be captured once per
 * accepted request. This module does not read a clock, so a compare-and-swap
 * retry cannot move the receipt. Client timestamps are not parameters here.
 *
 * Open idempotency uses `openedByRequestId` on the lease. That field is not
 * `lastRenewalRequestId`. Renewal order is `lastRenewalSequence`: an equal
 * sequence is a replay, a lower sequence is stale, and a higher sequence
 * extends from the captured server receipt. Explicit end stays terminal.
 * Expired and ended leases stay in the payload. This module does not accrue
 * world time.
 */

const MAX_CAS_ATTEMPTS = 8;

export type GameplaySessionOutcome =
  | 'opened'
  | 'idempotent_replay'
  | 'renewed'
  | 'stale'
  | 'ended'
  | 'expired'
  | 'unknown_session';

/** Status for the requesting client. Never the player's full lease set. */
export interface GameplaySessionView {
  sessionId: string;
  outcome: GameplaySessionOutcome;
  /** Receipt used for this decision, or the committed receipt when the call is a replay. */
  receiptMs: number | null;
  openedAtMs: number | null;
  expiresAtMs: number | null;
  endedAtMs: number | null;
  /**
   * Committed renewal sequence for this session. Null until a sequenced
   * renewal commits. A stale or replayed call returns this value, not the
   * sequence the caller just sent. It is not a timestamp.
   */
  lastRenewalSequence: number | null;
}

export interface GameplaySessionChange {
  state: GameState;
  changed: boolean;
  view: GameplaySessionView;
}

export type GameplaySessionCommit =
  | { ok: true; view: GameplaySessionView; state: GameState; stateVersion: number }
  | { ok: false; code: string; message: string };

export class GameplaySessionReceiptError extends Error {
  constructor() {
    super('Gameplay session receipt is behind authoritative state');
    this.name = 'GameplaySessionReceiptError';
  }
}

export function issueGameplaySessionId(): string {
  return randomUUID();
}

export function commitGameplaySession(
  persistence: PlayerWorldPersistence,
  playerId: string,
  apply: (state: GameState) => GameplaySessionChange,
): GameplaySessionCommit {
  let conflictMessage = 'Stale gameplay-session write';
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const loaded = persistence.ensure(playerId);
    const applied = apply(loaded.state);
    if (!applied.changed) {
      return {
        ok: true,
        view: applied.view,
        state: loaded.state,
        stateVersion: loaded.record.stateVersion,
      };
    }
    const saved = persistence.save(playerId, applied.state, loaded.record.stateVersion);
    if (saved.ok) {
      return {
        ok: true,
        view: applied.view,
        state: applied.state,
        stateVersion: saved.record.stateVersion,
      };
    }
    if (saved.code !== 'persistence.conflict') {
      return { ok: false, code: saved.code, message: saved.message };
    }
    conflictMessage = saved.message;
  }
  return { ok: false, code: 'persistence.conflict', message: conflictMessage };
}

export function applyGameplaySessionOpen(
  state: GameState,
  input: { sessionId: string; requestId: string; receiptMs: number },
): GameplaySessionChange {
  const existing = state.gameplaySessionLeases.find((lease) => lease.openedByRequestId === input.requestId);
  if (existing) {
    return { state, changed: false, view: viewOf(existing, 'idempotent_replay', existing.openedAtMs) };
  }
  const lease = openGameplaySessionLease({
    sessionId: input.sessionId,
    receiptMs: input.receiptMs,
    openedByRequestId: input.requestId,
  });
  return {
    state: insertGameplaySessionLease(state, lease),
    changed: true,
    view: viewOf(lease, 'opened', input.receiptMs),
  };
}

export function applyGameplaySessionHeartbeat(
  state: GameState,
  input: { sessionId: string; requestId: string; receiptMs: number; renewalSequence: number },
): GameplaySessionChange {
  const current = findLease(state, input.sessionId);
  if (!current) return { state, changed: false, view: unknownView(input.sessionId) };
  const result = renewWithoutMovingBackward(current, input.receiptMs, input.requestId, input.renewalSequence);
  if (result.outcome === 'renewed') {
    return {
      state: replaceGameplaySessionLease(state, result.lease),
      changed: true,
      view: viewOf(result.lease, 'renewed', input.receiptMs),
    };
  }
  const receiptMs = result.outcome === 'idempotent_replay' || result.outcome === 'stale'
    ? result.lease.lastReceiptAtMs
    : input.receiptMs;
  return { state, changed: false, view: viewOf(result.lease, result.outcome, receiptMs) };
}

export function applyGameplaySessionEnd(
  state: GameState,
  input: { sessionId: string; receiptMs: number },
): GameplaySessionChange {
  const current = findLease(state, input.sessionId);
  if (!current) return { state, changed: false, view: unknownView(input.sessionId) };
  if (current.endedAtMs !== null) {
    return { state, changed: false, view: viewOf(current, 'idempotent_replay', current.endedAtMs) };
  }
  let result;
  try {
    result = endGameplaySessionLease(current, input.receiptMs);
  } catch (err) {
    rethrowStableReceipt(err);
  }
  if (result.outcome === 'ended') {
    return {
      state: replaceGameplaySessionLease(state, result.lease),
      changed: true,
      view: viewOf(result.lease, 'ended', input.receiptMs),
    };
  }
  return { state, changed: false, view: viewOf(result.lease, result.outcome, input.receiptMs) };
}

function renewWithoutMovingBackward(
  lease: GameplaySessionLease,
  receiptMs: number,
  requestId: string,
  renewalSequence: number,
) {
  try {
    return renewGameplaySessionLeaseAtSequence(lease, receiptMs, requestId, renewalSequence);
  } catch (err) {
    rethrowStableReceipt(err);
  }
}

function rethrowStableReceipt(err: unknown): never {
  if (err instanceof Error && err.message.includes('earlier than the authoritative')) {
    throw new GameplaySessionReceiptError();
  }
  throw err;
}

function findLease(state: GameState, sessionId: string): GameplaySessionLease | undefined {
  return state.gameplaySessionLeases.find((lease) => lease.sessionId === sessionId);
}

function viewOf(lease: GameplaySessionLease, outcome: GameplaySessionOutcome, receiptMs: number): GameplaySessionView {
  return {
    sessionId: lease.sessionId,
    outcome,
    receiptMs,
    openedAtMs: lease.openedAtMs,
    expiresAtMs: lease.expiresAtMs,
    endedAtMs: lease.endedAtMs,
    lastRenewalSequence: lease.lastRenewalSequence ?? null,
  };
}

function unknownView(sessionId: string): GameplaySessionView {
  return {
    sessionId,
    outcome: 'unknown_session',
    receiptMs: null,
    openedAtMs: null,
    expiresAtMs: null,
    endedAtMs: null,
    lastRenewalSequence: null,
  };
}
