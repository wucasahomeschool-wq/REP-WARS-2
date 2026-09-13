import { ExerciseDefinition, ExercisePrescription, WorkoutExercise, WorkoutExerciseRole } from '../types';
import {
  FITNESS_PERSONALIZATION_CONFIG,
  FitnessPersonalizationConfig,
  clampPersonalization,
} from './config';
import { PersonalizedExerciseDecision } from './types';

const STRUCTURAL_ROLES: ReadonlySet<WorkoutExerciseRole> = new Set([
  'OPENING_STRETCH',
  'FINAL_STRETCH',
  'REST',
]);

export function personalizationDecisionForStep(
  step: WorkoutExercise,
  exercise: ExerciseDefinition,
): PersonalizedExerciseDecision {
  if (exercise.type === 'REST' || exercise.isRest || step.role === 'REST') {
    return 'KEEP_STRUCTURE';
  }
  if (STRUCTURAL_ROLES.has(step.role)) {
    return 'KEEP_STRUCTURE';
  }
  if (exercise.bodySection === 'GLOBAL') {
    return 'KEEP_STRUCTURE';
  }
  return 'SCALE';
}

export function scaleRepetitions(
  base: number,
  multiplier: number,
  config: FitnessPersonalizationConfig = FITNESS_PERSONALIZATION_CONFIG,
): number {
  const raw = base * multiplier;
  const delta = clampPersonalization(raw - base, -config.maxAbsRepAdjustment, config.maxAbsRepAdjustment);
  const rounded = Math.round(base + delta);
  return clampPersonalization(rounded, config.minRepetitions, config.maxRepetitions);
}

export function scaleDurationSeconds(
  base: number,
  multiplier: number,
  config: FitnessPersonalizationConfig = FITNESS_PERSONALIZATION_CONFIG,
): number {
  const raw = base * multiplier;
  const delta = clampPersonalization(
    raw - base,
    -config.maxAbsDurationAdjustment,
    config.maxAbsDurationAdjustment,
  );
  const rounded = Math.round(base + delta);
  return clampPersonalization(rounded, config.minDurationSeconds, config.maxDurationSeconds);
}

export function scaleExercisePrescription(
  prescription: ExercisePrescription,
  multiplier: number,
  decision: PersonalizedExerciseDecision,
  config: FitnessPersonalizationConfig = FITNESS_PERSONALIZATION_CONFIG,
): ExercisePrescription {
  if (decision === 'KEEP_STRUCTURE') {
    return prescription.kind === 'repetitions'
      ? { kind: 'repetitions', repetitions: prescription.repetitions }
      : { kind: 'duration', durationSeconds: prescription.durationSeconds };
  }
  if (prescription.kind === 'repetitions') {
    return {
      kind: 'repetitions',
      repetitions: scaleRepetitions(prescription.repetitions, multiplier, config),
    };
  }
  return {
    kind: 'duration',
    durationSeconds: scaleDurationSeconds(prescription.durationSeconds, multiplier, config),
  };
}
