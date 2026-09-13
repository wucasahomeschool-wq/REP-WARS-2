/**
 * Prototype game-reward conversion (game-reward-config.v1).
 *
 * PhysicalResult.totalPhysicalOutput is the only quantity converted.
 * Fitness Level, Confidence, feedback, speed, and frequency are ignored.
 *
 * A. Troops (NORMAL_TROOPS)
 *    amount = min(maxTroopsPerWorkout, floor(output × troopsPerPhysicalUnit))
 *    Example: 84.5 × 10 → 845 banked Troops.
 *
 * B. Construction (EXTRA_CONSTRUCTION_WORKERS)
 *    workerPower = min(maxWorkerPowerPerWorkout, round3(output × workersPerPhysicalUnit))
 *    Temporary acceleration units, not Army troops.
 *
 * C. Golden Yield (GOLDEN_YIELD) — bounded, not linear
 *    if output <= 0: multiplier = 1.0 (no enhancement)
 *    else:
 *      multiplier = min + (max - min) × (output / (output + halfSaturationOutput))
 *      rounded to 2 decimals, clamped to [min, max]
 *    A huge workout approaches maxMultiplier (4.0), never 50×.
 *    One-time collection effect only.
 *
 * D. Defense (DEFENSE)
 *    defensePower = min(maxDefensePowerPerWorkout, round3(output × defensePerPhysicalUnit))
 *    Distinct kind DEFENSE_MOBILIZATION; never TROOPS.
 */

export const GAME_REWARD_CONFIG = Object.freeze({
  modelVersion: 'game-reward.v1' as const,
  configVersion: 'game-reward-config.v1' as const,
  troopsPerPhysicalUnit: 10,
  maxTroopsPerWorkout: 10_000,
  workersPerPhysicalUnit: 0.25,
  maxWorkerPowerPerWorkout: 500,
  goldenYieldMinMultiplier: 1.25,
  goldenYieldMaxMultiplier: 4,
  goldenYieldHalfSaturationOutput: 40,
  goldenYieldZeroOutputMultiplier: 1,
  defensePerPhysicalUnit: 1,
  maxDefensePowerPerWorkout: 5_000,
});

export type GameRewardConfig = typeof GAME_REWARD_CONFIG;

export function roundReward(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function clampReward(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
