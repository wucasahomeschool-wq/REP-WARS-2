/**
 * Authoritative workout *selection* (which catalog WorkoutDefinition).
 *
 * Distinct from personalization (how that definition is scaled for this
 * player). Purpose remains session/context data — WorkoutDefinition does not
 * grow a purpose field. The same physical workout may be reused for every
 * current gameplay purpose.
 *
 * Mapping is explicit and deterministic. Unknown catalog ids fail closed.
 */
import { getWorkoutDefinition } from './catalog';
import { isWorkoutPurpose } from './purpose';
import { WORKOUT_PURPOSES, WorkoutId, WorkoutPurpose } from './types';

/** Prototype content reused across purposes. Matches Level 1 troop-floor tests. */
export const DEFAULT_SELECTED_WORKOUT_ID: WorkoutId = 'wk_moderate_full_body';

export const WORKOUT_SELECTION_BY_PURPOSE: Readonly<Record<WorkoutPurpose, WorkoutId>> = Object.freeze({
  NORMAL_TROOPS: DEFAULT_SELECTED_WORKOUT_ID,
  EXTRA_CONSTRUCTION_WORKERS: DEFAULT_SELECTED_WORKOUT_ID,
  GOLDEN_YIELD: DEFAULT_SELECTED_WORKOUT_ID,
  DEFENSE: DEFAULT_SELECTED_WORKOUT_ID,
});

export interface PurposeWorkoutSelection {
  purpose: WorkoutPurpose;
  selectedWorkoutId: WorkoutId;
}

function assertSelectionTable(): void {
  for (const purpose of WORKOUT_PURPOSES) {
    const id = WORKOUT_SELECTION_BY_PURPOSE[purpose];
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error(`fitness.selection: purpose ${purpose} has no selected workout id`);
    }
    if (!getWorkoutDefinition(id)) {
      throw new Error(`fitness.selection: purpose ${purpose} maps to unknown workout ${id}`);
    }
  }
}

assertSelectionTable();

export function selectedWorkoutIdForPurpose(purpose: WorkoutPurpose): WorkoutId {
  if (!isWorkoutPurpose(purpose)) {
    throw new Error(`fitness.selection: invalid WorkoutPurpose ${String(purpose)}`);
  }
  const id = WORKOUT_SELECTION_BY_PURPOSE[purpose];
  if (!id || !getWorkoutDefinition(id)) {
    throw new Error(`fitness.selection: purpose ${purpose} maps to unknown workout ${id}`);
  }
  return id;
}

export function listPurposeWorkoutSelections(): PurposeWorkoutSelection[] {
  return WORKOUT_PURPOSES.map((purpose) => ({
    purpose,
    selectedWorkoutId: selectedWorkoutIdForPurpose(purpose),
  }));
}
