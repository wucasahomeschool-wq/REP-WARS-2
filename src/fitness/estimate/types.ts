/**
 * FITNESS LEVEL & CONFIDENCE (Phase 17D)
 *
 * Interprets FitnessEvidence into an estimate of current workout capability.
 * Not XP, currency, military power, a medical score, or a game reward.
 *
 * Scale (fitness-model.v1):
 *   level 1.0–10.0  = prototype capability estimate for future prescription
 *   5.0             = uninitialized midpoint (neither beginner nor peak)
 *   confidence 0–1  = how much reliable evidence supports the level
 *
 * WorkoutDifficulty (VERY_EASY…VERY_HARD) remains a separate domain.
 */

import { BodySection } from '../types';
import { EvidenceQuality, FitnessEvidence, FitnessEvidenceSource } from '../evaluation/types';

export const FITNESS_MODEL_VERSION = 'fitness-model.v1';
export const FITNESS_EVALUATION_VERSION = 'fitness-evaluation.v1';

export type FitnessNetDirection = 'UP' | 'DOWN' | 'STABLE';

export interface FitnessBodySectionLevels {
  GLOBAL: number;
  UPPER_BODY: number;
  CORE: number;
  LOWER_BODY: number;
}

export interface FitnessEstimate {
  modelVersion: typeof FITNESS_MODEL_VERSION;
  playerId: string;
  /** Global capability estimate. Primary prototype value. */
  level: number;
  /** Reliability of `level`, not player affect and not Fitness Level itself. */
  confidence: number;
  /** Provisional section estimates for future personalization. Not the gameplay model. */
  bodySectionLevels: FitnessBodySectionLevels;
  initializedAt: number;
  lastUpdatedAt: number;
  observationCount: number;
}

/**
 * Real supplied history only. Empty/omitted fields mean "no history",
 * not "zero workouts invented by the engine".
 */
export interface FitnessHistoryContext {
  now?: number;
  priorEvidence?: readonly FitnessEvidence[];
  priorEstimates?: readonly FitnessEstimate[];
}

export interface FitnessSourceContribution {
  source: FitnessEvidenceSource;
  quality: EvidenceQuality | 'UNAVAILABLE';
  weight: number;
  qualityScale: number;
  signal: number;
  weightedContribution: number;
  notes: string;
}

export interface FitnessFrequencySnapshot {
  available: boolean;
  workoutsLastDay: number | null;
  workoutsLastWeek: number | null;
  workoutsLastMonth: number | null;
  /** Distinct calendar-day count in the last week. Not a streak bonus. */
  activeDaysLastWeek: number | null;
}

export interface FitnessEvaluationResult {
  modelVersion: typeof FITNESS_MODEL_VERSION;
  evaluationVersion: typeof FITNESS_EVALUATION_VERSION;
  playerId: string;
  sessionId: string;
  previousLevel: number;
  newLevel: number;
  previousConfidence: number;
  newConfidence: number;
  decayedConfidence: number;
  evidenceContributions: FitnessSourceContribution[];
  netEvidenceScore: number;
  netEvidenceDirection: FitnessNetDirection;
  rawLevelDelta: number;
  boundedLevelChange: number;
  decreaseResistanceApplied: boolean;
  recencyFactor: number;
  influenceScale: number;
  confidenceContribution: number;
  confidenceCeiling: number;
  frequency: FitnessFrequencySnapshot;
  bodySectionLevels: FitnessBodySectionLevels;
  evaluatedAt: number;
}

export interface CreateFitnessEstimateInput {
  playerId: string;
  now: number;
}
