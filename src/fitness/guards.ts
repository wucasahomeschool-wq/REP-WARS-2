import {
  BODY_SECTIONS,
  BodySection,
  EXERCISE_TYPES,
  ExercisePrescription,
  ExerciseType,
  WORKOUT_EXERCISE_ROLES,
  WorkoutExerciseRole,
} from './types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isExerciseType(value: unknown): value is ExerciseType {
  return typeof value === 'string' && (EXERCISE_TYPES as readonly string[]).includes(value);
}

export function isBodySection(value: unknown): value is BodySection {
  return typeof value === 'string' && (BODY_SECTIONS as readonly string[]).includes(value);
}

export function isWorkoutExerciseRole(value: unknown): value is WorkoutExerciseRole {
  return typeof value === 'string' && (WORKOUT_EXERCISE_ROLES as readonly string[]).includes(value);
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && Number.isFinite(value);
}

export function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function clonePrescription(prescription: ExercisePrescription): ExercisePrescription {
  if (prescription.kind === 'repetitions') {
    return { kind: 'repetitions', repetitions: prescription.repetitions };
  }
  return { kind: 'duration', durationSeconds: prescription.durationSeconds };
}

export function skippableForExerciseType(type: ExerciseType): boolean {
  return type === 'REST';
}

export function expectedPrescriptionKind(type: ExerciseType): ExercisePrescription['kind'] {
  return type === 'REP_BASED' ? 'repetitions' : 'duration';
}
