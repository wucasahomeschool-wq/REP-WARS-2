import { isWorkoutDifficulty } from '../fitness/difficulty';
import { assertWorkoutSessionIdAvailable, availableDefaultWorkoutSessionId, lockWorkoutStartReward, rewardWorkoutSessionId, workoutStartBlockReason } from '../gameplay/workoutStart';
import { cloneCompletionRewardEntitlement } from '../rewards/completionEntitlement';
import { workoutRewardView } from '../rewards/workoutRewardView';
import { cloneWorkoutSession } from '../fitness/session/clone';
import { evaluateLockedWorkoutFitness } from '../rewards/pipeline/settleLockedWorkout';
import { isWorkoutPurpose } from '../fitness/purpose';
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
import { WORLD_TICK_DURATION_MS } from '../world/realtimeClock';
import { applyAuthoredProgression, ProgressionApplyResult } from '../fitness/progression';
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
  assertResolvedWorkoutEligible,
  parseWorkoutSize,
  resolveStartWorkout,
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
  return paramNumber(ctx.req, 'now') ?? state.worldTick * WORLD_TICK_DURATION_MS;
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

function serializeProgressionPayload(result: ProgressionApplyResult): Record<string, unknown> | null {
  if (!result.applied || !result.evaluation) return null;
  const evaluation = result.evaluation;
  return {
    decision: evaluation.decision,
    bandBefore: evaluation.bandBefore,
    bandAfter: evaluation.bandAfter,
    bandChanged: evaluation.bandBefore !== evaluation.bandAfter,
    catalogId: evaluation.evidence.catalogId,
    catalogVersion: evaluation.evidence.catalogVersion,
    engineVersion: evaluation.evidence.engineVersion,
    completionRatio: evaluation.evidence.completionRatio,
    feedback: evaluation.evidence.feedback,
    completed: evaluation.evidence.completed,
    abandoned: evaluation.evidence.abandoned,
  };
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
    paramString(ctx.req, 'size'),
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
  const blocked = workoutStartBlockReason(state);
  if (blocked) throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, blocked);
  const size = parseWorkoutSize(paramString(ctx.req, 'size'));
  const resolved = resolveStartWorkout(state, purpose, paramString(ctx.req, 'workoutId'), size);
  const workoutId = resolved.workoutId;
  const selectedWorkoutId = resolved.selectedWorkoutId;
  const definition = resolved.definition;
  assertResolvedWorkoutEligible(state, definition);
  const difficultyRaw = paramString(ctx.req, 'intendedDifficulty') ?? definition.intendedDifficulty;
  if (!isWorkoutDifficulty(difficultyRaw)) {
    throw new OrchestrationError(ErrorCode.INVALID_PARAMETER, 'intendedDifficulty is invalid');
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
    workout: definition,
    workoutId,
    fitnessEstimate: definition.metadata.authored ? undefined : state.playerFitness.estimate ?? undefined,
    sessionId: purpose === 'NORMAL_TROOPS' ? rewardWorkoutSessionId(state, ctx.req) : paramString(ctx.req, 'sessionId'),
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
  const started = purpose !== 'NORMAL_TROOPS' && paramString(ctx.req, 'sessionId') === undefined
    ? { ...created.value, sessionId: availableDefaultWorkoutSessionId(state, created.value.sessionId, ctx.req.playerId, ctx.registry.workoutHistory) }
    : created.value;
  assertWorkoutSessionIdAvailable(state, started.sessionId, purpose === 'NORMAL_TROOPS');
  if (ctx.registry.workoutHistory?.get(ctx.req.playerId, started.sessionId)) {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Workout session identity was already used');
  }
  const session = purpose === 'NORMAL_TROOPS'
    ? { ...started, completionRewardEntitlement: lockWorkoutStartReward(state, started) }
    : started;
  state.playerFitness.activeSession = session;
  if (purpose === 'DEFENSE' && invasionId) {
    attachDefenseWorkoutToInvasion(state, invasionId, session.sessionId, startedAtWorldTick);
  }
  return {
    ...emptyResult(),
    payload: {
      sessionId: session.sessionId,
      purpose: session.purpose,
      state: session.state,
      workoutReward: workoutRewardView(state, session, true),
      invasionId,
      workoutId: created.value.workoutId,
      selectedWorkoutId,
      ...(session.completionRewardEntitlement
        ? { completionRewardEntitlement: cloneCompletionRewardEntitlement(session.completionRewardEntitlement, session) } : {}),
      selection: {
        source: resolved.source,
        selectedWorkoutId,
        workoutId: created.value.workoutId,
        size: created.value.authoredCatalog?.size ?? null,
        catalogId: created.value.authoredCatalog?.catalogId ?? null,
        catalogVersion: created.value.authoredCatalog?.catalogVersion ?? null,
        engineVersion: created.value.authoredCatalog?.engineVersion ?? null,
        progressionBandId: created.value.authoredCatalog?.progressionBandId ?? null,
      },
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
    payload: { sessionId: next.value.sessionId, state: next.value.state, currentExerciseIndex: next.value.currentExerciseIndex,
      workoutReward: workoutRewardView(state, state.playerFitness.activeSession!, true) },
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
    payload: { sessionId: next.value.sessionId, state: next.value.state,
      workoutReward: workoutRewardView(state, state.playerFitness.activeSession!, true) },
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
      workoutReward: workoutRewardView(state, next.value, true),
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
      workoutReward: workoutRewardView(state, next.value, true),
    },
  };
}

/** Explicit sessionId addresses a paid historical lock without replacing another active workout. */
function workoutForSettlement(state: GameState, ctx: GameplayHandlerContext) {
  const requested = paramString(ctx.req, 'sessionId');
  const active = state.playerFitness.activeSession;
  if (!requested || active?.sessionId === requested) return active?.playerId === ctx.req.playerId ? active : null;
  const stored = ctx.registry.workoutHistory?.get(ctx.req.playerId, requested)?.sessionSnapshot;
  if (!stored?.completionRewardEntitlement || !state.playerRewards.appliedRewards.some(row =>
    row.sessionId === requested && row.applicationId === stored.completionRewardEntitlement!.entitlementId)) return null;
  return cloneWorkoutSession(stored);
}

export function handleSubmitWorkoutFeedback(state: GameState, ctx: GameplayHandlerContext): HandlerResult {
  const session = workoutForSettlement(state, ctx);
  if (!session) {
    throw new OrchestrationError(ErrorCode.WORKOUT_SESSION_INVALID, 'No active workout session');
  }
  const value = requireString(ctx.req, 'value');
  if (!isWorkoutFeedbackValue(value)) {
    throw new OrchestrationError(ErrorCode.INVALID_PARAMETER, 'Feedback value is invalid');
  }
  const next = session.completionRewardEntitlement && session.feedback?.value === value
    ? { ok: true as const, value: session } // Same logical feedback retry, not a correction.
    : submitWorkoutFeedback(session, value, sessionNow(state, ctx));
  if (!next.ok) {
    throw new OrchestrationError(ErrorCode.WORKOUT_SESSION_INVALID, next.error.message);
  }
  if (state.playerFitness.activeSession?.sessionId === session.sessionId) state.playerFitness.activeSession = next.value;
  if (session.completionRewardEntitlement) {
    const history = ctx.registry.workoutHistory;
    if (!history) throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Workout history is required for locked feedback');
    persistTerminalSessionHistory(history, next.value);
    evaluateLockedWorkoutFitness(state, next.value, history);
  }
  return {
    ...emptyResult(),
    payload: { sessionId: next.value.sessionId, feedbackState: next.value.feedbackState,
      workoutReward: workoutRewardView(state, next.value, state.playerFitness.activeSession?.sessionId === next.value.sessionId) },
  };
}

export function handleFinalizeWorkout(state: GameState, ctx: GameplayHandlerContext): HandlerResult {
  const session = workoutForSettlement(state, ctx);
  if (!session) {
    throw new OrchestrationError(ErrorCode.WORKOUT_SESSION_INVALID, 'No active workout session');
  }
  if (!session.completionRewardEntitlement && !isEligibleForFitnessEvaluation(session)) {
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
  const progression = session.completionRewardEntitlement
    ? { applied: false, evaluation: null } : applyAuthoredProgression(state, session, sessionNow(state, ctx));
  if (!result.ok) {
    return {
      ...fail(ErrorCode.ACTION_NOT_ALLOWED, result.error?.message ?? 'Workout reward pipeline failed'),
      payload: {
        sessionId: result.sessionId,
        workoutReward: workoutRewardView(state, session, true),
        pendingReward: !!state.playerFitness.pendingReward,
        error: result.error,
        progression: serializeProgressionPayload(progression),
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
      workoutReward: workoutRewardView(state, session, state.playerFitness.activeSession?.sessionId === session.sessionId),
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
      progression: serializeProgressionPayload(progression),
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
  const progression = applyAuthoredProgression(state, next.value, sessionNow(state, ctx));
  const invasionOutcome = session.purpose === 'DEFENSE'
    ? resolveAbandonedDefense(state, ctx, session.gameplayContext?.invasionId)
    : undefined;
  return {
    ...emptyResult(),
    payload: {
      sessionId: next.value.sessionId,
      state: next.value.state,
      abandonmentReason: next.value.abandonmentReason,
      workoutReward: workoutRewardView(state, next.value, true),
      invasionOutcome,
      progression: serializeProgressionPayload(progression),
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
    applyAuthoredProgression(state, next.value, sessionNow(state, ctx));
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
      workoutReward: workoutRewardView(state, next.value, true),
      abandonmentReason: next.value.abandonmentReason,
      invasionOutcome,
    },
  };
}

