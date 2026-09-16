import { BALANCE } from '../constants/balance';
import { progressWorldEconomy } from '../gameplay/economy/worldProgress';
import type { FoodConsumptionFactionResult, FoodConsumptionResult } from '../gameplay/economy/foodConsumption';
import { defenseCompletionDeadlineTick, isOpenInvasion } from '../gameplay/invasion/deadlines';
import { isPlayerEmpirePaused, playerFacingTick } from '../gameplay/invasion/eligibility';
import { progressExpiredInvasions } from '../gameplay/invasion/progress';
import { persistTerminalSessionHistory } from '../fitness/history/persistSession';
import { GameState } from '../types/GameState';
import { withRequestParameters } from '../orchestration/helpers';
import { handleAdvanceWorld, HandlerContext } from '../orchestration/handlers';
import { GameEvent, HandlerResult, Notification, ResourceChange, StateChange } from '../orchestration/protocol';
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
  events: GameEvent[];
  stateChanges: StateChange[];
  notifications: Notification[];
  resourcesChanged: ResourceChange[];
  foodConsumption: FoodConsumptionResult;
  /** Merged ADVANCE_WORLD inspectable result (AI / events / movements). */
  worldAdvance: WorldAdvanceResult;
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

function mergeAdvance(into: { handler: HandlerResult }, inner: HandlerResult): void {
  into.handler.stateChanges.push(...inner.stateChanges);
  into.handler.events.push(...inner.events);
  into.handler.notifications.push(...inner.notifications);
  into.handler.resourcesChanged.push(...inner.resourcesChanged);
  if (inner.errors) {
    into.handler.errors = [...(into.handler.errors ?? []), ...inner.errors];
  }
}

function emptyFoodConsumption(fromTick: number, toTick = fromTick): FoodConsumptionResult {
  return { cycles: 0, gated: false, fromTick, toTick, factions: [] };
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseFactionRow(value: unknown): FoodConsumptionFactionResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.factionId !== 'string' || rec.factionId.length === 0) return null;
  return {
    factionId: rec.factionId,
    demandPerCycle: finiteNumber(rec.demandPerCycle),
    cycles: finiteNumber(rec.cycles),
    demand: finiteNumber(rec.demand),
    paid: finiteNumber(rec.paid),
    failedCycles: finiteNumber(rec.failedCycles),
    foodBefore: finiteNumber(rec.foodBefore),
    foodAfter: finiteNumber(rec.foodAfter),
    stabilityBefore: finiteNumber(rec.stabilityBefore),
    stabilityAfter: finiteNumber(rec.stabilityAfter),
  };
}

function parseFoodConsumption(value: unknown): FoodConsumptionResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.cycles !== 'number' || !Number.isFinite(rec.cycles)) return null;
  const factions: FoodConsumptionFactionResult[] = [];
  if (Array.isArray(rec.factions)) {
    for (const row of rec.factions) {
      const parsed = parseFactionRow(row);
      if (parsed) factions.push(parsed);
    }
  }
  return {
    cycles: rec.cycles,
    gated: rec.gated === true,
    fromTick: finiteNumber(rec.fromTick),
    toTick: finiteNumber(rec.toTick),
    factions,
  };
}

function mergeFactionRow(into: FoodConsumptionFactionResult[], row: FoodConsumptionFactionResult): void {
  const existing = into.find((entry) => entry.factionId === row.factionId);
  if (!existing) {
    into.push({ ...row });
    return;
  }
  existing.demandPerCycle = row.demandPerCycle;
  existing.cycles += row.cycles;
  existing.demand += row.demand;
  existing.paid += row.paid;
  existing.failedCycles += row.failedCycles;
  existing.foodAfter = row.foodAfter;
  existing.stabilityAfter = row.stabilityAfter;
}

function mergeFoodConsumption(into: FoodConsumptionResult, add: FoodConsumptionResult): void {
  into.toTick = add.toTick;
  if (add.cycles <= 0 && add.factions.length === 0) {
    if (into.cycles === 0) into.gated = add.gated || into.gated;
    return;
  }
  if (into.cycles === 0 && into.factions.length === 0) {
    into.fromTick = add.fromTick;
    into.gated = add.gated;
  } else {
    into.gated = into.gated && add.gated;
  }
  into.cycles += add.cycles;
  for (const row of add.factions) mergeFactionRow(into.factions, row);
}

function emptyCatchUpAdvance(state: GameState): WorldAdvanceResult {
  const time = { worldTick: state.worldTick, turn: state.turn };
  return {
    previousWorldTime: { ...time },
    newWorldTime: { ...time },
    previousWorldTick: time.worldTick,
    newWorldTick: time.worldTick,
    ticksAdvanced: 0,
    aiDecisions: [],
    commitmentProgress: [],
    commitmentResolutions: [],
    eventResults: [],
    movementResults: [],
    stateChanges: [],
    notifications: [],
    errors: [],
    events: [],
  };
}

function appendAdvanceRecords(into: WorldAdvanceResult, payload: Record<string, unknown>): void {
  const raw = payload.worldAdvance;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const inner = raw as WorldAdvanceResult;
  if (Array.isArray(inner.aiDecisions)) into.aiDecisions.push(...inner.aiDecisions);
  if (Array.isArray(inner.commitmentProgress)) into.commitmentProgress.push(...inner.commitmentProgress);
  if (Array.isArray(inner.commitmentResolutions)) into.commitmentResolutions.push(...inner.commitmentResolutions);
  if (Array.isArray(inner.eventResults)) into.eventResults.push(...inner.eventResults);
  if (Array.isArray(inner.movementResults)) into.movementResults.push(...inner.movementResults);
  if (Array.isArray(inner.errors)) into.errors.push(...inner.errors);
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
  const worldAdvance = emptyCatchUpAdvance(state);
  const foodConsumption = emptyFoodConsumption(previousWorldTick);
  const result = {
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
  mergeFoodConsumption(foodConsumption, progressWorldEconomy(state));
  flushAbandonedHistory(state, ctx);

  while (state.worldTick < targetWorldTick) {
    const step = nextCatchUpElapsedTicks(state, targetWorldTick);
    const inner = withRequestParameters(ctx.req, { elapsedTicks: step }, () => handleAdvanceWorld(state, ctx));
    mergeAdvance(result, inner);
    appendAdvanceRecords(worldAdvance, inner.payload);
    const chunkFood = parseFoodConsumption(inner.payload.foodConsumption);
    if (chunkFood) mergeFoodConsumption(foodConsumption, chunkFood);
    result.chunks += 1;
    flushAbandonedHistory(state, ctx);
  }

  result.worldTick = state.worldTick;
  result.ticksAdvanced = state.worldTick - previousWorldTick;
  worldAdvance.events = result.handler.events;
  worldAdvance.stateChanges = result.handler.stateChanges;
  worldAdvance.notifications = result.handler.notifications;
  worldAdvance.newWorldTick = state.worldTick;
  worldAdvance.newWorldTime = { worldTick: state.worldTick, turn: state.turn };
  worldAdvance.ticksAdvanced = result.ticksAdvanced;
  return {
    previousWorldTick: result.previousWorldTick,
    worldTick: result.worldTick,
    ticksAdvanced: result.ticksAdvanced,
    chunks: result.chunks,
    targetWorldTick: result.targetWorldTick,
    events: result.handler.events,
    stateChanges: result.handler.stateChanges,
    notifications: result.handler.notifications,
    resourcesChanged: result.handler.resourcesChanged,
    foodConsumption,
    worldAdvance,
  };
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
    stateChanges: catchUp.stateChanges,
    events: catchUp.events,
    notifications: catchUp.notifications,
    resourcesChanged: catchUp.resourcesChanged,
    payload: {
      previousWorldTick: catchUp.previousWorldTick,
      worldTick: catchUp.worldTick,
      ticksAdvanced: catchUp.ticksAdvanced,
      chunks: catchUp.chunks,
      targetWorldTick: catchUp.targetWorldTick,
      worldAdvance: catchUp.worldAdvance,
      foodConsumption: catchUp.foodConsumption,
    },
  };
}
