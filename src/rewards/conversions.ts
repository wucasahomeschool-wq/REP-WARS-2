import { PhysicalResult } from '../fitness/physicalResult';
import { GAME_REWARD_CONFIG, GameRewardConfig, clampReward, roundReward } from './config';
import {
  ConstructionWorkerReward,
  DefenseMobilizationReward,
  GAME_REWARD_CONFIG_VERSION,
  GAME_REWARD_MODEL_VERSION,
  GameRewardBase,
  GoldenYieldReward,
  TroopReward,
} from './types';

function baseFields(
  physical: PhysicalResult,
  _config: GameRewardConfig,
  notes: string[],
): GameRewardBase {
  return {
    modelVersion: GAME_REWARD_MODEL_VERSION,
    configVersion: GAME_REWARD_CONFIG_VERSION,
    playerId: physical.playerId,
    sessionId: physical.sessionId,
    workoutId: physical.workoutId,
    sourcePhysicalOutput: physical.totalPhysicalOutput,
    physicalResultModelVersion: physical.modelVersion,
    physicalOutputVersion: physical.outputVersion,
    intendedDifficulty: physical.intendedDifficulty,
    completedAt: physical.completedAt,
    conversionNotes: notes,
  };
}

export function convertTroops(
  physical: PhysicalResult,
  config: GameRewardConfig = GAME_REWARD_CONFIG,
): TroopReward {
  const raw = Math.floor(physical.totalPhysicalOutput * config.troopsPerPhysicalUnit);
  const amount = Math.max(0, Math.min(config.maxTroopsPerWorkout, raw));
  return {
    ...baseFields(physical, config, [
      `amount = min(${config.maxTroopsPerWorkout}, floor(output × ${config.troopsPerPhysicalUnit}))`,
      'banked_troops_not_applied_to_game_state',
    ]),
    kind: 'TROOPS',
    purpose: 'NORMAL_TROOPS',
    amount,
  };
}

export function convertConstructionWorkers(
  physical: PhysicalResult,
  config: GameRewardConfig = GAME_REWARD_CONFIG,
): ConstructionWorkerReward {
  const raw = roundReward(physical.totalPhysicalOutput * config.workersPerPhysicalUnit);
  const workerPower = Math.max(0, Math.min(config.maxWorkerPowerPerWorkout, raw));
  return {
    ...baseFields(physical, config, [
      `workerPower = min(${config.maxWorkerPowerPerWorkout}, round3(output × ${config.workersPerPhysicalUnit}))`,
      'temporary_construction_acceleration_not_military_troops',
    ]),
    kind: 'EXTRA_CONSTRUCTION_WORKERS',
    purpose: 'EXTRA_CONSTRUCTION_WORKERS',
    workerPower,
    permanence: 'TEMPORARY_ACCELERATION',
  };
}

export function convertGoldenYield(
  physical: PhysicalResult,
  config: GameRewardConfig = GAME_REWARD_CONFIG,
): GoldenYieldReward {
  const output = physical.totalPhysicalOutput;
  let multiplier: number;
  if (output <= 0) {
    multiplier = config.goldenYieldZeroOutputMultiplier;
  } else {
    const span = config.goldenYieldMaxMultiplier - config.goldenYieldMinMultiplier;
    const ratio = output / (output + config.goldenYieldHalfSaturationOutput);
    multiplier = clampReward(
      roundReward(config.goldenYieldMinMultiplier + span * ratio, 2),
      config.goldenYieldMinMultiplier,
      config.goldenYieldMaxMultiplier,
    );
  }
  return {
    ...baseFields(physical, config, [
      'one_time_collection_not_permanent_modifier',
      output <= 0
        ? 'zero_output_multiplier_is_1.0'
        : `multiplier = ${config.goldenYieldMinMultiplier} + (${config.goldenYieldMaxMultiplier} - ${config.goldenYieldMinMultiplier}) × (output / (output + ${config.goldenYieldHalfSaturationOutput}))`,
    ]),
    kind: 'GOLDEN_YIELD',
    purpose: 'GOLDEN_YIELD',
    multiplier,
    effect: 'ONE_TIME_COLLECTION',
    permanence: 'EPHEMERAL',
  };
}

export function convertDefense(
  physical: PhysicalResult,
  config: GameRewardConfig = GAME_REWARD_CONFIG,
): DefenseMobilizationReward {
  const raw = roundReward(physical.totalPhysicalOutput * config.defensePerPhysicalUnit);
  const defensePower = Math.max(0, Math.min(config.maxDefensePowerPerWorkout, raw));
  return {
    ...baseFields(physical, config, [
      `defensePower = min(${config.maxDefensePowerPerWorkout}, round3(output × ${config.defensePerPhysicalUnit}))`,
      'fresh_mobilization_not_banked_troops',
    ]),
    kind: 'DEFENSE_MOBILIZATION',
    purpose: 'DEFENSE',
    defensePower,
  };
}
