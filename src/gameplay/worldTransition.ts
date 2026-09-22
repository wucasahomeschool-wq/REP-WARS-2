import { cloneFitnessEstimate } from '../fitness/estimate/clone';
import { clonePlayerProgressionState, emptyPlayerProgressionState } from '../fitness/progression/types';
import { GameState, PlayerFitnessState } from '../types/GameState';
import { GameEvent } from '../orchestration/protocol';
import { OrchestrationError, ErrorCode } from '../orchestration/errors';
import { overwriteGameState } from '../state/cloneGameState';
import { findNextProductionWorldRegistration } from '../worldDefinition/campaign';
import {
  WorldCatalog,
  formatWorldLoadFailure,
  getDefaultWorldCatalog,
  isLegacyDefinitionWorldId,
} from '../worldDefinition/catalog';
import { createGameStateFromWorld } from '../worldDefinition/instantiate';
import { WorldFileRegistration } from '../worldDefinition/worldConfig';
import { evaluateWorldCompletion } from './completion';

export interface WorldTransitionView {
  eligible: boolean;
  nextWorldId: string | null;
  nextWorldLevel: number | null;
  alreadyOnLatestRegistered: boolean;
}

export type WorldTransitionApplyResult =
  | {
    status: 'transitioned';
    fromWorldId: string;
    fromWorldLevel: number;
    toWorldId: string;
    toWorldLevel: number;
  }
  | {
    status: 'already_completed';
    worldId: string;
    worldLevel: number | null;
  };

/**
 * Player-scoped fitness that survives a world change.
 * In-progress sessions, pending rewards, and world-tick stamps do not.
 */
export function carryPlayerScopedFitness(from: PlayerFitnessState, onto: PlayerFitnessState): void {
  onto.estimate = from.estimate ? cloneFitnessEstimate(from.estimate) : null;
  onto.compactHistory = from.compactHistory.map((entry) => ({ ...entry }));
  onto.progression = from.progression
    ? clonePlayerProgressionState(from.progression)
    : emptyPlayerProgressionState();
  onto.activeSession = null;
  onto.pendingReward = null;
  onto.lastWorkoutCompletedAtTick = null;
}

export function evaluateWorldTransition(
  state: GameState,
  catalog: WorldCatalog = getDefaultWorldCatalog(),
  registrations?: readonly WorldFileRegistration[],
): WorldTransitionView {
  const currentLevel = state.worldLevel;
  const nextReg = typeof currentLevel === 'number'
    ? findNextProductionWorldRegistration(currentLevel, registrations)
    : null;
  if (!nextReg) {
    return {
      eligible: false,
      nextWorldId: null,
      nextWorldLevel: null,
      alreadyOnLatestRegistered: !!state.definitionWorldId && !isLegacyDefinitionWorldId(state.definitionWorldId),
    };
  }
  if (state.definitionWorldId === nextReg.worldId) {
    return {
      eligible: false,
      nextWorldId: nextReg.worldId,
      nextWorldLevel: nextReg.level,
      alreadyOnLatestRegistered: findNextProductionWorldRegistration(nextReg.level, registrations) === null,
    };
  }
  const loaded = catalog.load(nextReg.worldId);
  if (!loaded.ok) {
    return {
      eligible: false,
      nextWorldId: nextReg.worldId,
      nextWorldLevel: nextReg.level,
      alreadyOnLatestRegistered: false,
    };
  }
  const complete = evaluateWorldCompletion(state)?.complete === true;
  return {
    eligible: complete,
    nextWorldId: nextReg.worldId,
    nextWorldLevel: nextReg.level,
    alreadyOnLatestRegistered: false,
  };
}

/**
 * Build the next world's GameState from its WorldDefinition.
 * Does not mutate `state`. Caller commits (orchestrator draft or persistence).
 */
export function buildNextWorldState(
  state: GameState,
  catalog: WorldCatalog = getDefaultWorldCatalog(),
  registrations?: readonly WorldFileRegistration[],
): WorldTransitionApplyResult & { next?: GameState } {
  const currentId = state.definitionWorldId;
  if (!currentId || isLegacyDefinitionWorldId(currentId)) {
    throw new OrchestrationError(
      ErrorCode.INVALID_GAME_STATE,
      'Current world is not an authored campaign world',
    );
  }
  const currentLevel = state.worldLevel;
  if (typeof currentLevel !== 'number' || !Number.isInteger(currentLevel)) {
    throw new OrchestrationError(ErrorCode.INVALID_GAME_STATE, 'Current world level is missing');
  }
  const nextReg = findNextProductionWorldRegistration(currentLevel, registrations);
  if (!nextReg || currentId === nextReg.worldId) {
    return {
      status: 'already_completed',
      worldId: currentId,
      worldLevel: currentLevel,
    };
  }
  const loaded = catalog.load(nextReg.worldId);
  if (!loaded.ok) {
    throw new OrchestrationError(
      ErrorCode.INVALID_GAME_STATE,
      formatWorldLoadFailure(nextReg.worldId, loaded),
      { reason: 'next_world_unavailable', worldId: nextReg.worldId },
    );
  }
  if (loaded.definition.level !== currentLevel + 1) {
    throw new OrchestrationError(
      ErrorCode.INVALID_GAME_STATE,
      'Registered next world is not the following campaign level',
      { reason: 'next_world_level_mismatch', worldId: nextReg.worldId },
    );
  }
  const complete = evaluateWorldCompletion(state)?.complete === true;
  if (!complete) {
    throw new OrchestrationError(
      ErrorCode.ACTION_NOT_ALLOWED,
      'Current world is not complete',
      { reason: 'not_eligible', definitionWorldId: currentId, worldLevel: currentLevel },
    );
  }

  const next = createGameStateFromWorld(loaded.definition, { seed: state.worldSeed });
  carryPlayerScopedFitness(state.playerFitness, next.playerFitness);
  next.level1Tutorial = null;
  return {
    status: 'transitioned',
    fromWorldId: currentId,
    fromWorldLevel: currentLevel,
    toWorldId: next.definitionWorldId ?? nextReg.worldId,
    toWorldLevel: next.worldLevel ?? nextReg.level,
    next,
  };
}

/** Mutate `draft` into the next world, or no-op when already there. */
export function applyWorldTransition(
  draft: GameState,
  catalog: WorldCatalog = getDefaultWorldCatalog(),
  registrations?: readonly WorldFileRegistration[],
): WorldTransitionApplyResult {
  const built = buildNextWorldState(draft, catalog, registrations);
  if (built.status === 'already_completed') {
    return built;
  }
  if (!built.next) {
    throw new OrchestrationError(ErrorCode.ENGINE_ERROR, 'World transition produced no next state');
  }
  overwriteGameState(draft, built.next);
  return {
    status: 'transitioned',
    fromWorldId: built.fromWorldId,
    fromWorldLevel: built.fromWorldLevel,
    toWorldId: built.toWorldId,
    toWorldLevel: built.toWorldLevel,
  };
}

export function worldTransitionedEvent(
  state: GameState,
  fromWorldId: string,
  fromWorldLevel: number,
  toWorldId: string,
  toWorldLevel: number,
  playerId: string,
): GameEvent {
  return {
    kind: 'world',
    id: `level_transitioned_${playerId}_${fromWorldId}_${toWorldId}`,
    title: 'World transitioned',
    summary: `Transitioned from ${fromWorldId} to ${toWorldId}`,
    factionId: state.playerFactionId,
    data: {
      worldProgression: 'level_transitioned',
      fromWorldId,
      fromWorldLevel,
      toWorldId,
      toWorldLevel,
      playerId,
    },
  };
}
