/**
 * PHYSICAL RESULT (Phase 17F)
 *
 * Neutral record of physical work completed in one eligible workout.
 * Not a fitness score, not Troops, and not a medical measurement.
 *
 * Units are a game abstraction called physical output (work units).
 * They are not calories, METs, or a player-visible fitness rating.
 */

import { BodySection, ExerciseId, ExerciseType, WorkoutDifficulty, WorkoutId, WorkoutPurpose, WorkoutPersonalizationMetadata } from '../types';
import {
  ExercisePerformanceStatus,
  WorkoutSessionId,
} from '../session/types';

export const PHYSICAL_RESULT_MODEL_VERSION = 'physical-result.v1';
export const PHYSICAL_OUTPUT_VERSION = 'physical-output.v1';

export type PhysicalWorkClass = 'REST' | 'STRETCH' | 'TRAINING';

export interface PhysicalExerciseContribution {
  order: number;
  exerciseId: ExerciseId;
  exerciseType: ExerciseType;
  bodySection: BodySection;
  status: ExercisePerformanceStatus;
  workClass: PhysicalWorkClass;
  prescribedRepetitions: number | null;
  completedRepetitions: number | null;
  creditedRepetitions: number | null;
  prescribedDurationSeconds: number | null;
  completedDurationSeconds: number | null;
  creditedDurationSeconds: number | null;
  unitValue: number;
  exerciseModifier: number;
  roleFactor: number;
  difficultyFactor: number;
  physicalOutput: number;
  notes: string;
}

export interface PhysicalBodySectionOutput {
  UPPER_BODY: number;
  CORE: number;
  LOWER_BODY: number;
  GLOBAL: number;
}

export interface PhysicalResult {
  modelVersion: typeof PHYSICAL_RESULT_MODEL_VERSION;
  outputVersion: typeof PHYSICAL_OUTPUT_VERSION;
  playerId: string;
  sessionId: WorkoutSessionId;
  workoutId: WorkoutId;
  purpose: WorkoutPurpose;
  intendedDifficulty: WorkoutDifficulty;
  completedAt: number;
  /** Audit only. Not a reward multiplier. */
  fitnessLevelAtPrescription: number | null;
  /** Audit only. Not a reward multiplier. */
  confidenceAtPrescription: number | null;
  personalizationModelVersion: string | null;
  /** Sum of exerciseContributions.physicalOutput. */
  totalPhysicalOutput: number;
  bodySectionOutput: PhysicalBodySectionOutput;
  exerciseContributions: PhysicalExerciseContribution[];
  notes: string[];
}

export interface PhysicalResultContext {
  fitnessEstimate?: {
    playerId: string;
    level: number;
    confidence: number;
  } | null;
  fitnessLevelAtPrescription?: number | null;
  confidenceAtPrescription?: number | null;
  personalization?: WorkoutPersonalizationMetadata | null;
}
