/**
 * GAME REWARD CONVERSION (Phase 17G)
 *
 * Interprets a neutral PhysicalResult plus WorkoutPurpose into one
 * GameRewardResult. This module does not mutate GameState, collect
 * resources, bank troops, or call BattleEngine.
 *
 * Conversion is a pure calculation. Claiming/application is Phase 17H
 * (`applyGameReward`). Calling convertGameReward twice is not a
 * double-claim.
 */

import { WorkoutDifficulty, WorkoutId, WorkoutPurpose } from '../fitness/types';
import { WorkoutSessionId } from '../fitness/session/types';

export const GAME_REWARD_MODEL_VERSION = 'game-reward.v1';
export const GAME_REWARD_CONFIG_VERSION = 'game-reward-config.v1';

export const GAME_REWARD_KINDS = [
  'TROOPS',
  'EXTRA_CONSTRUCTION_WORKERS',
  'GOLDEN_YIELD',
  'DEFENSE_MOBILIZATION',
] as const;
export type GameRewardKind = (typeof GAME_REWARD_KINDS)[number];

export interface GameRewardBase {
  modelVersion: typeof GAME_REWARD_MODEL_VERSION;
  configVersion: typeof GAME_REWARD_CONFIG_VERSION;
  playerId: string;
  sessionId: WorkoutSessionId;
  workoutId: WorkoutId;
  sourcePhysicalOutput: number;
  physicalResultModelVersion: string;
  physicalOutputVersion: string;
  intendedDifficulty: WorkoutDifficulty;
  completedAt: number;
  conversionNotes: string[];
}

export interface TroopReward extends GameRewardBase {
  kind: 'TROOPS';
  purpose: 'NORMAL_TROOPS';
  /** Integer banked-troop grant. Not applied to GameState in 17G. */
  amount: number;
}

export interface ConstructionWorkerReward extends GameRewardBase {
  kind: 'EXTRA_CONSTRUCTION_WORKERS';
  purpose: 'EXTRA_CONSTRUCTION_WORKERS';
  /** Temporary construction acceleration capacity. Not military troops. */
  workerPower: number;
  permanence: 'TEMPORARY_ACCELERATION';
}

export interface GoldenYieldReward extends GameRewardBase {
  kind: 'GOLDEN_YIELD';
  purpose: 'GOLDEN_YIELD';
  /** One-time collection enhancement. Not a lasting economy modifier. */
  multiplier: number;
  effect: 'ONE_TIME_COLLECTION';
  permanence: 'EPHEMERAL';
}

export interface DefenseMobilizationReward extends GameRewardBase {
  kind: 'DEFENSE_MOBILIZATION';
  purpose: 'DEFENSE';
  /** Fresh defensive mobilization. Never banked offensive troops. */
  defensePower: number;
}

export type GameRewardResult =
  | TroopReward
  | ConstructionWorkerReward
  | GoldenYieldReward
  | DefenseMobilizationReward;

export interface ConvertGameRewardInput {
  physicalResult: import('../fitness/physicalResult/types').PhysicalResult;
  /** Must match PhysicalResult.purpose when provided. */
  purpose?: WorkoutPurpose;
  configuration?: import('./config').GameRewardConfig;
}
