import { BALANCE } from '../constants/balance';
import { progressWorldEconomy } from '../gameplay/economy/worldProgress';
import { defenseCompletionDeadlineTick, isOpenInvasion } from '../gameplay/invasion/deadlines';
import { isPlayerEmpirePaused, playerFacingTick } from '../gameplay/invasion/eligibility';
import { progressExpiredInvasions } from '../gameplay/invasion/progress';
import { persistTerminalSessionHistory } from '../fitness/history/persistSession';
import { GameState } from '../types/GameState';
import { withRequestParameters } from '../orchestration/helpers';
import { handleAdvanceWorld, HandlerContext } from '../orchestration/handlers';
import { HandlerResult } from '../orchestration/protocol';
import { OrchestrationError, ErrorCode } from '../orchestration/errors';
import { PersistenceError } from '../persistence/errors';
import { resolveAuthoritativeTargetTick } from '../persistence/timeAuthority';
import { WorldAdvanceResult } from './ContinuousWorldEngine';

export interface CatchUpWorldResult {
  previousWorldTick: number;
  worldTick: number;
  ticksAdvanced: number;
  chunks: number;
  targetWorldTick: number;
}

function emptyHandlerResult(): HandlerResult {
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

function invasionExpiryTick(invasion: {
  status: string;
  responseDeadlineTick: number;
  defenseCompletionDeadlineTick: number | null;
  defenseWorkoutStartedAtTick: number | null;
}): number | null {
  if (invasion.status === 'pending_response') {
    return invasion.responseDeadlineTick + 1;
  }
  if (invasion.status === 'defense_in_progress') {
    const deadline = invasion.defenseCompletionDeadlineTick
      ?? (invasion.defenseWorkoutStartedAtTick !== null
        ? defenseCompletionDeadlineTick(invasion.defenseWorkoutStartedAtTick)
        : null);
    return deadline === null ? null : deadline + 1;
  }
  return null;
}

/**
 * Next ADVANCE_WORLD elapsedTicks for offline catch-up.
 * Caps at the existing 64-tick command limit and snaps to the next
 * player-facing invasion expiry so deadline resolution matches 1-tick
 * progression (cooldown stamps, no refreshed response window).
 */
export function nextCatchUpElapsedTicks(state: GameState, targetWorldTick: number): number {
  const now = state.worldTick;
  if (targetWorldTick <= now) return 0;
  let step = Math.min(BALANCE.world.maxElapsedTicksPerAdvance, targetWorldTick - now);
  if (!isPlayerEmpirePaused(state)) {
    for (const invasion of state.activeInvasions.values()) {
      if (!isOpenInvasion(invasion)) continue;
      const expiry = invasionExpiryTick(invasion);
      if (expiry === null || expiry <= now) continue;
      step = Math.min(step, expiry - now);
    }
  }
  return Math.max(1, step);
}

function mergeAdvance(into: CatchUpWorldResult & { handler: HandlerResult }, inner: HandlerResult): void {
  into.handler.stateChanges.push(...inner.stateChanges);
  into.handler.events.push(...inner.events);
  into.handler.notifications.push(...inner.notifications);
  if (inner.errors) {
    into.handler.errors = [...(into.handler.errors ?? []), ...inner.errors];
  }
}

function flushAbandonedHistory(state: GameState, ctx: HandlerContext): void {
  persistTerminalSessionHistory(ctx.registry.workoutHistory, state.playerFitness.activeSession, {
    completedAtWorldTick: playerFacingTick(state),
  });
}

/**
 * Advance `state` to `targetWorldTick` by repeating the existing
 * ADVANCE_WORLD simulation in deterministic chunks. Does not persist.
 */
export function catchUpWorld(state: GameState, ctx: HandlerContext, targetWorldTick: number): CatchUpWorldResult {
  if (!Number.isInteger(targetWorldTick) || targetWorldTick < 0) {
    throw new OrchestrationError(ErrorCode.INVALID_PARAMETER, 'targetWorldTick must be a non-negative integer', {
      targetWorldTick,
    });
  }
  if (targetWorldTick < state.worldTick) {
    throw new OrchestrationError(ErrorCode.TIME_UNAUTHORIZED, 'Cannot rewind worldTick during catch-up', {
      targetWorldTick,
      worldTick: state.worldTick,
    });
  }

  const previousWorldTick = state.worldTick;
  const handler = emptyHandlerResult();
  const result: CatchUpWorldResult & { handler: HandlerResult } = {
    previousWorldTick,
    worldTick: state.worldTick,
    ticksAdvanced: 0,
    chunks: 0,
    targetWorldTick,
    handler,
  };

  try {
    const expired = progressExpiredInvasions(state, ctx.registry.requireBattle());
    for (const extra of expired) mergeAdvance(result, extra);
  } catch (err) {
    if (!(err instanceof OrchestrationError)) throw err;
  }
  progressWorldEconomy(state);
  flushAbandonedHistory(state, ctx);

  while (state.worldTick < targetWorldTick) {
    const step = nextCatchUpElapsedTicks(state, targetWorldTick);
    const inner = withRequestParameters(ctx.req, { elapsedTicks: step }, () => handleAdvanceWorld(state, ctx));
    mergeAdvance(result, inner);
    result.chunks += 1;
    flushAbandonedHistory(state, ctx);
  }

  result.worldTick = state.worldTick;
  result.ticksAdvanced = state.worldTick - previousWorldTick;
  return result;
}

export function handleSyncPlayerWorld(state: GameState, ctx: HandlerContext): HandlerResult {
  const authority = ctx.registry.timeAuthority;
  if (!authority) {
    throw new OrchestrationError(
      ErrorCode.ENGINE_UNAVAILABLE,
      'World time authority is not registered',
      { engine: 'timeAuthority' },
    );
  }
  const requested = ctx.req.parameters && Object.prototype.hasOwnProperty.call(ctx.req.parameters, 'targetWorldTick')
    ? ctx.req.parameters.targetWorldTick
    : undefined;
  if (requested !== undefined && (typeof requested !== 'number' || !Number.isInteger(requested))) {
    throw new OrchestrationError(ErrorCode.INVALID_PARAMETER, 'targetWorldTick must be a finite integer', {
      targetWorldTick: requested,
    });
  }
  let target: number;
  try {
    target = resolveAuthoritativeTargetTick({
      authority,
      requestedTick: typeof requested === 'number' ? requested : undefined,
      currentTick: state.worldTick,
    });
  } catch (err) {
    if (err instanceof PersistenceError) {
      throw new OrchestrationError(
        err.code === 'persistence.time_unauthorized' ? ErrorCode.TIME_UNAUTHORIZED : ErrorCode.INVALID_PARAMETER,
        err.message,
        err.details,
      );
    }
    throw err;
  }

  const catchUp = catchUpWorld(state, ctx, target);
  return {
    ...emptyHandlerResult(),
    payload: {
      ...catchUp,
      worldAdvance: {
        previousWorldTick: catchUp.previousWorldTick,
        newWorldTick: catchUp.worldTick,
        ticksAdvanced: catchUp.ticksAdvanced,
      } satisfies Partial<WorldAdvanceResult>,
    },
  };
}
