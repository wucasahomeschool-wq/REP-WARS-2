import { isWorkoutDifficulty } from './difficulty';
import {
  clonePrescription,
  expectedPrescriptionKind,
  isBodySection,
  isExerciseType,
  isPositiveInteger,
  isPositiveNumber,
  isRecord,
  isWorkoutExerciseRole,
  skippableForExerciseType,
} from './guards';
import {
  ExerciseDefinition,
  ExerciseId,
  ExercisePrescription,
  WorkoutDefinition,
  WorkoutValidationIssue,
} from './types';

function issue(
  code: string,
  message: string,
  extra?: { workoutId?: string; exerciseId?: string },
): WorkoutValidationIssue {
  return { code, message, ...extra };
}

function parsePrescription(raw: unknown): { prescription: ExercisePrescription | null; issues: WorkoutValidationIssue[] } {
  const issues: WorkoutValidationIssue[] = [];
  if (!isRecord(raw) || typeof raw.kind !== 'string') {
    return { prescription: null, issues: [issue('prescription.invalid', 'Prescription must be an object with a kind')] };
  }
  if (raw.kind === 'repetitions') {
    if (!isPositiveInteger(raw.repetitions)) {
      issues.push(issue('prescription.invalid_repetitions', 'Repetitions must be a positive integer'));
      return { prescription: null, issues };
    }
    if ('durationSeconds' in raw && raw.durationSeconds !== undefined) {
      issues.push(issue('prescription.type_mismatch', 'Repetition prescriptions cannot include durationSeconds'));
    }
    return { prescription: { kind: 'repetitions', repetitions: raw.repetitions }, issues };
  }
  if (raw.kind === 'duration') {
    if (!isPositiveNumber(raw.durationSeconds)) {
      issues.push(issue('prescription.invalid_duration', 'Duration must be a positive number of seconds'));
      return { prescription: null, issues };
    }
    if ('repetitions' in raw && raw.repetitions !== undefined) {
      issues.push(issue('prescription.type_mismatch', 'Duration prescriptions cannot include repetitions'));
    }
    return { prescription: { kind: 'duration', durationSeconds: raw.durationSeconds }, issues };
  }
  return { prescription: null, issues: [issue('prescription.invalid_kind', `Unknown prescription kind: ${raw.kind}`)] };
}

export function validateExerciseDefinition(raw: unknown): WorkoutValidationIssue[] {
  const issues: WorkoutValidationIssue[] = [];
  if (!isRecord(raw)) {
    return [issue('exercise.not_object', 'Exercise definition must be an object')];
  }
  const id = raw.id;
  if (typeof id !== 'string' || id.trim() === '') {
    issues.push(issue('exercise.invalid_id', 'Exercise id must be a non-empty string'));
  }
  const extra = typeof id === 'string' ? { exerciseId: id } : undefined;
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    issues.push(issue('exercise.invalid_name', 'Exercise name must be a non-empty string', extra));
  }
  if (!isExerciseType(raw.type)) {
    issues.push(issue('exercise.invalid_type', 'Exercise type is invalid', extra));
  }
  if (!isBodySection(raw.bodySection)) {
    issues.push(issue('exercise.invalid_body_section', 'Body section is invalid', extra));
  }
  if (typeof raw.isRest !== 'boolean') {
    issues.push(issue('exercise.invalid_is_rest', 'isRest must be a boolean', extra));
  } else if (isExerciseType(raw.type) && raw.isRest !== (raw.type === 'REST')) {
    issues.push(issue('exercise.is_rest_mismatch', 'isRest must be true only for REST exercises', extra));
  }
  const parsed = parsePrescription(raw.defaultPrescription);
  issues.push(...parsed.issues.map((i) => ({ ...i, ...extra })));
  if (parsed.prescription && isExerciseType(raw.type)) {
    const expected = expectedPrescriptionKind(raw.type);
    if (parsed.prescription.kind !== expected) {
      issues.push(issue(
        'exercise.prescription_type_mismatch',
        `${raw.type} requires a ${expected} prescription`,
        extra,
      ));
    }
  }
  if (raw.metadata !== undefined && !isRecord(raw.metadata)) {
    issues.push(issue('exercise.invalid_metadata', 'metadata must be an object if present', extra));
  }
  return issues;
}

export function validateWorkoutDefinition(
  raw: unknown,
  exercisesById: ReadonlyMap<ExerciseId, ExerciseDefinition>,
): WorkoutValidationIssue[] {
  const issues: WorkoutValidationIssue[] = [];
  if (!isRecord(raw)) {
    return [issue('workout.not_object', 'Workout definition must be an object')];
  }
  const id = raw.id;
  if (typeof id !== 'string' || id.trim() === '') {
    issues.push(issue('workout.invalid_id', 'Workout id must be a non-empty string'));
  }
  const extra = typeof id === 'string' ? { workoutId: id } : undefined;
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    issues.push(issue('workout.invalid_name', 'Workout name must be a non-empty string', extra));
  }
  if (typeof raw.description !== 'string') {
    issues.push(issue('workout.invalid_description', 'Workout description must be a string', extra));
  }
  if (!isWorkoutDifficulty(raw.intendedDifficulty)) {
    issues.push(issue('workout.invalid_difficulty', 'Intended difficulty is invalid', extra));
  }
  if (!Array.isArray(raw.exercises) || raw.exercises.length === 0) {
    issues.push(issue('workout.empty', 'Workout must contain at least one exercise', extra));
    return issues;
  }
  const seenOrders = new Set<number>();
  raw.exercises.forEach((step, index) => {
    if (!isRecord(step)) {
      issues.push(issue('workout.step_not_object', `Exercise step ${index} must be an object`, extra));
      return;
    }
    const exerciseId = step.exerciseId;
    const stepExtra = { ...extra, exerciseId: typeof exerciseId === 'string' ? exerciseId : undefined };
    if (typeof exerciseId !== 'string' || exerciseId.trim() === '') {
      issues.push(issue('workout.invalid_exercise_id', `Step ${index} is missing exerciseId`, extra));
    } else if (!exercisesById.has(exerciseId)) {
      issues.push(issue('workout.unknown_exercise', `Step ${index} references unknown exercise ${exerciseId}`, stepExtra));
    }
    if (!Number.isInteger(step.order) || (step.order as number) < 0) {
      issues.push(issue('workout.invalid_order', `Step ${index} order must be a non-negative integer`, stepExtra));
    } else {
      if (seenOrders.has(step.order as number)) {
        issues.push(issue('workout.duplicate_order', `Step order ${step.order} is duplicated`, stepExtra));
      }
      seenOrders.add(step.order as number);
    }
    if (!isWorkoutExerciseRole(step.role)) {
      issues.push(issue('workout.invalid_role', `Step ${index} role is invalid`, stepExtra));
    }
    if (typeof step.skippable !== 'boolean') {
      issues.push(issue('workout.invalid_skippable', `Step ${index} skippable must be a boolean`, stepExtra));
    }
    const parsed = parsePrescription(step.prescription);
    issues.push(...parsed.issues.map((i) => ({ ...i, ...stepExtra })));
    const def = typeof exerciseId === 'string' ? exercisesById.get(exerciseId) : undefined;
    if (def) {
      if (typeof step.skippable === 'boolean' && step.skippable !== skippableForExerciseType(def.type)) {
        issues.push(issue(
          step.skippable ? 'workout.mandatory_marked_skippable' : 'workout.rest_not_skippable',
          def.type === 'REST'
            ? 'REST steps must be skippable'
            : 'Only REST steps may be skippable',
          stepExtra,
        ));
      }
      if (parsed.prescription && parsed.prescription.kind !== expectedPrescriptionKind(def.type)) {
        issues.push(issue(
          'workout.prescription_type_mismatch',
          `${def.type} step requires a ${expectedPrescriptionKind(def.type)} prescription`,
          stepExtra,
        ));
      }
    }
  });
  if (seenOrders.size === raw.exercises.length) {
    for (let i = 0; i < raw.exercises.length; i++) {
      if (!seenOrders.has(i)) {
        issues.push(issue('workout.order_not_dense', `Exercise order must be 0..${raw.exercises.length - 1} without gaps`, extra));
        break;
      }
    }
  }
  if (raw.metadata !== undefined && !isRecord(raw.metadata)) {
    issues.push(issue('workout.invalid_metadata', 'metadata must be an object if present', extra));
  }
  return issues;
}

export function validateExerciseCatalog(exercises: readonly unknown[]): WorkoutValidationIssue[] {
  const issues: WorkoutValidationIssue[] = [];
  const ids = new Set<string>();
  for (const raw of exercises) {
    issues.push(...validateExerciseDefinition(raw));
    if (isRecord(raw) && typeof raw.id === 'string') {
      if (ids.has(raw.id)) {
        issues.push(issue('catalog.duplicate_exercise_id', `Duplicate exercise id ${raw.id}`, { exerciseId: raw.id }));
      }
      ids.add(raw.id);
    }
  }
  return issues;
}

export function validateWorkoutCatalog(
  workouts: readonly unknown[],
  exercisesById: ReadonlyMap<ExerciseId, ExerciseDefinition>,
): WorkoutValidationIssue[] {
  const issues: WorkoutValidationIssue[] = [];
  const ids = new Set<string>();
  for (const raw of workouts) {
    issues.push(...validateWorkoutDefinition(raw, exercisesById));
    if (isRecord(raw) && typeof raw.id === 'string') {
      if (ids.has(raw.id)) {
        issues.push(issue('catalog.duplicate_workout_id', `Duplicate workout id ${raw.id}`, { workoutId: raw.id }));
      }
      ids.add(raw.id);
    }
  }
  return issues;
}

export function cloneExerciseDefinition(exercise: ExerciseDefinition): ExerciseDefinition {
  return {
    id: exercise.id,
    name: exercise.name,
    type: exercise.type,
    bodySection: exercise.bodySection,
    defaultPrescription: clonePrescription(exercise.defaultPrescription),
    isRest: exercise.isRest,
    metadata: { ...exercise.metadata },
  };
}

export function cloneWorkoutDefinition(workout: WorkoutDefinition): WorkoutDefinition {
  return {
    id: workout.id,
    name: workout.name,
    description: workout.description,
    intendedDifficulty: workout.intendedDifficulty,
    exercises: workout.exercises.map((step) => ({
      exerciseId: step.exerciseId,
      order: step.order,
      prescription: clonePrescription(step.prescription),
      role: step.role,
      skippable: step.skippable,
    })),
    metadata: {
      estimatedDurationSeconds: workout.metadata.estimatedDurationSeconds,
      tags: workout.metadata.tags ? [...workout.metadata.tags] : undefined,
    },
  };
}
