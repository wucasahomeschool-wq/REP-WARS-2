import { initializePlayerWorld } from './initializePlayerWorld';
import { cloneGameState } from '../state/cloneGameState';
import { checkGameStateInvariants } from '../state/gameStateInvariants';
import { GameState } from '../types/GameState';
import { EngineRegistry, createDefaultRegistry } from '../orchestration/engineRegistry';
import { HandlerContext } from '../orchestration/handlers';
import { getCommandDefinition } from '../orchestration/commandIndex';
import { buildWarlordStates } from '../state/gameStateAdapters';
import { catchUpWorld, CatchUpWorldResult } from '../world/catchup';
import { retryPendingWorkoutReward } from '../rewards/pipeline/runWorkoutRewardPipeline';
import { PersistenceError } from './errors';
import { DEFAULT_WORLD_ID, GameStateStore, LoadWorldResult, PersistedWorldRecord, SaveWorldResult } from './types';
import { resolveAuthoritativeTargetTick, WorldTimeAuthority } from './timeAuthority';
import { WorkoutHistoryStore } from '../fitness/history/types';
import { observeCatchUp, observeLoadResult, observeSaveResult } from '../analytics/persistence';
import { safeObserveCommand, safeObservePersistence } from '../analytics/recorder';
import type { TelemetryRecorder } from '../analytics/types';

export interface SyncPlayerWorldInput {
  playerId: string;
  requestedTick?: number;
  authority: WorldTimeAuthority;
  store: GameStateStore;
  history?: WorkoutHistoryStore;
  registry?: EngineRegistry;
  telemetry?: TelemetryRecorder | null;
  /**
   * If no persisted row exists, create a fresh local world. Default false:
   * missing state is an error, never a silent empty game after corruption.
   * Do not use this to mint a second empire for a human who already has a
   * `playerId` — keep the original id (`docs/PLAYER_IDENTITY.md`).
   */
  createIfMissing?: boolean;
}

export interface SyncPlayerWorldSuccess {
  ok: true;
  persisted: true;
  state: GameState;
  record: PersistedWorldRecord;
  catchUp: CatchUpWorldResult;
  pendingRetry?: { ok: boolean; alreadyProcessed?: boolean; sessionId: string };
}

export type SyncPlayerWorldResult =
  | SyncPlayerWorldSuccess
  | (LoadWorldResult & { ok: false; persisted: false })
  | (SaveWorldResult & { ok: false })
  | { ok: false; persisted: false; code: string; message: string; details?: Record<string, unknown> };

function syncContext(state: GameState, playerId: string, registry: EngineRegistry): HandlerContext {
  const def = getCommandDefinition('SYNC_PLAYER_WORLD');
  if (!def) {
    throw new Error('SYNC_PLAYER_WORLD is not in the command index');
  }
  return {
    req: { commandId: 'SYNC_PLAYER_WORLD', playerId, parameters: {} },
    def,
    registry,
    runtime: { aiWarlordStates: buildWarlordStates(state) },
  };
}

/**
 * Load authoritative state, catch the world up to a legal tick, retry any
 * pending reward, validate, and persist once. Not a per-tick write loop.
 */
export function syncPlayerWorld(input: SyncPlayerWorldInput): SyncPlayerWorldResult {
  const loaded = input.store.load(input.playerId);
  observeLoadResult(input.telemetry, {
    playerId: input.playerId,
    worldId: loaded.ok ? loaded.record.worldId : DEFAULT_WORLD_ID,
    result: loaded,
  });
  let state: GameState;
  let expectedVersion: number;
  if (!loaded.ok) {
    if (loaded.code !== 'persistence.not_found' || !input.createIfMissing) {
      return { ...loaded, persisted: false };
    }
    state = initializePlayerWorld({
      playerId: input.playerId,
      seed: undefined,
    }).state;
    expectedVersion = 0;
  } else {
    state = cloneGameState(loaded.state);
    expectedVersion = loaded.record.stateVersion;
  }

  let target: number;
  try {
    target = resolveAuthoritativeTargetTick({
      authority: input.authority,
      requestedTick: input.requestedTick,
      currentTick: state.worldTick,
    });
  } catch (err) {
    if (err instanceof PersistenceError) {
      return { ok: false, persisted: false, code: err.code, message: err.message, details: err.details };
    }
    throw err;
  }

  const registry = input.registry ?? createDefaultRegistry();
  if (input.history && !registry.workoutHistory) registry.workoutHistory = input.history;
  if (!registry.timeAuthority) registry.timeAuthority = input.authority;

  const ctx = syncContext(state, input.playerId, registry);
  const catchUp = catchUpWorld(state, ctx, target);
  const worldId = loaded.ok ? loaded.record.worldId : DEFAULT_WORLD_ID;
  observeCatchUp(input.telemetry, {
    playerId: input.playerId,
    worldId,
    worldTick: state.worldTick,
    definitionWorldId: state.definitionWorldId,
    worldLevel: state.worldLevel,
    playerFactionId: state.playerFactionId,
    catchUp,
  });
  const syncRequestId = `sync_${input.playerId}_${state.worldTick}`;
  safeObserveCommand(input.telemetry, {
    request: {
      commandId: 'SYNC_PLAYER_WORLD',
      playerId: input.playerId,
      requestId: syncRequestId,
      parameters: { targetWorldTick: target },
    },
    response: {
      success: true,
      commandId: 'SYNC_PLAYER_WORLD',
      requestId: syncRequestId,
      playerId: input.playerId,
      stateChanges: catchUp.stateChanges,
      events: catchUp.events,
      notifications: catchUp.notifications,
      presentation: null,
      resourcesChanged: catchUp.resourcesChanged,
      territoriesChanged: [],
      armiesChanged: [],
      newlyAvailableActions: [],
      errors: [],
      payload: {
        previousWorldTick: catchUp.previousWorldTick,
        worldTick: catchUp.worldTick,
        ticksAdvanced: catchUp.ticksAdvanced,
        chunks: catchUp.chunks,
        targetWorldTick: catchUp.targetWorldTick,
        worldAdvance: catchUp.worldAdvance,
        foodConsumption: catchUp.foodConsumption,
      },
    },
    state,
    worldId,
  });
  const pendingRetry = retryPendingWorkoutReward(state, input.playerId, {
    battle: registry.battle ?? undefined,
    history: registry.workoutHistory,
  });
  if (pendingRetry) {
    safeObservePersistence(input.telemetry, {
      operation: 'retry',
      playerId: input.playerId,
      worldId: loaded.ok ? loaded.record.worldId : DEFAULT_WORLD_ID,
      worldTick: state.worldTick,
      definitionWorldId: state.definitionWorldId,
      worldLevel: state.worldLevel,
      playerFactionId: state.playerFactionId,
      outcome: pendingRetry.ok ? 'ok' : 'failed',
      message: pendingRetry.ok ? undefined : pendingRetry.error?.message,
    });
  }

  const violations = checkGameStateInvariants(state);
  if (violations.length > 0) {
    return {
      ok: false,
      persisted: false,
      code: 'persistence.invalid_state',
      message: `Catch-up produced invalid GameState: ${violations[0]!.message}`,
      details: { violations },
    };
  }

  const saved = input.store.save(input.playerId, state, expectedVersion);
  observeSaveResult(input.telemetry, {
    playerId: input.playerId,
    worldId: saved.ok ? saved.record.worldId : DEFAULT_WORLD_ID,
    worldTick: state.worldTick,
    definitionWorldId: state.definitionWorldId,
    worldLevel: state.worldLevel,
    playerFactionId: state.playerFactionId,
    result: saved,
  });
  if (!saved.ok) {
    return saved;
  }
  return {
    ok: true,
    persisted: true,
    state: cloneGameState(state),
    record: saved.record,
    catchUp,
    pendingRetry: pendingRetry
      ? { ok: pendingRetry.ok, alreadyProcessed: pendingRetry.alreadyProcessed, sessionId: pendingRetry.sessionId }
      : undefined,
  };
}
