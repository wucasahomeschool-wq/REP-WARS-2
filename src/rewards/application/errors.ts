import { RewardApplicationErrorCode, RewardApplicationFailure } from './types';

export function applicationFailure(
  code: RewardApplicationErrorCode,
  message: string,
  details?: RewardApplicationFailure['details'],
): RewardApplicationFailure {
  return {
    ok: false,
    alreadyApplied: false,
    code,
    message,
    ...(details ? { details } : {}),
  };
}
