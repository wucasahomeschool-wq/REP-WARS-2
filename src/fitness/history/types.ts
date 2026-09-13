/**
 * Durable workout history (Phase 17L).
 *
 * This is not GameState and not a second fitness estimate. It stores the
 * facts a future Fitness Engine needs: raw session evidence, derived
 * FitnessEvidence, and reward traceability into the 17H applied-reward ledger.
 *
 * Abandoned sessions are kept as operational/integrity records. They are
 * not eligible for completed-workout fitness evaluation.
 */
import { FitnessEvidence } from '../evaluation/types';
import { PhysicalResult } from '../physicalResult/types';
import {
  ExercisePerformance,
  SessionPrescribedWorkout,
  WorkoutAbandonmentReason,
  WorkoutFeedbackRecord,
  WorkoutGameplayContext,
  WorkoutIntegrityFlag,
  WorkoutSessionId,
  WorkoutSessionState,
  WorkoutSessionSummary,
} from '../session/types';
import { WorkoutDifficulty, WorkoutId, WorkoutPurpose } from '../types';

export const WORKOUT_HISTORY_FORMAT = 'workout-history.v1' as const;

export type WorkoutHistoryCompletionState = 'COMPLETED' | 'ABANDONED';

export interface WorkoutHistoryEntry {
  formatVersion: typeof WORKOUT_HISTORY_FORMAT;
  playerId: string;
  sessionId: WorkoutSessionId;
  workoutId: WorkoutId;
  purpose: WorkoutPurpose;
  intendedDifficulty: WorkoutDifficulty;
  completionState: WorkoutHistoryCompletionState;
  eligibleForFitnessEvaluation: boolean;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  abandonedAt: number | null;
  abandonmentReason: WorkoutAbandonmentReason | null;
  completedAtWorldTick: number | null;
  feedback: WorkoutFeedbackRecord | null;
  integrityFlags: WorkoutIntegrityFlag[];
  pauseCount: number;
  prescribedWorkout: SessionPrescribedWorkout;
  performances: ExercisePerformance[];
  summary: WorkoutSessionSummary | null;
  /** Exercise ids for indexed same-exercise queries. Not a fitness score. */
  exerciseIds: string[];
  evidence: FitnessEvidence | null;
  physicalOutput: number | null;
  physicalResult: PhysicalResult | null;
  rewardKind: string | null;
  rewardApplicationId: string | null;
  gameplayContext: WorkoutGameplayContext | null;
  sessionState: WorkoutSessionState;
}

export interface WorkoutHistoryQuery {
  limit?: number;
  before?: number;
  since?: number;
  excludeSessionId?: string;
  completedOnly?: boolean;
  eligibleOnly?: boolean;
}

export interface SameExerciseQuery extends WorkoutHistoryQuery {
  exerciseId: string;
}

export interface WorkoutHistoryStore {
  upsert(entry: WorkoutHistoryEntry): void;
  get(playerId: string, sessionId: string): WorkoutHistoryEntry | null;
  recentCompleted(playerId: string, query?: WorkoutHistoryQuery): WorkoutHistoryEntry[];
  completedSince(playerId: string, since: number, query?: WorkoutHistoryQuery): WorkoutHistoryEntry[];
  sameExercisePrior(playerId: string, query: SameExerciseQuery): WorkoutHistoryEntry[];
  evidenceForFitness(playerId: string, query?: WorkoutHistoryQuery): FitnessEvidence[];
  clonePlayer(playerId: string): WorkoutHistoryEntry[];
  replacePlayer(playerId: string, entries: readonly WorkoutHistoryEntry[]): void;
}
