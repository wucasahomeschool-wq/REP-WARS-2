/**
 * Prototype Fitness Level evaluation configuration (fitness-evaluation.v1).
 *
 * These weights are tunable playtest parameters, not validated physiology.
 * Changing this file should not require changes to WorkoutDefinition,
 * WorkoutSession, CompletedWorkoutRecord, or FitnessEvidence.
 *
 * Scale: Fitness Level is a raw capability estimate with minimum 0 and
 * no upper bound. Downstream personalization may compress that raw value
 * into a bounded prescription shift; it must not cap the estimate itself.
 *
 * Recency: exponential half-life on estimate confidence.
 *   factor = 2^(-(now - lastUpdatedAt) / recencyHalfLifeMs)
 *   At 0 delay: 1. At one half-life: 0.5. Ancient updates approach 0,
 *   so old beginner certainty does not permanently pin confidence.
 *
 * Decreases: negative net deltas are multiplied by decreaseResistance
 *   so ordinary bad workouts move less than equivalent positive evidence.
 *
 * Level-update influence (not confidence):
 *   scale = max(floor, initial * decay ^ observationCount)
 *   Observation 0 (first workout) has disproportionately high calibration
 *   influence. Each later observation multiplies that scale by decay.
 *   Confidence is a separate evidence-quality measure and continues to
 *   use the approach-rate model in confidence.ts. Do not treat a smaller
 *   level step as lower-quality confidence.
 */

export const MS_PER_DAY = 86_400_000;
export const MS_PER_WEEK = 7 * MS_PER_DAY;
export const MS_PER_MONTH = 30 * MS_PER_DAY;

export const FITNESS_EVALUATION_CONFIG = Object.freeze({
  evaluationVersion: 'fitness-evaluation.v1' as const,
  levelMin: 0,
  levelInitial: 5,
  confidenceMin: 0,
  confidenceMax: 1,
  confidenceInitial: 0.08,
  maxAbsLevelDelta: 1.25,
  decreaseResistance: 0.42,
  /**
   * Level-step scale at observationCount 0, as a multiple of maxAbsLevelDelta.
   * Distinct from confidence. First workout is a calibration jump.
   */
  observationInfluenceInitial: 2.2,
  /** Multiplier applied once per already-recorded observation. 0–1. */
  observationInfluenceDecay: 0.7,
  /** Floor so later workouts still move the estimate a little. */
  observationInfluenceFloor: 0.06,
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

/** Raw Fitness Level has a floor and no ceiling. */
export function floorFitnessLevel(
  value: number,
  min: number = FITNESS_EVALUATION_CONFIG.levelMin,
): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, value);
}

/**
 * Per-observation level-update influence. Independent of confidence.
 * `observationCount` is how many workouts have already been applied.
 */
export function observationInfluenceScale(
  observationCount: number,
  config: FitnessEvaluationConfig = FITNESS_EVALUATION_CONFIG,
): number {
  const n = Number.isFinite(observationCount) ? Math.max(0, observationCount) : 0;
  const raw = config.observationInfluenceInitial * (config.observationInfluenceDecay ** n);
  return roundFitness(Math.max(config.observationInfluenceFloor, raw));
}
