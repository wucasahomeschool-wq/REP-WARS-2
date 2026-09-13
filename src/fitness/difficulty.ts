import {
  WORKOUT_DIFFICULTIES,
  WORKOUT_DIFFICULTY_RANK,
  WorkoutDifficulty,
} from './types';

export function isWorkoutDifficulty(value: unknown): value is WorkoutDifficulty {
  return typeof value === 'string' && (WORKOUT_DIFFICULTIES as readonly string[]).includes(value);
}

export function workoutDifficultyRank(difficulty: WorkoutDifficulty): number {
  return WORKOUT_DIFFICULTY_RANK[difficulty];
}

export function parseWorkoutDifficulty(value: unknown): WorkoutDifficulty | null {
  return isWorkoutDifficulty(value) ? value : null;
}
