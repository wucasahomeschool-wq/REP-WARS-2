import { FitnessEstimate } from '../estimate/types';
import { ExerciseDefinition, ExerciseId, WorkoutDifficulty, WorkoutPurpose } from '../types';
import { FitnessPersonalizationConfig } from './config';

export interface PersonalizationInput {
  playerId: string;
  fitnessEstimate: FitnessEstimate;
  desiredDifficulty: WorkoutDifficulty;
  /** Session metadata only. Must not change physical prescription. */
  purpose?: WorkoutPurpose;
  configuration?: FitnessPersonalizationConfig;
  exercisesById?: ReadonlyMap<ExerciseId, ExerciseDefinition>;
}

export interface PersonalizationMapping {
  catalogDifficulty: WorkoutDifficulty;
  desiredDifficulty: WorkoutDifficulty;
  catalogRank: number;
  desiredRank: number;
  fitnessLevel: number;
  confidence: number;
  fitnessShift: number;
  difficultyShift: number;
  confidenceFactor: number;
  effectiveShift: number;
  effectiveMultiplier: number;
}

export type PersonalizedExerciseDecision = 'SCALE' | 'KEEP_STRUCTURE';
