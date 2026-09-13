import { clonePhysicalResult } from '../fitness/physicalResult';
import { isWorkoutPurpose } from '../fitness/purpose';
import { WorkoutPurpose } from '../fitness/types';
import { GAME_REWARD_CONFIG, GameRewardConfig } from './config';
import {
  convertConstructionWorkers,
  convertDefense,
  convertGoldenYield,
  convertTroops,
} from './conversions';
import { rewardErr, rewardOk, RewardOpResult } from './errors';
import { ConvertGameRewardInput, GameRewardResult } from './types';
import { cloneGameRewardResult, validateGameRewardConfig, validatePhysicalResultForReward } from './validation';

function convertByPurpose(
  purpose: WorkoutPurpose,
  physical: ReturnType<typeof clonePhysicalResult>,
  config: GameRewardConfig,
): RewardOpResult<GameRewardResult> {
  switch (purpose) {
    case 'NORMAL_TROOPS':
      return rewardOk(convertTroops(physical, config));
    case 'EXTRA_CONSTRUCTION_WORKERS':
      return rewardOk(convertConstructionWorkers(physical, config));
    case 'GOLDEN_YIELD':
      return rewardOk(convertGoldenYield(physical, config));
    case 'DEFENSE':
      return rewardOk(convertDefense(physical, config));
    default: {
      const unexpected: never = purpose;
      return rewardErr('reward.invalid_purpose', `Unsupported workout purpose: ${String(unexpected)}`);
    }
  }
}

/**
 * Pure PhysicalResult → GameRewardResult conversion.
 * Does not mutate GameState. Repeated calls are not a claim/consume step.
 */
export function convertGameReward(input: ConvertGameRewardInput): RewardOpResult<GameRewardResult> {
  const config = input.configuration ?? GAME_REWARD_CONFIG;
  const configIssues = validateGameRewardConfig(config);
  if (configIssues.length > 0) {
    return rewardErr('reward.invalid_configuration', configIssues[0]!);
  }

  const physicalIssues = validatePhysicalResultForReward(input.physicalResult);
  if (physicalIssues.length > 0) {
    const unsupported = physicalIssues.some((issue) => issue.includes('unsupported'));
    return rewardErr(
      unsupported ? 'reward.unsupported_version' : 'reward.invalid_physical_result',
      physicalIssues[0]!,
    );
  }

  if (input.purpose !== undefined && !isWorkoutPurpose(input.purpose)) {
    return rewardErr('reward.invalid_purpose', 'Workout purpose is invalid');
  }

  const physical = clonePhysicalResult(input.physicalResult);
  const purpose = input.purpose ?? physical.purpose;
  if (!isWorkoutPurpose(purpose)) {
    return rewardErr('reward.invalid_purpose', 'Workout purpose is invalid');
  }
  if (purpose !== physical.purpose) {
    return rewardErr(
      'reward.purpose_mismatch',
      'Requested purpose does not match PhysicalResult.purpose',
      { requested: purpose, physical: physical.purpose },
    );
  }

  const converted = convertByPurpose(purpose, physical, config);
  if (!converted.ok) return converted;
  return rewardOk(cloneGameRewardResult(converted.value));
}
