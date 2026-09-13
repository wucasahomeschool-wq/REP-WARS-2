import { FitnessEvidence } from '../evaluation/types';
import { FITNESS_EVALUATION_CONFIG, FitnessEvaluationConfig, clampFitness } from './config';
import { bodySectionVariety, qualityScaleOf } from './signals';
import { FitnessFrequencySnapshot } from './types';

export function confidenceCeiling(
  evidence: FitnessEvidence,
  frequency: FitnessFrequencySnapshot,
  speedInterpreted: boolean,
  config: FitnessEvaluationConfig = FITNESS_EVALUATION_CONFIG,
): number {
  const components = evidence.components;
  const qualities = [
    components.perceivedDifficulty.quality,
    components.completion.quality,
    components.repSpeed.quality,
    components.workload.quality,
    components.restSkipping.quality,
    frequency.available ? 'STRONG' : 'UNAVAILABLE',
  ] as const;
  const coverage = qualities.filter((quality) => quality !== 'UNAVAILABLE').length / 6;
  const variety = bodySectionVariety(evidence);
  const ceiling = config.confidence.baseCeiling
    + config.confidence.coverageCeiling * coverage
    + config.confidence.varietyCeiling * variety
    + (frequency.available ? config.confidence.frequencyCeiling : 0)
    + (speedInterpreted ? config.confidence.interpretedSpeedCeiling : 0);
  return clampFitness(ceiling, config.confidenceMin, config.confidenceMax);
}

export function informationScore(
  evidence: FitnessEvidence,
  frequency: FitnessFrequencySnapshot,
  speedInterpreted: boolean,
): number {
  let score = 0;
  if (evidence.components.perceivedDifficulty.quality === 'STRONG') score += 0.35;
  if (evidence.components.completion.quality === 'STRONG') score += 0.2;
  else if (evidence.components.completion.quality === 'PARTIAL') score += 0.1;
  if (speedInterpreted) score += 0.15;
  else if (qualityScaleOf(evidence.components.repSpeed.quality) > 0) score += 0.05;
  if (evidence.components.workload.quality === 'STRONG') score += 0.1;
  if (evidence.components.restSkipping.quality === 'STRONG') score += 0.05;
  if (frequency.available) score += 0.12;
  score += 0.08 * bodySectionVariety(evidence);
  return clampFitness(score, 0, 1);
}

export function nextConfidence(
  decayedConfidence: number,
  evidence: FitnessEvidence,
  frequency: FitnessFrequencySnapshot,
  speedInterpreted: boolean,
  config: FitnessEvaluationConfig = FITNESS_EVALUATION_CONFIG,
): { next: number; contribution: number; ceiling: number } {
  const ceiling = confidenceCeiling(evidence, frequency, speedInterpreted, config);
  const info = informationScore(evidence, frequency, speedInterpreted);
  const room = Math.max(0, ceiling - decayedConfidence);
  const contribution = room * config.confidence.approachRate * info;
  const next = clampFitness(decayedConfidence + contribution, config.confidenceMin, ceiling);
  return { next, contribution, ceiling };
}
