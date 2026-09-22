import { authoredWorkoutAsDefinition, RuntimeWorkout, RuntimeWorkoutCatalog } from '../authoring/compile';
import { WorkoutDefinition } from '../types';
import { WorkoutSize } from '../authoring/types';
import { PlayerProgressionState } from './types';
import { workoutRequirementsSatisfied } from './readiness';

export interface AuthoredSelectionRequest {
  size?: WorkoutSize;
}

export interface AuthoredWorkoutSelection {
  workout: RuntimeWorkout;
  definition: WorkoutDefinition;
  catalog: RuntimeWorkoutCatalog;
  bandId: string;
  windowBandIds: string[];
  size: WorkoutSize;
  usedBridgePreference: boolean;
}

export type AuthoredSelectionResult =
  | { ok: true; value: AuthoredWorkoutSelection }
  | { ok: false; code: string; message: string };

export function currentSelectionWindow(
  catalog: RuntimeWorkoutCatalog,
  state: PlayerProgressionState,
): { bandId: string | null; windowBandIds: string[] } {
  const bandId = (
    state.currentBandId && catalog.progressionBands[state.currentBandId]
      ? state.currentBandId
      : catalog.orderedBandIds[0] ?? null
  );
  if (!bandId) return { bandId: null, windowBandIds: [] };
  const band = catalog.progressionBands[bandId];
  return { bandId, windowBandIds: [...(band?.selectionWindowBandIds ?? [bandId])] };
}

export function eligibleAuthoredWorkouts(
  catalog: RuntimeWorkoutCatalog,
  state: PlayerProgressionState,
  request: AuthoredSelectionRequest = {},
): RuntimeWorkout[] {
  const size = request.size ?? 'STANDARD';
  const { windowBandIds } = currentSelectionWindow(catalog, state);
  const window = new Set(windowBandIds);
  return Object.values(catalog.workouts)
    .filter((workout) => workout.size === size)
    .filter((workout) => window.has(workout.progressionBandId))
    .filter((workout) => workoutRequirementsSatisfied(catalog, state, workout.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function applyVariety(candidates: RuntimeWorkout[], state: PlayerProgressionState): RuntimeWorkout[] {
  const lastWorkout = state.recentWorkoutIds[0];
  const withoutLast = lastWorkout
    ? candidates.filter((workout) => workout.id !== lastWorkout)
    : candidates;
  const pool = withoutLast.length > 0 ? withoutLast : candidates;
  const lastFamily = state.recentFamilyIds[0];
  const withoutFamily = lastFamily
    ? pool.filter((workout) => workout.familyId !== lastFamily)
    : pool;
  return withoutFamily.length > 0 ? withoutFamily : pool;
}

/**
 * Selection from authored workouts only. Does not generate or rewrite content.
 * Bridge preference and variety-avoid-last are implementation choices.
 */
export function selectAuthoredWorkout(
  catalog: RuntimeWorkoutCatalog,
  state: PlayerProgressionState,
  request: AuthoredSelectionRequest = {},
): AuthoredSelectionResult {
  const size = request.size ?? 'STANDARD';
  const { bandId, windowBandIds } = currentSelectionWindow(catalog, state);
  if (!bandId) {
    return { ok: false, code: 'selection.empty_catalog', message: 'Authored catalog has no progression bands' };
  }
  const eligible = eligibleAuthoredWorkouts(catalog, state, { size });
  if (eligible.length === 0) {
    return {
      ok: false,
      code: 'selection.no_eligible_workout',
      message: `No authored ${size} workout is eligible in the current progression window`,
    };
  }
  const bridges = eligible.filter((workout) => workout.bridge?.fromBandId === bandId);
  const preferred = bridges.length > 0 ? bridges : eligible;
  const varied = applyVariety(preferred, state);
  const chosen = varied[0]!;
  return {
    ok: true,
    value: {
      workout: chosen,
      definition: authoredWorkoutAsDefinition(catalog, chosen),
      catalog,
      bandId,
      windowBandIds,
      size,
      usedBridgePreference: bridges.includes(chosen),
    },
  };
}
