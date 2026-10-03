import { BALANCE } from '../constants/balance';
import type { PresenceSegment } from './temporalBoundaries';
import type { TemporalPresence } from './timeToTick';
import { utcEpochMs } from './realtimeClock';

/**
 * Pure gameplay-session lease algebra.
 *
 * A lease is the authority. Presence segments are derived. This module does
 * not read durable simulation state, issue leases, or compact history.
 *
 * Coverage of one lease is the half-open interval `[openedAtMs, effectiveEnd)`.
 * `effectiveEnd` is `endedAtMs` when an explicit disconnect committed, and
 * `expiresAtMs` otherwise. The lease does not cover `effectiveEnd` itself.
 * Player presence is ONLINE when any lease covers the instant.
 *
 * Derived segments are contiguous on `[frontierMs, horizonMs)`. That is the
 * window Phase 3 accrues when its watermark is `frontierMs` and the caller
 * wants the next watermark to be `horizonMs`. Phase 3 emits boundaries in
 * `(frontierMs, horizonMs]` and applies the segment's presence to
 * `[startMs, endMs)`. Clipping leases to that same half-open window does
 * not replay the frontier millisecond and does not give `horizonMs` itself
 * a presence inside this window. A lease that ends at T and another that
 * opens at T are one ONLINE span: T belongs to the later lease.
 */

export interface GameplaySessionLease {
  sessionId: string;
  openedAtMs: number;
  expiresAtMs: number;
  /** Explicit disconnect instant. Null when the lease ends only by expiry. */
  endedAtMs: number | null;
  lastReceiptAtMs: number;
  /**
   * Request id of the latest committed renewal. This alone remembers one id.
   * Older renewals stay idempotent through `lastRenewalSequence`.
   */
  lastRenewalRequestId: string | null;
  /**
   * Monotonic renewal order for this session. Null until a sequenced renewal
   * commits. It is not a timestamp. A later HTTP arrival cannot apply an
   * equal or lower sequence again.
   */
  lastRenewalSequence?: number | null;
  /**
   * Open-request key that created this lease. Null when that key was not stored.
   * A replay finds this lease and does not open another. It is not a renewal id.
   */
  openedByRequestId?: string | null;
  /**
   * Monotonic gameplay-command order for this session. Null until a public
   * state-changing command commits. Independent of `lastRenewalSequence`.
   */
  lastCommandSequence?: number | null;
  /**
   * Compact result of the latest committed gameplay command on this session.
   * Older commands are not retained. Null until the first command commits.
   */
  lastCommandReceipt?: GameplayCommandReceipt | null;
}

/** One committed public command. Not a world snapshot and not a lease renewal. */
export interface GameplayCommandReceipt {
  sequence: number;
  requestId: string;
  commandId: string;
  success: boolean;
  payload: Record<string, unknown>;
  errors: { code: string; message: string }[];
}

export type LeaseRenewalResult =
  | { outcome: 'renewed'; lease: GameplaySessionLease }
  | { outcome: 'idempotent_replay'; lease: GameplaySessionLease }
  | { outcome: 'expired'; lease: GameplaySessionLease }
  | { outcome: 'ended'; lease: GameplaySessionLease };

export type SequencedLeaseRenewal =
  | LeaseRenewalResult
  | { outcome: 'stale'; lease: GameplaySessionLease };

export type LeaseEndResult =
  | { outcome: 'ended'; lease: GameplaySessionLease }
  | { outcome: 'idempotent_replay'; lease: GameplaySessionLease }
  | { outcome: 'expired'; lease: GameplaySessionLease };

export function validateGameplaySessionLease(lease: GameplaySessionLease): GameplaySessionLease {
  if (lease == null || typeof lease !== 'object') {
    throw new Error('Gameplay session lease is missing');
  }
  assertSessionId(lease.sessionId);
  assertEpochMs(lease.openedAtMs, 'Lease open instant');
  assertEpochMs(lease.expiresAtMs, 'Lease expiry');
  assertEpochMs(lease.lastReceiptAtMs, 'Lease receipt');
  if (lease.expiresAtMs <= lease.openedAtMs) {
    throw new Error('Lease expiry must be after its open instant');
  }
  if (lease.lastReceiptAtMs < lease.openedAtMs) {
    throw new Error('Lease receipt is before its open instant');
  }
  if (lease.lastReceiptAtMs >= lease.expiresAtMs) {
    throw new Error('Lease receipt is outside its expiry coverage');
  }
  if (lease.endedAtMs !== null) {
    assertEpochMs(lease.endedAtMs, 'Explicit lease end');
    if (lease.endedAtMs < lease.openedAtMs) {
      throw new Error('Explicit lease end is before its open instant');
    }
    if (lease.endedAtMs > lease.expiresAtMs) {
      throw new Error('Explicit lease end is after expiry');
    }
  }
  if (lease.lastRenewalRequestId !== null) assertRequestId(lease.lastRenewalRequestId);
  return copyLease(
    lease,
    readOpenedByRequestId(lease),
    readLastRenewalSequence(lease),
    readLastCommandSequence(lease),
    readLastCommandReceipt(lease),
  );
}

export function gameplaySessionLeaseEffectiveEndMs(lease: GameplaySessionLease): number {
  const checked = validateGameplaySessionLease(lease);
  return checked.endedAtMs ?? checked.expiresAtMs;
}

export function gameplaySessionLeaseCoversInstant(
  lease: GameplaySessionLease,
  atMs: number | string | Date,
): boolean {
  const checked = validateGameplaySessionLease(lease);
  const at = assertEpochMs(utcEpochMs(atMs), 'Presence instant');
  return checked.openedAtMs <= at && at < gameplaySessionLeaseEffectiveEndMs(checked);
}

/** ONLINE when any lease covers `atMs`. An empty set is OFFLINE. */
export function playerPresenceAt(
  leases: readonly GameplaySessionLease[],
  atMs: number | string | Date,
): TemporalPresence {
  const checked = validateLeaseSet(leases);
  const at = assertEpochMs(utcEpochMs(atMs), 'Presence instant');
  for (const lease of checked) {
    if (lease.openedAtMs <= at && at < (lease.endedAtMs ?? lease.expiresAtMs)) return 'ONLINE';
  }
  return 'OFFLINE';
}

/**
 * Smallest contiguous presence segmentation of `[frontierMs, horizonMs)`.
 * Overlapping and touching ONLINE coverage merges. Uncovered time is OFFLINE.
 * Session identity is not copied onto the segments. An empty interval is `[]`.
 */
export function derivePresenceSegments(
  leases: readonly GameplaySessionLease[],
  frontierMs: number | string | Date,
  horizonMs: number | string | Date,
): PresenceSegment[] {
  const frontier = assertEpochMs(utcEpochMs(frontierMs), 'Presence frontier');
  const horizon = assertEpochMs(utcEpochMs(horizonMs), 'Presence horizon');
  if (horizon < frontier) throw new Error('Presence interval must not rewind');
  if (horizon === frontier) return [];
  const online = mergeOnlineIntervals(clipOnlineCoverage(validateLeaseSet(leases), frontier, horizon));
  const segments: PresenceSegment[] = [];
  let cursor = frontier;
  for (const span of online) {
    if (span.startMs > cursor) segments.push(segment(cursor, span.startMs, 'OFFLINE'));
    segments.push(segment(span.startMs, span.endMs, 'ONLINE'));
    cursor = span.endMs;
  }
  if (cursor < horizon) segments.push(segment(cursor, horizon, 'OFFLINE'));
  return segments;
}

export function openGameplaySessionLease(input: {
  sessionId: string;
  receiptMs: number | string | Date;
  leaseDurationMs?: number;
  openedByRequestId?: string | null;
}): GameplaySessionLease {
  assertSessionId(input.sessionId);
  const openedAtMs = assertEpochMs(utcEpochMs(input.receiptMs), 'Lease open instant');
  const leaseDurationMs = resolveLeaseDuration(input.leaseDurationMs);
  const openedByRequestId = input.openedByRequestId == null ? null : input.openedByRequestId;
  if (openedByRequestId !== null) assertRequestId(openedByRequestId);
  return validateGameplaySessionLease({
    sessionId: input.sessionId,
    openedAtMs,
    expiresAtMs: addEpochMs(openedAtMs, leaseDurationMs, 'Lease expiry'),
    endedAtMs: null,
    lastReceiptAtMs: openedAtMs,
    lastRenewalRequestId: null,
    lastRenewalSequence: null,
    openedByRequestId,
    lastCommandSequence: null,
    lastCommandReceipt: null,
  });
}

/**
 * Extend one unexpired lease. The same request id returns the committed lease
 * and does not add the duration again. An ended lease, or a receipt at or
 * after expiry, is left unchanged so the caller can open a new session id.
 */
export function renewGameplaySessionLease(
  lease: GameplaySessionLease,
  receiptMs: number | string | Date,
  requestId: string,
  leaseDurationMs?: number,
): LeaseRenewalResult {
  const current = validateGameplaySessionLease(lease);
  assertRequestId(requestId);
  if (current.lastRenewalRequestId === requestId) {
    return { outcome: 'idempotent_replay', lease: current };
  }
  const receipt = assertEpochMs(utcEpochMs(receiptMs), 'Lease receipt');
  if (receipt < current.lastReceiptAtMs) {
    throw new Error('Renewal receipt is earlier than the authoritative last receipt');
  }
  if (current.endedAtMs !== null) return { outcome: 'ended', lease: current };
  if (receipt >= current.expiresAtMs) return { outcome: 'expired', lease: current };
  const duration = resolveLeaseDuration(leaseDurationMs);
  return {
    outcome: 'renewed',
    lease: validateGameplaySessionLease({
      ...current,
      expiresAtMs: addEpochMs(receipt, duration, 'Lease expiry'),
      lastReceiptAtMs: receipt,
      lastRenewalRequestId: requestId,
    }),
  };
}

/**
 * Renewal with a per-session sequence.
 * Equal to the committed sequence is a replay and does not extend.
 * Lower is stale and does not extend, even when this arrival's receipt is later.
 * Higher uses server receipt time. An earlier receipt than the committed
 * receipt does not regress the lease.
 */
export function renewGameplaySessionLeaseAtSequence(
  lease: GameplaySessionLease,
  receiptMs: number | string | Date,
  requestId: string,
  renewalSequence: number,
  leaseDurationMs?: number,
): SequencedLeaseRenewal {
  assertRenewalSequence(renewalSequence);
  const current = validateGameplaySessionLease(lease);
  const last = current.lastRenewalSequence ?? null;
  if (last !== null && renewalSequence === last) {
    return { outcome: 'idempotent_replay', lease: current };
  }
  if (last !== null && renewalSequence < last) {
    return { outcome: 'stale', lease: current };
  }
  if (current.lastRenewalRequestId === requestId) {
    return { outcome: 'idempotent_replay', lease: current };
  }
  const result = renewGameplaySessionLease(current, receiptMs, requestId, leaseDurationMs);
  if (result.outcome !== 'renewed') return result;
  return {
    outcome: 'renewed',
    lease: validateGameplaySessionLease({
      ...result.lease,
      lastRenewalSequence: renewalSequence,
    }),
  };
}

/**
 * Shorten one lease to an explicit disconnect. Other leases are not visible
 * here. A receipt at or after expiry does not rewrite the lease.
 */
export function endGameplaySessionLease(
  lease: GameplaySessionLease,
  receiptMs: number | string | Date,
): LeaseEndResult {
  const current = validateGameplaySessionLease(lease);
  const receipt = assertEpochMs(utcEpochMs(receiptMs), 'Explicit lease end');
  if (current.endedAtMs !== null) {
    if (current.endedAtMs !== receipt) {
      throw new Error('Explicit disconnect cannot move an authoritative lease end');
    }
    return { outcome: 'idempotent_replay', lease: current };
  }
  if (receipt < current.lastReceiptAtMs) {
    throw new Error('Disconnect receipt is earlier than the authoritative last receipt');
  }
  if (receipt >= current.expiresAtMs) return { outcome: 'expired', lease: current };
  if (receipt < current.openedAtMs) {
    throw new Error('Explicit lease end is before its open instant');
  }
  return {
    outcome: 'ended',
    lease: validateGameplaySessionLease({
      ...current,
      endedAtMs: receipt,
      lastReceiptAtMs: receipt,
    }),
  };
}

interface OnlineInterval {
  startMs: number;
  endMs: number;
}

function clipOnlineCoverage(
  leases: readonly GameplaySessionLease[],
  frontier: number,
  horizon: number,
): OnlineInterval[] {
  const clipped: OnlineInterval[] = [];
  for (const lease of leases) {
    const effectiveEnd = lease.endedAtMs ?? lease.expiresAtMs;
    const startMs = lease.openedAtMs > frontier ? lease.openedAtMs : frontier;
    const endMs = effectiveEnd < horizon ? effectiveEnd : horizon;
    if (endMs > startMs) clipped.push({ startMs, endMs });
  }
  return clipped;
}

function mergeOnlineIntervals(intervals: readonly OnlineInterval[]): OnlineInterval[] {
  const ordered = [...intervals].sort(compareOnlineIntervals);
  const merged: OnlineInterval[] = [];
  for (const interval of ordered) {
    const last = merged[merged.length - 1];
    if (!last || interval.startMs > last.endMs) {
      merged.push({ startMs: interval.startMs, endMs: interval.endMs });
      continue;
    }
    if (interval.endMs > last.endMs) last.endMs = interval.endMs;
  }
  return merged;
}

function compareOnlineIntervals(left: OnlineInterval, right: OnlineInterval): number {
  if (left.startMs !== right.startMs) return left.startMs < right.startMs ? -1 : 1;
  if (left.endMs !== right.endMs) return left.endMs < right.endMs ? -1 : 1;
  return 0;
}

function validateLeaseSet(leases: readonly GameplaySessionLease[]): GameplaySessionLease[] {
  if (!Array.isArray(leases)) throw new Error('Gameplay session lease set is missing');
  const seen = new Set<string>();
  const checked: GameplaySessionLease[] = [];
  for (const lease of leases) {
    const valid = validateGameplaySessionLease(lease);
    if (seen.has(valid.sessionId)) throw new Error('Duplicate gameplay session id');
    seen.add(valid.sessionId);
    checked.push(valid);
  }
  return checked;
}

function resolveLeaseDuration(leaseDurationMs: number | undefined): number {
  const duration = leaseDurationMs === undefined
    ? BALANCE.temporal.presenceLeaseDurationMs
    : leaseDurationMs;
  if (!Number.isSafeInteger(duration) || duration <= 0) {
    throw new Error('Lease duration must be a positive safe integer');
  }
  return duration;
}

function addEpochMs(startMs: number, durationMs: number, label: string): number {
  const sum = startMs + durationMs;
  return assertEpochMs(sum, label);
}

function assertEpochMs(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer millisecond`);
  }
  return value;
}

function assertSessionId(sessionId: string): void {
  if (typeof sessionId !== 'string' || sessionId.trim() === '' || sessionId !== sessionId.trim()) {
    throw new Error('Gameplay session id is required');
  }
}

function assertRequestId(requestId: string): void {
  if (typeof requestId !== 'string' || requestId.trim() === '' || requestId !== requestId.trim()) {
    throw new Error('Renewal request id is required');
  }
}

function readOpenedByRequestId(lease: GameplaySessionLease): string | null {
  if (lease.openedByRequestId == null) return null;
  assertRequestId(lease.openedByRequestId);
  return lease.openedByRequestId;
}

function readLastRenewalSequence(lease: GameplaySessionLease): number | null {
  if (lease.lastRenewalSequence == null) return null;
  assertRenewalSequence(lease.lastRenewalSequence);
  return lease.lastRenewalSequence;
}

function readLastCommandSequence(lease: GameplaySessionLease): number | null {
  if (lease.lastCommandSequence == null) return null;
  assertRenewalSequence(lease.lastCommandSequence);
  return lease.lastCommandSequence;
}

function readLastCommandReceipt(
  lease: GameplaySessionLease,
): GameplayCommandReceipt | null {
  const sequence = lease.lastCommandSequence ?? null;
  const receipt = lease.lastCommandReceipt ?? null;
  if (sequence === null && receipt === null) return null;
  if (sequence === null || receipt === null) {
    throw new Error('Gameplay command receipt does not match its sequence');
  }
  if (receipt.sequence !== sequence) {
    throw new Error('Gameplay command receipt does not match its sequence');
  }
  assertRenewalSequence(receipt.sequence);
  assertRequestId(receipt.requestId);
  if (typeof receipt.commandId !== 'string' || receipt.commandId.trim() === '' || receipt.commandId !== receipt.commandId.trim()) {
    throw new Error('Gameplay command receipt command id is required');
  }
  if (typeof receipt.success !== 'boolean') {
    throw new Error('Gameplay command receipt success flag is required');
  }
  if (receipt.payload == null || typeof receipt.payload !== 'object' || Array.isArray(receipt.payload)) {
    throw new Error('Gameplay command receipt payload is invalid');
  }
  if (!Array.isArray(receipt.errors)) {
    throw new Error('Gameplay command receipt errors are invalid');
  }
  const errors = receipt.errors.map((error) => {
    if (error == null || typeof error !== 'object' || typeof error.code !== 'string' || typeof error.message !== 'string') {
      throw new Error('Gameplay command receipt errors are invalid');
    }
    return { code: error.code, message: error.message };
  });
  return {
    sequence: receipt.sequence,
    requestId: receipt.requestId,
    commandId: receipt.commandId,
    success: receipt.success,
    payload: cloneJsonRecord(receipt.payload),
    errors,
  };
}

function cloneJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function assertRenewalSequence(renewalSequence: number): void {
  if (typeof renewalSequence !== 'number' || !Number.isSafeInteger(renewalSequence) || renewalSequence < 1) {
    throw new Error('Renewal sequence must be a positive safe integer');
  }
}

function copyLease(
  lease: GameplaySessionLease,
  openedByRequestId: string | null,
  lastRenewalSequence: number | null,
  lastCommandSequence: number | null,
  lastCommandReceipt: GameplayCommandReceipt | null,
): GameplaySessionLease {
  return {
    sessionId: lease.sessionId,
    openedAtMs: lease.openedAtMs,
    expiresAtMs: lease.expiresAtMs,
    endedAtMs: lease.endedAtMs,
    lastReceiptAtMs: lease.lastReceiptAtMs,
    lastRenewalRequestId: lease.lastRenewalRequestId,
    lastRenewalSequence,
    openedByRequestId,
    lastCommandSequence,
    lastCommandReceipt,
  };
}

function segment(startMs: number, endMs: number, presence: TemporalPresence): PresenceSegment {
  return { startMs, endMs, presence };
}
