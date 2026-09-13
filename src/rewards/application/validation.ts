import { isRecord } from '../../fitness/guards';
import { PHYSICAL_OUTPUT_VERSION, PHYSICAL_RESULT_MODEL_VERSION } from '../../fitness/physicalResult';
import { GAME_REWARD_CONFIG } from '../config';
import {
  GAME_REWARD_CONFIG_VERSION,
  GAME_REWARD_KINDS,
  GAME_REWARD_MODEL_VERSION,
  GameRewardKind,
  GameRewardResult,
} from '../types';
import { applicationFailure } from './errors';
import { RewardApplicationContext, RewardApplicationFailure, RewardApplicationMode } from './types';

const KIND_PURPOSE: Record<GameRewardKind, GameRewardResult['purpose']> = {
  TROOPS: 'NORMAL_TROOPS',
  EXTRA_CONSTRUCTION_WORKERS: 'EXTRA_CONSTRUCTION_WORKERS',
  GOLDEN_YIELD: 'GOLDEN_YIELD',
  DEFENSE_MOBILIZATION: 'DEFENSE',
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function unsupported(message: string, details?: RewardApplicationFailure['details']): RewardApplicationFailure {
  return applicationFailure('reward_application.unsupported_version', message, details);
}

function invalid(message: string, details?: RewardApplicationFailure['details']): RewardApplicationFailure {
  return applicationFailure('reward_application.invalid_reward', message, details);
}

/**
 * Validates a GameRewardResult as already-converted data.
 * Rejects fabricated/malformed payloads. Does not re-run conversion math.
 */
export function validateGameRewardForApplication(raw: unknown): RewardApplicationFailure | null {
  if (!isRecord(raw)) return invalid('GameRewardResult must be an object');

  if (raw.modelVersion !== GAME_REWARD_MODEL_VERSION) {
    return unsupported('Unsupported game-reward modelVersion', { modelVersion: String(raw.modelVersion) });
  }
  if (raw.configVersion !== GAME_REWARD_CONFIG_VERSION) {
    return unsupported('Unsupported game-reward-config version', { configVersion: String(raw.configVersion) });
  }
  if (raw.physicalResultModelVersion !== PHYSICAL_RESULT_MODEL_VERSION) {
    return unsupported('Unsupported physical-result modelVersion', {
      physicalResultModelVersion: String(raw.physicalResultModelVersion),
    });
  }
  if (raw.physicalOutputVersion !== PHYSICAL_OUTPUT_VERSION) {
    return unsupported('Unsupported physical-output version', {
      physicalOutputVersion: String(raw.physicalOutputVersion),
    });
  }

  if (!isNonEmptyString(raw.playerId)) return invalid('playerId is invalid');
  if (!isNonEmptyString(raw.sessionId)) return invalid('sessionId is invalid');
  if (!isNonEmptyString(raw.workoutId)) return invalid('workoutId is invalid');
  if (!isFiniteNumber(raw.sourcePhysicalOutput) || raw.sourcePhysicalOutput < 0) {
    return invalid('sourcePhysicalOutput must be a finite non-negative number');
  }
  if (!GAME_REWARD_KINDS.includes(raw.kind as GameRewardKind)) {
    return invalid('kind is invalid');
  }

  const kind = raw.kind as GameRewardKind;
  if (raw.purpose !== KIND_PURPOSE[kind]) {
    return invalid('kind/purpose pairing is invalid', {
      kind,
      purpose: String(raw.purpose),
    });
  }

  if (kind === 'TROOPS') {
    if (!Number.isSafeInteger(raw.amount) || (raw.amount as number) < 0) {
      return applicationFailure(
        'reward_application.unsafe_numeric_value',
        'TROOPS amount must be a non-negative safe integer',
      );
    }
    if ((raw.amount as number) > GAME_REWARD_CONFIG.maxTroopsPerWorkout) {
      return invalid('TROOPS amount exceeds conversion maximum', { amount: raw.amount as number });
    }
  }

  if (kind === 'EXTRA_CONSTRUCTION_WORKERS') {
    if (!isFiniteNumber(raw.workerPower) || raw.workerPower < 0) {
      return applicationFailure(
        'reward_application.unsafe_numeric_value',
        'workerPower must be a finite non-negative number',
      );
    }
    if (raw.workerPower > GAME_REWARD_CONFIG.maxWorkerPowerPerWorkout) {
      return invalid('workerPower exceeds conversion maximum', { workerPower: raw.workerPower });
    }
    if (raw.permanence !== 'TEMPORARY_ACCELERATION') {
      return invalid('construction reward must be a temporary acceleration');
    }
  }

  if (kind === 'GOLDEN_YIELD') {
    if (!isFiniteNumber(raw.multiplier) || raw.multiplier < 0) {
      return applicationFailure(
        'reward_application.unsafe_numeric_value',
        'Golden Yield multiplier must be a finite non-negative number',
      );
    }
    if (raw.multiplier < GAME_REWARD_CONFIG.goldenYieldZeroOutputMultiplier
      || raw.multiplier > GAME_REWARD_CONFIG.goldenYieldMaxMultiplier) {
      return invalid('Golden Yield multiplier is outside the conversion bounds', { multiplier: raw.multiplier });
    }
    if (raw.effect !== 'ONE_TIME_COLLECTION' || raw.permanence !== 'EPHEMERAL') {
      return invalid('Golden Yield must be a one-time ephemeral collection effect');
    }
  }

  if (kind === 'DEFENSE_MOBILIZATION') {
    if (!isFiniteNumber(raw.defensePower) || raw.defensePower < 0) {
      return applicationFailure(
        'reward_application.unsafe_numeric_value',
        'defensePower must be a finite non-negative number',
      );
    }
    if (raw.defensePower > GAME_REWARD_CONFIG.maxDefensePowerPerWorkout) {
      return invalid('defensePower exceeds conversion maximum', { defensePower: raw.defensePower });
    }
  }

  return null;
}

export function validateApplicationContext(
  reward: GameRewardResult,
  context: RewardApplicationContext,
): RewardApplicationFailure | null {
  const mode: RewardApplicationMode | undefined = context.mode;
  if (mode !== 'banked' && mode !== 'live') {
    return applicationFailure('reward_application.invalid_mode', 'Application mode must be banked or live');
  }

  if (reward.kind === 'TROOPS' && mode !== 'banked') {
    return applicationFailure(
      'reward_application.invalid_mode',
      'NORMAL_TROOPS rewards are banked and cannot be applied as a live action',
    );
  }
  if (reward.kind !== 'TROOPS' && mode !== 'live') {
    return applicationFailure(
      'reward_application.invalid_mode',
      'Construction, Golden Yield, and Defense rewards require a live workout context',
    );
  }

  if (reward.kind === 'DEFENSE_MOBILIZATION') {
    if (!isNonEmptyString(context.invasionId)) {
      return applicationFailure(
        'reward_application.no_active_invasion',
        'DEFENSE rewards require an active invasion id',
      );
    }
  }

  if (context.workoutStartedAtTick !== undefined && context.workoutStartedAtTick !== null) {
    if (!Number.isInteger(context.workoutStartedAtTick) || context.workoutStartedAtTick < 0) {
      return applicationFailure(
        'reward_application.invalid_reward',
        'workoutStartedAtTick must be a non-negative integer or null',
      );
    }
  }

  if (context.rewardApplicationId !== undefined && !isNonEmptyString(context.rewardApplicationId)) {
    return applicationFailure('reward_application.invalid_reward', 'rewardApplicationId is invalid');
  }

  return null;
}

export function isGameRewardResult(raw: unknown): raw is GameRewardResult {
  return validateGameRewardForApplication(raw) === null;
}
