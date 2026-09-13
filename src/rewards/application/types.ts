/**
 * GAME REWARD APPLICATION (Phase 17H)
 *
 * Consumes an already-converted GameRewardResult and applies it to the
 * canonical GameState. Conversion math stays in 17G; this layer does not
 * re-run PhysicalResult → reward formulas.
 *
 * This is a domain/application API, not a client command. Callers must
 * supply a validated GameRewardResult from convertGameReward. There is no
 * APPLY_REWARD orchestrator endpoint that accepts a fabricated payload.
 */

import { WorkoutPurpose } from '../../fitness/types';
import { GameState } from '../../types/GameState';
import { GAME_REWARD_CONFIG_VERSION, GAME_REWARD_MODEL_VERSION, GameRewardKind } from '../types';

export const REWARD_APPLICATION_MODEL_VERSION = 'reward-application.v1';

export const REWARD_APPLICATION_ERROR_CODES = [
  'reward_application.invalid_reward',
  'reward_application.unsupported_version',
  'reward_application.unauthorized',
  'reward_application.no_player_faction',
  'reward_application.faction_mismatch',
  'reward_application.invalid_mode',
  'reward_application.no_active_invasion',
  'reward_application.invasion_not_owned',
  'reward_application.invasion_already_defended',
  'reward_application.defense_deadline_missed',
  'reward_application.invalid_target',
  'reward_application.unsafe_numeric_value',
  'reward_application.invariant_failed',
] as const;

export type RewardApplicationErrorCode = (typeof REWARD_APPLICATION_ERROR_CODES)[number];

export type RewardApplicationMode = 'banked' | 'live';

export interface RewardApplicationContext {
  /** Must match GameRewardResult.playerId. Not a faction id. */
  playerId: string;
  /**
   * Untrusted if present. Must equal GameState.playerFactionId.
   * The target faction is never taken from this field alone.
   */
  factionId?: string;
  /**
   * NORMAL_TROOPS is banked. Construction, Golden Yield, and Defense
   * are live-action consequences and require `live`.
   */
  mode: RewardApplicationMode;
  /** Required for DEFENSE_MOBILIZATION. Ignored for other kinds. */
  invasionId?: string;
  constructionId?: string;
  collectionTerritoryId?: string;
  /** Authoritative workout-start tick for a future invasion deadline check. */
  workoutStartedAtTick?: number | null;
  /**
   * Optional explicit application identity. Defaults to
   * `sessionId:kind:modelVersion:configVersion`.
   */
  rewardApplicationId?: string;
}

export interface RewardStateChange {
  path: string;
  from: string | number | boolean | null;
  to: string | number | boolean | null;
}

export type AppliedEffectSummary =
  | { kind: 'TROOPS'; amount: number; bankedTroopsAfter: number }
  | {
    kind: 'EXTRA_CONSTRUCTION_WORKERS';
    workerPower: number;
    permanence: 'TEMPORARY_ACCELERATION';
  }
  | {
    kind: 'GOLDEN_YIELD';
    multiplier: number;
    effect: 'ONE_TIME_COLLECTION';
    permanence: 'EPHEMERAL';
    consumed: false;
  }
  | { kind: 'DEFENSE_MOBILIZATION'; defensePower: number; invasionId: string };

export interface RewardApplicationSuccess {
  ok: true;
  alreadyApplied: boolean;
  applicationId: string;
  playerId: string;
  factionId: string;
  kind: GameRewardKind;
  purpose: WorkoutPurpose;
  amountOrEffect: AppliedEffectSummary;
  sourceSessionId: string;
  sourceWorkoutId: string;
  sourcePhysicalOutput: number;
  appliedAtTick: number;
  modelVersion: typeof GAME_REWARD_MODEL_VERSION;
  configVersion: typeof GAME_REWARD_CONFIG_VERSION;
  physicalResultModelVersion: string;
  physicalOutputVersion: string;
  applicationModelVersion: typeof REWARD_APPLICATION_MODEL_VERSION;
  stateChanges: RewardStateChange[];
}

export interface RewardApplicationFailure {
  ok: false;
  alreadyApplied: false;
  code: RewardApplicationErrorCode;
  message: string;
  details?: Record<string, string | number | boolean | null>;
}

export type RewardApplicationResult = RewardApplicationSuccess | RewardApplicationFailure;

export type ApplyGameRewardOutcome =
  | { ok: true; state: GameState; result: RewardApplicationSuccess }
  | { ok: false; state: GameState; result: RewardApplicationFailure };
