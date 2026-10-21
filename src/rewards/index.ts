export {
  GAME_REWARD_MODEL_VERSION,
  GAME_REWARD_CONFIG_VERSION,
  GAME_REWARD_KINDS,
} from './types';
export type {
  GameRewardKind,
  GameRewardBase,
  TroopReward,
  ConstructionWorkerReward,
  GoldenYieldReward,
  DefenseMobilizationReward,
  GameRewardResult,
  ConvertGameRewardInput,
} from './types';

export {
  GAME_REWARD_CONFIG,
  roundReward,
  clampReward,
} from './config';
export type { GameRewardConfig } from './config';

export {
  GAME_REWARD_ERROR_CODES,
} from './errors';
export type {
  GameRewardErrorCode,
  GameRewardError,
  RewardOpResult,
} from './errors';

export {
  validateGameRewardConfig,
  validatePhysicalResultForReward,
  cloneGameRewardResult,
} from './validation';

export {
  convertTroops,
  convertConstructionWorkers,
  convertGoldenYield,
  convertDefense,
} from './conversions';

export { convertGameReward } from './converter';

export {
  applyGameReward,
  authorizeRewardApplication,
  resolveRewardApplicationId,
  validateGameRewardForApplication,
  REWARD_APPLICATION_MODEL_VERSION,
  REWARD_APPLICATION_ERROR_CODES,
} from './application';
export type {
  RewardApplicationContext,
  RewardApplicationMode,
  RewardApplicationResult,
  RewardApplicationSuccess,
  RewardApplicationFailure,
  RewardApplicationErrorCode,
  ApplyGameRewardOutcome,
  AppliedEffectSummary,
  RewardStateChange,
} from './application';

export { retryPendingWorkoutReward, runWorkoutRewardPipeline } from './pipeline/runWorkoutRewardPipeline';
export type { WorkoutRewardView } from './workoutRewardView';
export type { WorkoutPipelineResult, WorkoutPipelineOptions } from './pipeline/runWorkoutRewardPipeline';
export {
  COMPLETION_REWARD_UNITS, SOLDIER_RATIO_SCALE, WORKOUT_REWARD_POLICY_VERSION,
  calculateCompletionSoldiers, requireWorldWorkoutRewardPolicy, validateWorldWorkoutRewardPolicy,
} from './completionPolicy';
export type { WorldWorkoutRewardPolicy } from './completionPolicy';
export {
  COMPLETION_ENTITLEMENT_VERSION, completionEntitlementId, createCompletionRewardEntitlement,
  cloneCompletionRewardEntitlement, validateCompletionRewardEntitlement, workoutCompletionRewardMode,
} from './completionEntitlement';
export type { CompletionRewardEntitlement } from './completionEntitlement';
