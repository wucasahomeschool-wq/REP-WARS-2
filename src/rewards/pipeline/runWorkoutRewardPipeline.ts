/**
 * Internal workout-complete → GameState pipeline (Phase 17I).
 *
 * CompletedWorkoutRecord → FitnessEvidence → PhysicalResult (prescription-time
 * estimate) → GameRewardResult → applyGameReward. Fitness estimate updates are
 * for future workouts only and are not a reward multiplier.
 *
 * Not a client reward-grant command. Reuses 17H application identity.
 */
import { BattleEngine } from '../../battle/BattleEngine';
import { applyFitnessEvaluation, evaluateFitness } from '../../fitness/estimate/evaluator';
import { cloneFitnessEstimate } from '../../fitness/estimate/clone';
import { FitnessEstimate } from '../../fitness/estimate/types';
import { evaluateFitnessEvidence } from '../../fitness/evaluation/evaluator';
import { persistTerminalSessionHistory } from '../../fitness/history/persistSession';
import { fitnessHistoryContextFromStore } from '../../fitness/history/context';
import { WorkoutHistoryStore } from '../../fitness/history/types';
import { calculatePhysicalResult } from '../../fitness/physicalResult/evaluator';
import { finalizeCompletedWorkout } from '../../fitness/session/summary';
import { WorkoutSession } from '../../fitness/session/types';
import { GAMEPLAY_CONFIG } from '../../gameplay/config';
import { resolveInvasionBattle } from '../../gameplay/invasion/resolve';
import { isOpenInvasion } from '../../gameplay/invasion/deadlines';
import { GameState } from '../../types/GameState';
import { applyGameReward } from '../application/apply';
import { resolveRewardApplicationId } from '../application/identity';
import { ApplyGameRewardOutcome, RewardApplicationContext } from '../application/types';
import { convertGameReward } from '../converter';
import { cloneGameRewardResult } from '../validation';

export interface WorkoutPipelineResult {
  ok: boolean;
  alreadyProcessed: boolean;
  state: GameState;
  sessionId: string;
  purpose: WorkoutSession['purpose'];
  physicalOutput?: number;
  application?: ApplyGameRewardOutcome;
  invasionOutcome?: string;
  error?: { code: string; message: string };
}

export interface WorkoutPipelineOptions {
  battle?: BattleEngine;
  history?: WorkoutHistoryStore | null;
}

function contextFromSession(session: WorkoutSession, playerId: string): RewardApplicationContext {
  const live = session.purpose !== 'NORMAL_TROOPS';
  return {
    playerId,
    mode: live ? 'live' : 'banked',
    invasionId: session.gameplayContext?.invasionId,
    constructionId: session.gameplayContext?.constructionId,
    collectionTerritoryId: session.gameplayContext?.collectionTerritoryId,
    workoutStartedAtTick: session.gameplayContext?.startedAtWorldTick ?? null,
  };
}

function adoptGameState(target: GameState, source: GameState): void {
  const dest = target as unknown as Record<string, unknown>;
  const next = source as unknown as Record<string, unknown>;
  for (const key of Object.keys(next)) {
    dest[key] = next[key];
  }
}

function persistFitnessUpdate(
  state: GameState,
  evaluation: FitnessEstimate,
  session: WorkoutSession,
  completedAt: number,
): void {
  state.playerFitness.estimate = evaluation;
  state.playerFitness.lastWorkoutCompletedAtTick = state.worldTick;
  if (!state.playerFitness.compactHistory.some((entry) => entry.sessionId === session.sessionId)) {
    state.playerFitness.compactHistory = [
      ...state.playerFitness.compactHistory,
      {
        sessionId: session.sessionId,
        completedAt,
        completedAtTick: state.worldTick,
        purpose: session.purpose,
      },
    ].slice(-GAMEPLAY_CONFIG.maxFitnessHistoryEntries);
  }
  state.playerFitness.activeSession = null;
  state.playerFitness.pendingReward = null;
}

export function runWorkoutRewardPipeline(
  state: GameState,
  session: WorkoutSession,
  playerId: string,
  options: WorkoutPipelineOptions = {},
): WorkoutPipelineResult {
  if (session.playerId !== playerId) {
    return {
      ok: false,
      alreadyProcessed: false,
      state,
      sessionId: session.sessionId,
      purpose: session.purpose,
      error: { code: 'pipeline.unauthorized', message: 'Session playerId does not match caller' },
    };
  }

  const alreadyApplied = state.playerRewards.appliedRewards.some((record) => record.sessionId === session.sessionId);
  const alreadyEstimated = state.playerFitness.compactHistory.some((entry) => entry.sessionId === session.sessionId);
  if (alreadyApplied && alreadyEstimated) {
    persistTerminalSessionHistory(options.history, session, {
      completedAtWorldTick: state.worldTick,
      rewardApplicationId: state.playerRewards.appliedRewards.find((record) => record.sessionId === session.sessionId)?.applicationId ?? null,
      rewardKind: state.playerRewards.appliedRewards.find((record) => record.sessionId === session.sessionId)?.kind ?? null,
    });
    return {
      ok: true,
      alreadyProcessed: true,
      state,
      sessionId: session.sessionId,
      purpose: session.purpose,
    };
  }

  if (session.purpose === 'DEFENSE') {
    const invasionId = session.gameplayContext?.invasionId;
    const invasion = typeof invasionId === 'string' ? state.activeInvasions.get(invasionId) : undefined;
    if (!invasion || !isOpenInvasion(invasion)) {
      return {
        ok: false,
        alreadyProcessed: false,
        state,
        sessionId: session.sessionId,
        purpose: session.purpose,
        error: {
          code: 'reward_application.no_active_invasion',
          message: 'Defense completion requires a matching open invasion',
        },
      };
    }
    if (invasion.defenseSessionId && invasion.defenseSessionId !== session.sessionId) {
      return {
        ok: false,
        alreadyProcessed: false,
        state,
        sessionId: session.sessionId,
        purpose: session.purpose,
        error: {
          code: 'reward_application.invasion_not_owned',
          message: 'Defense session does not match the invasion defense workout',
        },
      };
    }
  }

  const finalized = finalizeCompletedWorkout(session);
  if (!finalized.ok) {
    return {
      ok: false,
      alreadyProcessed: false,
      state,
      sessionId: session.sessionId,
      purpose: session.purpose,
      error: { code: finalized.error.code, message: finalized.error.message },
    };
  }
  const record = finalized.value;

  const evidenceResult = evaluateFitnessEvidence(record);
  if (!evidenceResult.ok) {
    return {
      ok: false,
      alreadyProcessed: false,
      state,
      sessionId: session.sessionId,
      purpose: session.purpose,
      error: { code: evidenceResult.error.code, message: evidenceResult.error.message },
    };
  }
  const evidence = evidenceResult.value;
  const prescriptionEstimate = state.playerFitness.estimate
    ? cloneFitnessEstimate(state.playerFitness.estimate)
    : null;

  const physical = calculatePhysicalResult({
    completedWorkout: record,
    evidence,
    context: prescriptionEstimate
      ? {
        fitnessEstimate: prescriptionEstimate,
        fitnessLevelAtPrescription: prescriptionEstimate.level,
        confidenceAtPrescription: prescriptionEstimate.confidence,
      }
      : {},
  });
  if (!physical.ok) {
    return {
      ok: false,
      alreadyProcessed: false,
      state,
      sessionId: session.sessionId,
      purpose: session.purpose,
      error: { code: physical.error.code, message: physical.error.message },
    };
  }

  const historicalContext = options.history
    ? fitnessHistoryContextFromStore(options.history, playerId, evidence.completedAt, session.sessionId)
    : { now: evidence.completedAt };
  const fitnessUpdate = evaluateFitness({
    previousEstimate: prescriptionEstimate,
    currentEvidence: evidence,
    historicalContext,
  });
  if (!fitnessUpdate.ok) {
    return {
      ok: false,
      alreadyProcessed: false,
      state,
      sessionId: session.sessionId,
      purpose: session.purpose,
      error: { code: fitnessUpdate.error.code, message: fitnessUpdate.error.message },
    };
  }
  const nextEstimate = applyFitnessEvaluation(prescriptionEstimate, fitnessUpdate.value, evidence.completedAt);
  if (!nextEstimate.ok) {
    return {
      ok: false,
      alreadyProcessed: false,
      state,
      sessionId: session.sessionId,
      purpose: session.purpose,
      error: { code: nextEstimate.error.code, message: nextEstimate.error.message },
    };
  }

  const converted = convertGameReward({ physicalResult: physical.value });
  if (!converted.ok) {
    return {
      ok: false,
      alreadyProcessed: false,
      state,
      sessionId: session.sessionId,
      purpose: session.purpose,
      error: { code: converted.error.code, message: converted.error.message },
    };
  }

  const pending = state.playerFitness.pendingReward;
  const reward = pending && pending.sessionId === session.sessionId
    ? pending.reward
    : converted.value;
  const context = pending && pending.sessionId === session.sessionId
    ? pending.context
    : contextFromSession(session, playerId);

  const applied = applyGameReward(state, reward, context);
  const applicationId = resolveRewardApplicationId(reward, context);

  if (!applied.ok) {
    state.playerFitness.activeSession = session;
    state.playerFitness.pendingReward = {
      sessionId: session.sessionId,
      reward: cloneGameRewardResult(converted.value),
      context,
    };
    persistTerminalSessionHistory(options.history, session, {
      completedAtWorldTick: state.worldTick,
      evidence,
      physicalResult: physical.value,
      rewardKind: reward.kind,
      rewardApplicationId: applicationId,
    });
    return {
      ok: false,
      alreadyProcessed: false,
      state,
      sessionId: session.sessionId,
      purpose: session.purpose,
      application: applied,
      physicalOutput: physical.value.totalPhysicalOutput,
      error: { code: applied.result.code, message: applied.result.message },
    };
  }

  if (applied.state !== state) {
    adoptGameState(state, applied.state);
  }

  if (!alreadyEstimated) {
    persistFitnessUpdate(state, nextEstimate.value, session, record.completedAt);
  } else {
    state.playerFitness.activeSession = null;
    state.playerFitness.pendingReward = null;
  }

  let invasionOutcome: string | undefined;
  if (
    session.purpose === 'DEFENSE'
    && context.invasionId
    && options.battle
    && !applied.result.alreadyApplied
  ) {
    const live = state.activeInvasions.get(context.invasionId);
    if (live && isOpenInvasion(live)) {
      const resolved = resolveInvasionBattle(state, options.battle, context.invasionId, 'defense_battle');
      invasionOutcome = String(resolved.payload.invasionOutcome ?? '');
    }
  }

  persistTerminalSessionHistory(options.history, session, {
    completedAtWorldTick: state.worldTick,
    evidence,
    physicalResult: physical.value,
    rewardKind: reward.kind,
    rewardApplicationId: applied.result.applicationId,
  });

  return {
    ok: true,
    alreadyProcessed: applied.result.alreadyApplied === true,
    state,
    sessionId: session.sessionId,
    purpose: session.purpose,
    physicalOutput: physical.value.totalPhysicalOutput,
    application: applied,
    invasionOutcome,
  };
}

/**
 * Retry a persisted pending reward after reload. Uses the existing
 * application identity so a successful grant cannot duplicate.
 */
export function retryPendingWorkoutReward(
  state: GameState,
  playerId: string,
  options: WorkoutPipelineOptions = {},
): WorkoutPipelineResult | null {
  const pending = state.playerFitness.pendingReward;
  if (!pending) return null;
  const session = state.playerFitness.activeSession
    && state.playerFitness.activeSession.sessionId === pending.sessionId
    ? state.playerFitness.activeSession
    : null;
  if (!session) {
    const applied = applyGameReward(state, pending.reward, pending.context);
    if (applied.ok && applied.state !== state) {
      adoptGameState(state, applied.state);
    }
    if (applied.ok) {
      state.playerFitness.pendingReward = null;
      if (state.playerFitness.activeSession?.sessionId === pending.sessionId) {
        state.playerFitness.activeSession = null;
      }
    }
    return {
      ok: applied.ok,
      alreadyProcessed: applied.ok && applied.result.alreadyApplied === true,
      state,
      sessionId: pending.sessionId,
      purpose: pending.reward.purpose,
      application: applied,
      error: applied.ok ? undefined : { code: applied.result.code, message: applied.result.message },
    };
  }
  return runWorkoutRewardPipeline(state, session, playerId, options);
}
