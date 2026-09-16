import { DEFAULT_WORLD_ID } from '../persistence/types';
import { WorldAdvanceResult } from '../world/ContinuousWorldEngine';
import { createTelemetryEvent, toTelemetryPayload } from './schema';
import {
  omitUndefined,
  sanitizeBattle,
  sanitizeFitnessResult,
  sanitizeGameReward,
  workoutContextFromParameters,
} from './sanitize';
import { isReadOnlyCommand, isValidationErrorCode } from './taxonomy';
import {
  CommandObservation,
  PersistenceObservation,
  TelemetryEvent,
  TelemetryEventType,
  TelemetryPayload,
  TelemetrySourceSystem,
} from './types';

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function paramsOf(request: CommandObservation['request']): Record<string, unknown> {
  return request.parameters ?? {};
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isWorldAdvance(value: unknown): value is WorldAdvanceResult {
  const rec = asRecord(value);
  return typeof rec.ticksAdvanced === 'number' && Array.isArray(rec.aiDecisions);
}

class ObservationBuilder {
  readonly events: TelemetryEvent[] = [];
  private seq = 0;
  private lastByCorrelation = new Map<string, string>();

  constructor(
    private readonly lastByCorrelationSeed: Map<string, string>,
    private readonly worldTick: number,
    private readonly occurredAtMs: number | null,
    private readonly worldId: string,
    private readonly definitionWorldId: string | null,
    private readonly worldLevel: number | null,
    private readonly playerId: string,
    private readonly playerFactionId: string | null,
    private readonly commandId: string,
    private readonly requestId: string,
  ) {
    for (const [key, value] of lastByCorrelationSeed) {
      this.lastByCorrelation.set(key, value);
    }
  }

  lastId(correlationId: string): string | null {
    return this.lastByCorrelation.get(correlationId) ?? null;
  }

  emit(input: {
    eventType: TelemetryEventType;
    correlationId: string;
    causationId?: string | null;
    sourceSystem: TelemetrySourceSystem;
    factionId?: string | null;
    sessionId?: string | null;
    payload?: TelemetryPayload;
    metadata?: TelemetryPayload;
    occurredAtWorldTick?: number;
  }): TelemetryEvent {
    const causationId = input.causationId === undefined
      ? this.lastId(input.correlationId)
      : input.causationId;
    const event = createTelemetryEvent({
      eventId: `tel_${this.requestId}_${this.seq}_${input.eventType}`,
      eventType: input.eventType,
      occurredAtWorldTick: input.occurredAtWorldTick ?? this.worldTick,
      occurredAtMs: this.occurredAtMs,
      worldId: this.worldId,
      definitionWorldId: this.definitionWorldId,
      worldLevel: this.worldLevel,
      playerId: this.playerId,
      factionId: input.factionId ?? this.playerFactionId,
      sessionId: input.sessionId ?? null,
      correlationId: input.correlationId,
      causationId,
      sourceSystem: input.sourceSystem,
      commandId: this.commandId,
      requestId: this.requestId,
      payload: input.payload ?? {},
      metadata: input.metadata ?? {},
    });
    this.seq += 1;
    this.events.push(event);
    this.lastByCorrelation.set(input.correlationId, event.eventId);
    return event;
  }

  seedMap(): Map<string, string> {
    return new Map(this.lastByCorrelation);
  }
}

function sessionIdOf(request: CommandObservation['request'], payload: Record<string, unknown>): string | undefined {
  return str(payload.sessionId) ?? str(paramsOf(request).sessionId);
}

function emitResourceChanges(
  builder: ObservationBuilder,
  observation: CommandObservation,
  correlationId: string,
): void {
  for (const change of observation.response.resourcesChanged) {
    if (change.from === change.to) continue;
    const spent = change.to < change.from;
    builder.emit({
      eventType: spent ? 'resource.spent' : 'resource.collected',
      correlationId,
      sourceSystem: 'economy',
      factionId: change.factionId,
      payload: omitUndefined({
        factionId: change.factionId,
        resource: change.resource,
        from: change.from,
        to: change.to,
        delta: change.to - change.from,
      }),
    });
  }
}

function emitBattleBundle(
  builder: ObservationBuilder,
  payload: Record<string, unknown>,
  correlationId: string,
  factionId: string | null,
): void {
  const battleResult = payload.battleResult ?? payload.battle;
  const extras = {
    territoryId: str(payload.territoryId),
    winner: str(payload.winner),
    territoryOutcome: str(payload.territoryOutcome),
    committedTroops: num(payload.committedTroops),
    invasionId: str(payload.invasionId),
    invasionOutcome: str(payload.invasionOutcome),
    resolveReason: str(payload.resolveReason),
  };
  const battleEvent = builder.emit({
    eventType: 'battle.resolved',
    correlationId,
    sourceSystem: 'battle',
    factionId,
    payload: sanitizeBattle(battleResult, extras),
  });
  const outcome = str(payload.territoryOutcome)
    ?? str(asRecord(battleResult).territoryOutcome);
  if (outcome === 'captured') {
    builder.emit({
      eventType: 'territory.conquered',
      correlationId,
      causationId: battleEvent.eventId,
      sourceSystem: 'battle',
      factionId,
      payload: omitUndefined({
        territoryId: extras.territoryId ?? str(asRecord(battleResult).territoryId),
        winner: extras.winner ?? str(asRecord(battleResult).winner),
        battleId: str(asRecord(battleResult).battleId),
        invasionId: extras.invasionId,
      }),
    });
  }
}

function emitAttackOutcome(
  builder: ObservationBuilder,
  observation: CommandObservation,
  correlationId: string,
  factionId: string | null,
): void {
  const payload = observation.response.payload;
  const parameters = paramsOf(observation.request);
  const outcome = str(payload.attackOutcome);
  const invasionId = str(payload.invasionId);
  const chainId = invasionId ?? correlationId;

  if (num(payload.committedTroops) !== undefined) {
    builder.emit({
      eventType: 'attack.committed',
      correlationId: chainId,
      sourceSystem: 'orchestrator',
      factionId,
      payload: omitUndefined({
        territoryId: str(parameters.territoryId),
        committedTroops: num(payload.committedTroops),
        remainingBankedTroops: num(payload.remainingBankedTroops),
        committedArmyId: str(payload.committedArmyId),
        attackOutcome: outcome,
      }),
    });
  }

  if (outcome === 'invasion_created') {
    builder.emit({
      eventType: 'invasion.started',
      correlationId: chainId,
      sourceSystem: 'invasion',
      factionId,
      payload: omitUndefined({
        invasionId,
        territoryId: str(paramsOf(observation.request).territoryId) ?? str(payload.territoryId),
        responseDeadlineTick: num(payload.responseDeadlineTick),
        notifiedAtTick: num(payload.notifiedAtTick),
      }),
    });
    return;
  }
  if (outcome === 'awaiting_defense') {
    builder.emit({
      eventType: 'invasion.awaiting_defense',
      correlationId: chainId,
      sourceSystem: 'invasion',
      factionId,
      payload: omitUndefined({ invasionId, skipped: true }),
    });
    return;
  }
  if (outcome === 'battle_resolved') {
    emitBattleBundle(builder, payload, chainId, factionId);
    if (invasionId) {
      builder.emit({
        eventType: 'invasion.resolved',
        correlationId: chainId,
        sourceSystem: 'invasion',
        factionId,
        payload: omitUndefined({
          invasionId,
          invasionOutcome: str(payload.invasionOutcome),
          territoryId: str(payload.territoryId),
          winner: str(payload.winner),
          resolveReason: str(payload.resolveReason),
        }),
      });
    }
    return;
  }
  if (outcome === 'movement_started_for_attack') {
    builder.emit({
      eventType: 'attack.declared',
      correlationId: chainId,
      sourceSystem: 'orchestrator',
      factionId,
      payload: omitUndefined({
        attackOutcome: outcome,
        armyId: str(payload.armyId),
        from: str(payload.from),
        to: str(payload.to),
        targetTerritoryId: str(payload.targetTerritoryId),
        durationTicks: num(payload.durationTicks),
      }),
    });
    builder.emit({
      eventType: 'army.moved',
      correlationId: chainId,
      sourceSystem: 'orchestrator',
      factionId,
      payload: omitUndefined({
        armyId: str(payload.armyId),
        from: str(payload.from),
        to: str(payload.to),
        arrivalPending: true,
      }),
    });
    return;
  }
  if (outcome === 'failed' || outcome === 'skipped') {
    builder.emit({
      eventType: 'attack.failed',
      correlationId: chainId,
      sourceSystem: 'orchestrator',
      factionId,
      payload: omitUndefined({
        attackOutcome: outcome,
        territoryId: str(parameters.territoryId),
      }),
    });
  }
}

function emitFinalizeWorkout(builder: ObservationBuilder, observation: CommandObservation): void {
  const payload = observation.response.payload;
  const sessionId = sessionIdOf(observation.request, payload);
  const correlationId = sessionId ?? observation.response.requestId;
  if (payload.alreadyProcessed === true) {
    builder.emit({
      eventType: 'workout.reward_applied',
      correlationId,
      sourceSystem: 'rewards',
      sessionId,
      payload: omitUndefined({
        sessionId,
        applicationId: str(payload.applicationId),
        kind: str(payload.kind),
        alreadyProcessed: true,
      }),
    });
    return;
  }
  const intended = observation.state.playerFitness.compactHistory
    .find((entry) => entry.sessionId === sessionId);
  const applied = observation.state.playerRewards.appliedRewards
    .filter((record) => record.sessionId === sessionId)
    .slice(-1)[0];
  const completed = builder.emit({
    eventType: 'workout.completed',
    correlationId,
    sourceSystem: 'fitness',
    sessionId,
    payload: omitUndefined({
      sessionId,
      purpose: str(payload.purpose),
      alreadyProcessed: payload.alreadyProcessed === true,
      completedAtTick: intended?.completedAtTick,
    }),
  });
  const fitness = builder.emit({
    eventType: 'workout.fitness_result',
    correlationId,
    causationId: completed.eventId,
    sourceSystem: 'fitness',
    sessionId,
    payload: sanitizeFitnessResult({
      sessionId,
      purpose: payload.purpose,
      physicalOutput: payload.physicalOutput,
      alreadyProcessed: payload.alreadyProcessed,
      intendedDifficulty: applied?.result?.intendedDifficulty,
    }),
  });
  const rewardKind = str(payload.kind) ?? (applied ? String(applied.kind) : undefined);
  const reward = builder.emit({
    eventType: 'workout.game_reward',
    correlationId,
    causationId: fitness.eventId,
    sourceSystem: 'rewards',
    sessionId,
    payload: sanitizeGameReward({
      kind: rewardKind,
      purpose: payload.purpose,
      sessionId,
      applicationId: applied?.applicationId,
      physicalOutput: payload.physicalOutput,
      bankedTroops: payload.bankedTroops,
      amountOrEffect: applied?.result?.amountOrEffect,
      sourcePhysicalOutput: applied?.result?.sourcePhysicalOutput,
    }),
  });
  builder.emit({
    eventType: 'workout.reward_applied',
    correlationId,
    causationId: reward.eventId,
    sourceSystem: 'rewards',
    sessionId,
    payload:     omitUndefined({
      sessionId,
      applicationId: str(payload.applicationId) ?? applied?.applicationId,
      kind: rewardKind,
      bankedTroops: num(payload.bankedTroops),
      amountOrEffect: payload.amountOrEffect,
      alreadyProcessed: payload.alreadyProcessed === true,
      invasionOutcome: str(payload.invasionOutcome),
    }),
  });
  if (str(payload.invasionOutcome)) {
    builder.emit({
      eventType: 'invasion.resolved',
      correlationId,
      sourceSystem: 'invasion',
      sessionId,
      payload: omitUndefined({
        invasionOutcome: str(payload.invasionOutcome),
        sessionId,
      }),
    });
  }
}

function emitBattleGameEvents(
  builder: ObservationBuilder,
  events: CommandObservation['response']['events'],
  fallbackCorrelation: string,
): void {
  for (const event of events) {
    if (event.kind !== 'battle') continue;
    const data = event.data ?? {};
    if (!str(data.territoryOutcome) && !str(data.winner) && !str(data.invasionOutcome)) continue;
    const corr = str(data.invasionId) ?? event.id ?? fallbackCorrelation;
    builder.emit({
      eventType: 'battle.resolved',
      correlationId: corr,
      sourceSystem: 'battle',
      factionId: event.factionId ?? null,
      payload: omitUndefined({
        battleEventId: event.id,
        territoryId: event.territoryId,
        winner: data.winner,
        territoryOutcome: data.territoryOutcome,
        invasionId: data.invasionId,
        invasionOutcome: data.invasionOutcome,
        resolveReason: data.resolveReason,
        summary: event.summary,
      }),
    });
    if (str(data.territoryOutcome) === 'captured') {
      builder.emit({
        eventType: 'territory.conquered',
        correlationId: corr,
        sourceSystem: 'battle',
        factionId: event.factionId ?? null,
        payload: omitUndefined({
          territoryId: event.territoryId,
          winner: data.winner,
          invasionId: data.invasionId,
        }),
      });
    }
    if (str(data.invasionId) || str(data.invasionOutcome)) {
      builder.emit({
        eventType: 'invasion.resolved',
        correlationId: corr,
        sourceSystem: 'invasion',
        factionId: event.factionId ?? null,
        payload: omitUndefined({
          invasionId: data.invasionId,
          invasionOutcome: data.invasionOutcome,
          territoryId: event.territoryId,
          winner: data.winner,
          resolveReason: data.resolveReason,
        }),
      });
    }
  }
}

function emitAnchorProgressionEvents(
  builder: ObservationBuilder,
  events: CommandObservation['response']['events'],
  fallbackCorrelation: string,
  factionId: string | null,
): void {
  for (const event of events) {
    const data = event.data ?? {};
    const progression = str(data.anchorProgression);
    if (!progression) continue;
    const corr = event.id ?? fallbackCorrelation;
    if (progression === 'became_attackable') {
      builder.emit({
        eventType: 'anchor.became_attackable',
        correlationId: corr,
        sourceSystem: 'world',
        factionId: event.factionId ?? factionId,
        payload: omitUndefined({
          territoryId: event.territoryId,
          remainingAnchorTerritoryIds: data.remainingAnchorTerritoryIds,
        }),
      });
    }
    if (progression === 'level_defeated') {
      builder.emit({
        eventType: 'level.defeated',
        correlationId: corr,
        sourceSystem: 'world',
        factionId: event.factionId ?? factionId,
        payload: omitUndefined({
          territoryId: event.territoryId,
          defeatedLevel: data.defeatedLevel,
          defeatedWorldId: data.defeatedWorldId,
          lastLostAnchorTerritoryId: data.lastLostAnchorTerritoryId,
          previousWorldIds: data.previousWorldIds,
        }),
      });
    }
  }
}

function emitTutorialProgressionEvents(
  builder: ObservationBuilder,
  events: CommandObservation['response']['events'],
  fallbackCorrelation: string,
  factionId: string | null,
): void {
  for (const event of events) {
    const data = event.data ?? {};
    const progression = str(data.tutorialProgression);
    if (!progression) continue;
    const corr = event.id ?? fallbackCorrelation;
    if (progression === 'beat_changed') {
      builder.emit({
        eventType: 'tutorial.beat_changed',
        correlationId: corr,
        sourceSystem: 'world',
        factionId: event.factionId ?? factionId,
        payload: omitUndefined({
          fromBeat: data.fromBeat,
          toBeat: data.toBeat,
          beat: data.beat ?? data.toBeat,
        }),
      });
    }
    if (progression === 'scripted_invasion') {
      const invasionId = str(data.invasionId);
      const territoryId = event.territoryId ?? str(data.territoryId);
      builder.emit({
        eventType: 'tutorial.scripted_invasion',
        correlationId: invasionId ?? corr,
        sourceSystem: 'world',
        factionId: event.factionId ?? factionId,
        payload: omitUndefined({
          invasionId,
          territoryId,
          raidTroops: data.raidTroops,
        }),
      });
      builder.emit({
        eventType: 'invasion.started',
        correlationId: invasionId ?? corr,
        sourceSystem: 'invasion',
        factionId: event.factionId ?? factionId,
        payload: omitUndefined({
          invasionId,
          territoryId,
          scripted: true,
          raidTroops: data.raidTroops,
        }),
      });
    }
  }
}

function emitWorldCompletionEvents(
  builder: ObservationBuilder,
  events: CommandObservation['response']['events'],
  fallbackCorrelation: string,
  factionId: string | null,
): void {
  for (const event of events) {
    const data = event.data ?? {};
    if (str(data.worldProgression) !== 'level_completed') continue;
    builder.emit({
      eventType: 'level.completed',
      correlationId: event.id ?? fallbackCorrelation,
      sourceSystem: 'world',
      factionId: event.factionId ?? factionId,
      payload: omitUndefined({
        definitionWorldId: data.definitionWorldId,
        worldLevel: data.worldLevel,
        type: data.type,
        playerOwned: data.playerOwned,
        total: data.total,
        fraction: data.fraction,
      }),
    });
  }
}

function emitWorldTransitionEvents(
  builder: ObservationBuilder,
  events: CommandObservation['response']['events'],
  fallbackCorrelation: string,
  factionId: string | null,
  playerId: string,
): void {
  for (const event of events) {
    const data = event.data ?? {};
    if (str(data.worldProgression) !== 'level_transitioned') continue;
    builder.emit({
      eventType: 'level.transitioned',
      correlationId: event.id ?? fallbackCorrelation,
      sourceSystem: 'world',
      factionId: event.factionId ?? factionId,
      payload: omitUndefined({
        playerId: str(data.playerId) ?? playerId,
        fromWorldId: data.fromWorldId,
        fromWorldLevel: data.fromWorldLevel,
        toWorldId: data.toWorldId,
        toWorldLevel: data.toWorldLevel,
      }),
    });
  }
}

function emitBuildingDestroyedFromEvents(
  builder: ObservationBuilder,
  events: CommandObservation['response']['events'],
  fallbackCorrelation: string,
  factionId: string | null,
): void {
  for (const event of events) {
    const data = event.data ?? {};
    if (data.buildingDestroyed !== true) continue;
    builder.emit({
      eventType: 'building.destroyed',
      correlationId: event.id ?? fallbackCorrelation,
      sourceSystem: 'economy',
      factionId: event.factionId ?? factionId,
      payload: omitUndefined({
        territoryId: event.territoryId,
        previousOwner: data.previousOwner,
        newOwner: data.newOwner,
        cityDestroyed: data.cityDestroyed === true,
        cityId: data.cityId,
        fortificationDestroyed: data.fortificationDestroyed,
        farmDestroyed: data.farmDestroyed === true,
        mineDestroyed: data.mineDestroyed === true,
        lumberDestroyed: data.lumberDestroyed === true,
        constructionCancelled: data.constructionCancelled,
      }),
    });
  }
}

function emitConstructionFollowUps(
  builder: ObservationBuilder,
  input: {
    constructionId?: string;
    projectType?: string;
    territoryId?: string;
    factionId?: string | null;
    completedAtTick?: number;
  },
  correlationId: string,
): void {
  const projectType = input.projectType;
  if (projectType === 'CITY') {
    builder.emit({
      eventType: 'city.founded',
      correlationId,
      sourceSystem: 'economy',
      factionId: input.factionId ?? null,
      payload: omitUndefined({
        constructionId: input.constructionId,
        territoryId: input.territoryId,
        projectType,
        completedAtTick: input.completedAtTick,
      }),
    });
  }
  if (projectType === 'FARM' || projectType === 'MINE' || projectType === 'LUMBER') {
    builder.emit({
      eventType: 'development.completed',
      correlationId,
      sourceSystem: 'economy',
      factionId: input.factionId ?? null,
      payload: omitUndefined({
        constructionId: input.constructionId,
        territoryId: input.territoryId,
        projectType,
        development: projectType,
        completedAtTick: input.completedAtTick,
      }),
    });
  }
}

function emitFoodConsumption(
  builder: ObservationBuilder,
  observation: CommandObservation,
  correlationId: string,
): void {
  const rec = asRecord(observation.response.payload.foodConsumption);
  if (rec.gated === true) return;
  const cycles = num(rec.cycles) ?? 0;
  if (cycles <= 0) return;
  const rows = Array.isArray(rec.factions) ? rec.factions : [];
  for (const raw of rows) {
    const row = asRecord(raw);
    const factionId = str(row.factionId);
    if (!factionId) continue;
    const paid = num(row.paid) ?? 0;
    const failedCycles = num(row.failedCycles) ?? 0;
    if (paid <= 0 && failedCycles <= 0) continue;
    const foodBefore = num(row.foodBefore);
    const foodAfter = num(row.foodAfter);
    builder.emit({
      eventType: 'resource.consumed',
      correlationId,
      sourceSystem: 'economy',
      factionId,
      payload: omitUndefined({
        factionId,
        resource: 'food',
        from: foodBefore,
        to: foodAfter,
        delta: foodBefore !== undefined && foodAfter !== undefined ? foodAfter - foodBefore : undefined,
        paid,
        demand: num(row.demand),
        cycles,
        failedCycles,
        fromTick: num(rec.fromTick),
        toTick: num(rec.toTick),
      }),
    });
    const stabilityBefore = num(row.stabilityBefore);
    const stabilityAfter = num(row.stabilityAfter);
    if (
      failedCycles > 0
      && stabilityBefore !== undefined
      && stabilityAfter !== undefined
      && stabilityAfter !== stabilityBefore
    ) {
      builder.emit({
        eventType: 'stability.changed',
        correlationId,
        sourceSystem: 'economy',
        factionId,
        payload: omitUndefined({
          factionId,
          from: stabilityBefore,
          to: stabilityAfter,
          delta: stabilityAfter - stabilityBefore,
          reason: 'food_consumption_failed',
          failedCycles,
        }),
      });
    }
  }
}

function emitWorldAdvance(builder: ObservationBuilder, observation: CommandObservation): void {
  const payload = observation.response.payload;
  const advance = isWorldAdvance(payload.worldAdvance) ? payload.worldAdvance : null;
  if (!advance) return;
  if (advance.ticksAdvanced === 0 && advance.aiDecisions.length === 0 && advance.events.length === 0) {
    return;
  }
  const correlationId = observation.response.requestId;
  builder.emit({
    eventType: 'world.advanced',
    correlationId,
    sourceSystem: 'world',
    payload: omitUndefined({
      previousWorldTick: advance.previousWorldTick,
      newWorldTick: advance.newWorldTick,
      ticksAdvanced: advance.ticksAdvanced,
    }),
  });

  for (const decision of advance.aiDecisions) {
    const corr = decision.commitmentId || `ai:${decision.factionId}`;
    builder.emit({
      eventType: 'ai.decision_selected',
      correlationId: corr,
      sourceSystem: 'ai',
      factionId: decision.factionId,
      payload: omitUndefined({
        factionId: decision.factionId,
        commitmentId: decision.commitmentId,
        action: decision.action,
        targetId: decision.targetId,
        worldTick: decision.worldTick,
      }),
      occurredAtWorldTick: decision.worldTick,
    });
  }

  for (const resolution of advance.commitmentResolutions) {
    const corr = resolution.commitmentId || `ai:${resolution.factionId}`;
    builder.emit({
      eventType: resolution.action === 'DEFEND' ? 'ai.defend_posture' : 'ai.commitment_resolved',
      correlationId: corr,
      sourceSystem: 'ai',
      factionId: resolution.factionId,
      payload: omitUndefined({
        factionId: resolution.factionId,
        commitmentId: resolution.commitmentId,
        action: resolution.action,
        outcome: resolution.outcome,
        success: resolution.success,
        worldTick: resolution.worldTick,
      }),
      occurredAtWorldTick: resolution.worldTick,
    });
  }

  for (const movement of advance.movementResults) {
    if (movement.status === 'moving') continue;
    builder.emit({
      eventType: movement.status === 'interrupted' || movement.status === 'cancelled'
        ? 'army.movement_interrupted'
        : 'army.arrived',
      correlationId: movement.commitmentId ?? `army:${movement.armyId}`,
      sourceSystem: 'world',
      factionId: movement.owner,
      payload: omitUndefined({
        armyId: movement.armyId,
        status: movement.status,
        originTerritoryId: movement.originTerritoryId,
        destinationTerritoryId: movement.destinationTerritoryId,
        reason: movement.reason,
        commitmentId: movement.commitmentId,
      }),
      occurredAtWorldTick: movement.worldTick,
    });
  }

  for (const step of advance.eventResults) {
    if (step.triggered <= 0) continue;
    builder.emit({
      eventType: 'imperial.event_triggered',
      correlationId,
      sourceSystem: 'world',
      payload: omitUndefined({
        turn: step.turn,
        worldTick: step.worldTick,
        triggered: step.triggered,
        summary: step.summary.slice(0, 8),
      }),
      occurredAtWorldTick: step.worldTick,
    });
  }

  emitBattleGameEvents(builder, advance.events, correlationId);

  const previousTick = advance.previousWorldTick;
  for (const project of observation.state.constructions.values()) {
    if (project.status !== 'completed' || project.completedAtTick === null) continue;
    if (project.completedAtTick <= previousTick || project.completedAtTick > advance.newWorldTick) continue;
    builder.emit({
      eventType: 'construction.completed',
      correlationId: `construction:${project.id}`,
      sourceSystem: 'economy',
      factionId: project.factionId,
      payload: omitUndefined({
        constructionId: project.id,
        territoryId: project.territoryId,
        projectType: project.projectType,
        completedAtTick: project.completedAtTick,
      }),
      occurredAtWorldTick: project.completedAtTick,
    });
    emitConstructionFollowUps(builder, {
      constructionId: project.id,
      projectType: project.projectType,
      territoryId: project.territoryId,
      factionId: project.factionId,
      completedAtTick: project.completedAtTick ?? undefined,
    }, `construction:${project.id}`);
  }
}

function emitSuccess(builder: ObservationBuilder, observation: CommandObservation): void {
  const { request, response, state } = observation;
  const payload = response.payload;
  const parameters = paramsOf(request);
  const requestCorr = response.requestId;
  const sessionId = sessionIdOf(request, payload);
  const actingFaction = str(parameters.factionId) ?? state.playerFactionId;
  emitAnchorProgressionEvents(builder, response.events, requestCorr, actingFaction);
  emitWorldCompletionEvents(builder, response.events, requestCorr, actingFaction);
  emitWorldTransitionEvents(builder, response.events, requestCorr, actingFaction, observation.request.playerId);
  emitTutorialProgressionEvents(builder, response.events, requestCorr, actingFaction);
  emitBuildingDestroyedFromEvents(builder, response.events, requestCorr, actingFaction);

  switch (request.commandId) {
    case 'ATTACK':
      emitAttackOutcome(builder, observation, requestCorr, actingFaction);
      return;
    case 'MOVE':
      builder.emit({
        eventType: 'army.moved',
        correlationId: str(payload.armyId) ?? requestCorr,
        sourceSystem: 'orchestrator',
        factionId: actingFaction,
        payload: omitUndefined({
          armyId: str(payload.armyId),
          from: str(payload.from),
          to: str(payload.to),
          durationTicks: num(payload.durationTicks),
          arrivalPending: payload.arrivalPending === true,
        }),
      });
      return;
    case 'BUILD':
      builder.emit({
        eventType: 'construction.started',
        correlationId: str(payload.constructionId) ?? requestCorr,
        sourceSystem: 'economy',
        factionId: actingFaction,
        payload: omitUndefined({
          constructionId: str(payload.constructionId),
          projectType: str(payload.projectType) ?? 'FORTIFICATION',
          remainingTicks: num(payload.remainingTicks),
          territoryId: str(payload.territoryId) ?? str(parameters.territoryId),
          legacyCommand: true,
        }),
      });
      emitResourceChanges(builder, observation, requestCorr);
      return;
    case 'REINFORCE':
      builder.emit({
        eventType: 'army.reinforced',
        correlationId: requestCorr,
        sourceSystem: 'orchestrator',
        factionId: actingFaction,
        payload: omitUndefined({
          territoryId: str(payload.territoryId),
          garrison: num(payload.garrison),
        }),
      });
      emitResourceChanges(builder, observation, requestCorr);
      return;
    case 'DECLARE_WAR':
      builder.emit({
        eventType: 'diplomacy.war_declared',
        correlationId: requestCorr,
        sourceSystem: 'orchestrator',
        factionId: actingFaction,
        payload: omitUndefined({ targetFactionId: str(payload.targetFactionId) }),
      });
      return;
    case 'NEGOTIATE':
      builder.emit({
        eventType: 'diplomacy.negotiated',
        correlationId: requestCorr,
        sourceSystem: 'orchestrator',
        factionId: actingFaction,
        payload: omitUndefined({ targetFactionId: str(payload.targetFactionId) }),
      });
      return;
    case 'SYNC_PLAYER_WORLD':
      builder.emit({
        eventType: 'world.synced',
        correlationId: requestCorr,
        sourceSystem: 'world',
        payload: omitUndefined({
          worldTick: state.worldTick,
          ticksAdvanced: num(payload.ticksAdvanced),
          chunks: num(payload.chunks),
        }),
      });
      if (isWorldAdvance(payload.worldAdvance)) {
        emitWorldAdvance(builder, observation);
      } else {
        emitBattleGameEvents(builder, response.events, requestCorr);
      }
      emitFoodConsumption(builder, observation, requestCorr);
      return;
    case 'ADVANCE_WORLD':
      emitWorldAdvance(builder, observation);
      emitFoodConsumption(builder, observation, requestCorr);
      return;
    case 'AI_DECIDE': {
      const warlordId = str(parameters.warlordId);
      const commitments = Array.isArray(payload.commitments) ? payload.commitments : [];
      if (warlordId) {
        const match = commitments.find((row) => {
          const rec = asRecord(row);
          return rec.factionId === warlordId;
        });
        const rec = asRecord(match);
        const commitment = asRecord(rec.commitment);
        const commitmentId = str(commitment.id);
        builder.emit({
          eventType: 'ai.decision_selected',
          correlationId: commitmentId ?? `ai:${warlordId}`,
          sourceSystem: 'ai',
          factionId: warlordId,
          payload: omitUndefined({
            factionId: warlordId,
            commitmentId,
            action: str(commitment.action),
            targetId: str(commitment.targetId),
            status: str(commitment.status),
          }),
        });
      } else {
        builder.emit({
          eventType: 'ai.decision_cycle',
          correlationId: requestCorr,
          sourceSystem: 'ai',
          payload: {
            commitmentCount: commitments.length,
            actions: commitments.map((row) => {
              const rec = asRecord(row);
              const commitment = asRecord(rec.commitment);
              return {
                factionId: str(rec.factionId) ?? null,
                action: str(commitment.action) ?? null,
                targetId: str(commitment.targetId) ?? null,
                commitmentId: str(commitment.id) ?? null,
              };
            }),
          },
        });
      }
      return;
    }
    case 'RESOLVE_COMMITMENT': {
      const factionId = actingFaction;
      const live = factionId ? observation.state.commitments.get(factionId) : undefined;
      const commitmentId = str(payload.commitmentId) ?? live?.id;
      const corr = commitmentId ?? `ai:${factionId ?? requestCorr}`;
      builder.emit({
        eventType: 'ai.commitment_resolved',
        correlationId: corr,
        sourceSystem: 'ai',
        factionId,
        payload: omitUndefined({
          commitmentOutcome: str(payload.commitmentOutcome),
          action: str(payload.action),
          targetId: str(payload.targetId),
          attackOutcome: str(payload.attackOutcome),
          success: payload.commitmentOutcome !== 'failed',
        }),
      });
      if (str(payload.attackOutcome)) {
        emitAttackOutcome(builder, observation, corr, factionId);
      }
      return;
    }
    case 'START_CONSTRUCTION':
      builder.emit({
        eventType: 'construction.started',
        correlationId: str(payload.constructionId) ?? requestCorr,
        sourceSystem: 'economy',
        factionId: actingFaction,
        payload: omitUndefined({
          constructionId: str(payload.constructionId),
          projectType: str(payload.projectType),
          remainingTicks: num(payload.remainingTicks),
          territoryId: str(parameters.territoryId),
        }),
      });
      emitResourceChanges(builder, observation, requestCorr);
      return;
    case 'APPLY_CONSTRUCTION_ACCELERATION': {
      const constructionId = str(payload.constructionId);
      const corr = constructionId ?? requestCorr;
      const project = constructionId ? observation.state.constructions.get(constructionId) : undefined;
      builder.emit({
        eventType: 'construction.accelerated',
        correlationId: corr,
        sourceSystem: 'economy',
        factionId: actingFaction,
        payload: omitUndefined({
          constructionId,
          remainingTicks: num(payload.remainingTicks),
          status: str(payload.status),
          completed: payload.completed === true,
        }),
      });
      if (payload.completed === true) {
        builder.emit({
          eventType: 'construction.completed',
          correlationId: corr,
          sourceSystem: 'economy',
          factionId: actingFaction,
          payload: omitUndefined({
            constructionId,
            remainingTicks: num(payload.remainingTicks),
            projectType: project?.projectType,
            territoryId: project?.territoryId,
            completedAtTick: project?.completedAtTick ?? observation.state.worldTick,
          }),
        });
        emitConstructionFollowUps(builder, {
          constructionId,
          projectType: project?.projectType,
          territoryId: project?.territoryId,
          factionId: actingFaction,
          completedAtTick: project?.completedAtTick ?? observation.state.worldTick,
        }, corr);
      }
      return;
    }
    case 'COLLECT_RESOURCES': {
      const territoryId = str(parameters.territoryId);
      const corr = territoryId ?? requestCorr;
      builder.emit({
        eventType: 'resource.collected',
        correlationId: corr,
        sourceSystem: 'economy',
        factionId: actingFaction,
        payload: omitUndefined({
          territoryId,
          collected: num(payload.collected),
          collectedTotal: num(payload.collectedTotal),
          base: num(payload.base),
          baseTotal: num(payload.baseTotal),
          baseResources: payload.baseResources,
          transferredResources: payload.transferredResources,
          multiplier: num(payload.multiplier),
          effectConsumed: payload.effectConsumed === true,
        }),
      });
      if (payload.effectConsumed === true) {
        builder.emit({
          eventType: 'resource.golden_yield_used',
          correlationId: corr,
          sourceSystem: 'economy',
          factionId: actingFaction,
          payload: omitUndefined({
            territoryId,
            multiplier: num(payload.multiplier),
            collected: num(payload.collected),
            collectedTotal: num(payload.collectedTotal),
            baseTotal: num(payload.baseTotal),
            transferredResources: payload.transferredResources,
          }),
        });
      }
      return;
    }
    case 'SET_PLAYER_PAUSE':
      builder.emit({
        eventType: payload.paused === true ? 'player.pause.started' : 'player.pause.ended',
        correlationId: requestCorr,
        sourceSystem: 'orchestrator',
        payload: omitUndefined({
          paused: payload.paused === true,
          pausedAtTick: num(payload.pausedAtTick),
        }),
      });
      return;
    case 'START_WORKOUT': {
      const sid = sessionId;
      builder.emit({
        eventType: 'workout.started',
        correlationId: sid ?? requestCorr,
        sourceSystem: 'fitness',
        sessionId: sid,
        payload: {
          ...workoutContextFromParameters(parameters),
          sessionId: sid ?? null,
          state: str(payload.state) ?? null,
        },
      });
      return;
    }
    case 'PAUSE_WORKOUT':
      builder.emit({
        eventType: 'workout.paused',
        correlationId: sessionId ?? requestCorr,
        sourceSystem: 'fitness',
        sessionId,
        payload: omitUndefined({
          sessionId,
          state: str(payload.state),
          pauseCount: num(payload.pauseCount),
        }),
      });
      return;
    case 'RESUME_WORKOUT':
      builder.emit({
        eventType: 'workout.resumed',
        correlationId: sessionId ?? requestCorr,
        sourceSystem: 'fitness',
        sessionId,
        payload: omitUndefined({
          sessionId,
          state: str(payload.state),
          pauseCount: num(payload.pauseCount),
        }),
      });
      return;
    case 'RECORD_EXERCISE':
      builder.emit({
        eventType: 'workout.exercise_recorded',
        correlationId: sessionId ?? requestCorr,
        sourceSystem: 'fitness',
        sessionId,
        payload: omitUndefined({
          sessionId,
          order: num(parameters.order),
          currentExerciseIndex: num(payload.currentExerciseIndex),
          state: str(payload.state),
        }),
      });
      return;
    case 'SKIP_REST':
      builder.emit({
        eventType: 'workout.rest_skipped',
        correlationId: sessionId ?? requestCorr,
        sourceSystem: 'fitness',
        sessionId,
        payload: omitUndefined({
          sessionId,
          order: num(parameters.order),
          state: str(payload.state),
        }),
      });
      return;
    case 'SUBMIT_WORKOUT_FEEDBACK':
      builder.emit({
        eventType: 'workout.feedback_submitted',
        correlationId: sessionId ?? requestCorr,
        sourceSystem: 'fitness',
        sessionId,
        payload: omitUndefined({
          sessionId,
          value: str(parameters.value),
          feedbackState: str(payload.feedbackState),
        }),
      });
      return;
    case 'FINALIZE_WORKOUT':
      emitFinalizeWorkout(builder, observation);
      return;
    case 'ABANDON_WORKOUT':
      builder.emit({
        eventType: 'workout.abandoned',
        correlationId: sessionId ?? requestCorr,
        sourceSystem: 'fitness',
        sessionId,
        payload: omitUndefined({
          sessionId,
          state: str(payload.state),
          abandonmentReason: str(payload.abandonmentReason),
          invasionOutcome: str(payload.invasionOutcome),
        }),
      });
      if (str(payload.invasionOutcome)) {
        builder.emit({
          eventType: 'invasion.resolved',
          correlationId: sessionId ?? requestCorr,
          sourceSystem: 'invasion',
          sessionId,
          payload: omitUndefined({ invasionOutcome: str(payload.invasionOutcome) }),
        });
      }
      return;
    case 'RECORD_INTEGRITY_FLAG':
      builder.emit({
        eventType: 'workout.integrity_flag',
        correlationId: sessionId ?? requestCorr,
        sourceSystem: 'fitness',
        sessionId,
        payload: omitUndefined({
          sessionId,
          type: str(parameters.type),
          state: str(payload.state),
        }),
      });
      if (str(payload.state) === 'ABANDONED') {
        builder.emit({
          eventType: 'workout.abandoned',
          correlationId: sessionId ?? requestCorr,
          sourceSystem: 'fitness',
          sessionId,
          payload: omitUndefined({
            sessionId,
            state: str(payload.state),
            invasionOutcome: str(payload.invasionOutcome),
          }),
        });
      }
      return;
    default:
      return;
  }
}

export function collectCommandTelemetry(
  observation: CommandObservation,
  lastByCorrelation: Map<string, string> = new Map(),
): { events: TelemetryEvent[]; lastByCorrelation: Map<string, string> } {
  if (isReadOnlyCommand(observation.request.commandId)) {
    return { events: [], lastByCorrelation };
  }
  const builder = new ObservationBuilder(
    lastByCorrelation,
    observation.state.worldTick,
    num(observation.request.timestamp) ?? num(paramsOf(observation.request).now) ?? null,
    observation.worldId ?? DEFAULT_WORLD_ID,
    observation.state.definitionWorldId,
    observation.state.worldLevel,
    observation.request.playerId,
    observation.state.playerFactionId,
    observation.request.commandId,
    observation.response.requestId,
  );

  if (!observation.response.success) {
    const error = observation.response.errors[0];
    const code = error?.code ?? 'ENGINE_ERROR';
    const details = asRecord(error?.details);
    if (str(details.reason) === 'anchor_protected' || (error?.message ?? '').includes('anchor')) {
      builder.emit({
        eventType: 'anchor.protection_blocked',
        correlationId: observation.response.requestId,
        sourceSystem: 'orchestrator',
        factionId: str(paramsOf(observation.request).factionId) ?? observation.state.playerFactionId,
        payload: omitUndefined({
          commandId: observation.request.commandId,
          code,
          message: error?.message ?? 'command failed',
          territoryId: str(details.territoryId) ?? str(paramsOf(observation.request).territoryId),
        }),
      });
    }
    builder.emit({
      eventType: isValidationErrorCode(code) ? 'command.validation_failed' : 'command.rejected',
      correlationId: observation.response.requestId,
      sourceSystem: 'orchestrator',
      payload: toTelemetryPayload({
        commandId: observation.request.commandId,
        code,
        message: error?.message ?? 'command failed',
      }),
    });
    return { events: builder.events, lastByCorrelation: builder.seedMap() };
  }

  emitSuccess(builder, observation);
  return { events: builder.events, lastByCorrelation: builder.seedMap() };
}

export function collectPersistenceTelemetry(observation: PersistenceObservation): TelemetryEvent[] {
  const builder = new ObservationBuilder(
    new Map(),
    observation.worldTick,
    null,
    observation.worldId,
    observation.definitionWorldId ?? null,
    observation.worldLevel ?? null,
    observation.playerId,
    observation.playerFactionId ?? null,
    `PERSISTENCE_${observation.operation.toUpperCase()}`,
    observation.requestId ?? `persistence_${observation.operation}_${observation.playerId}_${observation.worldTick}`,
  );
  const payload = omitUndefined({
    operation: observation.operation,
    outcome: observation.outcome,
    code: observation.code,
    message: observation.message,
    ticksAdvanced: observation.ticksAdvanced,
  });
  if (observation.operation === 'catch_up') {
    builder.emit({
      eventType: 'world.catch_up',
      correlationId: builder.events[0]?.correlationId ?? observation.playerId,
      sourceSystem: 'persistence',
      payload,
    });
    return builder.events;
  }
  if (observation.operation === 'retry') {
    builder.emit({
      eventType: 'persistence.retry',
      correlationId: observation.playerId,
      sourceSystem: 'persistence',
      payload,
    });
    return builder.events;
  }
  if (observation.outcome === 'conflict') {
    builder.emit({
      eventType: 'persistence.save_conflict',
      correlationId: observation.playerId,
      sourceSystem: 'persistence',
      payload,
    });
    return builder.events;
  }
  if (observation.outcome === 'failed' || observation.outcome === 'invalid_state') {
    builder.emit({
      eventType: observation.operation === 'save' ? 'persistence.save_failed' : 'command.rejected',
      correlationId: observation.playerId,
      sourceSystem: 'persistence',
      payload,
    });
    return builder.events;
  }
  if (observation.operation === 'load' && observation.outcome === 'ok') {
    builder.emit({
      eventType: 'persistence.loaded',
      correlationId: observation.playerId,
      sourceSystem: 'persistence',
      payload,
    });
    return builder.events;
  }
  if (observation.operation === 'save' && observation.outcome === 'ok') {
    builder.emit({
      eventType: 'persistence.saved',
      correlationId: observation.playerId,
      sourceSystem: 'persistence',
      payload,
    });
  }
  return builder.events;
}
