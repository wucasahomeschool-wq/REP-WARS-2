/**
 * Prototype Fitness Level evaluation configuration (fitness-evaluation.v1).
 *
 * These weights are tunable playtest parameters, not validated physiology.
 * Changing this file should not require changes to WorkoutDefinition,
 * WorkoutSession, CompletedWorkoutRecord, or FitnessEvidence.
 *
 * Recency: exponential half-life on estimate confidence.
 *   factor = 2^(-(now - lastUpdatedAt) / recencyHalfLifeMs)
 *   At 0 delay: 1. At one half-life: 0.5. Ancient updates approach 0,
 *   so old beginner certainty does not permanently pin the level.
 *
 * Decreases: negative net deltas are multiplied by decreaseResistance
 *   so ordinary bad workouts move less than equivalent positive evidence.
 *
 * Influence: (1 - influenceConfidenceDamping * decayedConfidence).
 *   Low confidence → larger per-workout level steps.
 *   High confidence → smaller ordinary steps; strong signals still move.
 */

export const MS_PER_DAY = 86_400_000;
export const MS_PER_WEEK = 7 * MS_PER_DAY;
export const MS_PER_MONTH = 30 * MS_PER_DAY;

export const FITNESS_EVALUATION_CONFIG = Object.freeze({
  evaluationVersion: 'fitness-evaluation.v1' as const,
  levelMin: 1,
  levelMax: 10,
  levelInitial: 5,
  confidenceMin: 0,
  confidenceMax: 1,
  confidenceInitial: 0.08,
  maxAbsLevelDelta: 1.25,
  decreaseResistance: 0.42,
  influenceConfidenceDamping: 0.62,
  recencyHalfLifeMs: 14 * MS_PER_DAY,
  stableNetThreshold: 0.04,
  weights: Object.freeze({
    PERCEIVED_DIFFICULTY: 0.45,
    COMPLETION: 0.2,
    REP_SPEED: 0.12,
    WORKLOAD: 0.1,
    REST_SKIPPING: 0.03,
    FREQUENCY: 0.1,
    BODY_SECTION: 0,
    REGROUPING: 0,
  }),
  qualityScale: Object.freeze({
    STRONG: 1,
    PARTIAL: 0.55,
    UNAVAILABLE: 0,
  }),
  confidence: Object.freeze({
    approachRate: 0.22,
    baseCeiling: 0.38,
    coverageCeiling: 0.32,
    varietyCeiling: 0.12,
    frequencyCeiling: 0.1,
    interpretedSpeedCeiling: 0.08,
  }),
  frequency: Object.freeze({
    /** Workouts/week at or above this yield no extra capability signal. */
    grindThresholdPerWeek: 8,
    modestSignal: 0.08,
  }),
});

export type FitnessEvaluationConfig = typeof FITNESS_EVALUATION_CONFIG;

export function roundFitness(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function clampFitness(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
