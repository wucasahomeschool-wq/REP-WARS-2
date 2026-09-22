import { exerciseCatalogById } from '../catalog/exercises';
import { getWorkoutDefinition } from '../catalog/workouts';
import { RuntimeWorkout, RuntimeWorkoutCatalog } from '../authoring/compile';
import { authoredExerciseAsDefinition, authoredWorkoutAsDefinition } from '../authoring/compile';
import { ExerciseDefinition, ExerciseId, WorkoutDefinition } from '../types';

let installed: RuntimeWorkoutCatalog | null = null;

export function installAuthoredWorkoutCatalog(catalog: RuntimeWorkoutCatalog | null): RuntimeWorkoutCatalog | null {
  const previous = installed;
  installed = catalog;
  return previous;
}

export function getAuthoredWorkoutCatalog(): RuntimeWorkoutCatalog | null {
  return installed;
}

export function getAuthoredRuntimeWorkout(workoutId: string): RuntimeWorkout | null {
  if (!installed) return null;
  return installed.workouts[workoutId] ?? null;
}

export function getAuthoredWorkoutDefinition(workoutId: string): WorkoutDefinition | null {
  const workout = getAuthoredRuntimeWorkout(workoutId);
  if (!installed || !workout) return null;
  return authoredWorkoutAsDefinition(installed, workout);
}

export function getAuthoredExerciseDefinition(exerciseId: string): ExerciseDefinition | null {
  if (!installed) return null;
  const exercise = installed.exercises[exerciseId];
  if (!exercise) return null;
  return authoredExerciseAsDefinition(installed, exercise);
}

export function listAuthoredWorkoutDefinitions(): WorkoutDefinition[] {
  if (!installed) return [];
  return Object.values(installed.workouts).map((workout) => authoredWorkoutAsDefinition(installed!, workout));
}

export function hasAuthoredCatalog(): boolean {
  return !!installed && Object.keys(installed.workouts).length > 0;
}

export function isAuthoredWorkoutDefinition(workout: WorkoutDefinition): boolean {
  return !!workout.metadata.authored;
}

export function resolveWorkoutDefinition(workoutId: string): WorkoutDefinition | undefined {
  return getAuthoredWorkoutDefinition(workoutId) ?? getWorkoutDefinition(workoutId);
}

export function mergedExerciseCatalogById(): Map<ExerciseId, ExerciseDefinition> {
  const map = new Map(exerciseCatalogById());
  if (!installed) return map;
  for (const exercise of Object.values(installed.exercises)) {
    map.set(exercise.id, authoredExerciseAsDefinition(installed, exercise));
  }
  return map;
}
