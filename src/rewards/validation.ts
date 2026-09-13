import { isRecord } from '../fitness/guards';
import { isWorkoutPurpose } from '../fitness/purpose';
import { PHYSICAL_OUTPUT_VERSION, PHYSICAL_RESULT_MODEL_VERSION, PhysicalResult } from '../fitness/physicalResult';
import { GAME_REWARD_CONFIG, GameRewardConfig } from './config';
import { GameRewardResult } from './types';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validateGameRewardConfig(raw: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(raw)) return ['Game reward configuration must be an object'];
  for (const key of Object.keys(GAME_REWARD_CONFIG) as (keyof GameRewardConfig)[]) {
    if (!(key in raw)) issues.push(`${String(key)} is required`);
  }
  const numericKeys: (keyof GameRewardConfig)[] = [
    'troopsPerPhysicalUnit',
    'maxTroopsPerWorkout',
    'workersPerPhysicalUnit',
    'maxWorkerPowerPerWorkout',
    'goldenYieldMinMultiplier',
    'goldenYieldMaxMultiplier',
    'goldenYieldHalfSaturationOutput',
    'goldenYieldZeroOutputMultiplier',
    'defensePerPhysicalUnit',
    'maxDefensePowerPerWorkout',
  ];
  for (const key of numericKeys) {
    if (!isFiniteNumber(raw[key]) || (raw[key] as number) < 0) {
      issues.push(`${String(key)} must be a finite number >= 0`);
    }
  }
  if (
    isFiniteNumber(raw.goldenYieldMinMultiplier)
    && isFiniteNumber(raw.goldenYieldMaxMultiplier)
    && raw.goldenYieldMinMultiplier > raw.goldenYieldMaxMultiplier
  ) {
    issues.push('goldenYieldMinMultiplier must be <= goldenYieldMaxMultiplier');
  }
  if (raw.modelVersion !== GAME_REWARD_CONFIG.modelVersion) issues.push('modelVersion is invalid');
  if (raw.configVersion !== GAME_REWARD_CONFIG.configVersion) issues.push('configVersion is invalid');
  return issues;
}

export function validatePhysicalResultForReward(raw: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(raw)) return ['PhysicalResult must be an object'];
  if (raw.modelVersion !== PHYSICAL_RESULT_MODEL_VERSION) {
    issues.push('PhysicalResult modelVersion is unsupported');
  }
  if (raw.outputVersion !== PHYSICAL_OUTPUT_VERSION) {
    issues.push('PhysicalResult outputVersion is unsupported');
  }
  if (typeof raw.playerId !== 'string' || raw.playerId.trim() === '') issues.push('playerId is invalid');
  if (typeof raw.sessionId !== 'string' || raw.sessionId.trim() === '') issues.push('sessionId is invalid');
  if (typeof raw.workoutId !== 'string' || raw.workoutId.trim() === '') issues.push('workoutId is invalid');
  if (!isWorkoutPurpose(raw.purpose)) issues.push('purpose is invalid');
  if (!isFiniteNumber(raw.totalPhysicalOutput) || raw.totalPhysicalOutput < 0) {
    issues.push('totalPhysicalOutput must be a finite non-negative number');
  }
  if ('troops' in raw || 'goldenYield' in raw || 'constructionWorkers' in raw || 'defensePower' in raw) {
    issues.push('PhysicalResult must remain reward-neutral');
  }
  if ('fitnessScore' in raw || 'physicalScore' in raw) {
    issues.push('PhysicalResult must not contain a score field');
  }
  return issues;
}

export function isPhysicalResultForReward(raw: unknown): raw is PhysicalResult {
  return validatePhysicalResultForReward(raw).length === 0;
}

export function cloneGameRewardResult(result: GameRewardResult): GameRewardResult {
  return JSON.parse(JSON.stringify(result)) as GameRewardResult;
}
