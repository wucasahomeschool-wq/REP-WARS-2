import { GameState } from '../types/GameState';
import { WorkoutSession, WorkoutFeedbackState, WorkoutSessionState } from '../fitness/session/types';
import { WorkoutHistoryEntry } from '../fitness/history/types';
import { hasCompletedPrescribedWorkout, isEligibleForFitnessEvaluation } from '../fitness/session/summary';
import { WorkoutPurpose } from '../fitness/types';
import { WorkoutSize } from '../fitness/authoring/types';
import { CompletionRewardEntitlement, cloneCompletionRewardEntitlement } from './completionEntitlement';
import { AppliedEffectSummary, RewardApplicationSuccess } from './application/types';

/** Read-only client DTO. Payment status is always derived from the existing ledger. */
export interface WorkoutRewardView {
  formatVersion: 'workout-reward-view.v1';
  sessionId: string;
  workoutId: string;
  purpose: WorkoutPurpose;
  mode: 'LOCKED_COMPLETION' | 'LEGACY' | 'SPECIALIZED';
  workoutState: WorkoutSessionState;
  workoutSize: WorkoutSize | null;
  completionRewardEntitlement: CompletionRewardEntitlement | null;
  status: 'NOT_EARNED' | 'AWAITING_SETTLEMENT' | 'PENDING_RETRY' | 'SETTLED' | 'UNKNOWN';
  canFinalize: boolean;
  canSubmitFeedback: boolean;
  feedbackState: WorkoutFeedbackState | null;
  currentBankedTroops: number;
  settlement: {
    applicationId: string;
    kind: RewardApplicationSuccess['kind'];
    appliedAtTick: number;
    amountOrEffect: AppliedEffectSummary;
  } | null;
}

export function workoutRewardView(state: GameState, source: WorkoutSession | WorkoutHistoryEntry, isActive: boolean): WorkoutRewardView {
  const session = 'state' in source ? source : source.sessionSnapshot;
  const workoutState = session?.state ?? (source as WorkoutHistoryEntry).sessionState;
  const feedbackState = session?.feedbackState ?? (source as WorkoutHistoryEntry).summary?.feedbackState ?? null;
  const lock = source.completionRewardEntitlement
    ? cloneCompletionRewardEntitlement(source.completionRewardEntitlement, source) : null;
  const record = state.playerRewards.appliedRewards.find(row => row.sessionId === source.sessionId
    && (!lock || row.applicationId === lock.entitlementId)
    && row.result.playerId === source.playerId && row.result.sourceWorkoutId === source.workoutId);
  const applied = record?.result as unknown as RewardApplicationSuccess | undefined;
  const earned = workoutState === 'COMPLETED' && (!lock || (!!session && hasCompletedPrescribedWorkout(session)));
  const pending = state.playerFitness.pendingReward?.sessionId === source.sessionId;
  return {
    formatVersion: 'workout-reward-view.v1', sessionId: source.sessionId, workoutId: source.workoutId,
    purpose: source.purpose, mode: lock ? 'LOCKED_COMPLETION' : source.purpose === 'NORMAL_TROOPS' ? 'LEGACY' : 'SPECIALIZED',
    workoutState, workoutSize: lock?.size ?? session?.authoredCatalog?.size ?? null,
    completionRewardEntitlement: lock,
    // Pre-R1-E transitions could discard the ledger. History alone cannot prove
    // an old payment or establish another entitlement to credit.
    status: record ? 'SETTLED' : pending ? 'PENDING_RETRY'
      : !isActive && workoutState === 'COMPLETED' ? 'UNKNOWN' : earned ? 'AWAITING_SETTLEMENT' : 'NOT_EARNED',
    canFinalize: !record && isActive && !!session && (lock ? earned : isEligibleForFitnessEvaluation(session)),
    canSubmitFeedback: workoutState === 'COMPLETED' && !source.feedback
      && (isActive || (!!lock && !!session && !!record)),
    feedbackState, currentBankedTroops: state.playerRewards.bankedTroops,
    settlement: record && applied ? {
      applicationId: record.applicationId, kind: record.kind, appliedAtTick: record.appliedAtTick,
      amountOrEffect: JSON.parse(JSON.stringify(applied.amountOrEffect)) as AppliedEffectSummary,
    } : null,
  };
}
