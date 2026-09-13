import { FITNESS_EVALUATION_CONFIG, FitnessEvaluationConfig } from './config';

export function recencyFactor(
  ageMs: number,
  config: FitnessEvaluationConfig = FITNESS_EVALUATION_CONFIG,
): number {
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 1;
  return 2 ** (-ageMs / config.recencyHalfLifeMs);
}

export function decayConfidence(
  confidence: number,
  ageMs: number,
  config: FitnessEvaluationConfig = FITNESS_EVALUATION_CONFIG,
): number {
  const factor = recencyFactor(ageMs, config);
  return config.confidenceInitial + (confidence - config.confidenceInitial) * factor;
}
