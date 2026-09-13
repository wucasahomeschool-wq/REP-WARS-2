import { WORKOUT_PURPOSES, WorkoutPurpose } from './types';

/**
 * Session/context intent selected before a workout.
 *
 * A session has exactly one purpose. WorkoutDefinition does not store purpose,
 * so the same physical workout can be reused for different gameplay intents.
 *
 * Purpose does not award Troops, construction workers, Golden Yield, or
 * defense inside the fitness pipeline. Conversion of a PhysicalResult into a
 * GameRewardResult lives in src/rewards. Applying that reward to GameState
 * is a later game-layer phase.
 */
export const WORKOUT_PURPOSE_AWARDS_REWARDS: Readonly<Record<WorkoutPurpose, false>> = Object.freeze({
  NORMAL_TROOPS: false,
  EXTRA_CONSTRUCTION_WORKERS: false,
  GOLDEN_YIELD: false,
  DEFENSE: false,
});

export function isWorkoutPurpose(value: unknown): value is WorkoutPurpose {
  return typeof value === 'string' && (WORKOUT_PURPOSES as readonly string[]).includes(value);
}
