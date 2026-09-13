import { cloneFitnessEvidence } from '../evaluation/clone';
import { clonePhysicalResult } from '../physicalResult/clone';
import { cloneExercisePerformance, cloneSessionPrescribedWorkout, cloneFeedbackRecord, cloneIntegrityFlag } from '../session/clone';
import { WorkoutSession } from '../session/types';
import { isEligibleForFitnessEvaluation, buildWorkoutSessionSummary } from '../session/summary';
import { WorkoutHistoryEntry, WORKOUT_HISTORY_FORMAT } from './types';
import { FitnessEvidence } from '../evaluation/types';
import { PhysicalResult } from '../physicalResult/types';

export function cloneWorkoutHistoryEntry(entry: WorkoutHistoryEntry): WorkoutHistoryEntry {
  return {
    formatVersion: WORKOUT_HISTORY_FORMAT,
    playerId: entry.playerId,
    sessionId: entry.sessionId,
    workoutId: entry.workoutId,
    purpose: entry.purpose,
    intendedDifficulty: entry.intendedDifficulty,
    completionState: entry.completionState,
    eligibleForFitnessEvaluation: entry.eligibleForFitnessEvaluation,
    createdAt: entry.createdAt,
    startedAt: entry.startedAt,
    completedAt: entry.completedAt,
    abandonedAt: entry.abandonedAt,
    abandonmentReason: entry.abandonmentReason,
    completedAtWorldTick: entry.completedAtWorldTick,
    feedback: entry.feedback ? cloneFeedbackRecord(entry.feedback) : null,
    integrityFlags: entry.integrityFlags.map(cloneIntegrityFlag),
    pauseCount: entry.pauseCount,
    prescribedWorkout: cloneSessionPrescribedWorkout(entry.prescribedWorkout),
    performances: entry.performances.map(cloneExercisePerformance),
    summary: entry.summary ? JSON.parse(JSON.stringify(entry.summary)) as WorkoutHistoryEntry['summary'] : null,
    exerciseIds: [...entry.exerciseIds],
    evidence: entry.evidence ? cloneFitnessEvidence(entry.evidence) : null,
    physicalOutput: entry.physicalOutput,
    physicalResult: entry.physicalResult ? clonePhysicalResult(entry.physicalResult) : null,
    rewardKind: entry.rewardKind,
    rewardApplicationId: entry.rewardApplicationId,
    gameplayContext: entry.gameplayContext ? { ...entry.gameplayContext } : null,
    sessionState: entry.sessionState,
  };
}

export function toWorkoutHistoryEntry(
  session: WorkoutSession,
  extras: {
    completedAtWorldTick?: number | null;
    evidence?: FitnessEvidence | null;
    physicalResult?: PhysicalResult | null;
    rewardKind?: string | null;
    rewardApplicationId?: string | null;
  } = {},
): WorkoutHistoryEntry {
  const abandoned = session.state === 'ABANDONED';
  const completed = session.state === 'COMPLETED';
  const eligible = isEligibleForFitnessEvaluation(session);
  const exerciseIds = [...new Set(session.prescribedWorkout.exercises.map((step) => step.exerciseId))];
  return {
    formatVersion: WORKOUT_HISTORY_FORMAT,
    playerId: session.playerId,
    sessionId: session.sessionId,
    workoutId: session.workoutId,
    purpose: session.purpose,
    intendedDifficulty: session.intendedDifficulty,
    completionState: abandoned ? 'ABANDONED' : 'COMPLETED',
    eligibleForFitnessEvaluation: eligible,
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    abandonedAt: session.abandonedAt,
    abandonmentReason: session.abandonmentReason,
    completedAtWorldTick: extras.completedAtWorldTick ?? null,
    feedback: session.feedback ? cloneFeedbackRecord(session.feedback) : null,
    integrityFlags: session.integrityFlags.map(cloneIntegrityFlag),
    pauseCount: session.pauseCount,
    prescribedWorkout: cloneSessionPrescribedWorkout(session.prescribedWorkout),
    performances: session.performances.map(cloneExercisePerformance),
    summary: (completed || abandoned) ? buildWorkoutSessionSummary(session) : null,
    exerciseIds,
    evidence: eligible && extras.evidence ? cloneFitnessEvidence(extras.evidence) : null,
    physicalOutput: extras.physicalResult?.totalPhysicalOutput ?? null,
    physicalResult: extras.physicalResult ? clonePhysicalResult(extras.physicalResult) : null,
    rewardKind: extras.rewardKind ?? null,
    rewardApplicationId: extras.rewardApplicationId ?? null,
    gameplayContext: session.gameplayContext ? { ...session.gameplayContext } : null,
    sessionState: session.state,
  };
}
