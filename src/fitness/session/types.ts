/**
 * WORKOUT SESSION DOMAIN (Phase 17B)
 *
 * WorkoutSession records what the player actually did. It must not be mixed
 * into WorkoutDefinition (what was prescribed). Performance values are facts
 * for a future Fitness Engine; this module does not score fitness or awards.
 */

import {
  BodySection,
  ExerciseId,
  ExercisePrescription,
  ExerciseType,
  WorkoutDifficulty,
  WorkoutExerciseRole,
  WorkoutId,
  WorkoutPurpose,
} from '../types';

export type WorkoutSessionId = string;

export const WORKOUT_SESSION_STATES = [
  'NOT_STARTED',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'ABANDONED',
] as const;
export type WorkoutSessionState = (typeof WORKOUT_SESSION_STATES)[number];

export const EXERCISE_PERFORMANCE_STATUSES = [
  'PENDING',
  'COMPLETED',
  'SKIPPED_REST',
  'INCOMPLETE_MANDATORY',
] as const;
export type ExercisePerformanceStatus = (typeof EXERCISE_PERFORMANCE_STATUSES)[number];

export const WORKOUT_FEEDBACK_VALUES = [
  'TOO_EASY',
  'EASY',
  'ABOUT_RIGHT',
  'HARD',
  'TOO_HARD',
] as const;
export type WorkoutFeedbackValue = (typeof WORKOUT_FEEDBACK_VALUES)[number];

export const WORKOUT_FEEDBACK_STATES = [
  'NOT_APPLICABLE',
  'FEEDBACK_REQUIRED',
  'FEEDBACK_SUBMITTED',
] as const;
export type WorkoutFeedbackState = (typeof WORKOUT_FEEDBACK_STATES)[number];

export const WORKOUT_FEEDBACK_PROMPT =
  'How hard do you think this workout was relative to the difficulty?';

export const WORKOUT_ABANDONMENT_REASONS = ['PLAYER', 'INTEGRITY_FLAGS', 'INVASION_TIMEOUT'] as const;
export type WorkoutAbandonmentReason = (typeof WORKOUT_ABANDONMENT_REASONS)[number];

export const INTEGRITY_FLAG_TYPES = ['SUSPECTED_INTEGRITY'] as const;
export type IntegrityFlagType = (typeof INTEGRITY_FLAG_TYPES)[number];

export type ExerciseActualPerformance =
  | { kind: 'none' }
  | { kind: 'repetitions'; completedRepetitions: number }
  | { kind: 'duration'; completedDurationSeconds: number }
  | { kind: 'skipped_rest' };

export interface SessionPrescribedExercise {
  exerciseId: ExerciseId;
  order: number;
  exerciseType: ExerciseType;
  isRest: boolean;
  bodySection: BodySection;
  prescription: ExercisePrescription;
  role: WorkoutExerciseRole;
  skippable: boolean;
}

export interface SessionPrescribedWorkout {
  workoutId: WorkoutId;
  intendedDifficulty: WorkoutDifficulty;
  exercises: SessionPrescribedExercise[];
}

export interface ExercisePerformance {
  exerciseId: ExerciseId;
  order: number;
  exerciseType: ExerciseType;
  prescribed: ExercisePrescription;
  actual: ExerciseActualPerformance;
  status: ExercisePerformanceStatus;
  startedAt: number | null;
  completedAt: number | null;
  /**
   * Elapsed session-clock ms while this exercise was current, excluding pause
   * intervals. Evidence for a future rep-speed estimate — not a fitness score
   * and not claimed as sensor-precise.
   */
  activeDurationMs: number | null;
}

export interface PauseInterval {
  startedAt: number;
  endedAt: number | null;
}

export interface WorkoutIntegrityFlag {
  index: number;
  type: IntegrityFlagType;
  recordedAt: number;
  sessionStateAtFlag: WorkoutSessionState;
}

export interface WorkoutFeedbackRecord {
  value: WorkoutFeedbackValue;
  intendedDifficulty: WorkoutDifficulty;
  submittedAt: number;
}

export interface WorkoutGameplayContext {
  invasionId?: string;
  constructionId?: string;
  collectionTerritoryId?: string;
  startedAtWorldTick?: number | null;
}

/** Snapshot of the authored catalog used for this session. Not a fitness score. */
export interface WorkoutSessionAuthoredRef {
  catalogId: string;
  catalogVersion: string;
  engineVersion: string;
  familyId: string;
  size: 'SHORT' | 'STANDARD' | 'LONG';
  progressionBandId: string;
}

export interface WorkoutSession {
  sessionId: WorkoutSessionId;
  playerId: string;
  workoutId: WorkoutId;
  intendedDifficulty: WorkoutDifficulty;
  purpose: WorkoutPurpose;
  state: WorkoutSessionState;
  prescribedWorkout: SessionPrescribedWorkout;
  currentExerciseIndex: number | null;
  performances: ExercisePerformance[];
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  abandonedAt: number | null;
  abandonmentReason: WorkoutAbandonmentReason | null;
  pauseIntervals: PauseInterval[];
  pauseCount: number;
  integrityFlags: WorkoutIntegrityFlag[];
  feedbackState: WorkoutFeedbackState;
  feedback: WorkoutFeedbackRecord | null;
  /** Optional live-action hook for reward application. Not a fitness input. */
  gameplayContext?: WorkoutGameplayContext;
  /** Present when the session used a compiled authored-v2 workout. */
  authoredCatalog?: WorkoutSessionAuthoredRef;
}

export interface WorkoutSessionSummaryExercise {
  order: number;
  exerciseId: ExerciseId;
  exerciseType: ExerciseType;
  bodySection: BodySection;
  isRest: boolean;
  status: ExercisePerformanceStatus;
  prescribed: ExercisePrescription;
  actual: ExerciseActualPerformance;
  startedAt: number | null;
  completedAt: number | null;
  activeDurationMs: number | null;
}

export interface WorkoutSessionSummary {
  sessionId: WorkoutSessionId;
  playerId: string;
  workoutId: WorkoutId;
  intendedDifficulty: WorkoutDifficulty;
  purpose: WorkoutPurpose;
  state: WorkoutSessionState;
  feedbackState: WorkoutFeedbackState;
  feedback: WorkoutFeedbackRecord | null;
  eligibleForFitnessEvaluation: boolean;
  exerciseCount: number;
  completedExerciseCount: number;
  skippedRestCount: number;
  mandatoryIncompleteCount: number;
  flagCount: number;
  pauseCount: number;
  totalPausedMs: number;
  totalActiveDurationMs: number;
  startedAt: number | null;
  completedAt: number | null;
  abandonedAt: number | null;
  abandonmentReason: WorkoutAbandonmentReason | null;
  exercises: WorkoutSessionSummaryExercise[];
}

/**
 * Compact finalized record for a future Fitness Engine.
 * Does not contain Fitness Level, confidence, or game rewards.
 */
export interface CompletedWorkoutRecord {
  kind: 'completed_workout_record';
  sessionId: WorkoutSessionId;
  playerId: string;
  workoutId: WorkoutId;
  intendedDifficulty: WorkoutDifficulty;
  purpose: WorkoutPurpose;
  completedAt: number;
  feedback: WorkoutFeedbackRecord | null;
  feedbackState: WorkoutFeedbackState;
  eligibleForFitnessEvaluation: boolean;
  summary: WorkoutSessionSummary;
}
