import { BodySection, ExerciseDefinition, ExercisePrescription, ExerciseType, WorkoutDefinition, WorkoutDifficulty, WorkoutExerciseRole } from '../types';
import {
  AuthoredPrescription,
  WorkoutAuthoringDocument,
  WorkoutSize,
  WORKOUT_PROGRESSION_ENGINE_VERSION,
} from './types';
import { asWorkoutAuthoringDocument } from './structural';
import { validateWorkoutAuthoringDocument } from './semantic';
import { AuthoringIssue } from './types';

export interface RuntimeMeasurementModel {
  id: string;
  kind: WorkoutAuthoringDocument['measurementModels'][number]['kind'];
  validPrescriptionKinds: WorkoutAuthoringDocument['measurementModels'][number]['validPrescriptionKinds'];
}

export interface RuntimeMovementStage {
  id: string;
  name: string;
  order: number;
}

export interface RuntimeMovementFamily {
  id: string;
  name: string;
  stages: RuntimeMovementStage[];
}

export interface RuntimeProgressionBand {
  id: string;
  name: string;
  order: number;
  selectionWindowBandIds: string[];
}

export interface RuntimeExercise {
  id: string;
  name: string;
  movementFamilyId: string;
  movementStageId: string;
  measurementModelId: string;
  isRest: boolean;
  defaultPrescription: AuthoredPrescription;
}

export interface RuntimeMovementRequirement {
  movementFamilyId: string;
  minimumStageId: string;
}

export interface RuntimeWorkoutStep {
  exerciseId: string;
  order: number;
  prescription: AuthoredPrescription;
  role: WorkoutExerciseRole;
  skippable: boolean;
}

export interface RuntimeBridge {
  fromBandId: string;
  toBandId: string;
}

export interface RuntimeWorkout {
  id: string;
  name: string;
  description: string;
  familyId: string;
  size: WorkoutSize;
  progressionBandId: string;
  movementRequirements: RuntimeMovementRequirement[];
  exercises: RuntimeWorkoutStep[];
  bridge: RuntimeBridge | null;
}

export interface RuntimeWorkoutFamily {
  id: string;
  name: string;
  workoutIds: string[];
}

export interface RuntimeWorkoutCatalog {
  formatVersion: WorkoutAuthoringDocument['formatVersion'];
  catalogId: string;
  catalogVersion: string;
  engineVersion: typeof WORKOUT_PROGRESSION_ENGINE_VERSION;
  measurementModels: Record<string, RuntimeMeasurementModel>;
  movementFamilies: Record<string, RuntimeMovementFamily>;
  progressionBands: Record<string, RuntimeProgressionBand>;
  exercises: Record<string, RuntimeExercise>;
  workoutFamilies: Record<string, RuntimeWorkoutFamily>;
  workouts: Record<string, RuntimeWorkout>;
  orderedBandIds: string[];
}

export interface CompileAuthoringResult {
  ok: boolean;
  issues: AuthoringIssue[];
  catalog?: RuntimeWorkoutCatalog;
  completeness: ReturnType<typeof validateWorkoutAuthoringDocument>['completeness'];
}

function toRuntimePrescription(p: AuthoredPrescription): ExercisePrescription {
  if (p.kind === 'REPETITIONS') return { kind: 'repetitions', repetitions: p.repetitions };
  return { kind: 'duration', durationSeconds: p.durationSeconds };
}

function exerciseTypeOf(exercise: RuntimeExercise, model: RuntimeMeasurementModel | undefined): ExerciseType {
  if (exercise.isRest) return 'REST';
  if (model?.kind === 'REPETITIONS') return 'REP_BASED';
  return 'TIMED';
}

/**
 * Session compatibility only. Band order is not a generated difficulty score.
 * Assumption: the existing session type still requires a named WorkoutDifficulty.
 */
function difficultyForBandOrder(order: number): WorkoutDifficulty {
  if (order <= 0) return 'VERY_EASY';
  if (order === 1) return 'EASY';
  if (order === 2) return 'MODERATE';
  if (order === 3) return 'HARD';
  return 'VERY_HARD';
}

function bodySectionForFamily(familyId: string): BodySection {
  const id = familyId.toLowerCase();
  if (id.includes('push') || id.includes('pull') || id.includes('upper')) return 'UPPER_BODY';
  if (id.includes('squat') || id.includes('hip') || id.includes('lunge') || id.includes('lower')) return 'LOWER_BODY';
  if (id.includes('trunk') || id.includes('core')) return 'CORE';
  return 'GLOBAL';
}

function roleOf(step: RuntimeWorkoutStep, exercise: RuntimeExercise): WorkoutExerciseRole {
  if (exercise.isRest || step.role === 'REST') return 'REST';
  return step.role;
}

export function compileAuthoringDocument(raw: unknown): CompileAuthoringResult {
  const validation = validateWorkoutAuthoringDocument(raw);
  if (!validation.ok) {
    return { ok: false, issues: validation.issues, completeness: validation.completeness };
  }
  const doc = asWorkoutAuthoringDocument(raw);
  const catalog: RuntimeWorkoutCatalog = {
    formatVersion: doc.formatVersion,
    catalogId: doc.catalogId,
    catalogVersion: doc.catalogVersion,
    engineVersion: WORKOUT_PROGRESSION_ENGINE_VERSION,
    measurementModels: {},
    movementFamilies: {},
    progressionBands: {},
    exercises: {},
    workoutFamilies: {},
    workouts: {},
    orderedBandIds: [],
  };
  for (const model of doc.measurementModels) {
    catalog.measurementModels[model.id] = {
      id: model.id,
      kind: model.kind,
      validPrescriptionKinds: [...model.validPrescriptionKinds],
    };
  }
  for (const family of doc.movementFamilies) {
    catalog.movementFamilies[family.id] = {
      id: family.id,
      name: family.name,
      stages: family.stages
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((stage) => ({ id: stage.id, name: stage.name, order: stage.order })),
    };
  }
  const bands = doc.progressionBands.slice().sort((a, b) => a.order - b.order);
  catalog.orderedBandIds = bands.map((b) => b.id);
  for (const band of bands) {
    catalog.progressionBands[band.id] = {
      id: band.id,
      name: band.name,
      order: band.order,
      selectionWindowBandIds: [...band.selectionWindowBandIds],
    };
  }
  for (const exercise of doc.exercises) {
    catalog.exercises[exercise.id] = {
      id: exercise.id,
      name: exercise.name,
      movementFamilyId: exercise.movementFamilyId,
      movementStageId: exercise.movementStageId,
      measurementModelId: exercise.measurementModelId,
      isRest: exercise.isRest === true,
      defaultPrescription: exercise.defaultPrescription,
    };
  }
  for (const family of doc.workoutFamilies) {
    catalog.workoutFamilies[family.id] = {
      id: family.id,
      name: family.name,
      workoutIds: [...family.workoutIds],
    };
  }
  for (const workout of doc.workouts) {
    catalog.workouts[workout.id] = {
      id: workout.id,
      name: workout.name,
      description: workout.description ?? '',
      familyId: workout.familyId,
      size: workout.size,
      progressionBandId: workout.progressionBandId,
      movementRequirements: workout.movementRequirements.map((req) => ({ ...req })),
      exercises: workout.exercises.map((step) => {
        const exercise = catalog.exercises[step.exerciseId]!;
        const role = step.role ?? (exercise.isRest ? 'REST' : 'MAIN');
        return {
          exerciseId: step.exerciseId,
          order: step.order,
          prescription: step.prescription,
          role,
          skippable: step.skippable ?? exercise.isRest,
        };
      }),
      bridge: workout.bridge ? { fromBandId: workout.bridge.fromBandId, toBandId: workout.bridge.toBandId } : null,
    };
  }
  return {
    ok: true,
    issues: validation.issues,
    catalog: deepFreezeCatalog(catalog),
    completeness: validation.completeness,
  };
}

function deepFreezeCatalog(catalog: RuntimeWorkoutCatalog): RuntimeWorkoutCatalog {
  return JSON.parse(JSON.stringify(catalog)) as RuntimeWorkoutCatalog;
}

export function mergeRuntimeCatalogs(catalogs: readonly RuntimeWorkoutCatalog[]): RuntimeWorkoutCatalog {
  const sorted = catalogs.slice().sort((a, b) => {
    if (a.catalogVersion !== b.catalogVersion) return a.catalogVersion < b.catalogVersion ? -1 : 1;
    if (a.catalogId !== b.catalogId) return a.catalogId < b.catalogId ? -1 : 1;
    return 0;
  });
  const merged: RuntimeWorkoutCatalog = {
    formatVersion: sorted[sorted.length - 1]?.formatVersion ?? 'rep-wars-workout-authoring.v2',
    catalogId: sorted.map((c) => c.catalogId).join('+') || 'merged',
    catalogVersion: sorted.map((c) => c.catalogVersion).join('+') || '0',
    engineVersion: WORKOUT_PROGRESSION_ENGINE_VERSION,
    measurementModels: {},
    movementFamilies: {},
    progressionBands: {},
    exercises: {},
    workoutFamilies: {},
    workouts: {},
    orderedBandIds: [],
  };
  for (const catalog of sorted) {
    Object.assign(merged.measurementModels, catalog.measurementModels);
    Object.assign(merged.movementFamilies, catalog.movementFamilies);
    Object.assign(merged.progressionBands, catalog.progressionBands);
    Object.assign(merged.exercises, catalog.exercises);
    Object.assign(merged.workoutFamilies, catalog.workoutFamilies);
    Object.assign(merged.workouts, catalog.workouts);
  }
  merged.orderedBandIds = Object.values(merged.progressionBands)
    .sort((a, b) => a.order - b.order)
    .map((b) => b.id);
  return deepFreezeCatalog(merged);
}

export function authoredExerciseAsDefinition(
  catalog: RuntimeWorkoutCatalog,
  exercise: RuntimeExercise,
): ExerciseDefinition {
  const model = catalog.measurementModels[exercise.measurementModelId];
  const type = exerciseTypeOf(exercise, model);
  return {
    id: exercise.id,
    name: exercise.name,
    type,
    bodySection: bodySectionForFamily(exercise.movementFamilyId),
    defaultPrescription: toRuntimePrescription(exercise.defaultPrescription),
    isRest: type === 'REST',
    metadata: { notes: 'authored-v2' },
  };
}

export function authoredWorkoutAsDefinition(
  catalog: RuntimeWorkoutCatalog,
  workout: RuntimeWorkout,
): WorkoutDefinition {
  const band = catalog.progressionBands[workout.progressionBandId];
  return {
    id: workout.id,
    name: workout.name,
    description: workout.description,
    intendedDifficulty: difficultyForBandOrder(band?.order ?? 0),
    exercises: workout.exercises.map((step) => {
      const exercise = catalog.exercises[step.exerciseId]!;
      return {
        exerciseId: step.exerciseId,
        order: step.order,
        prescription: toRuntimePrescription(step.prescription),
        role: roleOf(step, exercise),
        skippable: step.skippable,
      };
    }),
    metadata: {
      tags: ['authored-v2', workout.size, workout.progressionBandId],
      authored: {
        catalogId: catalog.catalogId,
        catalogVersion: catalog.catalogVersion,
        engineVersion: catalog.engineVersion,
        familyId: workout.familyId,
        size: workout.size,
        progressionBandId: workout.progressionBandId,
      },
    },
  };
}

export function listAuthoredExerciseDefinitions(catalog: RuntimeWorkoutCatalog): ExerciseDefinition[] {
  return Object.values(catalog.exercises).map((exercise) => authoredExerciseAsDefinition(catalog, exercise));
}
