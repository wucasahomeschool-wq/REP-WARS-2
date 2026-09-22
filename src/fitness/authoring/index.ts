export {
  WORKOUT_AUTHORING_FORMAT,
  WORKOUT_PROGRESSION_ENGINE_VERSION,
  MEASUREMENT_MODEL_KINDS,
  AUTHORED_PRESCRIPTION_KINDS,
  WORKOUT_SIZES,
  AUTHORED_EXERCISE_ROLES,
} from './types';
export type {
  MeasurementModelKind,
  AuthoredPrescriptionKind,
  WorkoutSize,
  AuthoredExerciseRole,
  AuthoredPrescription,
  AuthoredMeasurementModel,
  AuthoredMovementStage,
  AuthoredMovementFamily,
  AuthoredProgressionBand,
  AuthoredExercise,
  AuthoredMovementRequirement,
  AuthoredWorkoutExercise,
  AuthoredBridge,
  AuthoredWorkout,
  AuthoredWorkoutFamily,
  WorkoutAuthoringDocument,
  AuthoringIssue,
  AuthoringValidationResult,
} from './types';

export { validateAuthoringStructure, isWorkoutAuthoringDocument, asWorkoutAuthoringDocument } from './structural';
export { validateAuthoringSemantics, validateWorkoutAuthoringDocument } from './semantic';
export {
  compileAuthoringDocument,
  mergeRuntimeCatalogs,
  authoredWorkoutAsDefinition,
  authoredExerciseAsDefinition,
  listAuthoredExerciseDefinitions,
} from './compile';
export type {
  RuntimeMeasurementModel,
  RuntimeMovementStage,
  RuntimeMovementFamily,
  RuntimeProgressionBand,
  RuntimeExercise,
  RuntimeMovementRequirement,
  RuntimeWorkoutStep,
  RuntimeBridge,
  RuntimeWorkout,
  RuntimeWorkoutFamily,
  RuntimeWorkoutCatalog,
  CompileAuthoringResult,
} from './compile';
export { WORKOUT_AUTHORING_JSON_SCHEMA } from './schema';
export { sampleAuthoringDocumentV2, AUTHORED_V2_FIXTURE_CATALOG_ID, AUTHORED_V2_FIXTURE_CATALOG_VERSION } from './fixture';
export {
  installAuthoredWorkoutCatalog,
  getAuthoredWorkoutCatalog,
  getAuthoredRuntimeWorkout,
  getAuthoredWorkoutDefinition,
  getAuthoredExerciseDefinition,
  listAuthoredWorkoutDefinitions,
  hasAuthoredCatalog,
  isAuthoredWorkoutDefinition,
  resolveWorkoutDefinition,
  mergedExerciseCatalogById,
} from './registry';
