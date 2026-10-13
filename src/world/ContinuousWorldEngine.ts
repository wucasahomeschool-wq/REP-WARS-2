import {progressTradeShipments} from '../gameplay/trade/trade';
import { progressRecruitment, settleRecruitmentWorldBoundary } from '../gameplay/recruitment/recruitment';
import { nextAiWorldBoundary, commitAiWorldBoundary } from './aiTemporal';
import { activeOperations, settleOperation } from '../engine/operations';
import { progressAllConstructions, displayedRemainingTicks } from '../gameplay/construction/progress';
import { playerFacingTick } from '../gameplay/invasion/eligibility';
import { BALANCE } from '../constants/balance';
import { isActiveCommitmentStatus, isFactionEliminated } from '../engine/DecisionEngine';
import { isUnsupportedCommitmentAction } from '../engine/executableActions';
import { OrchestrationError, ErrorCode } from '../orchestration/errors';
import type { OrchestrationErrorBody } from '../orchestration/errors';
import {
  GameEvent,
  HandlerResult,
  Notification,
  StateChange,
} from '../orchestration/protocol';
import { GameState } from '../types/GameState';
import { FactionId } from '../types';
import { EventTickResult } from './eventTick';
import {
  isCommitmentReady,
  stampCommitmentTiming,
  ticksRemaining,
} from './worldTime';
import {
  isMovementCommitmentInFlight,
  movementResultsToHandlerBits,
  movementTicksRemaining,
  progressArmyMovements,
  type MovementTickResult,
} from '../army/movement';
import {
  invalidateStaleAttackIntents,
  isActiveAttackIntent,
  isStrategicAttackInFlight,
} from '../army/strategicAttack';
import { isLevel1TutorialAiSuppressed } from '../gameplay/tutorial/level1';

export interface WorldTimeStamp {
  worldTick: number;
  turn: number;
}

export interface WorldAiDecisionRecord {
  factionId: FactionId;
  commitmentId: string;
  action: string;
  targetId: string | null;
  worldTick: number;
}

export interface WorldCommitmentProgressRecord {
  factionId: FactionId;
  commitmentId: string;
  action: string;
  status: string;
  startedAtTick: number | null;
  durationTicks: number;
  ticksRemaining: number;
  worldTick: number;
}

export interface WorldCommitmentResolutionRecord {
  factionId: FactionId;
  commitmentId: string;
  action: string;
  outcome: string;
  success: boolean;
  worldTick: number;
  errors?: OrchestrationErrorBody[];
}

export interface WorldEventStepResult {
  turn: number;
  worldTick: number;
  triggered: number;
  summary: string[];
  historyLength: number;
}

/**
 * Inspectable result of one `ADVANCE_WORLD` / `advance()` call.
 * Deterministic given identical GameState, world seed, elapsed ticks, and
 * prior commands. Does not include engine internals (WarlordState, RNG).
 */
export interface WorldAdvanceResult {
  previousWorldTime: WorldTimeStamp;
  newWorldTime: WorldTimeStamp;
  previousWorldTick: number;
  newWorldTick: number;
  ticksAdvanced: number;
  aiDecisions: WorldAiDecisionRecord[];
  commitmentProgress: WorldCommitmentProgressRecord[];
  commitmentResolutions: WorldCommitmentResolutionRecord[];
  eventResults: WorldEventStepResult[];
  movementResults: MovementTickResult[];
  stateChanges: StateChange[];
  notifications: Notification[];
  errors: OrchestrationErrorBody[];
  events: GameEvent[];
}

export interface WorldAdvanceOptions {
  /**
   * Catch-up inspectable mode. Simulation and GameState are unchanged.
   * Drops per-tick worldTick / progress / empty event / in-flight movement
   * records that a returning client does not need.
   */
  compactInspectable?: boolean;
}

/**
 * Host callbacks into existing Orchestrator handlers. The Continuous World
 * Engine must not implement a second AI execution path or event engine.
 */
export interface WorldSimulationHost {
  progressProactive(atMs: number, allowEndpointDecision?: boolean): HandlerResult;
  decide(factionId: FactionId): HandlerResult;
  resolve(factionId: FactionId, operationId?: string): HandlerResult;
  runEventTurn(): EventTickResult;
  rebindRuntime(state: GameState): void;
  completeCommitment(operationId: string, reason: string): HandlerResult;
  failCommitment(operationId: string, reason: string): HandlerResult;
  interruptCommitment(operationId: string, reason: string): HandlerResult;
  executePendingAttack(armyId: string): HandlerResult;
  resolveInvalidatedInvasions?(): HandlerResult[];
  resolveDeadlineGates?(): HandlerResult[];
  refreshWorldFacts?(): void;
}

function emptyAdvanceResult(time: WorldTimeStamp, ticksAdvanced: number): WorldAdvanceResult {
  return {
    previousWorldTime: { ...time },
    newWorldTime: { ...time },
    previousWorldTick: time.worldTick,
    newWorldTick: time.worldTick,
    ticksAdvanced,
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

function appendHandler(result: WorldAdvanceResult, inner: HandlerResult, compactInspectable = false): void {
  if (compactInspectable) {
    for (const change of inner.stateChanges) {
      if (change.entity === 'territory' || (change.entity === 'army' && change.field === 'location')) {
        result.stateChanges.push(change);
      }
    }
    for (const note of inner.notifications) {
      if (note.severity !== 'info') result.notifications.push(note);
    }
  } else {
    result.stateChanges.push(...inner.stateChanges);
    result.notifications.push(...inner.notifications);
  }
  result.events.push(...inner.events);
  if(!compactInspectable && Array.isArray(inner.payload.proactiveDecisions))
    result.aiDecisions.push(...inner.payload.proactiveDecisions as WorldAiDecisionRecord[]);
  if(Array.isArray(inner.payload.proactiveResolutions))
    result.commitmentResolutions.push(...inner.payload.proactiveResolutions as WorldCommitmentResolutionRecord[]);
  if (inner.errors) {
    result.errors.push(...inner.errors);
  }
}

function errorBody(err: unknown): OrchestrationErrorBody {
  if (err instanceof OrchestrationError) {
    return err.toBody();
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: ErrorCode.ENGINE_ERROR, message };
}

function sortedAiFactionIds(state: GameState): FactionId[] {
  return state.allFactionIds
    .filter((id) => id !== state.playerFactionId)
    .slice()
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function progressRecord(
  state: GameState,
  operationId: string,
): WorldCommitmentProgressRecord | null {
  const c = state.operations.get(operationId);
  const factionId = c?.warlordId ?? '';
  if (!c || !isActiveCommitmentStatus(c.status)) {
    return null;
  }
  if (c.phase === 'selected') stampCommitmentTiming(c, state.worldTick);
  let started = c.startedAtTick ?? null;
  let duration = c.phase === 'selected' ? c.durationTicks ?? 0 : 0;
  let remaining = c.phase === 'selected' ? ticksRemaining(c, state.worldTick) : 0;
  const army = c.links.armyId ? state.armies.get(c.links.armyId) : undefined;
  const project = c.links.constructionId ? state.constructions.get(c.links.constructionId) : undefined;
  const invasion = c.links.invasionId ? state.activeInvasions.get(c.links.invasionId) : undefined;
  if (army?.movement) {
    started = army.movement.startedAtTick; duration = army.movement.durationTicks;
    remaining = movementTicksRemaining(army.movement, state.worldTick);
  } else if (project) {
    started = project.startedAtTick; duration = project.durationTicks;
    remaining = displayedRemainingTicks(project, state.worldTick);
  } else if (invasion) {
    started = invasion.defenseWorkoutStartedAtTick ?? invasion.notifiedAtTick;
    const deadline = invasion.defenseCompletionDeadlineTick ?? invasion.responseDeadlineTick;
    duration = deadline - started; remaining = Math.max(0, deadline - playerFacingTick(state));
  }
  return {
    factionId,
    commitmentId: c.id,
    action: c.action,
    status: c.status,
    startedAtTick: started,
    durationTicks: duration,
    ticksRemaining: remaining,
    worldTick: state.worldTick,
  };
}

/** Advance existing deterministic domain boundaries, then progress every
 * canonical operation by stable ID. Physical movement keeps army-ID order;
 * construction keeps project-ID order. Canonical opportunities coalesce cognition;
 * existing physical operation count never gates a new decision.
 */
export class ContinuousWorldEngine {
  private compactInspectable = false;

  advance(
    state: GameState,
    elapsedTicks: number,
    host: WorldSimulationHost,
    options?: WorldAdvanceOptions,
  ): WorldAdvanceResult {
    this.compactInspectable = options?.compactInspectable === true;
    if (!Number.isInteger(elapsedTicks) || !Number.isFinite(elapsedTicks) || elapsedTicks < 0) {
      throw new OrchestrationError(
        ErrorCode.INVALID_PARAMETER,
        'elapsedTicks must be a non-negative integer',
        { elapsedTicks },
      );
    }
    const previous: WorldTimeStamp = { worldTick: state.worldTick, turn: state.turn };
    const result = emptyAdvanceResult(previous, elapsedTicks);
    if (elapsedTicks === 0) {
      return result;
    }

    progressRecruitment(state);
    host.rebindRuntime(state);
    const ticksPerEventTurn = BALANCE.world.ticksPerEventTurn;

    for (let step = 0; step < elapsedTicks; step++) {
      const aiInstant=nextAiWorldBoundary(state);
      if(aiInstant!==null) appendHandler(result,host.progressProactive!(aiInstant,false),this.compactInspectable);
      state.worldTick += 1;
      if (!this.compactInspectable) {
        result.stateChanges.push({
          entity: 'world',
          id: 'worldTick',
          field: 'worldTick',
          from: state.worldTick - 1,
          to: state.worldTick,
          summary: `World tick ${state.worldTick - 1} → ${state.worldTick}`,
        });
      }

      settleRecruitmentWorldBoundary(state);
      this.advanceArmyMovements(state, host, result);
      const constructing = activeOperations(state).filter(o => o.action === 'BUILD' && o.phase !== 'selected').map(o => o.id);
      progressAllConstructions(state);
      progressTradeShipments(state); // Physical delivery precedes deadline gates and world-event choices.
      for (const id of constructing) {
        const op = state.operations.get(id)!;
        if (op.terminal) result.commitmentResolutions.push({ factionId: op.warlordId, commitmentId: id,
          action: op.action, outcome: op.terminal.outcome, success: op.terminal.outcome === 'completed', worldTick: state.worldTick });
      }
      // Same-boundary consequences precede observation: arrival/completion,
      // interruption, existing deadline gates, world facts, then cognition.
      for (const invalidated of host.resolveInvalidatedInvasions?.() ?? []) appendHandler(result, invalidated, this.compactInspectable);
      this.reconcileOrphanMovementCommitments(state, host, result);
      for (const expired of host.resolveDeadlineGates?.() ?? []) appendHandler(result, expired, this.compactInspectable);
      if (ticksPerEventTurn > 0 && state.worldTick % ticksPerEventTurn === 0) {
        const eventStep = host.runEventTurn();
        if (!this.compactInspectable || eventStep.triggered > 0) {
          result.eventResults.push({
            turn: eventStep.turn,
            worldTick: state.worldTick,
            triggered: eventStep.triggered,
            summary: eventStep.summary,
            historyLength: eventStep.historyLength,
          });
        }
        result.stateChanges.push(...eventStep.stateChanges);
        if (this.compactInspectable) {
          for (const event of eventStep.events) {
            if (event.kind === 'world' && String(event.id).startsWith('sum_')) continue;
            result.events.push(event);
          }
        } else {
          result.events.push(...eventStep.events);
        }
        if (eventStep.triggered > 0 && !this.compactInspectable) {
          result.notifications.push({
            severity: 'info',
            title: 'World events',
            body: `Turn ${eventStep.turn}: ${eventStep.triggered} event(s) triggered`,
          });
        }
        host.rebindRuntime(state);
      }

      host.refreshWorldFacts?.();
      {
        for(const op of activeOperations(state).filter(o=>o.phase==='selected'&&o.warlordId!==state.playerFactionId)) {
          stampCommitmentTiming(op,state.worldTick);
          if(isCommitmentReady(op,state.worldTick)||isUnsupportedCommitmentAction(op.action))
            this.resolveFaction(state,op.warlordId,host,result,op.id);
        }
        if(aiInstant!==null) {
          commitAiWorldBoundary(state,aiInstant);
          appendHandler(result,host.progressProactive(aiInstant,true),this.compactInspectable);
        }
      }
    }

    if (this.compactInspectable && state.worldTick !== previous.worldTick) {
      result.stateChanges.push({
        entity: 'world',
        id: 'worldTick',
        field: 'worldTick',
        from: previous.worldTick,
        to: state.worldTick,
        summary: `World tick ${previous.worldTick} → ${state.worldTick}`,
      });
    }

    result.newWorldTime = { worldTick: state.worldTick, turn: state.turn };
    result.newWorldTick = state.worldTick;
    return result;
  }

  private resolveFaction(
    state: GameState,
    factionId: FactionId,
    host: WorldSimulationHost,
    result: WorldAdvanceResult, operationId: string,
  ): void {
    const before = state.operations.get(operationId);
    if (!before || !isActiveCommitmentStatus(before.status)) {
      return;
    }
    const commitmentId = before.id;
    const action = before.action;
    const inner = host.resolve(factionId, operationId);
    appendHandler(result, inner, this.compactInspectable);

    const after = state.operations.get(operationId);
    const outcome = typeof inner.payload.commitmentOutcome === 'string'
      ? inner.payload.commitmentOutcome
      : (after && !isActiveCommitmentStatus(after.status) ? after.status : 'unknown');
    result.commitmentResolutions.push({
      factionId,
      commitmentId,
      action,
      outcome,
      success: inner.commandSuccess !== false,
      worldTick: state.worldTick,
      errors: inner.errors,
    });
  }

  private advanceArmyMovements(
    state: GameState,
    host: WorldSimulationHost,
    result: WorldAdvanceResult,
  ): void {
    this.failStaleStrategicAttacks(state, host, result);
    const ticks = progressArmyMovements(state, state.worldTick);
    if (ticks.length > 0) {
      const inspectableMovements = this.compactInspectable
        ? ticks.filter((ev) => ev.status !== 'moving')
        : ticks;
      result.movementResults.push(...inspectableMovements);
      if (inspectableMovements.length > 0) {
        const bits = movementResultsToHandlerBits(inspectableMovements);
        result.stateChanges.push(...bits.stateChanges);
      }
      for (const ev of ticks) {
        if (ev.status === 'arrived') {
          const army = state.armies.get(ev.armyId);
          if (army && isActiveAttackIntent(army)) {
            continue;
          }
        }
        if (!ev.commitmentId) continue;
        const factionId = ev.owner;
        const commitment = state.operations.get(ev.commitmentId);
        if (!commitment || commitment.id !== ev.commitmentId) continue;
        if (!isActiveCommitmentStatus(commitment.status)) continue;
        if (commitment.action === 'ATTACK' && commitment.phase !== 'recovery' && ev.status === 'arrived') continue;
        const inner = ev.status === 'arrived'
          ? commitment.phase === 'recovery' ? host.failCommitment(commitment.id, commitment.statusReason ?? 'invalid objective reached physical arrival') : host.completeCommitment(commitment.id, 'army arrived')
          : ev.status === 'interrupted'
            ? host.interruptCommitment(commitment.id, ev.reason ?? 'movement interrupted')
            : host.failCommitment(commitment.id, ev.reason ?? 'movement failed');
        appendHandler(result, inner, this.compactInspectable);

        result.commitmentResolutions.push({
          factionId,
          commitmentId: ev.commitmentId,
          action: commitment.action,
          outcome: commitment.status,
          success: commitment.status === 'completed',
          worldTick: state.worldTick,
        });
        result.notifications.push({
          severity: ev.status === 'arrived' ? 'info' : 'warning',
          title: ev.status === 'arrived' ? 'Army arrived' : 'Movement interrupted',
          body: `${ev.armyId} ${ev.originTerritoryId} → ${ev.destinationTerritoryId}`,
        });
      }
    }

    const ready = [...state.armies.values()]
      .filter((a) => isActiveAttackIntent(a) && !a.movement)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const army of ready) {
      if (!isActiveAttackIntent(army)) continue;
      const intent = { ...army.attackIntent! };
      const inner = host.executePendingAttack(army.id);
      appendHandler(result, inner, this.compactInspectable);
      if (inner.payload.skipped === true || inner.payload.attackOutcome === 'skipped') continue;

      const outcome = typeof inner.payload.commitmentOutcome === 'string'
        ? inner.payload.commitmentOutcome
        : typeof inner.payload.attackOutcome === 'string'
          ? String(inner.payload.attackOutcome)
          : 'unknown';
      if (intent.commitmentId) {
        result.commitmentResolutions.push({
          factionId: army.owner,
          commitmentId: intent.commitmentId,
          action: 'ATTACK',
          outcome,
          success: state.operations.get(intent.commitmentId)?.terminal?.outcome === 'completed',
          worldTick: state.worldTick,
          errors: inner.errors,
        });
      }
      result.notifications.push({
        severity: inner.payload.attackOutcome === 'battle_resolved' ? 'info' : 'warning',
        title: inner.payload.attackOutcome === 'battle_resolved' ? 'Delayed attack resolved' : 'Pending attack failed',
        body: `${army.id} → ${intent.targetTerritoryId}`,
      });
    }
  }

  private failStaleStrategicAttacks(
    state: GameState,
    host: WorldSimulationHost,
    result: WorldAdvanceResult,
  ): void {
    const stale = invalidateStaleAttackIntents(state);
    for (const item of stale) {
      result.stateChanges.push({
        entity: 'army',
        id: item.armyId,
        field: 'attackIntent',
        from: item.commitmentId,
        to: null,
        summary: `Pending attack invalidated: ${item.reason}`,
      });
      result.notifications.push({
        severity: 'warning',
        title: 'Pending attack failed',
        body: `${item.armyId}: ${item.reason}`,
      });
      if (!item.commitmentId) continue;
      const commitment = state.operations.get(item.commitmentId);
      if (!commitment || commitment.id !== item.commitmentId || !isActiveCommitmentStatus(commitment.status)) {
        continue;
      }
      const inner = host.failCommitment(commitment.id, item.reason);
      appendHandler(result, inner, this.compactInspectable);

      result.commitmentResolutions.push({
        factionId: item.owner,
        commitmentId: item.commitmentId,
        action: 'ATTACK',
        outcome: commitment.phase === 'recovery' ? 'recovering' : commitment.status,
        success: false,
        worldTick: state.worldTick,
      });
    }
  }

  private reconcileOrphanMovementCommitments(
    state: GameState,
    host: WorldSimulationHost,
    result: WorldAdvanceResult,
  ): void {
    for (const c of activeOperations(state)) {
      if (c.phase === 'selected') continue;
      if (c.action === 'BUILD') {
        const p = c.links.constructionId ? state.constructions.get(c.links.constructionId) : undefined;
        if (!p) settleOperation(state, c.id, 'failed', 'linked construction destroyed or cancelled');
        continue;
      }
      if (c.links.invasionId && state.activeInvasions.has(c.links.invasionId)) continue;
      if (!['MOVE','RETREAT','ATTACK'].includes(c.action)) continue;
      if (isStrategicAttackInFlight(state, c.id) || isMovementCommitmentInFlight(state, c.id)) continue;
      const inner = host.failCommitment(c.id, 'physical force lifecycle is gone');
      appendHandler(result, inner, this.compactInspectable);

      result.commitmentResolutions.push({ factionId: c.warlordId, commitmentId: c.id,
        action: c.action, outcome: 'failed', success: false, worldTick: state.worldTick });
    }
  }
}
