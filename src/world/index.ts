export {
  ContinuousWorldEngine,
  WorldAdvanceResult,
  WorldSimulationHost,
  WorldTimeStamp,
  WorldAiDecisionRecord,
  WorldCommitmentProgressRecord,
  WorldCommitmentResolutionRecord,
  WorldEventStepResult,
} from './ContinuousWorldEngine';
export { catchUpWorld, nextCatchUpElapsedTicks, handleSyncPlayerWorld } from './catchup';
export type { CatchUpWorldResult } from './catchup';
export { runEventEngineTurn, EventTickResult } from './eventTick';
export {
  WORLD_TICK_DURATION_MS,
  currentUtcNowMs,
  utcEpochMs,
  elapsedWholeTicks,
  advanceAuthoritativeWorldClock,
} from './realtimeClock';
export type { WorldClockAdvance } from './realtimeClock';
export { accrueAuthoritativeWorldTime } from './worldAccrual';
export type { WorldTemporalAccrualResult } from './worldAccrual';
export {
  emptyFixedPointAccrual,
  isTemporalPresence,
  temporalRatePpm,
  promoteTemporalPresence,
  accrueSimulationTime,
  accrueSimulationTimeAtRatePpm,
  realMillisecondsForSimulationWork,
  beginActivityTemporalProgress,
  accrueActivityTemporalProgress,
  promoteActivityTemporalRate,
  accrueActivityThenObservePresence,
} from './timeToTick';
export type {
  TemporalPresence,
  FixedPointAccrual,
  ActivityTemporalProgress,
  TimeToTickAccrual,
} from './timeToTick';
export {
  TEMPORAL_BOUNDARY_STAGE,
  stageForBoundaryKind,
  compareTemporalBoundaries,
  orderTemporalBoundaries,
  realWorldGateBoundary,
  interruptionBoundary,
  postCompletionDecisionBoundary,
  normalizePresenceSegments,
  slicePresenceSegments,
  projectWorldAccrual,
  projectActionProgress,
  observeWorldAccrual,
  observeActionProgress,
  deriveWorldTickBoundaries,
  worldTickBoundaryInstant,
  deriveActionCompletion,
  deriveOrderedBoundaries,
} from './temporalBoundaries';
export type {
  TemporalBoundaryStage,
  TemporalBoundaryKind,
  TemporalBoundary,
  WorldAccrualState,
  PresenceSegment,
  PresenceSegmentInput,
  ActionClockInput,
  DerivedBoundaryInput,
} from './temporalBoundaries';
export {
  validateGameplaySessionLease,
  gameplaySessionLeaseEffectiveEndMs,
  gameplaySessionLeaseCoversInstant,
  playerPresenceAt,
  derivePresenceSegments,
  openGameplaySessionLease,
  renewGameplaySessionLease,
  renewGameplaySessionLeaseAtSequence,
  endGameplaySessionLease,
} from './presenceLeases';
export type {
  GameplaySessionLease,
  LeaseRenewalResult,
  SequencedLeaseRenewal,
  LeaseEndResult,
} from './presenceLeases';
export {
  parseElapsedTicks,
  commitmentDurationTicksFor,
  stampCommitmentTiming,
  ticksRemaining,
  isCommitmentReady,
  canReassessFaction,
} from './worldTime';
