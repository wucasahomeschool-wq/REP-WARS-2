export const GAME_REWARD_ERROR_CODES = [
  'reward.invalid_purpose',
  'reward.purpose_mismatch',
  'reward.invalid_physical_result',
  'reward.invalid_configuration',
  'reward.unsupported_version',
] as const;

export type GameRewardErrorCode = (typeof GAME_REWARD_ERROR_CODES)[number];

export interface GameRewardError {
  code: GameRewardErrorCode;
  message: string;
  details?: Record<string, string | number | boolean | null>;
}

export type RewardOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: GameRewardError };

export function rewardOk<T>(value: T): RewardOpResult<T> {
  return { ok: true, value };
}

export function rewardErr<T = never>(
  code: GameRewardErrorCode,
  message: string,
  details?: GameRewardError['details'],
): RewardOpResult<T> {
  return { ok: false, error: { code, message, details } };
}
