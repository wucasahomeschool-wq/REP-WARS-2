/**
 * FITNESS EVIDENCE (Phase 17C)
 *
 * Objective observations extracted from a CompletedWorkoutRecord.
 * This is not a Fitness Level, Confidence, or game reward.
 */

import { BodySection, ExerciseId, WorkoutDifficulty, WorkoutId, WorkoutPurpose } from '../types';
import {
  ExercisePerformanceStatus,
  WorkoutFeedbackValue,
  WorkoutSessionId,
} from '../session/types';

export const FITNESS_EVIDENCE_VERSION = 'fitness-evidence.v1';

export const FITNESS_EVIDENCE_SOURCES = [
  'PERCEIVED_DIFFICULTY',
  'COMPLETION',
  'REP_SPEED',
  'WORKLOAD',
  'REST_SKIPPING',
  'BODY_SECTION',
  'FREQUENCY',
  'REGROUPING',
] as const;
export type FitnessEvidenceSource = (typeof FITNESS_EVIDENCE_SOURCES)[number];

export const EVIDENCE_QUALITIES = ['STRONG', 'PARTIAL', 'UNAVAILABLE'] as const;
export type EvidenceQuality = (typeof EVIDENCE_QUALITIES)[number];

/** Feedback vs intended difficulty. Not a Fitness Level delta. */
export const FEEDBACK_RELATIVE_OFFSET: Readonly<Record<WorkoutFeedbackValue, number>> = Object.freeze({
  TOO_EASY: -2,
  EASY: -1,
  ABOUT_RIGHT: 0,
  HARD: 1,
  TOO_HARD: 2,
});

export const RELATIVE_DIFFICULTY_READINGS = [
  'EASIER_THAN_INTENDED',
  'AS_INTENDED',
  'HARDER_THAN_INTENDED',
] as const;
export type RelativeDifficultyReading = (typeof RELATIVE_DIFFICULTY_READINGS)[number];

/**
 * Optional future context. 17C does not invent history or recovery rules.
 * Frequency and regrouping components stay UNAVAILABLE until a later phase
 * interprets these fields.
 */
export interface FitnessEvaluationContext {
  evaluatedAt?: number;
  recentCompletedWorkouts?: readonly unknown[];
  historicalCompletedWorkouts?: readonly unknown[];
  previousEvidence?: readonly unknown[];
  regrouping?: {
    expectedRegroupingEndedAt?: number;
    resumedBeforeRegroupingEnded?: boolean;
  };
}

export interface PerceivedDifficultyEvidence {
  source: 'PERCEIVED_DIFFICULTY';
  quality: EvidenceQuality;
  intendedDifficulty: WorkoutDifficulty;
  intendedDifficultyRank: number;
  perceivedRelative: WorkoutFeedbackValue;
  /** Discrete ordinal of feedback vs intended. Not a fitness delta. */
  relativeOffset: number;
  reading: RelativeDifficultyReading;
}

export interface RepBasedCompletionTotals {
  exercisesPrescribed: number;
  exercisesCompleted: number;
  exercisesIncomplete: number;
  prescribedRepetitions: number;
  completedRepetitions: number;
}

export interface TimedCompletionTotals {
  exercisesPrescribed: number;
  exercisesCompleted: number;
  exercisesIncomplete: number;
  prescribedDurationSeconds: number;
  completedDurationSeconds: number;
}

export interface CompletionPerformanceEvidence {
  source: 'COMPLETION';
  quality: EvidenceQuality;
  exercisesPrescribed: number;
  exercisesCompleted: number;
  exercisesSkippedRest: number;
  exercisesIncompleteMandatory: number;
  mandatoryPrescribed: number;
  mandatoryCompleted: number;
  mandatoryCompletionRatio: number | null;
  resolvedRatio: number | null;
  repBased: RepBasedCompletionTotals;
  timed: TimedCompletionTotals;
}

export interface RepSpeedRaw {
  completedRepetitions: number;
  activeDurationMs: number;
}

export interface RepSpeedDerived {
  available: true;
  averageMsPerRep: number;
}

export interface RepSpeedUnavailable {
  available: false;
  reason: string;
}

export interface RepSpeedExerciseEvidence {
  order: number;
  exerciseId: ExerciseId;
  status: ExercisePerformanceStatus;
  raw: { completedRepetitions: number | null; activeDurationMs: number | null };
  derived: RepSpeedDerived | RepSpeedUnavailable;
}

export interface RepSpeedEvidence {
  source: 'REP_SPEED';
  quality: EvidenceQuality;
  /** Timing is session-clock active duration (pauses already excluded by 17B), not sensor-grade. */
  timingPrecision: 'session_clock_minus_pauses';
  exercises: RepSpeedExerciseEvidence[];
  aggregate:
    | {
        available: true;
        totalCompletedRepetitions: number;
        totalActiveDurationMs: number;
        averageMsPerRep: number;
      }
    | { available: false; reason: string };
}

export interface WorkloadEvidence {
  source: 'WORKLOAD';
  quality: EvidenceQuality;
  exerciseCount: number;
  activeExerciseCount: number;
  intendedDifficulty: WorkoutDifficulty;
  totalPrescribedRepetitions: number;
  totalCompletedRepetitions: number;
  repetitionCompletionRatio: number | null;
  totalPrescribedTimedDurationSeconds: number;
  totalCompletedTimedDurationSeconds: number;
  timedCompletionRatio: number | null;
}

export interface RestSkippingEvidence {
  source: 'REST_SKIPPING';
  quality: EvidenceQuality;
  restExercisesPrescribed: number;
  restExercisesCompleted: number;
  restExercisesSkipped: number;
  restSkipRate: number | null;
}

export interface BodySectionTotals {
  exercisesPrescribed: number;
  exercisesCompleted: number;
  exercisesSkippedRest: number;
  exercisesIncompleteMandatory: number;
  prescribedRepetitions: number;
  completedRepetitions: number;
  prescribedTimedDurationSeconds: number;
  completedTimedDurationSeconds: number;
}

export interface BodySectionEvidence {
  source: 'BODY_SECTION';
  quality: EvidenceQuality;
  upperBodyExercises: number;
  coreExercises: number;
  lowerBodyExercises: number;
  globalExercises: number;
  sections: Record<BodySection, BodySectionTotals>;
}

export interface FrequencyEvidence {
  source: 'FREQUENCY';
  quality: 'UNAVAILABLE';
  reason: 'history_not_in_scope';
}

export interface RegroupingEvidence {
  source: 'REGROUPING';
  quality: 'UNAVAILABLE';
  reason: 'regrouping_not_in_scope';
}

export interface FitnessEvidenceComponents {
  perceivedDifficulty: PerceivedDifficultyEvidence;
  completion: CompletionPerformanceEvidence;
  repSpeed: RepSpeedEvidence;
  workload: WorkloadEvidence;
  restSkipping: RestSkippingEvidence;
  bodySection: BodySectionEvidence;
  frequency: FrequencyEvidence;
  regrouping: RegroupingEvidence;
}

export interface FitnessEvidence {
  evaluationVersion: typeof FITNESS_EVIDENCE_VERSION;
  playerId: string;
  sessionId: WorkoutSessionId;
  workoutId: WorkoutId;
  purpose: WorkoutPurpose;
  intendedDifficulty: WorkoutDifficulty;
  feedback: WorkoutFeedbackValue;
  completedAt: number;
  evaluatedAt: number | null;
  integrityFlagCount: number;
  components: FitnessEvidenceComponents;
}

export interface FitnessEvaluationIssue {
  code: string;
  message: string;
}
