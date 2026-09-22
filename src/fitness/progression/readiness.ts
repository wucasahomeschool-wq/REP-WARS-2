import { RuntimeMovementFamily, RuntimeWorkoutCatalog } from '../authoring/compile';
import { PlayerProgressionState } from './types';

export function orderedStages(family: RuntimeMovementFamily): RuntimeMovementFamily['stages'] {
  return family.stages.slice().sort((a, b) => a.order - b.order);
}

export function firstStageId(family: RuntimeMovementFamily): string | null {
  return orderedStages(family)[0]?.id ?? null;
}

/**
 * Missing readiness means the family's first authored stage, not "ineligible".
 */
export function readinessStageId(
  state: PlayerProgressionState,
  family: RuntimeMovementFamily,
): string | null {
  return state.movementReadiness[family.id] ?? firstStageId(family);
}

export function stageMeetsMinimum(
  family: RuntimeMovementFamily,
  currentStageId: string | null,
  minimumStageId: string,
): boolean {
  const stages = orderedStages(family);
  const current = stages.findIndex((stage) => stage.id === currentStageId);
  const minimum = stages.findIndex((stage) => stage.id === minimumStageId);
  if (minimum < 0) return false;
  if (current < 0) return minimum === 0;
  return current >= minimum;
}

export function workoutRequirementsSatisfied(
  catalog: RuntimeWorkoutCatalog,
  state: PlayerProgressionState,
  workoutId: string,
): boolean {
  const workout = catalog.workouts[workoutId];
  if (!workout) return false;
  for (const req of workout.movementRequirements) {
    const family = catalog.movementFamilies[req.movementFamilyId];
    if (!family) return false;
    const current = readinessStageId(state, family);
    if (!stageMeetsMinimum(family, current, req.minimumStageId)) return false;
  }
  return true;
}

export function seedMissingReadiness(
  catalog: RuntimeWorkoutCatalog,
  state: PlayerProgressionState,
): void {
  for (const family of Object.values(catalog.movementFamilies)) {
    if (!state.movementReadiness[family.id]) {
      const first = firstStageId(family);
      if (first) state.movementReadiness[family.id] = first;
    }
  }
}
