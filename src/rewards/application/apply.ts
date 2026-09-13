/**
 * Authoritative GameRewardResult → GameState application.
 *
 * Uses `runStateTransaction` (clone → mutate → invariants → commit).
 * Business-rule failures return the original state unchanged.
 * Fitness code and 17G conversion are not invoked here.
 */
import { ErrorCode, OrchestrationError } from '../../orchestration/errors';
import { runStateTransaction } from '../../orchestration/transaction';
import { AppliedRewardRecord, GameState } from '../../types/GameState';
import {
  ConstructionWorkerReward,
  DefenseMobilizationReward,
  GameRewardResult,
  GoldenYieldReward,
  TroopReward,
} from '../types';
import { authorizeRewardApplication } from './authorization';
import { addPendingConstructionEffect } from './construction';
import { attachDefenseMobilization, findInvasionForDefense } from './defense';
import { applicationFailure } from './errors';
import { addPendingGoldenYieldEffect } from './goldenYield';
import { resolveRewardApplicationId } from './identity';
import { addBankedTroops } from './troops';
import {
  ApplyGameRewardOutcome,
  REWARD_APPLICATION_MODEL_VERSION,
  RewardApplicationContext,
  RewardApplicationSuccess,
} from './types';
import { validateApplicationContext, validateGameRewardForApplication } from './validation';

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function findAppliedRecord(state: GameState, applicationId: string): AppliedRewardRecord | undefined {
  return state.playerRewards.appliedRewards.find((record) => record.applicationId === applicationId);
}

function restoreAlreadyApplied(record: AppliedRewardRecord): RewardApplicationSuccess {
  const snapshot = jsonClone(record.result) as unknown as RewardApplicationSuccess;
  return { ...snapshot, alreadyApplied: true, ok: true };
}

function persistSuccess(result: RewardApplicationSuccess): Record<string, unknown> {
  return jsonClone({ ...result, alreadyApplied: false }) as Record<string, unknown>;
}

function recordApplication(draft: GameState, result: RewardApplicationSuccess): void {
  draft.playerRewards.appliedRewards.push({
    applicationId: result.applicationId,
    sessionId: result.sourceSessionId,
    kind: result.kind,
    appliedAtTick: result.appliedAtTick,
    result: persistSuccess(result),
  });
}

function fail(state: GameState, failure: ApplyGameRewardOutcome['result'] & { ok: false }): ApplyGameRewardOutcome {
  return { ok: false, state, result: failure };
}

function applyTroops(
  draft: GameState,
  reward: TroopReward,
  factionId: string,
  applicationId: string,
): RewardApplicationSuccess {
  const { from, to } = addBankedTroops(draft, reward.amount);
  return successBase(draft, reward, factionId, applicationId, {
    kind: 'TROOPS',
    amount: reward.amount,
    bankedTroopsAfter: to,
  }, [{ path: 'playerRewards.bankedTroops', from, to }]);
}

function applyConstruction(
  draft: GameState,
  reward: ConstructionWorkerReward,
  factionId: string,
  applicationId: string,
): RewardApplicationSuccess {
  const { from, to } = addPendingConstructionEffect(draft, {
    applicationId,
    sessionId: reward.sessionId,
    workoutId: reward.workoutId,
    playerId: reward.playerId,
    workerPower: reward.workerPower,
    permanence: 'TEMPORARY_ACCELERATION',
    appliedAtTick: draft.worldTick,
    sourcePhysicalOutput: reward.sourcePhysicalOutput,
  });
  return successBase(draft, reward, factionId, applicationId, {
    kind: 'EXTRA_CONSTRUCTION_WORKERS',
    workerPower: reward.workerPower,
    permanence: 'TEMPORARY_ACCELERATION',
  }, [{ path: 'playerRewards.pendingConstructionEffects.length', from, to }]);
}

function applyGoldenYield(
  draft: GameState,
  reward: GoldenYieldReward,
  factionId: string,
  applicationId: string,
): RewardApplicationSuccess {
  const { from, to } = addPendingGoldenYieldEffect(draft, {
    applicationId,
    sessionId: reward.sessionId,
    workoutId: reward.workoutId,
    playerId: reward.playerId,
    multiplier: reward.multiplier,
    effect: 'ONE_TIME_COLLECTION',
    permanence: 'EPHEMERAL',
    consumed: false,
    appliedAtTick: draft.worldTick,
    sourcePhysicalOutput: reward.sourcePhysicalOutput,
  });
  return successBase(draft, reward, factionId, applicationId, {
    kind: 'GOLDEN_YIELD',
    multiplier: reward.multiplier,
    effect: 'ONE_TIME_COLLECTION',
    permanence: 'EPHEMERAL',
    consumed: false,
  }, [{ path: 'playerRewards.pendingGoldenYieldEffects.length', from, to }]);
}

function applyDefense(
  draft: GameState,
  reward: DefenseMobilizationReward,
  factionId: string,
  applicationId: string,
  invasionId: string,
  workoutStartedAtTick: number | null,
): RewardApplicationSuccess {
  attachDefenseMobilization(draft, invasionId, reward, applicationId, workoutStartedAtTick);
  return successBase(draft, reward, factionId, applicationId, {
    kind: 'DEFENSE_MOBILIZATION',
    defensePower: reward.defensePower,
    invasionId,
  }, [{
    path: `activeInvasions.${invasionId}.defenseMobilization.defensePower`,
    from: null,
    to: reward.defensePower,
  }]);
}

function successBase(
  draft: GameState,
  reward: GameRewardResult,
  factionId: string,
  applicationId: string,
  amountOrEffect: RewardApplicationSuccess['amountOrEffect'],
  stateChanges: RewardApplicationSuccess['stateChanges'],
): RewardApplicationSuccess {
  return {
    ok: true,
    alreadyApplied: false,
    applicationId,
    playerId: reward.playerId,
    factionId,
    kind: reward.kind,
    purpose: reward.purpose,
    amountOrEffect,
    sourceSessionId: reward.sessionId,
    sourceWorkoutId: reward.workoutId,
    sourcePhysicalOutput: reward.sourcePhysicalOutput,
    appliedAtTick: draft.worldTick,
    modelVersion: reward.modelVersion,
    configVersion: reward.configVersion,
    physicalResultModelVersion: reward.physicalResultModelVersion,
    physicalOutputVersion: reward.physicalOutputVersion,
    applicationModelVersion: REWARD_APPLICATION_MODEL_VERSION,
    stateChanges,
  };
}

function applyToDraft(
  draft: GameState,
  reward: GameRewardResult,
  context: RewardApplicationContext,
  factionId: string,
  applicationId: string,
): RewardApplicationSuccess {
  let result: RewardApplicationSuccess;
  switch (reward.kind) {
    case 'TROOPS':
      result = applyTroops(draft, reward, factionId, applicationId);
      break;
    case 'EXTRA_CONSTRUCTION_WORKERS':
      result = applyConstruction(draft, reward, factionId, applicationId);
      break;
    case 'GOLDEN_YIELD':
      result = applyGoldenYield(draft, reward, factionId, applicationId);
      break;
    case 'DEFENSE_MOBILIZATION':
      result = applyDefense(
        draft,
        reward,
        factionId,
        applicationId,
        context.invasionId!,
        context.workoutStartedAtTick ?? null,
      );
      break;
    default: {
      const unexpected: never = reward;
      throw new Error(`Unsupported reward kind: ${String(unexpected)}`);
    }
  }
  recordApplication(draft, result);
  return result;
}

export function applyGameReward(
  gameState: GameState,
  reward: GameRewardResult,
  context: RewardApplicationContext,
): ApplyGameRewardOutcome {
  const rewardFailure = validateGameRewardForApplication(reward);
  if (rewardFailure) return fail(gameState, rewardFailure);

  const contextFailure = validateApplicationContext(reward, context);
  if (contextFailure) return fail(gameState, contextFailure);

  const auth = authorizeRewardApplication(gameState, reward, context);
  if (!auth.ok) return fail(gameState, auth.failure);

  const applicationId = resolveRewardApplicationId(reward, context);
  const existing = findAppliedRecord(gameState, applicationId);
  if (existing) {
    return { ok: true, state: gameState, result: restoreAlreadyApplied(existing) };
  }

  if (reward.kind === 'TROOPS') {
    const next = gameState.playerRewards.bankedTroops + reward.amount;
    if (!Number.isSafeInteger(next)) {
      return fail(gameState, applicationFailure(
        'reward_application.unsafe_numeric_value',
        'Applying this troop reward would overflow safe integer storage',
      ));
    }
  }

  if (reward.kind === 'DEFENSE_MOBILIZATION') {
    const invasion = findInvasionForDefense(gameState, context, auth.factionId);
    if (!invasion.ok) return fail(gameState, invasion.failure);
  }

  try {
    const tx = runStateTransaction(gameState, (draft) => (
      applyToDraft(draft, reward, context, auth.factionId, applicationId)
    ));
    return { ok: true, state: tx.state, result: tx.result };
  } catch (err) {
    if (err instanceof OrchestrationError && err.code === ErrorCode.INVALID_GAME_STATE) {
      return fail(gameState, applicationFailure(
        'reward_application.invariant_failed',
        err.message,
      ));
    }
    throw err;
  }
}
