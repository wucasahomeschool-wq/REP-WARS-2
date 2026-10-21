import { WorkoutSession } from '../fitness/session/types';
import { CompletionRewardEntitlement, createCompletionRewardEntitlement } from '../rewards/completionEntitlement';
import { requireWorldWorkoutRewardPolicy } from '../rewards/completionPolicy';
import { GameState } from '../types/GameState';
import { assertWorldIdentity, resolveWorldDefinition } from '../worldDefinition';
import { CommandRequest } from '../orchestration/protocol';
import { ErrorCode, OrchestrationError } from '../orchestration/errors';
import { WorkoutHistoryStore } from '../fitness/history/types';

const REWARD_SESSION_PREFIX = 'wses_reward:';

/** A terminal session is not necessarily paid. Never discard the only unpaid source record. */
export function workoutStartBlockReason(state: GameState): string | null {
  if (state.playerFitness.pendingReward) return 'A workout reward is still pending';
  const active = state.playerFitness.activeSession;
  if (!active) return null;
  if (active.state !== 'COMPLETED' && active.state !== 'ABANDONED') return 'An active workout session is already in progress';
  if (active.state === 'COMPLETED'
    && !state.playerRewards.appliedRewards.some(row => row.sessionId === active.sessionId
      && (!active.completionRewardEntitlement || row.applicationId === active.completionRewardEntitlement.entitlementId))) {
    return 'The completed workout must be settled before starting another workout or changing worlds';
  }
  return null;
}

/** Reuse durable server-issued lease + monotonic command identity; no new counter or client workout ID. */
export function rewardWorkoutSessionId(state: GameState, request: CommandRequest): string {
  const sequence = request.commandSequence;
  const lease = state.gameplaySessionLeases.find(item => item.sessionId === request.gameplaySessionId);
  if (!lease || !Number.isSafeInteger(sequence) || sequence! < 1 || !request.requestId?.trim()) {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Normal workouts require a gameplay session and sequenced command');
  }
  if (lease.lastCommandSequence != null && sequence! <= lease.lastCommandSequence) {
    throw new OrchestrationError(ErrorCode.COMMAND_STALE, 'Workout start command is already committed or stale');
  }
  return `${REWARD_SESSION_PREFIX}${JSON.stringify([request.playerId, lease.sessionId, sequence])}`;
}

function knownWorkoutSessionIds(state: GameState): Set<string> {
  return new Set([
    state.playerFitness.activeSession?.sessionId, state.playerFitness.pendingReward?.sessionId,
    ...state.playerRewards.appliedRewards.map(row => row.sessionId),
    ...state.playerFitness.compactHistory.map(row => row.sessionId),
    ...state.playerFitness.progression.evidenceLog.map(row => row.sessionId),
  ].filter((id): id is string => id !== undefined));
}

/** Legacy specialized defaults can collide at an unchanged session clock. No gameplay wait is necessary. */
export function availableDefaultWorkoutSessionId(state: GameState, base: string, playerId: string, history: WorkoutHistoryStore | null): string {
  const used = knownWorkoutSessionIds(state);
  let id = base, suffix = 0;
  while (used.has(id) || history?.get(playerId, id)) {
    id = `${base}_${++suffix}`;
  }
  return id;
}

export function assertWorkoutSessionIdAvailable(state: GameState, sessionId: string, serverIssued: boolean): void {
  if (!serverIssued && sessionId.startsWith(REWARD_SESSION_PREFIX)) {
    throw new OrchestrationError(ErrorCode.INVALID_PARAMETER, 'Workout session identity is reserved for the server');
  }
  if (knownWorkoutSessionIds(state).has(sessionId)) {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Workout session identity was already used');
  }
}

/** Pure assembly from resolved server content. Never infer a legacy size or use client reward terms. */
export function lockWorkoutStartReward(state: GameState, session: WorkoutSession): CompletionRewardEntitlement {
  const authored = session.authoredCatalog;
  if (!authored) {
    throw new OrchestrationError(ErrorCode.WORKOUT_CONFIGURATION_UNAVAILABLE, 'Normal workouts require an authored workout size and catalog identity');
  }
  const loaded = state.definitionWorldId ? resolveWorldDefinition(state.definitionWorldId) : null;
  if (!loaded?.ok) throw new OrchestrationError(ErrorCode.WORKOUT_CONFIGURATION_UNAVAILABLE, 'Current authored world is unavailable for workout rewards');
  assertWorldIdentity(state, loaded.definition);
  try {
    const policy = requireWorldWorkoutRewardPolicy(loaded.definition);
    return createCompletionRewardEntitlement({ session, size: authored.size, catalogId: authored.catalogId,
      catalogVersion: authored.catalogVersion,
      world: { worldId: loaded.definition.worldId, formatVersion: loaded.definition.formatVersion, level: loaded.definition.level }, policy });
  } catch {
    throw new OrchestrationError(ErrorCode.WORKOUT_CONFIGURATION_UNAVAILABLE, 'Current world has no valid authored workout reward policy');
  }
}
