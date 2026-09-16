import { getWorkoutDefinition } from '../fitness/catalog';
import { isWorkoutDifficulty } from '../fitness/difficulty';
import { isWorkoutPurpose } from '../fitness/purpose';
import { selectedWorkoutIdForPurpose } from '../fitness/selection';
import {
  beginWorkoutSession,
  completeExercise,
  isEligibleForFitnessEvaluation,
  isWorkoutFeedbackValue,
  skipExercise,
  submitWorkoutFeedback,
  abandonWorkoutSession,
  pauseWorkoutSession,
  resumeWorkoutSession,
  recordIntegrityFlag,
  INTEGRITY_FLAG_TYPES,
} from '../fitness/session';
import type { IntegrityFlagType } from '../fitness/session';
import { WorkoutPurpose } from '../fitness/types';
import { persistTerminalSessionHistory } from '../fitness/history/persistSession';
import { startConstruction, consumeConstructionEffect } from '../gameplay/construction/consume';
import { isConstructionProjectType } from '../gameplay/construction/definitions';
import { handlerResultForConstructionStart } from '../gameplay/construction/handlerResult';
import { cloneResources } from '../gameplay/economy/config';
import { collectTerritoryYield } from '../gameplay/economy/collect';
import { isDeadlineElapsed, isOpenInvasion } from '../gameplay/invasion/deadlines';
import { playerFacingTick } from '../gameplay/invasion/eligibility';
import { setPlayerEmpirePause } from '../gameplay/invasion/pause';
import { resolveInvasionBattle } from '../gameplay/invasion/resolve';
import { attachDefenseWorkoutToInvasion } from '../gameplay/invasion/session';
import {
  assertLevel1TutorialWorkoutAllowed,
  shouldWaiveWorkoutFeedback,
} from '../gameplay/tutorial/level1';
import {
  resolveStartWorkoutId,
  serializeWorkoutSelectionView,
} from '../gameplay/workoutSelection';
import { runWorkoutRewardPipeline } from '../rewards/pipeline/runWorkoutRewardPipeline';
import { GameState } from '../types/GameState';
import { OrchestrationError, ErrorCode, type OrchestrationErrorBody } from './errors';
import {
  paramNumber,
  paramString,
  recordAllResourceChanges,
  requireFactionSnapshot,
  requireString,
  requireTerritory,
  resolveActingFactionId,
} from './helpers';
import { CommandDefinition, CommandRequest, HandlerResult } from './protocol';
import { EngineRegistry } from './engineRegistry';

interface GameplayHandlerContext {
  req: CommandRequest;
  def: CommandDefinition;
  registry: EngineRegistry;
}

function emptyResult(): HandlerResult {
  return {
    stateChanges: [],
    events: [],
    notifications: [],
    presentation: null,
    resourcesChanged: [],
    territoriesChanged: [],
    armiesChanged: [],
    newlyAvailableActions: [],
    payload: {},
  };
}

function sessionNow(state: GameState, ctx: GameplayHandlerContext): number {
  return paramNumber(ctx.req, 'now') ?? state.worldTick * 60_000;
}

function applyFirstWorkoutFeedbackWaiver(state: GameState, session: typeof state.playerFitness.activeSession): typeof session {
  if (!session) return session;
  if (session.state !== 'COMPLETED') return session;
  if (session.feedbackState !== 'FEEDBACK_REQUIRED') return session;
  if (!shouldWaiveWorkoutFeedback(state, session)) return session;
  session.feedbackState = 'NOT_APPLICABLE';
  return session;
}

function fail(code: ErrorCode, message: string): HandlerResult {
  const errors: OrchestrationErrorBody[] = [{ code, message }];
  return { ...emptyResult(), commandSuccess: false, errors };
}

export function handleStartConstruction(state: GameState, ctx: GameplayHandlerContext): HandlerResult {
  const factionId = resolveActingFactionId(state, ctx.req);
  const territoryId = requireString(ctx.req, 'territoryId');
  const projectTypeRaw = paramString(ctx.req, 'projectType');
  if (projectTypeRaw !== undefined && !isConstructionProjectType(projectTypeRaw)) {
    throw new OrchestrationError(ErrorCode.INVALID_PARAMETER, 'Unknown construction project type');
  }
  const projectType = projectTypeRaw !== undefined && isConstructionProjectType(projectTypeRaw)
    ? projectTypeRaw
    : undefined;
  const faction = requireFactionSnapshot(state, factionId);
  const resourcesBefore = cloneResources(faction.resources);
  const project = startConstruction(state, {
    factionId,
    territoryId,
    projectId: paramString(ctx.req, 'constructionId'),
    projectType,
  });
  return handlerResultForConstructionStart(
    project,
    territoryId,
    resourcesBefore,
    cloneResources(faction.resources),
    factionId,
  );
}

export function handleApplyConstructionAcceleration(state: GameState, ctx: GameplayHandlerContext): HandlerResult {
  const factionId = resolveActingFactionId(state, ctx.req);
  const constructionId = requireString(ctx.req, 'constructionId');
  const project = consumeConstructionEffect(state, {
    factionId,
    constructionId,
    playerId: ctx.req.playerId,
  });
  return {
    ...emptyResult(),
    stateChanges: [{
      entity: 'territory',
      id: project.territoryId,
      summary: `Construction ${project.id} remainingTicks=${project.remainingTicks} status=${project.status}`,
    }],
    payload: {
      constructionId: project.id,
      remainingTicks: project.remainingTicks,
      status: project.status,
      completed: project.status === 'completed',
    },
  };
}

export function handleCollectResources(state: GameState, ctx: GameplayHandlerContext): HandlerResult {
  const factionId = resolveActingFactionId(state, ctx.req);
  const territoryId = requireString(ctx.req, 'territoryId');
  requireTerritory(state, territoryId);
  const consumeGoldenYield = ctx.req.parameters?.useGoldenYield === true
    || ctx.req.parameters?.consumeGoldenYield === true;
  const faction = requireFactionSnapshot(state, factionId);
  const resourcesBefore = cloneResources(faction.resources);
  const result = collectTerritoryYield(state, {
    factionId,
    territoryId,
    playerId: ctx.req.playerId,
    consumeGoldenYield,
  });
  const resourcesAfter = cloneResources(faction.resources);
  const resourcesChanged: HandlerResult['resourcesChanged'] = [];
  recordAllResourceChanges(resourcesChanged, factionId, resourcesBefore, resourcesAfter);
  return {
    ...emptyResult(),
    resourcesChanged,
    payload: {
      territoryId,
      ...result,
    },
  };
}

export function handleSetPlayerPause(state: GameState, ctx: GameplayHandlerContext): HandlerResult {
  const paused = ctx.req.parameters?.paused;
  if (typeof paused !== 'boolean') {
    throw new OrchestrationError(ErrorCode.MISSING_PARAMETER, 'Missing required parameter: paused');
  }
  setPlayerEmpirePause(state, paused);
  return {
    ...emptyResult(),
    payload: {
      paused: state.playerEmpirePause.paused,
      pausedAtTick: state.playerEmpirePause.pausedAtTick,
    },
  };
}

export function handleGetWorkoutSelection(state: GameState, ctx: GameplayHandlerContext): HandlerResult {
  const purposeRaw = requireString(ctx.req, 'purpose');
  if (!isWorkoutPurpose(purposeRaw)) {
    throw new OrchestrationError(ErrorCode.INVALID_PARAMETER, 'purpose is not a valid WorkoutPurpose');
  }
  const view = serializeWorkoutSelectionView(
    state,
    ctx.req.playerId,
    purposeRaw,
    paramString(ctx.req, 'intendedDifficulty'),
  );
  return {
    ...emptyResult(),
    payload: { ...view },
  };
}

export function handleStartWorkout(state: GameState, ctx: GameplayHandlerContext): HandlerResult {
  const purposeRaw = requireString(ctx.req, 'purpose');
  if (!isWorkoutPurpose(purposeRaw)) {
    throw new OrchestrationError(ErrorCode.INVALID_PARAMETER, 'purpose is not a valid WorkoutPurpose');
  }
  const purpose: WorkoutPurpose = purposeRaw;
  assertLevel1TutorialWorkoutAllowed(state, purpose);
  const selectedWorkoutId = selectedWorkoutIdForPurpose(purpose);
  const workoutId = resolveStartWorkoutId(state, purpose, paramString(ctx.req, 'workoutId'));
  const definition = getWorkoutDefinition(workoutId);
  if (!definition) {
    throw new OrchestrationError(ErrorCode.INVALID_PARAMETER, `Unknown workout ${workoutId}`);
  }
  const difficultyRaw = paramString(ctx.req, 'intendedDifficulty') ?? definition.intendedDifficulty;
  if (!isWorkoutDifficulty(difficultyRaw)) {
    throw new OrchestrationError(ErrorCode.INVALID_PARAMETER, 'intendedDifficulty is invalid');
  }
  const active = state.playerFitness.activeSession;
  if (active && active.state !== 'COMPLETED' && active.state !== 'ABANDONED') {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'An active workout session is already in progress');
  }

  const invasionId = paramString(ctx.req, 'invasionId');
  const constructionId = paramString(ctx.req, 'constructionId');
  const collectionTerritoryId = paramString(ctx.req, 'collectionTerritoryId');
  const startedAtWorldTick = playerFacingTick(state);

  if (purpose === 'DEFENSE') {
    if (!invasionId) {
      throw new OrchestrationError(ErrorCode.MISSING_PARAMETER, 'DEFENSE workouts require invasionId');
    }
    const invasion = state.activeInvasions.get(invasionId);
    if (!invasion || !isOpenInvasion(invasion)) {
      throw new OrchestrationError(ErrorCode.INVALID_TARGET, 'No matching active invasion');
    }
    if (state.playerFactionId && invasion.defenderFactionId !== state.playerFactionId) {
      throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Action not allowed');
    }
    if (invasion.defenseMobilization) {
      throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'This invasion already has a defense mobilization');
    }
    if (
      invasion.status === 'defense_in_progress'
      || invasion.defenseWorkoutStartedAtTick !== null
      || invasion.defenseSessionId !== null
    ) {
      throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'A defense workout is already in progress for this invasion');
    }
    if (isDeadlineElapsed(startedAtWorldTick, invasion.responseDeadlineTick)) {
      throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Defense workout started after the response deadline');
    }
    for (const other of state.activeInvasions.values()) {
      if (
        other.id !== invasion.id
        && other.defenderFactionId === invasion.defenderFactionId
        && other.status === 'defense_in_progress'
      ) {
        throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'An active defense workout is already in progress');
      }
    }
  } else if (invasionId) {
    throw new OrchestrationError(ErrorCode.INVALID_PARAMETER, 'invasionId is only valid for DEFENSE workouts');
  }

  const created = beginWorkoutSession({
    playerId: ctx.req.playerId,
    purpose,
    intendedDifficulty: difficultyRaw,
    workoutId,
    fitnessEstimate: state.playerFitness.estimate ?? undefined,
    sessionId: paramString(ctx.req, 'sessionId'),
    now: sessionNow(state, ctx),
    gameplayContext: {
      invasionId,
      constructionId,
      collectionTerritoryId,
      startedAtWorldTick,
    },
  });
  if (!created.ok) {
    throw new OrchestrationError(ErrorCode.WORKOUT_SESSION_INVALID, created.error.message);
  }
  state.playerFitness.activeSession = created.value;
  if (purpose === 'DEFENSE' && invasionId) {
    attachDefenseWorkoutToInvasion(state, invasionId, created.value.sessionId, startedAtWorldTick);
  }
  return {
    ...emptyResult(),
    payload: {
      sessionId: created.value.sessionId,
      purpose: created.value.purpose,
      state: created.value.state,
      invasionId,
      workoutId: created.value.workoutId,
      selectedWorkoutId,
    },
  };
}

export function handleRecordExercise(state: GameState, ctx: GameplayHandlerContext): HandlerResult {
  const session = state.playerFitness.activeSession;
  if (!session) {
    throw new OrchestrationError(ErrorCode.WORKOUT_SESSION_INVALID, 'No active workout session');
  }
  const order = paramNumber(ctx.req, 'order');
  if (order === undefined) {
    throw new OrchestrationError(ErrorCode.MISSING_PARAMETER, 'Missing required parameter: order');
  }
  const next = completeExercise(session, {
    order,
    repetitions: paramNumber(ctx.req, 'repetitions'),
    durationSeconds: paramNumber(ctx.req, 'durationSeconds'),
  }, sessionNow(state, ctx));
  if (!next.ok) {
    throw new OrchestrationError(ErrorCode.WORKOUT_SESSION_INVALID, next.error.message);
  }
  state.playerFitness.activeSession = applyFirstWorkoutFeedbackWaiver(state, next.value) ?? next.value;
  return {
    ...emptyResult(),
    payload: { sessionId: next.value.sessionId, state: next.value.state, currentExerciseIndex: next.value.currentExerciseIndex },
  };
}

export function handleSkipRest(state: GameState, ctx: GameplayHandlerContext): HandlerResult {
  const session = state.playerFitness.activeSession;
  if (!session) {
    throw new OrchestrationError(ErrorCode.WORKOUT_SESSION_INVALID, 'No active workout session');
  }
  const order = paramNumber(ctx.req, 'order');
  if (order === undefined) {
    throw new OrchestrationError(ErrorCode.MISSING_PARAMETER, 'Missing required parameter: order');
  }
  const next = skipExercise(session, order, sessionNow(state, ctx));
  if (!next.ok) {
    throw new OrchestrationError(ErrorCode.WORKOUT_SESSION_INVALID, next.error.message);
  }
  state.playerFitness.activeSession = applyFirstWorkoutFeedbackWaiver(state, next.value) ?? next.value;
  return {
    ...emptyResult(),
    payload: { sessionId: next.value.sessionId, state: next.value.state },
  };
}

export function handlePauseWorkout(state: GameState, ctx: GameplayHandlerContext): HandlerResult {
  const session = state.playerFitness.activeSession;
  if (!session) {
    throw new OrchestrationError(ErrorCode.WORKOUT_SESSION_INVALID, 'No active workout session');
  }
  const next = pauseWorkoutSession(session, sessionNow(state, ctx));
  if (!next.ok) {
    throw new OrchestrationError(ErrorCode.WORKOUT_SESSION_INVALID, next.error.message);
  }
  state.playerFitness.activeSession = next.value;
  return {
    ...emptyResult(),
    payload: {
      sessionId: next.value.sessionId,
      state: next.value.state,
      pauseCount: next.value.pauseCount,
    },
  };
}

export function handleResumeWorkout(state: GameState, ctx: GameplayHandlerContext): HandlerResult {
  const session = state.playerFitness.activeSession;
  if (!session) {
    throw new OrchestrationError(ErrorCode.WORKOUT_SESSION_INVALID, 'No active workout session');
  }
  const next = resumeWorkoutSession(session, sessionNow(state, ctx));
  if (!next.ok) {
    throw new OrchestrationError(ErrorCode.WORKOUT_SESSION_INVALID, next.error.message);
  }
  state.playerFitness.activeSession = next.value;
  return {
    ...emptyResult(),
    payload: {
      sessionId: next.value.sessionId,
      state: next.value.state,
      pauseCount: next.value.pauseCount,
    },
  };
}

export function handleSubmitWorkoutFeedback(state: GameState, ctx: GameplayHandlerContext): HandlerResult {
  const session = state.playerFitness.activeSession;
  if (!session) {
    throw new OrchestrationError(ErrorCode.WORKOUT_SESSION_INVALID, 'No active workout session');
  }
  const value = requireString(ctx.req, 'value');
  if (!isWorkoutFeedbackValue(value)) {
    throw new OrchestrationError(ErrorCode.INVALID_PARAMETER, 'Feedback value is invalid');
  }
  const next = submitWorkoutFeedback(session, value, sessionNow(state, ctx));
  if (!next.ok) {
    throw new OrchestrationError(ErrorCode.WORKOUT_SESSION_INVALID, next.error.message);
  }
  state.playerFitness.activeSession = next.value;
  return {
    ...emptyResult(),
    payload: { sessionId: next.value.sessionId, feedbackState: next.value.feedbackState },
  };
}

export function handleFinalizeWorkout(state: GameState, ctx: GameplayHandlerContext): HandlerResult {
  const session = state.playerFitness.activeSession;
  if (!session) {
    throw new OrchestrationError(ErrorCode.WORKOUT_SESSION_INVALID, 'No active workout session');
  }
  if (!isEligibleForFitnessEvaluation(session)) {
    throw new OrchestrationError(ErrorCode.WORKOUT_SESSION_INVALID, 'Session is not eligible for completion');
  }
  if (session.purpose === 'DEFENSE') {
    const invasionId = session.gameplayContext?.invasionId;
    if (!invasionId) {
      throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Defense session is missing an invasion id');
    }
    const invasion = state.activeInvasions.get(invasionId);
    if (!invasion || !isOpenInvasion(invasion)) {
      throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Invasion is no longer active for this defense workout');
    }
    if (state.playerFactionId && invasion.defenderFactionId !== state.playerFactionId) {
      throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Action not allowed');
    }
    if (invasion.defenseSessionId && invasion.defenseSessionId !== session.sessionId) {
      throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Defense session does not match the invasion');
    }
    const now = playerFacingTick(state);
    if (
      invasion.defenseCompletionDeadlineTick !== null
      && isDeadlineElapsed(now, invasion.defenseCompletionDeadlineTick)
    ) {
      throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Defense workout exceeded the maximum completion window');
    }
    const started = session.gameplayContext?.startedAtWorldTick ?? invasion.defenseWorkoutStartedAtTick;
    if (started !== null && started > invasion.responseDeadlineTick) {
      throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Defense workout started after the response deadline');
    }
  }
  const result = runWorkoutRewardPipeline(state, session, ctx.req.playerId, {
    battle: ctx.registry.requireBattle(),
    history: ctx.registry.workoutHistory,
  });
  if (!result.ok) {
    return {
      ...fail(ErrorCode.ACTION_NOT_ALLOWED, result.error?.message ?? 'Workout reward pipeline failed'),
      payload: {
        sessionId: result.sessionId,
        pendingReward: !!state.playerFitness.pendingReward,
        error: result.error,
      },
    };
  }
  const applied = result.application && result.application.ok ? result.application.result : undefined;
  return {
    ...emptyResult(),
    events: result.events ?? [],
    payload: {
      sessionId: result.sessionId,
      purpose: result.purpose,
      alreadyProcessed: result.alreadyProcessed,
      physicalOutput: result.physicalOutput,
      bankedTroops: state.playerRewards.bankedTroops,
      applicationId: applied?.applicationId,
      kind: applied?.kind ?? (result.application && result.application.ok ? result.application.result.kind : undefined),
      amountOrEffect: applied?.amountOrEffect,
      invasionOutcome: result.invasionOutcome,
      winner: result.invasionWinner,
      territoryOutcome: result.invasionTerritoryOutcome,
      territoryId: result.invasionTerritoryId,
    },
  };
}

function resolveAbandonedDefense(state: GameState, ctx: GameplayHandlerContext, invasionId: string | undefined): string | undefined {
  if (!invasionId) return undefined;
  const invasion = state.activeInvasions.get(invasionId);
  if (!invasion || !isOpenInvasion(invasion)) return undefined;
  const resolved = resolveInvasionBattle(state, ctx.registry.requireBattle(), invasionId, 'defense_abandoned');
  return String(resolved.payload.invasionOutcome ?? 'defense_abandoned');
}

export function handleAbandonWorkout(state: GameState, ctx: GameplayHandlerContext): HandlerResult {
  const session = state.playerFitness.activeSession;
  if (!session) {
    throw new OrchestrationError(ErrorCode.WORKOUT_SESSION_INVALID, 'No active workout session');
  }
  const next = abandonWorkoutSession(session, sessionNow(state, ctx), 'PLAYER');
  if (!next.ok) {
    throw new OrchestrationError(ErrorCode.WORKOUT_SESSION_INVALID, next.error.message);
  }
  state.playerFitness.activeSession = next.value;
  persistTerminalSessionHistory(ctx.registry.workoutHistory, next.value, {
    completedAtWorldTick: playerFacingTick(state),
  });
  const invasionOutcome = session.purpose === 'DEFENSE'
    ? resolveAbandonedDefense(state, ctx, session.gameplayContext?.invasionId)
    : undefined;
  return {
    ...emptyResult(),
    payload: {
      sessionId: next.value.sessionId,
      state: next.value.state,
      abandonmentReason: next.value.abandonmentReason,
      invasionOutcome,
    },
  };
}

export function handleRecordIntegrityFlag(state: GameState, ctx: GameplayHandlerContext): HandlerResult {
  const session = state.playerFitness.activeSession;
  if (!session) {
    throw new OrchestrationError(ErrorCode.WORKOUT_SESSION_INVALID, 'No active workout session');
  }
  const typeRaw = paramString(ctx.req, 'type');
  if (typeRaw && !(INTEGRITY_FLAG_TYPES as readonly string[]).includes(typeRaw)) {
    throw new OrchestrationError(ErrorCode.INVALID_PARAMETER, 'Integrity flag type is invalid');
  }
  const next = recordIntegrityFlag(session, sessionNow(state, ctx), {
    type: typeRaw as IntegrityFlagType | undefined,
  });
  if (!next.ok) {
    throw new OrchestrationError(ErrorCode.WORKOUT_SESSION_INVALID, next.error.message);
  }
  state.playerFitness.activeSession = next.value;
  if (next.value.state === 'ABANDONED') {
    persistTerminalSessionHistory(ctx.registry.workoutHistory, next.value, {
      completedAtWorldTick: playerFacingTick(state),
    });
  }
  const invasionOutcome = next.value.state === 'ABANDONED' && session.purpose === 'DEFENSE'
    ? resolveAbandonedDefense(state, ctx, session.gameplayContext?.invasionId)
    : undefined;
  return {
    ...emptyResult(),
    payload: {
      sessionId: next.value.sessionId,
      state: next.value.state,
      integrityFlagCount: next.value.integrityFlags.length,
      abandonmentReason: next.value.abandonmentReason,
      invasionOutcome,
    },
  };
}

