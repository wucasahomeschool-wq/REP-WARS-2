import { exerciseCatalogById } from '../catalog';
import { isWorkoutDifficulty } from '../difficulty';
import { cloneFitnessEstimate } from '../estimate/clone';
import { validateFitnessEstimate } from '../estimate/validation';
import { FitnessEstimate } from '../estimate/types';
import { clonePersonalizationMetadata, prescribeWorkoutBaseline } from '../prescription';
import { clonePrescription } from '../guards';
import { isWorkoutPurpose } from '../purpose';
import {
  ExerciseDefinition,
  ExerciseId,
  PrescribedWorkout,
  WorkoutDefinition,
  WorkoutPersonalizationMetadata,
} from '../types';
import { cloneWorkoutDefinition, validateWorkoutDefinition } from '../validation';
import {
  FITNESS_PERSONALIZATION_CONFIG,
  FITNESS_PERSONALIZATION_VERSION,
  FitnessPersonalizationConfig,
} from './config';
import { personalizationErr, personalizationOk, PersonalizationOpResult } from './errors';
import { computePersonalizationMapping, fitnessLevelForSection } from './mapping';
import { personalizationDecisionForStep, scaleExercisePrescription } from './scale';
import { PersonalizationInput } from './types';
import { validatePersonalizationConfig } from './validation';

function personalizeFromDefinition(
  definition: WorkoutDefinition,
  estimate: FitnessEstimate,
  input: PersonalizationInput,
  config: FitnessPersonalizationConfig,
  exercisesById: ReadonlyMap<ExerciseId, ExerciseDefinition>,
): PersonalizationOpResult<PrescribedWorkout> {
  const mapping = computePersonalizationMapping({
    fitnessLevel: estimate.level,
    confidence: estimate.confidence,
    catalogDifficulty: definition.intendedDifficulty,
    desiredDifficulty: input.desiredDifficulty,
    configuration: config,
  });

  const baseline = prescribeWorkoutBaseline(definition);
  const resolved: Array<{
    exerciseId: string;
    order: number;
    prescription: ReturnType<typeof scaleExercisePrescription>;
    role: (typeof baseline.exercises)[number]['role'];
    skippable: boolean;
    decision: ReturnType<typeof personalizationDecisionForStep>;
  }> = [];

  for (let index = 0; index < baseline.exercises.length; index++) {
    const step = baseline.exercises[index]!;
    const source = definition.exercises[index]!;
    const exercise = exercisesById.get(step.exerciseId);
    if (!exercise) {
      return personalizationErr(
        'personalization.unknown_exercise',
        `Prescription references unknown exercise ${step.exerciseId}`,
        { exerciseId: step.exerciseId },
      );
    }
    const decision = personalizationDecisionForStep(source, exercise);
    const levelForStep = fitnessLevelForSection(estimate, exercise.bodySection, config);
    const stepMapping = levelForStep === estimate.level
      ? mapping
      : computePersonalizationMapping({
        fitnessLevel: levelForStep,
        confidence: estimate.confidence,
        catalogDifficulty: definition.intendedDifficulty,
        desiredDifficulty: input.desiredDifficulty,
        configuration: config,
      });
    const multiplier = decision === 'SCALE' ? stepMapping.effectiveMultiplier : 1;
    const prescription = scaleExercisePrescription(step.prescription, multiplier, decision, config);
    if (prescription.kind === 'repetitions') {
      if (!Number.isInteger(prescription.repetitions) || prescription.repetitions < 1) {
        return personalizationErr(
          'personalization.invalid_prescription',
          'Personalized repetitions must be a positive integer',
          { exerciseId: step.exerciseId, repetitions: prescription.repetitions },
        );
      }
    } else if (!(prescription.durationSeconds > 0) || !Number.isFinite(prescription.durationSeconds)) {
      return personalizationErr(
        'personalization.invalid_prescription',
        'Personalized duration must be a finite positive number of seconds',
        { exerciseId: step.exerciseId, durationSeconds: prescription.durationSeconds },
      );
    }
    resolved.push({
      exerciseId: step.exerciseId,
      order: step.order,
      prescription,
      role: step.role,
      skippable: step.skippable,
      decision,
    });
  }
  let scaledExerciseCount = 0;
  let unscaledExerciseCount = 0;
  let anyValueChanged = false;
  for (let i = 0; i < resolved.length; i++) {
    const step = resolved[i]!;
    if (step.decision === 'SCALE') scaledExerciseCount += 1;
    else unscaledExerciseCount += 1;
    const before = baseline.exercises[i]!.prescription;
    const after = step.prescription;
    if (before.kind !== after.kind) anyValueChanged = true;
    else if (before.kind === 'repetitions' && after.kind === 'repetitions' && before.repetitions !== after.repetitions) {
      anyValueChanged = true;
    } else if (before.kind === 'duration' && after.kind === 'duration' && before.durationSeconds !== after.durationSeconds) {
      anyValueChanged = true;
    }
  }

  const metadata: WorkoutPersonalizationMetadata = {
    modelVersion: FITNESS_PERSONALIZATION_VERSION,
    playerId: estimate.playerId,
    catalogDifficulty: definition.intendedDifficulty,
    intendedDifficulty: input.desiredDifficulty,
    fitnessLevelUsed: estimate.level,
    confidenceUsed: estimate.confidence,
    referenceLevel: config.referenceLevel,
    fitnessShift: mapping.fitnessShift,
    difficultyShift: mapping.difficultyShift,
    confidenceFactor: mapping.confidenceFactor,
    effectiveMultiplier: mapping.effectiveMultiplier,
    applied: anyValueChanged || mapping.effectiveMultiplier !== 1,
    scaledExerciseCount,
    unscaledExerciseCount,
  };

  return personalizationOk({
    workoutId: definition.id,
    intendedDifficulty: input.desiredDifficulty,
    exercises: resolved.map((step) => ({
      exerciseId: step.exerciseId,
      order: step.order,
      prescription: clonePrescription(step.prescription),
      role: step.role,
      skippable: step.skippable,
    })),
    personalization: clonePersonalizationMetadata(metadata),
  });
}

export function personalizeWorkout(
  definition: WorkoutDefinition,
  input: PersonalizationInput,
): PersonalizationOpResult<PrescribedWorkout> {
  /**
   * Legacy path: FitnessEstimate → scaled PrescribedWorkout.
   * Authored-v2 selection does not call this. Kept for tutorial / empty catalog.
   */
  if (typeof input.playerId !== 'string' || input.playerId.trim() === '') {
    return personalizationErr('personalization.invalid_player', 'playerId must be a non-empty string');
  }
  if (!isWorkoutDifficulty(input.desiredDifficulty)) {
    return personalizationErr('personalization.invalid_difficulty', 'Desired difficulty is invalid');
  }
  if (input.purpose !== undefined && !isWorkoutPurpose(input.purpose)) {
    return personalizationErr('personalization.invalid_workout', 'Workout purpose is invalid');
  }

  const config = input.configuration ?? FITNESS_PERSONALIZATION_CONFIG;
  const configIssues = validatePersonalizationConfig(config);
  if (configIssues.length > 0) {
    return personalizationErr('personalization.invalid_configuration', configIssues[0]!);
  }

  const estimateIssues = validateFitnessEstimate(input.fitnessEstimate);
  if (estimateIssues.length > 0) {
    return personalizationErr('personalization.invalid_estimate', estimateIssues[0]!);
  }
  const estimate = cloneFitnessEstimate(input.fitnessEstimate);
  if (estimate.playerId !== input.playerId.trim()) {
    return personalizationErr('personalization.player_mismatch', 'Estimate and personalization playerId do not match', {
      estimatePlayer: estimate.playerId,
      requestedPlayer: input.playerId.trim(),
    });
  }

  const clonedDefinition = cloneWorkoutDefinition(definition);
  const exercisesById = input.exercisesById ?? exerciseCatalogById();
  const workoutIssues = validateWorkoutDefinition(clonedDefinition, exercisesById);
  if (workoutIssues.length > 0) {
    return personalizationErr('personalization.invalid_workout', workoutIssues[0]!.message, {
      workoutId: clonedDefinition.id,
    });
  }

  return personalizeFromDefinition(clonedDefinition, estimate, {
    ...input,
    playerId: input.playerId.trim(),
  }, config, exercisesById);
}
