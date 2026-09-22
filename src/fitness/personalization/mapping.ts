import { workoutDifficultyRank } from '../difficulty';
import { BodySection, WorkoutDifficulty } from '../types';
import { FitnessEstimate } from '../estimate/types';
import {
  FITNESS_PERSONALIZATION_CONFIG,
  FitnessPersonalizationConfig,
  clampPersonalization,
  roundPersonalization,
} from './config';
import { PersonalizationMapping } from './types';

export function confidenceFactor(
  confidence: number,
  config: FitnessPersonalizationConfig = FITNESS_PERSONALIZATION_CONFIG,
): number {
  if (confidence <= config.confidenceFloor) return 0;
  if (confidence >= config.confidenceFull) return 1;
  const span = config.confidenceFull - config.confidenceFloor;
  const linear = clampPersonalization((confidence - config.confidenceFloor) / span, 0, 1);
  return linear ** config.confidenceCurve;
}

export function fitnessShiftFromLevel(
  level: number,
  config: FitnessPersonalizationConfig = FITNESS_PERSONALIZATION_CONFIG,
): number {
  const span = config.levelMax - config.referenceLevel;
  // Mapping compression only. Raw Fitness Level is not clamped here.
  const deviation = (level - config.referenceLevel) / span;
  return Math.tanh(deviation * config.fitnessCompression) * config.maxFitnessShift;
}

export function difficultyShiftFromRanks(
  desiredRank: number,
  catalogRank: number,
  config: FitnessPersonalizationConfig = FITNESS_PERSONALIZATION_CONFIG,
): number {
  return ((desiredRank - catalogRank) / 4) * config.maxDifficultyShift;
}

/**
 * Global Fitness Level is the 17E personalization source.
 * Provisional section levels are available when useBodySectionLevels is on,
 * except GLOBAL — that is a stretch/warmup tag, not a capacity lane.
 */
export function fitnessLevelForSection(
  estimate: FitnessEstimate,
  bodySection: BodySection,
  config: FitnessPersonalizationConfig = FITNESS_PERSONALIZATION_CONFIG,
): number {
  if (!config.useBodySectionLevels || bodySection === 'GLOBAL') {
    return estimate.level;
  }
  return estimate.bodySectionLevels[bodySection];
}

export function computePersonalizationMapping(input: {
  fitnessLevel: number;
  confidence: number;
  catalogDifficulty: WorkoutDifficulty;
  desiredDifficulty: WorkoutDifficulty;
  configuration?: FitnessPersonalizationConfig;
}): PersonalizationMapping {
  const config = input.configuration ?? FITNESS_PERSONALIZATION_CONFIG;
  const catalogRank = workoutDifficultyRank(input.catalogDifficulty);
  const desiredRank = workoutDifficultyRank(input.desiredDifficulty);
  const fitnessShift = roundPersonalization(fitnessShiftFromLevel(input.fitnessLevel, config));
  const difficultyShift = roundPersonalization(difficultyShiftFromRanks(desiredRank, catalogRank, config));
  const factor = roundPersonalization(confidenceFactor(input.confidence, config));
  const unclamped = difficultyShift + fitnessShift * factor;
  const minShift = config.minMultiplier - 1;
  const maxShift = config.maxMultiplier - 1;
  const effectiveShift = roundPersonalization(clampPersonalization(unclamped, minShift, maxShift));
  return {
    catalogDifficulty: input.catalogDifficulty,
    desiredDifficulty: input.desiredDifficulty,
    catalogRank,
    desiredRank,
    fitnessLevel: input.fitnessLevel,
    confidence: input.confidence,
    fitnessShift,
    difficultyShift,
    confidenceFactor: factor,
    effectiveShift,
    effectiveMultiplier: roundPersonalization(1 + effectiveShift),
  };
}
