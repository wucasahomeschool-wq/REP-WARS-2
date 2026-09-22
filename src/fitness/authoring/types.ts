/**
 * Authoring document: rep-wars-workout-authoring.v2
 *
 * This is the content contract, not the gameplay runtime model.
 * The compiler translates a valid document into an immutable runtime catalog.
 *
 * The separate workout-authoring branch owns production content.
 * Fixtures in this repo are tests only.
 */

export const WORKOUT_AUTHORING_FORMAT = 'rep-wars-workout-authoring.v2' as const;
export const WORKOUT_PROGRESSION_ENGINE_VERSION = 'rep-wars-workout-progression.v1' as const;

export const MEASUREMENT_MODEL_KINDS = ['REPETITIONS', 'DURATION', 'HOLD_DURATION'] as const;
export type MeasurementModelKind = (typeof MEASUREMENT_MODEL_KINDS)[number];

export const AUTHORED_PRESCRIPTION_KINDS = ['REPETITIONS', 'DURATION_SECONDS'] as const;
export type AuthoredPrescriptionKind = (typeof AUTHORED_PRESCRIPTION_KINDS)[number];

export const WORKOUT_SIZES = ['SHORT', 'STANDARD', 'LONG'] as const;
export type WorkoutSize = (typeof WORKOUT_SIZES)[number];

export const AUTHORED_EXERCISE_ROLES = [
  'OPENING_STRETCH',
  'MAIN',
  'UPPER_BODY',
  'LOWER_BODY',
  'CORE',
  'REST',
  'FINAL_STRETCH',
] as const;
export type AuthoredExerciseRole = (typeof AUTHORED_EXERCISE_ROLES)[number];

export type AuthoredPrescription =
  | { kind: 'REPETITIONS'; repetitions: number }
  | { kind: 'DURATION_SECONDS'; durationSeconds: number };

export interface AuthoredMeasurementModel {
  id: string;
  kind: MeasurementModelKind;
  validPrescriptionKinds: AuthoredPrescriptionKind[];
  notes?: string;
}

export interface AuthoredMovementStage {
  id: string;
  name: string;
  /** Explicit order within this family only. Not comparable across families. */
  order: number;
  notes?: string;
}

export interface AuthoredMovementFamily {
  id: string;
  name: string;
  stages: AuthoredMovementStage[];
  notes?: string;
}

export interface AuthoredProgressionBand {
  id: string;
  name: string;
  /** Explicit order among bands. Never inferred from the id string. */
  order: number;
  selectionWindowBandIds: string[];
  notes?: string;
}

export interface AuthoredExercise {
  id: string;
  name: string;
  description?: string;
  movementFamilyId: string;
  movementStageId: string;
  measurementModelId: string;
  defaultPrescription: AuthoredPrescription;
  isRest?: boolean;
  notes?: string;
}

export interface AuthoredMovementRequirement {
  movementFamilyId: string;
  minimumStageId: string;
}

export interface AuthoredWorkoutExercise {
  exerciseId: string;
  order: number;
  prescription: AuthoredPrescription;
  role?: AuthoredExerciseRole;
  skippable?: boolean;
}

export interface AuthoredBridge {
  fromBandId: string;
  toBandId: string;
  notes?: string;
}

export interface AuthoredWorkout {
  id: string;
  name: string;
  description?: string;
  familyId: string;
  size: WorkoutSize;
  progressionBandId: string;
  movementRequirements: AuthoredMovementRequirement[];
  exercises: AuthoredWorkoutExercise[];
  bridge?: AuthoredBridge | null;
  authorNotes?: string;
}

export interface AuthoredWorkoutFamily {
  id: string;
  name: string;
  workoutIds: string[];
  notes?: string;
}

export interface WorkoutAuthoringDocument {
  formatVersion: typeof WORKOUT_AUTHORING_FORMAT;
  catalogId: string;
  catalogVersion: string;
  authorNotes?: string;
  measurementModels: AuthoredMeasurementModel[];
  movementFamilies: AuthoredMovementFamily[];
  progressionBands: AuthoredProgressionBand[];
  exercises: AuthoredExercise[];
  workoutFamilies: AuthoredWorkoutFamily[];
  workouts: AuthoredWorkout[];
}

export interface AuthoringIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  path?: string;
}

export interface AuthoringValidationResult {
  ok: boolean;
  issues: AuthoringIssue[];
  completeness: {
    completeFamilyIds: string[];
    incompleteFamilies: Array<{ familyId: string; missingSizes: WorkoutSize[] }>;
  };
}
