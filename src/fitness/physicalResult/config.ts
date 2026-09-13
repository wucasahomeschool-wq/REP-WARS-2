/**
 * Physical-output normalization (physical-output.v1).
 *
 * This is a game abstraction, not calories, METs, or exertion science.
 *
 * REP_BASED:
 *   output = creditedReps × repWorkUnit × exerciseModifier × roleFactor × difficultyFactor
 *
 * TIMED:
 *   output = creditedSeconds × timedWorkUnitPerSecond × exerciseModifier × roleFactor × difficultyFactor
 *
 * credited = min(completed, prescribed) from the session snapshot (personalized
 * prescription, not the catalog). Incomplete / skipped / none → 0 credited.
 *
 * repWorkUnit and timedWorkUnitPerSecond are independent knobs.
 * They are intentionally not 1 rep = 1 second.
 *
 * Example (defaults, MODERATE, modifier 1, training role):
 *   10 push-ups → 10 × 1.0 = 10
 *   20s plank   → 20 × 0.5 = 10
 *
 * Difficulty is a modest accent only. The named difficulty already shaped
 * the personalized prescription; this factor does not re-scale volume.
 *   factor = 1 + (rank - 3) × 0.04   clamped to [0.88, 1.12]
 *   VERY_EASY 0.92 … MODERATE 1.00 … VERY_HARD 1.08
 *
 * REST → roleFactor 0. Stretch/mobility → stretchFactor (default 0).
 * Fitness Level, Confidence, feedback, rep speed, frequency, and purpose
 * are not multipliers.
 */

import { WorkoutDifficulty } from '../types';
import { WORKOUT_DIFFICULTY_RANK } from '../types';

export const PHYSICAL_RESULT_MODEL_VERSION_REF = 'physical-result.v1' as const;
export const PHYSICAL_OUTPUT_VERSION_REF = 'physical-output.v1' as const;

export const PHYSICAL_RESULT_CONFIG = Object.freeze({
  modelVersion: PHYSICAL_RESULT_MODEL_VERSION_REF,
  outputVersion: PHYSICAL_OUTPUT_VERSION_REF,
  repWorkUnit: 1,
  timedWorkUnitPerSecond: 0.5,
  defaultExerciseModifier: 1,
  exerciseModifiers: Object.freeze({
    ex_push_ups: 1,
    ex_squats: 1,
    ex_lunges: 1,
    ex_sit_ups: 1,
    ex_plank: 1,
    ex_wall_sit: 1,
  } as Record<string, number>),
  restFactor: 0,
  stretchFactor: 0,
  stretchExerciseIds: Object.freeze([
    'ex_neck_rolls',
    'ex_arm_circles',
    'ex_shoulder_stretch',
    'ex_quad_stretch',
    'ex_child_pose',
  ]),
  referenceDifficultyRank: WORKOUT_DIFFICULTY_RANK.MODERATE,
  difficultyStepPerRank: 0.04,
  difficultyFactorMin: 0.88,
  difficultyFactorMax: 1.12,
});

export type PhysicalResultConfig = typeof PHYSICAL_RESULT_CONFIG;

export function roundPhysicalOutput(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function clampPhysicalOutput(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function difficultyFactor(
  difficulty: WorkoutDifficulty,
  config: PhysicalResultConfig = PHYSICAL_RESULT_CONFIG,
): number {
  const rank = WORKOUT_DIFFICULTY_RANK[difficulty];
  const raw = 1 + (rank - config.referenceDifficultyRank) * config.difficultyStepPerRank;
  return roundPhysicalOutput(clampPhysicalOutput(raw, config.difficultyFactorMin, config.difficultyFactorMax));
}

export function exerciseModifier(
  exerciseId: string,
  config: PhysicalResultConfig = PHYSICAL_RESULT_CONFIG,
): number {
  return config.exerciseModifiers[exerciseId] ?? config.defaultExerciseModifier;
}
