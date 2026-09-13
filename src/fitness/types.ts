/**
 * FITNESS / WORKOUT DOMAIN TYPES (Phase 17A)
 *
 * These describe *prescribed* workouts: what the player is supposed to do.
 * They are not sessions (what the player did), fitness scores, or game
 * rewards. Do not import GameState, BattleEngine, or economy types here.
 *
 * Purpose is session/context data — not a field on WorkoutDefinition —
 * so the same physical workout can be used for different gameplay intents.
 */

export type ExerciseId = string;
export type WorkoutId = string;

export const WORKOUT_DIFFICULTIES = ['VERY_EASY', 'EASY', 'MODERATE', 'HARD', 'VERY_HARD'] as const;
export type WorkoutDifficulty = (typeof WORKOUT_DIFFICULTIES)[number];

export const EXERCISE_TYPES = ['REP_BASED', 'TIMED', 'REST'] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];

export const BODY_SECTIONS = ['UPPER_BODY', 'CORE', 'LOWER_BODY', 'GLOBAL'] as const;
export type BodySection = (typeof BODY_SECTIONS)[number];

export const WORKOUT_PURPOSES = [
  'NORMAL_TROOPS',
  'EXTRA_CONSTRUCTION_WORKERS',
  'GOLDEN_YIELD',
  'DEFENSE',
] as const;
export type WorkoutPurpose = (typeof WORKOUT_PURPOSES)[number];

export const WORKOUT_EXERCISE_ROLES = [
  'OPENING_STRETCH',
  'MAIN',
  'UPPER_BODY',
  'LOWER_BODY',
  'CORE',
  'REST',
  'FINAL_STRETCH',
] as const;
export type WorkoutExerciseRole = (typeof WORKOUT_EXERCISE_ROLES)[number];

/** User-facing difficulty → stable internal rank. Do not scatter these numbers. */
export const WORKOUT_DIFFICULTY_RANK: Readonly<Record<WorkoutDifficulty, number>> = Object.freeze({
  VERY_EASY: 1,
  EASY: 2,
  MODERATE: 3,
  HARD: 4,
  VERY_HARD: 5,
});

export type ExercisePrescription =
  | { kind: 'repetitions'; repetitions: number }
  | { kind: 'duration'; durationSeconds: number };

export interface ExerciseDefinition {
  id: ExerciseId;
  name: string;
  type: ExerciseType;
  bodySection: BodySection;
  defaultPrescription: ExercisePrescription;
  /** True iff `type === 'REST'`. REST is not "zero reps". */
  isRest: boolean;
  metadata: {
    notes?: string;
  };
}

export interface WorkoutExercise {
  exerciseId: ExerciseId;
  /** Zero-based position in the workout. Must be unique and dense (0..n-1). */
  order: number;
  prescription: ExercisePrescription;
  role: WorkoutExerciseRole;
  /** Only REST steps may be skippable. */
  skippable: boolean;
}

export interface WorkoutDefinition {
  id: WorkoutId;
  name: string;
  description: string;
  intendedDifficulty: WorkoutDifficulty;
  exercises: WorkoutExercise[];
  metadata: {
    estimatedDurationSeconds?: number;
    tags?: string[];
  };
}

export interface WorkoutValidationIssue {
  code: string;
  message: string;
  workoutId?: WorkoutId;
  exerciseId?: ExerciseId;
}

/**
 * Baseline prescription ignores player fields.
 * Personalization (17E) reads playerId / desiredDifficulty / purpose
 * from PersonalizationInput instead of mutating this type with estimates
 * (FitnessEstimate lives in the estimate module to avoid import cycles).
 */
export interface PrescriptionInput {
  playerId?: string | null;
  desiredDifficulty?: WorkoutDifficulty;
  purpose?: WorkoutPurpose;
}

export interface PrescribedWorkoutExercise {
  exerciseId: ExerciseId;
  order: number;
  prescription: ExercisePrescription;
  role: WorkoutExerciseRole;
  skippable: boolean;
}

/**
 * Internal personalization trace. Not player-facing.
 * Baseline prescriptions omit this field.
 */
export interface WorkoutPersonalizationMetadata {
  modelVersion: string;
  playerId: string;
  catalogDifficulty: WorkoutDifficulty;
  intendedDifficulty: WorkoutDifficulty;
  fitnessLevelUsed: number;
  confidenceUsed: number;
  referenceLevel: number;
  fitnessShift: number;
  difficultyShift: number;
  confidenceFactor: number;
  effectiveMultiplier: number;
  applied: boolean;
  scaledExerciseCount: number;
  unscaledExerciseCount: number;
}

export interface PrescribedWorkout {
  workoutId: WorkoutId;
  /** Player-facing named difficulty for this prescription. */
  intendedDifficulty: WorkoutDifficulty;
  exercises: PrescribedWorkoutExercise[];
  personalization?: WorkoutPersonalizationMetadata;
}
