/**
 * Prototype gameplay timing and consumption (gameplay-config.v1).
 *
 * Player-facing durations (24h protection, 30min defense, 48h recovery)
 * are expressed in minutes and converted to canonical `worldTick`s.
 * This is not Date.now() and not the fitness session clock.
 *
 * Prototype mapping: 1 worldTick = 1 minute of scheduled player time.
 */
export const GAMEPLAY_CONFIG = Object.freeze({
  configVersion: 'gameplay-config.v1' as const,
  ticksPerMinute: 1,
  playerProtectionMinutes: 24 * 60,
  defenseResponseMinutes: 30,
  successfulDefenseRecoveryMinutes: 48 * 60,
  /**
   * After a failed defense, the attacker cannot immediately continue.
   * Prototype: 4 hours — long enough for a typical phone check-in.
   */
  failedDefenseContinuationMinutes: 4 * 60,
  /**
   * Maximum world time to finish a defense workout after a timely start.
   * Prototype: 12 hours. Separate from the 30-minute response window.
   * Empire pause freezes this clock (playerFacingTick / deadline extension).
   */
  defenseWorkoutMaxDurationMinutes: 12 * 60,
  defaultConstructionDurationTicks: 20,
  constructionTicksPerWorkerPower: 1,
  maxFitnessHistoryEntries: 16,
  constructionGoldCost: 40,
  constructionStoneCost: 20,
  cityGoldCost: 80,
  cityStoneCost: 40,
  cityConstructionDurationTicks: 30,
  maxFortificationLevel: 5,
});

export type GameplayConfig = typeof GAMEPLAY_CONFIG;

export function minutesToTicks(minutes: number, config: GameplayConfig = GAMEPLAY_CONFIG): number {
  return Math.max(0, Math.round(minutes * config.ticksPerMinute));
}

export function playerProtectionTicks(config: GameplayConfig = GAMEPLAY_CONFIG): number {
  return minutesToTicks(config.playerProtectionMinutes, config);
}

export function defenseResponseTicks(config: GameplayConfig = GAMEPLAY_CONFIG): number {
  return minutesToTicks(config.defenseResponseMinutes, config);
}

export function successfulDefenseRecoveryTicks(config: GameplayConfig = GAMEPLAY_CONFIG): number {
  return minutesToTicks(config.successfulDefenseRecoveryMinutes, config);
}

export function failedDefenseContinuationTicks(config: GameplayConfig = GAMEPLAY_CONFIG): number {
  return minutesToTicks(config.failedDefenseContinuationMinutes, config);
}

export function defenseWorkoutMaxDurationTicks(config: GameplayConfig = GAMEPLAY_CONFIG): number {
  return minutesToTicks(config.defenseWorkoutMaxDurationMinutes, config);
}

/** Remaining construction ticks after applying workerPower. */
export function acceleratedRemainingTicks(
  remainingTicks: number,
  workerPower: number,
  config: GameplayConfig = GAMEPLAY_CONFIG,
): number {
  const reduction = Math.max(0, workerPower) * config.constructionTicksPerWorkerPower;
  return Math.max(0, Math.ceil(remainingTicks - reduction));
}
