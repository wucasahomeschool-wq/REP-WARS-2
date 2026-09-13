import { EvidenceQuality, FitnessEvidence } from '../evaluation/types';
import { FITNESS_EVALUATION_CONFIG, FitnessEvaluationConfig, clampFitness } from './config';
import { recencyFactor } from './recency';
import { BodySection } from '../types';

export function qualityScaleOf(
  quality: EvidenceQuality | 'UNAVAILABLE',
  config: FitnessEvaluationConfig = FITNESS_EVALUATION_CONFIG,
): number {
  if (quality === 'STRONG') return config.qualityScale.STRONG;
  if (quality === 'PARTIAL') return config.qualityScale.PARTIAL;
  return config.qualityScale.UNAVAILABLE;
}

export function perceivedDifficultySignal(evidence: FitnessEvidence): { signal: number; notes: string } {
  const perceived = evidence.components.perceivedDifficulty;
  const base = -perceived.relativeOffset / 2;
  const rankScale = 0.55 + 0.45 * (perceived.intendedDifficultyRank - 1) / 4;
  const signal = clampFitness(base * rankScale, -1, 1);
  return {
    signal,
    notes: `${perceived.reading}:${perceived.intendedDifficulty}:${perceived.perceivedRelative}`,
  };
}

export function completionSignal(evidence: FitnessEvidence): { signal: number; notes: string } {
  const completion = evidence.components.completion;
  const ratio = completion.mandatoryCompletionRatio ?? completion.resolvedRatio ?? 0;
  if (completion.exercisesIncompleteMandatory > 0) {
    return {
      signal: clampFitness((ratio - 1) * 1.15, -1, 0),
      notes: 'incomplete_mandatory',
    };
  }
  return {
    signal: 0.12 * clampFitness(ratio, 0, 1),
    notes: 'completed_mandatory',
  };
}

export function workloadSignal(evidence: FitnessEvidence): { signal: number; notes: string } {
  const workload = evidence.components.workload;
  const ratios: number[] = [];
  if (workload.repetitionCompletionRatio !== null) ratios.push(workload.repetitionCompletionRatio);
  if (workload.timedCompletionRatio !== null) ratios.push(workload.timedCompletionRatio);
  if (ratios.length === 0) return { signal: 0, notes: 'no_workload_ratios' };
  const average = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
  return {
    signal: clampFitness((average - 0.92) * 0.8, -1, 0.2),
    notes: 'completion_ratios_not_volume',
  };
}

export function restSkippingSignal(evidence: FitnessEvidence): { signal: number; notes: string } {
  const rest = evidence.components.restSkipping;
  if (rest.quality === 'UNAVAILABLE' || rest.restSkipRate === null) {
    return { signal: 0, notes: 'no_rest_opportunities' };
  }
  return {
    signal: rest.restSkipRate * 0.25,
    notes: 'weak_contextual_only',
  };
}

function priorSpeedForExercise(
  exerciseId: string,
  prior: readonly FitnessEvidence[],
  now: number,
): number | null {
  let weighted = 0;
  let weights = 0;
  for (const record of prior) {
    const row = record.components.repSpeed.exercises.find((item) => item.exerciseId === exerciseId);
    if (!row || !row.derived.available) continue;
    const weight = recencyFactor(now - record.completedAt);
    weighted += row.derived.averageMsPerRep * weight;
    weights += weight;
  }
  if (weights <= 0) return null;
  return weighted / weights;
}

export function repSpeedSignal(
  evidence: FitnessEvidence,
  prior: readonly FitnessEvidence[],
  now: number,
): { signal: number; quality: EvidenceQuality | 'UNAVAILABLE'; notes: string } {
  const speed = evidence.components.repSpeed;
  if (speed.quality === 'UNAVAILABLE' || !speed.aggregate.available) {
    return { signal: 0, quality: 'UNAVAILABLE', notes: 'insufficient_timing' };
  }
  if (prior.length === 0) {
    return { signal: 0, quality: 'PARTIAL', notes: 'no_self_comparison_history' };
  }
  const comparable: number[] = [];
  for (const row of speed.exercises) {
    if (!row.derived.available) continue;
    const priorMs = priorSpeedForExercise(row.exerciseId, prior, now);
    if (priorMs === null || priorMs <= 0) continue;
    comparable.push((priorMs - row.derived.averageMsPerRep) / priorMs);
  }
  if (comparable.length === 0) {
    return { signal: 0, quality: 'PARTIAL', notes: 'no_matching_prior_exercise_speed' };
  }
  const mean = comparable.reduce((sum, value) => sum + value, 0) / comparable.length;
  return {
    signal: clampFitness(mean * 1.4, -1, 1) * 0.65,
    quality: 'STRONG',
    notes: 'self_relative_session_clock',
  };
}

export function bodySectionShares(evidence: FitnessEvidence): Record<BodySection, number> {
  const sections = evidence.components.bodySection.sections;
  const total = (['UPPER_BODY', 'CORE', 'LOWER_BODY', 'GLOBAL'] as const)
    .reduce((sum, key) => sum + sections[key].exercisesPrescribed, 0);
  const shares = {
    UPPER_BODY: 0,
    CORE: 0,
    LOWER_BODY: 0,
    GLOBAL: 0,
  } as Record<BodySection, number>;
  if (total <= 0) return shares;
  for (const key of ['UPPER_BODY', 'CORE', 'LOWER_BODY', 'GLOBAL'] as const) {
    shares[key] = sections[key].exercisesPrescribed / total;
  }
  return shares;
}

export function bodySectionVariety(evidence: FitnessEvidence): number {
  const body = evidence.components.bodySection;
  const used = [body.upperBodyExercises, body.coreExercises, body.lowerBodyExercises]
    .filter((count) => count > 0).length;
  return used / 3;
}
