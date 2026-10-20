import type { WorkoutSize } from '../fitness/authoring/types';

/** R1 contracts only. No runtime payout or START_WORKOUT caller yet. */
export const COMPLETION_REWARD_UNITS: Readonly<Record<WorkoutSize, number>> = Object.freeze({
  SHORT: 60, STANDARD: 100, LONG: 145,
});
export const SOLDIER_RATIO_SCALE = 1_000_000;
export const WORKOUT_REWARD_POLICY_VERSION = 'workout-soldiers.v1' as const;

export interface WorldWorkoutRewardPolicy {
  readonly version: typeof WORKOUT_REWARD_POLICY_VERSION;
  readonly revision: string;
  /** Soldiers per reward unit, in millionths. No default / approved production value. */
  readonly soldiersPerRewardUnitMicros: number;
}

/** These validators consume authored/persisted JSON data, not executable objects. */
export function contractRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(record, key))
    || actual.some(key => !keys.includes(key))) throw new Error(`Invalid ${label} fields`);
  return record;
}

export function contractId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${label}`);
}

function nonnegativeSafeInteger(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Reward quantities must be nonnegative safe integers');
  }
}

export function validateWorldWorkoutRewardPolicy(value: unknown): asserts value is WorldWorkoutRewardPolicy {
  const record = contractRecord(value, ['version', 'revision', 'soldiersPerRewardUnitMicros'], 'workout reward policy');
  if (record.version !== WORKOUT_REWARD_POLICY_VERSION) throw new Error('Unsupported workout reward policy version');
  contractId(record.revision, 'reward policy revision');
  nonnegativeSafeInteger(record.soldiersPerRewardUnitMicros);
  if (record.soldiersPerRewardUnitMicros === 0) throw new Error('Soldier ratio must be positive');
}

/** Legacy definitions may omit policy. New-policy callers must explicitly require it. */
export function requireWorldWorkoutRewardPolicy(world: { workoutRewards?: WorldWorkoutRewardPolicy }): WorldWorkoutRewardPolicy {
  validateWorldWorkoutRewardPolicy(world.workoutRewards);
  return Object.freeze({ ...world.workoutRewards });
}

/** Positive round-half-up, using exact integer arithmetic before the checked Number conversion. */
export function calculateCompletionSoldiers(rewardUnits: number, ratioMicros: number): number {
  nonnegativeSafeInteger(rewardUnits);
  nonnegativeSafeInteger(ratioMicros);
  if (ratioMicros === 0) throw new Error('Soldier ratio must be positive');
  const result = (BigInt(rewardUnits) * BigInt(ratioMicros) + BigInt(SOLDIER_RATIO_SCALE / 2)) / BigInt(SOLDIER_RATIO_SCALE);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Soldier entitlement exceeds safe integer range');
  return Number(result);
}
