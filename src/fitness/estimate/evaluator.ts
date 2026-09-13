import { cloneFitnessEvidence, validateFitnessEvidence } from '../evaluation/clone';
import { FitnessEvidence } from '../evaluation/types';
import { cloneBodySectionLevels, cloneFitnessEstimate, cloneFitnessEvaluationResult, emptyBodySectionLevels } from './clone';
import { nextConfidence } from './confidence';
import {
  FITNESS_EVALUATION_CONFIG,
  FitnessEvaluationConfig,
  clampFitness,
  roundFitness,
} from './config';
import { estimateErr, estimateOk, EstimateOpResult } from './errors';
import { buildFrequencySnapshot, frequencySignal } from './frequency';
import { decayConfidence, recencyFactor } from './recency';
import {
  bodySectionShares,
  completionSignal,
  perceivedDifficultySignal,
  qualityScaleOf,
  repSpeedSignal,
  restSkippingSignal,
  workloadSignal,
} from './signals';
import {
  CreateFitnessEstimateInput,
  FITNESS_EVALUATION_VERSION,
  FITNESS_MODEL_VERSION,
  FitnessEstimate,
  FitnessEvaluationResult,
  FitnessHistoryContext,
  FitnessNetDirection,
  FitnessSourceContribution,
} from './types';
import { validateFitnessEstimate } from './validation';

export function createInitialFitnessEstimate(input: CreateFitnessEstimateInput): EstimateOpResult<FitnessEstimate> {
  if (typeof input.playerId !== 'string' || input.playerId.trim() === '') {
    return estimateErr('estimate.invalid_estimate', 'playerId must be a non-empty string');
  }
  if (!Number.isFinite(input.now) || input.now < 0) {
    return estimateErr('estimate.invalid_timestamp', 'now must be a finite non-negative timestamp');
  }
  const level = FITNESS_EVALUATION_CONFIG.levelInitial;
  return estimateOk({
    modelVersion: FITNESS_MODEL_VERSION,
    playerId: input.playerId.trim(),
    level,
    confidence: FITNESS_EVALUATION_CONFIG.confidenceInitial,
    bodySectionLevels: emptyBodySectionLevels(level),
    initializedAt: input.now,
    lastUpdatedAt: input.now,
    observationCount: 0,
  });
}

function directionOf(net: number, threshold: number): FitnessNetDirection {
  if (net > threshold) return 'UP';
  if (net < -threshold) return 'DOWN';
  return 'STABLE';
}

export function evaluateFitness(input: {
  previousEstimate: FitnessEstimate | null;
  currentEvidence: FitnessEvidence;
  historicalContext?: FitnessHistoryContext;
  configuration?: FitnessEvaluationConfig;
}): EstimateOpResult<FitnessEvaluationResult> {
  const config = input.configuration ?? FITNESS_EVALUATION_CONFIG;
  const evidenceIssues = validateFitnessEvidence(input.currentEvidence);
  if (evidenceIssues.length > 0) {
    return estimateErr('estimate.invalid_evidence', evidenceIssues[0]!.message);
  }
  const evidence = cloneFitnessEvidence(input.currentEvidence);
  const now = input.historicalContext?.now ?? evidence.evaluatedAt ?? evidence.completedAt;
  if (!Number.isFinite(now) || now < 0) {
    return estimateErr('estimate.invalid_timestamp', 'Evaluation timestamp is invalid');
  }

  let previous: FitnessEstimate;
  if (input.previousEstimate === null) {
    const created = createInitialFitnessEstimate({ playerId: evidence.playerId, now });
    if (!created.ok) return created;
    previous = created.value;
  } else {
    const estimateIssues = validateFitnessEstimate(input.previousEstimate);
    if (estimateIssues.length > 0) {
      return estimateErr('estimate.invalid_estimate', estimateIssues[0]!);
    }
    previous = cloneFitnessEstimate(input.previousEstimate);
  }

  if (previous.playerId !== evidence.playerId) {
    return estimateErr('estimate.player_mismatch', 'Estimate and evidence playerId do not match', {
      estimatePlayer: previous.playerId,
      evidencePlayer: evidence.playerId,
    });
  }

  const priorEvidence = (input.historicalContext?.priorEvidence ?? []).map(cloneFitnessEvidence);
  for (const prior of priorEvidence) {
    if (prior.playerId !== evidence.playerId) {
      return estimateErr('estimate.invalid_history', 'Historical evidence belongs to a different player');
    }
  }

  const ageMs = now - previous.lastUpdatedAt;
  const recency = recencyFactor(ageMs, config);
  const decayedConf = roundFitness(decayConfidence(previous.confidence, ageMs, config));
  const frequency = buildFrequencySnapshot(evidence, priorEvidence, now);
  const perceived = perceivedDifficultySignal(evidence);
  const completion = completionSignal(evidence);
  const workload = workloadSignal(evidence);
  const rest = restSkippingSignal(evidence);
  const speed = repSpeedSignal(evidence, priorEvidence, now);
  const freq = frequencySignal(frequency);

  const contributions: FitnessSourceContribution[] = [
    {
      source: 'PERCEIVED_DIFFICULTY',
      quality: evidence.components.perceivedDifficulty.quality,
      weight: config.weights.PERCEIVED_DIFFICULTY,
      qualityScale: qualityScaleOf(evidence.components.perceivedDifficulty.quality, config),
      signal: perceived.signal,
      weightedContribution: 0,
      notes: perceived.notes,
    },
    {
      source: 'COMPLETION',
      quality: evidence.components.completion.quality,
      weight: config.weights.COMPLETION,
      qualityScale: qualityScaleOf(evidence.components.completion.quality, config),
      signal: completion.signal,
      weightedContribution: 0,
      notes: completion.notes,
    },
    {
      source: 'REP_SPEED',
      quality: speed.quality,
      weight: config.weights.REP_SPEED,
      qualityScale: qualityScaleOf(speed.quality, config),
      signal: speed.signal,
      weightedContribution: 0,
      notes: speed.notes,
    },
    {
      source: 'WORKLOAD',
      quality: evidence.components.workload.quality,
      weight: config.weights.WORKLOAD,
      qualityScale: qualityScaleOf(evidence.components.workload.quality, config),
      signal: workload.signal,
      weightedContribution: 0,
      notes: workload.notes,
    },
    {
      source: 'REST_SKIPPING',
      quality: evidence.components.restSkipping.quality,
      weight: config.weights.REST_SKIPPING,
      qualityScale: qualityScaleOf(evidence.components.restSkipping.quality, config),
      signal: rest.signal,
      weightedContribution: 0,
      notes: rest.notes,
    },
    {
      source: 'FREQUENCY',
      quality: frequency.available ? 'PARTIAL' : 'UNAVAILABLE',
      weight: config.weights.FREQUENCY,
      qualityScale: frequency.available ? config.qualityScale.PARTIAL : 0,
      signal: freq.signal,
      weightedContribution: 0,
      notes: freq.notes,
    },
    {
      source: 'BODY_SECTION',
      quality: evidence.components.bodySection.quality,
      weight: config.weights.BODY_SECTION,
      qualityScale: 0,
      signal: 0,
      weightedContribution: 0,
      notes: 'preserved_for_provisional_section_estimates',
    },
    {
      source: 'REGROUPING',
      quality: 'UNAVAILABLE',
      weight: config.weights.REGROUPING,
      qualityScale: 0,
      signal: 0,
      weightedContribution: 0,
      notes: 'not_interpreted',
    },
  ];

  for (const row of contributions) {
    row.weightedContribution = roundFitness(row.weight * row.qualityScale * row.signal);
  }

  const net = roundFitness(contributions.reduce((sum, row) => sum + row.weightedContribution, 0));
  const influenceScale = roundFitness(1 - config.influenceConfidenceDamping * decayedConf);
  const unadjustedDelta = net * config.maxAbsLevelDelta * influenceScale;
  const decreaseResistanceApplied = unadjustedDelta < 0;
  const resistedDelta = decreaseResistanceApplied
    ? unadjustedDelta * config.decreaseResistance
    : unadjustedDelta;
  const bounded = roundFitness(clampFitness(resistedDelta, -config.maxAbsLevelDelta, config.maxAbsLevelDelta));
  const newLevel = roundFitness(clampFitness(previous.level + bounded, config.levelMin, config.levelMax));

  const speedInterpreted = speed.notes === 'self_relative_session_clock';
  const confidence = nextConfidence(decayedConf, evidence, frequency, speedInterpreted, config);
  const newConfidence = roundFitness(confidence.next);

  const shares = bodySectionShares(evidence);
  const bodySectionLevels = cloneBodySectionLevels(previous.bodySectionLevels);
  bodySectionLevels.GLOBAL = newLevel;
  for (const key of ['UPPER_BODY', 'CORE', 'LOWER_BODY'] as const) {
    const sectionDelta = bounded * shares[key];
    bodySectionLevels[key] = roundFitness(clampFitness(
      previous.bodySectionLevels[key] + sectionDelta,
      config.levelMin,
      config.levelMax,
    ));
  }

  const result: FitnessEvaluationResult = {
    modelVersion: FITNESS_MODEL_VERSION,
    evaluationVersion: FITNESS_EVALUATION_VERSION,
    playerId: evidence.playerId,
    sessionId: evidence.sessionId,
    previousLevel: previous.level,
    newLevel,
    previousConfidence: previous.confidence,
    newConfidence,
    decayedConfidence: decayedConf,
    evidenceContributions: contributions,
    netEvidenceScore: net,
    netEvidenceDirection: directionOf(net, config.stableNetThreshold),
    rawLevelDelta: roundFitness(unadjustedDelta),
    boundedLevelChange: bounded,
    decreaseResistanceApplied,
    recencyFactor: roundFitness(recency),
    influenceScale,
    confidenceContribution: roundFitness(confidence.contribution),
    confidenceCeiling: roundFitness(confidence.ceiling),
    frequency,
    bodySectionLevels,
    evaluatedAt: now,
  };

  return estimateOk(cloneFitnessEvaluationResult(result));
}

export function applyFitnessEvaluation(
  previousEstimate: FitnessEstimate | null,
  result: FitnessEvaluationResult,
  now?: number,
): EstimateOpResult<FitnessEstimate> {
  const evaluatedAt = now ?? result.evaluatedAt;
  let base: FitnessEstimate;
  if (previousEstimate === null) {
    const created = createInitialFitnessEstimate({ playerId: result.playerId, now: evaluatedAt });
    if (!created.ok) return created;
    base = created.value;
  } else {
    const issues = validateFitnessEstimate(previousEstimate);
    if (issues.length > 0) return estimateErr('estimate.invalid_estimate', issues[0]!);
    if (previousEstimate.playerId !== result.playerId) {
      return estimateErr('estimate.player_mismatch', 'Cannot apply evaluation to a different player');
    }
    base = cloneFitnessEstimate(previousEstimate);
  }
  base.level = result.newLevel;
  base.confidence = result.newConfidence;
  base.bodySectionLevels = cloneBodySectionLevels(result.bodySectionLevels);
  base.lastUpdatedAt = evaluatedAt;
  base.observationCount += 1;
  return estimateOk(base);
}
