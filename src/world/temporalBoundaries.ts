import { BALANCE } from '../constants/balance';
import {
  accrueSimulationTime,
  isTemporalPresence,
  promoteTemporalPresence,
  realMillisecondsForSimulationWork,
  type ActivityTemporalProgress,
  type FixedPointAccrual,
  type TemporalPresence,
} from './timeToTick';
import { utcEpochMs } from './realtimeClock';

/**
 * Pure boundary algebra for two clocks that share presence history.
 *
 * The world clock accrues at the presence of each segment. An action accrues
 * at its achieved rate. Promotion may raise that rate at a segment boundary.
 * Logout does not lower it. Neither clock reads durable simulation state.
 *
 * The ordering coordinate is the earliest safe integer UTC millisecond at
 * which the boundary's required work is earned. That millisecond comes from
 * Phase 1 `realMillisecondsForSimulationWork`: the smallest whole elapsed
 * millisecond whose fixed-point accrual satisfies the deficit. One millisecond
 * earlier does not. This module does not define a second rounding rule.
 *
 * Boundaries discovered from a watermark fall in the half-open window
 * (watermark, horizon]. A boundary already earned at the watermark is not
 * emitted again.
 */

export const TEMPORAL_BOUNDARY_STAGE = {
  ACTION_COMPLETION: 1,
  INTERRUPTION: 2,
  DEADLINE: 3,
  WORLD_PROCESS: 4,
  AI_DECISION: 5,
} as const;

export type TemporalBoundaryStage = (typeof TEMPORAL_BOUNDARY_STAGE)[keyof typeof TEMPORAL_BOUNDARY_STAGE];

export type TemporalBoundaryKind =
  | 'WORLD_TICK'
  | 'ACTION_COMPLETION'
  | 'REAL_WORLD_GATE'
  | 'INTERRUPTION'
  | 'AI_DECISION';

/**
 * Sort key, in order: `realInstantMs`, then `stage`, then `stableId`.
 * `stableId` uses UTF-16 code-unit order. Insertion order is not a key.
 */
export interface TemporalBoundary {
  kind: TemporalBoundaryKind;
  realInstantMs: number;
  stage: TemporalBoundaryStage;
  stableId: string;
  /** Whole world tick earned at this instant. Present for `WORLD_TICK`. */
  earnedWorldTick?: number;
  /** Achieved rate that earned the completing work. Present for `ACTION_COMPLETION`. */
  achievedRate?: TemporalPresence;
}

/** Plain Phase 2 world accrual. `accruedTargetWorldTick` is the earned whole-tick count. */
export interface WorldAccrualState {
  accruedTargetWorldTick: number;
  subTickMicroticks: number;
  accrualDivisionRemainder: number;
  lastAccrualAtMs: number;
}

/**
 * Presence in force on `[startMs, endMs)`.
 * The observation that selects this presence takes effect at `startMs`.
 * An action promotes here when this presence is faster than its achieved rate.
 * The world accrues this segment at this presence only.
 */
export interface PresenceSegment {
  startMs: number;
  endMs: number;
  presence: TemporalPresence;
}

export type PresenceSegmentInput = {
  startMs: number | string | Date;
  endMs: number | string | Date;
  presence: TemporalPresence;
};

export interface ActionClockInput {
  stableId: string;
  progress: ActivityTemporalProgress;
  requiredWholeTicks: number;
}

export interface DerivedBoundaryInput {
  world: WorldAccrualState;
  segments: readonly PresenceSegmentInput[];
  actions?: readonly ActionClockInput[];
  gates?: readonly { stableId: string; atMs: number | string | Date }[];
  interruptions?: readonly { stableId: string; atMs: number | string | Date }[];
  /** When true, each action completion also yields an AI decision boundary at the same millisecond. */
  includePostCompletionDecisions?: boolean;
}

const MICRO = BALANCE.temporal.microticksPerSimulationTick;

export function stageForBoundaryKind(kind: TemporalBoundaryKind): TemporalBoundaryStage {
  switch (kind) {
    case 'ACTION_COMPLETION':
      return TEMPORAL_BOUNDARY_STAGE.ACTION_COMPLETION;
    case 'INTERRUPTION':
      return TEMPORAL_BOUNDARY_STAGE.INTERRUPTION;
    case 'REAL_WORLD_GATE':
      return TEMPORAL_BOUNDARY_STAGE.DEADLINE;
    case 'WORLD_TICK':
      return TEMPORAL_BOUNDARY_STAGE.WORLD_PROCESS;
    case 'AI_DECISION':
      return TEMPORAL_BOUNDARY_STAGE.AI_DECISION;
    default:
      throw new Error('Temporal boundary kind is not recognized');
  }
}

export function compareTemporalBoundaries(left: TemporalBoundary, right: TemporalBoundary): number {
  if (left.realInstantMs !== right.realInstantMs) return left.realInstantMs < right.realInstantMs ? -1 : 1;
  if (left.stage !== right.stage) return left.stage - right.stage;
  if (left.stableId < right.stableId) return -1;
  if (left.stableId > right.stableId) return 1;
  return 0;
}

/** Copy and sort. Duplicate `(instant, stage, stableId)` keys throw instead of falling through to input order. */
export function orderTemporalBoundaries(boundaries: readonly TemporalBoundary[]): TemporalBoundary[] {
  const ordered = boundaries.map((item) => ({ ...assertBoundary(item) }));
  ordered.sort(compareTemporalBoundaries);
  for (let i = 1; i < ordered.length; i++) {
    if (compareTemporalBoundaries(ordered[i - 1]!, ordered[i]!) === 0) {
      throw new Error('Temporal boundaries share a real instant, stage, and stable id');
    }
  }
  return ordered;
}

export function realWorldGateBoundary(stableId: string, atMs: number | string | Date): TemporalBoundary {
  return boundary('REAL_WORLD_GATE', utcEpochMs(atMs), stableId);
}

export function interruptionBoundary(stableId: string, atMs: number | string | Date): TemporalBoundary {
  return boundary('INTERRUPTION', utcEpochMs(atMs), stableId);
}

/** Same real instant as the action completion. Stage 5 sorts after stage 1. */
export function postCompletionDecisionBoundary(completion: TemporalBoundary): TemporalBoundary {
  const checked = assertBoundary(completion);
  if (checked.kind !== 'ACTION_COMPLETION') {
    throw new Error('Post-completion decision requires an action-completion boundary');
  }
  return boundary('AI_DECISION', checked.realInstantMs, checked.stableId);
}

export function normalizePresenceSegments(input: readonly PresenceSegmentInput[]): PresenceSegment[] {
  const segments = input.map((segment) => ({
    startMs: utcEpochMs(segment.startMs),
    endMs: utcEpochMs(segment.endMs),
    presence: segment.presence,
  }));
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    if (!isTemporalPresence(segment.presence)) {
      throw new Error('Temporal rate is not a configured online or offline rate');
    }
    if (segment.endMs < segment.startMs) throw new Error('Temporal boundary interval must not rewind');
    if (i > 0 && segment.startMs !== segments[i - 1]!.endMs) {
      throw new Error('Presence segments must be contiguous');
    }
  }
  return segments;
}

/** Coverage-clipped copy. Empty when `fromMs === untilMs`. Does not invent a rate for a gap. */
export function slicePresenceSegments(
  input: readonly PresenceSegmentInput[],
  fromMs: number | string | Date,
  untilMs: number | string | Date,
): PresenceSegment[] {
  const from = utcEpochMs(fromMs);
  const until = utcEpochMs(untilMs);
  if (until < from) throw new Error('Temporal boundary interval must not rewind');
  const segments = normalizePresenceSegments(input);
  if (segments.length === 0) return [];
  const coverageStart = segments[0]!.startMs;
  const coverageEnd = segments[segments.length - 1]!.endMs;
  if (from < coverageStart || until > coverageEnd) {
    throw new Error('Presence slice is outside the segment coverage');
  }
  const sliced: PresenceSegment[] = [];
  for (const segment of segments) {
    const startMs = segment.startMs > from ? segment.startMs : from;
    const endMs = segment.endMs < until ? segment.endMs : until;
    if (endMs > startMs) sliced.push({ startMs, endMs, presence: segment.presence });
  }
  return sliced;
}

export function projectWorldAccrual(state: WorldAccrualState, input: readonly PresenceSegmentInput[]): WorldAccrualState {
  return walkWorld(state, normalizePresenceSegments(input)).state;
}

export function projectActionProgress(
  progress: ActivityTemporalProgress,
  input: readonly PresenceSegmentInput[],
): ActivityTemporalProgress {
  return walkAction(progress, normalizePresenceSegments(input)).progress;
}

/** Earlier than the watermark: no accrual and no promotion. Equal: world state unchanged. */
export function observeWorldAccrual(
  state: WorldAccrualState,
  atMs: number | string | Date,
  presence: TemporalPresence,
): WorldAccrualState {
  const at = utcEpochMs(atMs);
  const current = cloneWorld(state);
  if (at < current.lastAccrualAtMs) return current;
  if (at === current.lastAccrualAtMs) return current;
  return projectWorldAccrual(current, [{ startMs: current.lastAccrualAtMs, endMs: at, presence }]);
}

/**
 * Earlier than the watermark: no accrual and no promotion.
 * Equal: promote when the observation is faster, and add no work.
 */
export function observeActionProgress(
  progress: ActivityTemporalProgress,
  atMs: number | string | Date,
  observedPresence: TemporalPresence,
): ActivityTemporalProgress {
  const at = utcEpochMs(atMs);
  const current = cloneProgress(progress);
  if (!isTemporalPresence(observedPresence)) {
    throw new Error('Temporal rate is not a configured online or offline rate');
  }
  if (at < current.accruedThroughMs) return current;
  if (at === current.accruedThroughMs) {
    return { ...current, achievedRate: promoteTemporalPresence(current.achievedRate, observedPresence) };
  }
  return projectActionProgress(current, [{ startMs: current.accruedThroughMs, endMs: at, presence: observedPresence }]);
}

export function deriveWorldTickBoundaries(
  state: WorldAccrualState,
  input: readonly PresenceSegmentInput[],
): TemporalBoundary[] {
  return walkWorld(state, normalizePresenceSegments(input)).boundaries;
}

/**
 * Earliest millisecond at which `earnedWorldTick` becomes earned, or null when
 * that tick is outside `(lastAccrualAtMs, horizon]`.
 */
export function worldTickBoundaryInstant(
  state: WorldAccrualState,
  earnedWorldTick: number,
  input: readonly PresenceSegmentInput[],
): number | null {
  assertWholeTicks(earnedWorldTick);
  const segments = normalizePresenceSegments(input);
  let current = cloneWorld(state);
  if (earnedWorldTick <= current.accruedTargetWorldTick) return null;
  if (segments.length === 0) return null;
  if (segments[0]!.startMs !== current.lastAccrualAtMs) {
    throw new Error('World presence segments must start at the accrual watermark');
  }
  for (const segment of segments) {
    const elapsed = millisecondsUntilWholeTicks(toAccrual(current), earnedWorldTick, segment.presence);
    const instant = current.lastAccrualAtMs + elapsed;
    if (!Number.isSafeInteger(instant)) throw new Error('Boundary instant exceeds a safe integer');
    if (instant <= segment.endMs) return instant;
    if (segment.endMs > current.lastAccrualAtMs) {
      const tail = segment.endMs - current.lastAccrualAtMs;
      current = fromAccrual(accrueFixed(toAccrual(current), tail, segment.presence), segment.endMs);
    }
    if (current.accruedTargetWorldTick >= earnedWorldTick) {
      throw new Error('World-tick boundary was earned inside a segment but not reported at its instant');
    }
  }
  return null;
}

/** Derived completion inside the segment horizon, or null when the work is already met or not yet met. */
export function deriveActionCompletion(
  action: ActionClockInput,
  input: readonly PresenceSegmentInput[],
): TemporalBoundary | null {
  return walkAction(action.progress, normalizePresenceSegments(input), action.requiredWholeTicks, action.stableId).completion;
}

export function deriveOrderedBoundaries(input: DerivedBoundaryInput): TemporalBoundary[] {
  const segments = normalizePresenceSegments(input.segments);
  const world = cloneWorld(input.world);
  if (segments.length > 0 && segments[0]!.startMs !== world.lastAccrualAtMs) {
    throw new Error('World presence segments must start at the accrual watermark');
  }
  const horizon = segments.length === 0 ? world.lastAccrualAtMs : segments[segments.length - 1]!.endMs;
  const coverageStart = segments.length === 0 ? world.lastAccrualAtMs : segments[0]!.startMs;
  const boundaries: TemporalBoundary[] = [...deriveWorldTickBoundaries(world, segments)];

  for (const action of input.actions ?? []) {
    const started = action.progress.accruedThroughMs;
    if (started < coverageStart || started > horizon) {
      throw new Error('Action accrual watermark is outside the presence coverage');
    }
    const actionSegments = slicePresenceSegments(segments, started, horizon);
    const completion = deriveActionCompletion(action, actionSegments);
    if (!completion) continue;
    boundaries.push(completion);
    if (input.includePostCompletionDecisions) boundaries.push(postCompletionDecisionBoundary(completion));
  }

  for (const gate of input.gates ?? []) {
    const instant = utcEpochMs(gate.atMs);
    if (instant > world.lastAccrualAtMs && instant <= horizon) boundaries.push(realWorldGateBoundary(gate.stableId, instant));
  }
  for (const interruption of input.interruptions ?? []) {
    const instant = utcEpochMs(interruption.atMs);
    if (instant > world.lastAccrualAtMs && instant <= horizon) boundaries.push(interruptionBoundary(interruption.stableId, instant));
  }
  return orderTemporalBoundaries(boundaries);
}

function walkWorld(state: WorldAccrualState, segments: readonly PresenceSegment[]): { state: WorldAccrualState; boundaries: TemporalBoundary[] } {
  let current = cloneWorld(state);
  const boundaries: TemporalBoundary[] = [];
  if (segments.length === 0) return { state: current, boundaries };
  if (segments[0]!.startMs !== current.lastAccrualAtMs) {
    throw new Error('World presence segments must start at the accrual watermark');
  }
  for (const segment of segments) {
    let atMs = segment.startMs;
    while (atMs < segment.endMs) {
      if (atMs !== current.lastAccrualAtMs) throw new Error('World accrual watermark diverged from the segment cursor');
      const nextTick = current.accruedTargetWorldTick + 1;
      const elapsed = millisecondsUntilWholeTicks(toAccrual(current), nextTick, segment.presence);
      if (elapsed <= 0) throw new Error('World-tick boundary did not advance');
      const instant = atMs + elapsed;
      if (!Number.isSafeInteger(instant)) throw new Error('Boundary instant exceeds a safe integer');
      if (instant > segment.endMs) break;
      const earned = accrueFixed(toAccrual(current), elapsed, segment.presence);
      if (earned.wholeTicks !== nextTick) {
        throw new Error('World-tick boundary crossed more or less than one whole tick');
      }
      current = fromAccrual(earned, instant);
      boundaries.push(worldTickBoundary(nextTick, instant));
      atMs = instant;
    }
    if (segment.endMs > current.lastAccrualAtMs) {
      const tail = segment.endMs - current.lastAccrualAtMs;
      current = fromAccrual(accrueFixed(toAccrual(current), tail, segment.presence), segment.endMs);
    }
  }
  return { state: current, boundaries };
}

function walkAction(
  progress: ActivityTemporalProgress,
  segments: readonly PresenceSegment[],
  requiredWholeTicks?: number,
  stableId?: string,
): { progress: ActivityTemporalProgress; completion: TemporalBoundary | null } {
  let current = cloneProgress(progress);
  let completion: TemporalBoundary | null = null;
  if (requiredWholeTicks !== undefined) assertWholeTicks(requiredWholeTicks);
  if (stableId !== undefined) assertStableId(stableId);
  if (segments.length === 0) return { progress: current, completion };
  if (segments[0]!.startMs !== current.accruedThroughMs) {
    throw new Error('Action presence segments must start at the accrual watermark');
  }
  for (const segment of segments) {
    const achievedRate = promoteTemporalPresence(current.achievedRate, segment.presence);
    current = { ...current, achievedRate };
    const span = segment.endMs - segment.startMs;
    if (
      completion === null
      && requiredWholeTicks !== undefined
      && stableId !== undefined
      && !wholeTicksEarned(current, requiredWholeTicks)
    ) {
      const elapsed = millisecondsUntilWholeTicks(current, requiredWholeTicks, achievedRate);
      if (elapsed <= 0) throw new Error('Unsatisfied action work did not advance');
      if (elapsed <= span) {
        const instant = current.accruedThroughMs + elapsed;
        if (!Number.isSafeInteger(instant)) throw new Error('Boundary instant exceeds a safe integer');
        completion = actionCompletionBoundary(stableId, instant, achievedRate);
      }
    }
    if (span > 0) {
      const earned = accrueFixed(current, span, achievedRate);
      current = {
        ...earned,
        achievedRate,
        accruedThroughMs: segment.endMs,
      };
    }
  }
  return { progress: current, completion };
}

/**
 * Smallest whole elapsed millisecond at which `targetWholeTicks` has been earned
 * from `progress` at `presence`. Zero when that many whole ticks are already earned.
 * Uses Phase 1 ceiling division, so the previous millisecond is still short.
 */
function millisecondsUntilWholeTicks(progress: FixedPointAccrual, targetWholeTicks: number, presence: TemporalPresence): number {
  assertWholeTicks(targetWholeTicks);
  if (progress.wholeTicks > targetWholeTicks) return 0;
  if (progress.wholeTicks === targetWholeTicks) return 0;
  const ticksAhead = targetWholeTicks - progress.wholeTicks;
  if (progress.subTickMicroticks === 0) {
    return realMillisecondsForSimulationWork(ticksAhead, 0, presence, progress.accrualDivisionRemainder);
  }
  const partial = MICRO - progress.subTickMicroticks;
  if (ticksAhead === 1) {
    return realMillisecondsForSimulationWork(0, partial, presence, progress.accrualDivisionRemainder);
  }
  return realMillisecondsForSimulationWork(ticksAhead - 1, partial, presence, progress.accrualDivisionRemainder);
}

function wholeTicksEarned(progress: FixedPointAccrual, requiredWholeTicks: number): boolean {
  return progress.wholeTicks >= requiredWholeTicks;
}

function accrueFixed(progress: FixedPointAccrual, elapsedMs: number, presence: TemporalPresence): FixedPointAccrual {
  const earned = accrueSimulationTime(progress, elapsedMs, presence);
  return {
    wholeTicks: earned.wholeTicks,
    subTickMicroticks: earned.subTickMicroticks,
    accrualDivisionRemainder: earned.accrualDivisionRemainder,
  };
}

function toAccrual(state: WorldAccrualState): FixedPointAccrual {
  return {
    wholeTicks: state.accruedTargetWorldTick,
    subTickMicroticks: state.subTickMicroticks,
    accrualDivisionRemainder: state.accrualDivisionRemainder,
  };
}

function fromAccrual(progress: FixedPointAccrual, atMs: number): WorldAccrualState {
  return {
    accruedTargetWorldTick: progress.wholeTicks,
    subTickMicroticks: progress.subTickMicroticks,
    accrualDivisionRemainder: progress.accrualDivisionRemainder,
    lastAccrualAtMs: atMs,
  };
}

function worldTickBoundary(earnedWorldTick: number, realInstantMs: number): TemporalBoundary {
  return {
    ...boundary('WORLD_TICK', realInstantMs, `world-tick:${earnedWorldTick}`),
    earnedWorldTick,
  };
}

function actionCompletionBoundary(stableId: string, realInstantMs: number, achievedRate: TemporalPresence): TemporalBoundary {
  return {
    ...boundary('ACTION_COMPLETION', realInstantMs, stableId),
    achievedRate,
  };
}

function boundary(kind: TemporalBoundaryKind, realInstantMs: number, stableId: string): TemporalBoundary {
  assertStableId(stableId);
  if (!Number.isSafeInteger(realInstantMs)) throw new Error('Boundary instant must be a safe integer millisecond');
  return { kind, realInstantMs, stage: stageForBoundaryKind(kind), stableId };
}

function assertBoundary(value: TemporalBoundary): TemporalBoundary {
  stageForBoundaryKind(value.kind);
  if (value.stage !== stageForBoundaryKind(value.kind)) {
    throw new Error('Temporal boundary stage does not match its kind');
  }
  assertStableId(value.stableId);
  if (!Number.isSafeInteger(value.realInstantMs)) throw new Error('Boundary instant must be a safe integer millisecond');
  return value;
}

function assertStableId(stableId: string): void {
  if (typeof stableId !== 'string' || stableId.length === 0) throw new Error('Temporal boundary stable id is required');
}

function assertWholeTicks(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Simulation ticks must be a non-negative safe integer');
}

function cloneWorld(state: WorldAccrualState): WorldAccrualState {
  return {
    accruedTargetWorldTick: state.accruedTargetWorldTick,
    subTickMicroticks: state.subTickMicroticks,
    accrualDivisionRemainder: state.accrualDivisionRemainder,
    lastAccrualAtMs: state.lastAccrualAtMs,
  };
}

function cloneProgress(progress: ActivityTemporalProgress): ActivityTemporalProgress {
  return {
    wholeTicks: progress.wholeTicks,
    subTickMicroticks: progress.subTickMicroticks,
    accrualDivisionRemainder: progress.accrualDivisionRemainder,
    achievedRate: progress.achievedRate,
    accruedThroughMs: progress.accruedThroughMs,
  };
}
