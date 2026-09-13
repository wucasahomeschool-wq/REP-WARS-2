import { GameRewardResult } from '../types';
import { RewardApplicationContext } from './types';

export function resolveRewardApplicationId(
  reward: GameRewardResult,
  context: RewardApplicationContext,
): string {
  if (typeof context.rewardApplicationId === 'string' && context.rewardApplicationId.trim() !== '') {
    return context.rewardApplicationId;
  }
  return `${reward.sessionId}:${reward.kind}:${reward.modelVersion}:${reward.configVersion}`;
}
