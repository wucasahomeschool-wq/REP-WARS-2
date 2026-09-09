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
  canReassessFaction,
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

/**
 * Host callbacks into existing Orchestrator handlers. The Continuous World
 * Engine must not implement a second AI execution path or event engine.
 */
export interface WorldSimulationHost {
  decide(factionId: FactionId): HandlerResult;
  resolve(factionId: FactionId): HandlerResult;
  runEventTurn(): EventTickResult;
  rebindRuntime(state: GameState): void;
  completeCommitment(factionId: FactionId, reason: string): HandlerResult;
  failCommitment(factionId: FactionId, reason: string): HandlerResult;
  interruptCommitment(factionId: FactionId, reason: string): HandlerResult;
  executePendingAttack(armyId: string): HandlerResult;
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

function appendHandler(result: WorldAdvanceResult, inner: HandlerResult): void {
  result.stateChanges.push(...inner.stateChanges);
  result.events.push(...inner.events);
  result.notifications.push(...inner.notifications);
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

function markLastDecision(state: GameState, factionId: FactionId, worldTick: number): void {
  state.lastAiDecisionTick.set(factionId, worldTick);
}

function progressRecord(
  state: GameState,
  factionId: FactionId,
): WorldCommitmentProgressRecord | null {
  const c = state.commitments.get(factionId);
  if (!c || !isActiveCommitmentStatus(c.status)) {
    return null;
  }
  stampCommitmentTiming(c, state.worldTick);
  let remaining = ticksRemaining(c, state.worldTick);
  if ((c.action === 'MOVE' || c.action === 'RETREAT') && isMovementCommitmentInFlight(state, c.id)) {
    const army = [...state.armies.values()].find((a) => a.movement?.commitmentId === c.id);
    if (army?.movement) {
      remaining = movementTicksRemaining(army.movement, state.worldTick);
    }
  }
  if (c.action === 'ATTACK' && isStrategicAttackInFlight(state, c.id)) {
    const army = [...state.armies.values()].find((a) => a.attackIntent?.commitmentId === c.id);
    if (army?.movement) {
      remaining = movementTicksRemaining(army.movement, state.worldTick);
    }
  }
  return {
    factionId,
    commitmentId: c.id,
    action: c.action,
    status: c.status,
    startedAtTick: c.startedAtTick ?? null,
    durationTicks: c.durationTicks ?? 0,
    ticksRemaining: remaining,
    worldTick: state.worldTick,
  };
}

/**
 * Simulation coordinator: advances world time, AI commitment lifecycle, and
 * EventEngine steps. Does not score actions, resolve battles, or generate
 * maps. Player commands remain immediate via the Orchestrator.
 *
 * AI RUNTIME INTEGRATION PASS — canonical per-tick ordering (audited,
 * unchanged from Phase 13/15 except for the two additions noted below).
 * Within `advance()`, for EACH world tick, in this exact order:
 *
 *   1. `worldTick += 1`.
 *   2. EventEngine step, only every `BALANCE.world.ticksPerEventTurn`
 *      ticks (`runEventTurn` — may change territory owners/factions).
 *   3. `advanceArmyMovements`:
 *      a. `failStaleStrategicAttacks` — re-validate every pending
 *         `Army.attackIntent` against CURRENT state (post-event) and fail
 *         any that are no longer legal, BEFORE progressing movement or
 *         resolving anything else this tick. This must run first: an
 *         event that just changed the target's owner (step 2) must not
 *         let a stale attack intent survive into arrival handling.
 *      b. `progressArmyMovements` — advance in-flight MOVE/RETREAT/attack
 *         staging marches; complete/interrupt/fail their commitments on
 *         arrival (ATTACK commitments are deliberately left `executing`
 *         on arrival, not completed here — see (c)).
 *      c. Resolve every army that has ARRIVED with a still-active
 *         `attackIntent` (`host.executePendingAttack`), in sorted army-id
 *         order — this is where a delayed MOVE → ATTACK chain actually
 *         reaches BattleEngine.
 *   4. `advanceAiFactions` (sorted faction-id order):
 *      - An eliminated faction (`isFactionEliminated`) never decides —
 *        checked BEFORE reassessment cadence, so a faction that lost its
 *        last territory/army this same tick (via step 2 or 3) stops
 *        immediately rather than deciding once more with nothing left.
 *      - A faction with an `executing` MOVE/RETREAT commitment currently
 *        in flight, or an `executing` ATTACK commitment (immediate OR
 *        mid-staging-march), is skipped entirely — it does not
 *        `AI_DECIDE` again until that operation resolves. This is what
 *        prevents the AI from reassessing mid-march and abandoning an
 *        attack it already started staging.
 *      - Otherwise: reassessment-cadence check
 *        (`canReassessFaction`/`reassessmentIntervalTicks`), then
 *        `AI_DECIDE` → immediate resolution if the new commitment is
 *        already "ready" (duration-elapsed or unsupported).
 *   5. `reconcileOrphanMovementCommitments` — a last-resort sweep: an
 *      `executing` MOVE/RETREAT/ATTACK commitment whose army no longer
 *      exists or is no longer actually in flight (e.g. destroyed by an
 *      event mid-march) is failed here so it cannot stay active forever.
 *
 * Why battles never resolve "after" an AI already reassessed for the same
 * army: step 3c (attack arrival) and step 4's in-flight check happen
 * BEFORE that faction is offered a new `AI_DECIDE` in the same tick, and
 * an `executing` ATTACK commitment blocks reassessment entirely per (4)
 * until it resolves. Determinism: faction iteration is always sorted by
 * id (`sortedAiFactionIds`), pending-attack army iteration is sorted by
 * army id, and no step reads wall-clock time or unseeded randomness — see
 * docs/AI_RUNTIME_INTEGRATION.md, "Continuous-world ordering" and
 * docs/CONTINUOUS_WORLD_ARCHITECTURE.md.
 */
export class ContinuousWorldEngine {
  advance(state: GameState, elapsedTicks: number, host: WorldSimulationHost): WorldAdvanceResult {
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

    host.rebindRuntime(state);
    const ticksPerEventTurn = BALANCE.world.ticksPerEventTurn;

    for (let step = 0; step < elapsedTicks; step++) {
      state.worldTick += 1;
      result.stateChanges.push({
        entity: 'world',
        id: 'worldTick',
        field: 'worldTick',
        from: state.worldTick - 1,
        to: state.worldTick,
        summary: `World tick ${state.worldTick - 1} → ${state.worldTick}`,
      });

      if (ticksPerEventTurn > 0 && state.worldTick % ticksPerEventTurn === 0) {
        const eventStep = host.runEventTurn();
        result.eventResults.push({
          turn: eventStep.turn,
          worldTick: state.worldTick,
          triggered: eventStep.triggered,
          summary: eventStep.summary,
          historyLength: eventStep.historyLength,
        });
        result.stateChanges.push(...eventStep.stateChanges);
        result.events.push(...eventStep.events);
        if (eventStep.triggered > 0) {
          result.notifications.push({
            severity: 'info',
            title: 'World events',
            body: `Turn ${eventStep.turn}: ${eventStep.triggered} event(s) triggered`,
          });
        }
        host.rebindRuntime(state);
      }

      this.advanceArmyMovements(state, host, result);
      this.advanceAiFactions(state, host, result);
      this.reconcileOrphanMovementCommitments(state, host, result);
    }

    result.newWorldTime = { worldTick: state.worldTick, turn: state.turn };
    result.newWorldTick = state.worldTick;
    return result;
  }

  private advanceAiFactions(
    state: GameState,
    host: WorldSimulationHost,
    result: WorldAdvanceResult,
  ): void {
    for (const factionId of sortedAiFactionIds(state)) {
      try {
        this.advanceOneFaction(state, factionId, host, result);
      } catch (err) {
        result.errors.push(errorBody(err));
        result.notifications.push({
          severity: 'error',
          title: 'AI faction step failed',
          body: `${factionId}: ${errorBody(err).message}`,
        });
      }
    }
  }

  private advanceOneFaction(
    state: GameState,
    factionId: FactionId,
    host: WorldSimulationHost,
    result: WorldAdvanceResult,
  ): void {
    const existing = state.commitments.get(factionId);
    if (existing && isActiveCommitmentStatus(existing.status)) {
      stampCommitmentTiming(existing, state.worldTick);
      const progress = progressRecord(state, factionId);
      if (progress) {
        result.commitmentProgress.push(progress);
      }
      if ((existing.action === 'MOVE' || existing.action === 'RETREAT') && isMovementCommitmentInFlight(state, existing.id)) {
        return;
      }
      if (existing.action === 'ATTACK' && existing.status === 'executing') {
        return;
      }
      if (isCommitmentReady(existing, state.worldTick) || isUnsupportedCommitmentAction(existing.action)) {
        this.resolveFaction(state, factionId, host, result);
      }
      return;
    }

    // AI RUNTIME INTEGRATION PASS — eliminated factions do not reassess.
    // A faction with no territories and no armies (see
    // `isFactionEliminated`) has no executable action left except
    // faction-level diplomacy (NEGOTIATE/TRADE/DECLARE_WAR/OFFER_PEACE)
    // or WAIT — it would otherwise keep "deciding" forever as a ghost
    // empire. Any commitment it already had active still resolves/fails
    // normally above (a mid-flight army dying does not retroactively
    // erase its commitment); this only blocks starting a NEW decision.
    const snapshot = state.factions.get(factionId);
    if (snapshot && isFactionEliminated(snapshot)) {
      return;
    }

    if (!canReassessFaction(state.lastAiDecisionTick.get(factionId), state.worldTick)) {
      return;
    }

    const inner = host.decide(factionId);
    appendHandler(result, inner);
    markLastDecision(state, factionId, state.worldTick);

    const created = state.commitments.get(factionId);
    if (created && isActiveCommitmentStatus(created.status)) {
      stampCommitmentTiming(created, state.worldTick);
      result.aiDecisions.push({
        factionId,
        commitmentId: created.id,
        action: created.action,
        targetId: created.targetId,
        worldTick: state.worldTick,
      });
      result.notifications.push({
        severity: 'info',
        title: 'AI decision',
        body: `${factionId} committed ${created.action}`,
      });
      const progress = progressRecord(state, factionId);
      if (progress) {
        result.commitmentProgress.push(progress);
      }
      if (isCommitmentReady(created, state.worldTick) || isUnsupportedCommitmentAction(created.action)) {
        this.resolveFaction(state, factionId, host, result);
      }
    }
  }

  private resolveFaction(
    state: GameState,
    factionId: FactionId,
    host: WorldSimulationHost,
    result: WorldAdvanceResult,
  ): void {
    const before = state.commitments.get(factionId);
    if (!before || !isActiveCommitmentStatus(before.status)) {
      return;
    }
    const commitmentId = before.id;
    const action = before.action;
    const inner = host.resolve(factionId);
    appendHandler(result, inner);
    markLastDecision(state, factionId, state.worldTick);
    const after = state.commitments.get(factionId);
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
      result.movementResults.push(...ticks);
      const bits = movementResultsToHandlerBits(ticks);
      result.stateChanges.push(...bits.stateChanges);
      for (const ev of ticks) {
        if (ev.status === 'arrived') {
          const army = state.armies.get(ev.armyId);
          if (army && isActiveAttackIntent(army)) {
            continue;
          }
        }
        if (!ev.commitmentId) continue;
        const factionId = ev.owner;
        const commitment = state.commitments.get(factionId);
        if (!commitment || commitment.id !== ev.commitmentId) continue;
        if (!isActiveCommitmentStatus(commitment.status)) continue;
        if (commitment.action === 'ATTACK' && ev.status === 'arrived') continue;
        const inner = ev.status === 'arrived'
          ? host.completeCommitment(factionId, 'army arrived')
          : ev.status === 'interrupted'
            ? host.interruptCommitment(factionId, ev.reason ?? 'movement interrupted')
            : host.failCommitment(factionId, ev.reason ?? 'movement failed');
        appendHandler(result, inner);
        markLastDecision(state, factionId, state.worldTick);
        result.commitmentResolutions.push({
          factionId,
          commitmentId: ev.commitmentId,
          action: commitment.action,
          outcome: ev.status === 'arrived' ? 'completed' : ev.status,
          success: ev.status === 'arrived',
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
      appendHandler(result, inner);
      if (inner.payload.skipped === true || inner.payload.attackOutcome === 'skipped') continue;
      markLastDecision(state, army.owner, state.worldTick);
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
          success: inner.commandSuccess !== false && inner.payload.attackOutcome === 'battle_resolved',
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
      const commitment = state.commitments.get(item.owner);
      if (!commitment || commitment.id !== item.commitmentId || !isActiveCommitmentStatus(commitment.status)) {
        continue;
      }
      const inner = host.failCommitment(item.owner, item.reason);
      appendHandler(result, inner);
      markLastDecision(state, item.owner, state.worldTick);
      result.commitmentResolutions.push({
        factionId: item.owner,
        commitmentId: item.commitmentId,
        action: 'ATTACK',
        outcome: 'failed',
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
    const factionIds = [...state.allFactionIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const factionId of factionIds) {
      const c = state.commitments.get(factionId);
      if (!c || !isActiveCommitmentStatus(c.status)) continue;
      if (c.action !== 'MOVE' && c.action !== 'RETREAT' && c.action !== 'ATTACK') continue;
      if (c.action === 'ATTACK') {
        if (isStrategicAttackInFlight(state, c.id)) continue;
      } else if (isMovementCommitmentInFlight(state, c.id)) {
        continue;
      }
      if (c.status !== 'executing') continue;
      const inner = host.failCommitment(factionId, 'moving army is gone; commitment cannot stay active');
      appendHandler(result, inner);
      markLastDecision(state, factionId, state.worldTick);
      result.commitmentResolutions.push({
        factionId,
        commitmentId: c.id,
        action: c.action,
        outcome: 'failed',
        success: false,
        worldTick: state.worldTick,
      });
    }
  }
}
