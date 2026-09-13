import { clonePrescription } from './guards';
import {
  PrescribedWorkout,
  PrescriptionInput,
  WorkoutDefinition,
  WorkoutPersonalizationMetadata,
} from './types';

/**
 * Resolvers turn a WorkoutDefinition into a player-specific PrescribedWorkout
 * without mutating the definition. Baseline copies catalog numbers as-is.
 * Personalized resolvers should call personalizeWorkout from a definition,
 * never from an already-personalized PrescribedWorkout.
 */
export interface WorkoutPrescriptionResolver {
  prescribe(definition: WorkoutDefinition, input?: PrescriptionInput): PrescribedWorkout;
}

export function clonePersonalizationMetadata(
  metadata: WorkoutPersonalizationMetadata,
): WorkoutPersonalizationMetadata {
  return {
    modelVersion: metadata.modelVersion,
    playerId: metadata.playerId,
    catalogDifficulty: metadata.catalogDifficulty,
    intendedDifficulty: metadata.intendedDifficulty,
    fitnessLevelUsed: metadata.fitnessLevelUsed,
    confidenceUsed: metadata.confidenceUsed,
    referenceLevel: metadata.referenceLevel,
    fitnessShift: metadata.fitnessShift,
    difficultyShift: metadata.difficultyShift,
    confidenceFactor: metadata.confidenceFactor,
    effectiveMultiplier: metadata.effectiveMultiplier,
    applied: metadata.applied,
    scaledExerciseCount: metadata.scaledExerciseCount,
    unscaledExerciseCount: metadata.unscaledExerciseCount,
  };
}

export function prescribeWorkoutBaseline(
  definition: WorkoutDefinition,
  _input: PrescriptionInput = {},
): PrescribedWorkout {
  return {
    workoutId: definition.id,
    intendedDifficulty: definition.intendedDifficulty,
    exercises: definition.exercises.map((step) => ({
      exerciseId: step.exerciseId,
      order: step.order,
      prescription: clonePrescription(step.prescription),
      role: step.role,
      skippable: step.skippable,
    })),
  };
}

export const baselinePrescriptionResolver: WorkoutPrescriptionResolver = {
  prescribe: prescribeWorkoutBaseline,
};

export function clonePrescribedWorkout(prescribed: PrescribedWorkout): PrescribedWorkout {
  const clone: PrescribedWorkout = {
    workoutId: prescribed.workoutId,
    intendedDifficulty: prescribed.intendedDifficulty,
    exercises: prescribed.exercises.map((step) => ({
      exerciseId: step.exerciseId,
      order: step.order,
      prescription: clonePrescription(step.prescription),
      role: step.role,
      skippable: step.skippable,
    })),
  };
  if (prescribed.personalization) {
    clone.personalization = clonePersonalizationMetadata(prescribed.personalization);
  }
  return clone;
}
