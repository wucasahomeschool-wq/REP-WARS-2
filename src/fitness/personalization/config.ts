/**
 * Prototype workout personalization (fitness-personalization.v1).
 *
 * Mapping — two independent axes, then a confidence blend on fitness only:
 *
 *   difficultyShift =
 *     ((desiredRank - catalogRank) / 4) * maxDifficultyShift
 *
 *   When the player selects the workout's own named difficulty, this is 0.
 *   Catalog numbers already encode that difficulty. A mismatch applies a
 *   small extra shift so EASY < MODERATE < HARD still holds on one definition.
 *
 *   deviation = (fitnessLevel - referenceLevel) / (levelMax - referenceLevel)
 *   fitnessShift = tanh(deviation * fitnessCompression) * maxFitnessShift
 *
 *   Level 5 → 0. Level 10 is compressed well below +100%. Not × fitnessLevel.
 *
 *   confidenceFactor =
 *     0  if confidence <= confidenceFloor (initial 0.08)
 *     1  if confidence >= confidenceFull
 *     ((confidence - floor) / (full - floor)) ^ confidenceCurve   otherwise
 *
 *   effectiveShift = clamp(
 *     difficultyShift + fitnessShift * confidenceFactor,
 *     minMultiplier - 1,
 *     maxMultiplier - 1
 *   )
 *   effectiveMultiplier = 1 + effectiveShift
 *
 * REST, opening/final stretches, and GLOBAL-section exercises are not scaled.
 * Purpose is ignored. These numbers are playtest knobs, not physiology.
 */

import { FITNESS_EVALUATION_CONFIG } from '../estimate/config';

export const FITNESS_PERSONALIZATION_VERSION = 'fitness-personalization.v1' as const;

export const FITNESS_PERSONALIZATION_CONFIG = Object.freeze({
  personalizationVersion: FITNESS_PERSONALIZATION_VERSION,
  referenceLevel: FITNESS_EVALUATION_CONFIG.levelInitial,
  levelMin: FITNESS_EVALUATION_CONFIG.levelMin,
  levelMax: FITNESS_EVALUATION_CONFIG.levelMax,
  fitnessCompression: 1.15,
  maxFitnessShift: 0.2,
  maxDifficultyShift: 0.24,
  minMultiplier: 0.82,
  maxMultiplier: 1.22,
  maxAbsRepAdjustment: 6,
  maxAbsDurationAdjustment: 8,
  minRepetitions: 1,
  maxRepetitions: 80,
  minDurationSeconds: 1,
  maxDurationSeconds: 180,
  confidenceFloor: FITNESS_EVALUATION_CONFIG.confidenceInitial,
  confidenceFull: 0.8,
  confidenceCurve: 1,
  /**
   * 17E uses the global Fitness Level for the whole workout.
   * When true, future versions may scale UPPER_BODY / CORE / LOWER_BODY
   * steps from provisional section levels. GLOBAL is never treated as its
   * own capacity lane.
   */
  useBodySectionLevels: false,
});

export type FitnessPersonalizationConfig = typeof FITNESS_PERSONALIZATION_CONFIG;

export function roundPersonalization(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function clampPersonalization(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
