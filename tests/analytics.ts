import assert from 'assert';
import {
  COMMAND_INDEX,
  DEFAULT_WORLD_ID,
  ErrorCode,
  IsolatedTelemetryRecorder,
  InMemoryGameStateStore,
  InMemoryTelemetryStore,
  InMemoryWorkoutHistoryStore,
  GAMEPLAY_CONFIG,
  Orchestrator,
  TELEMETRY_EVENT_TYPES,
  TELEMETRY_SCHEMA_VERSION,
  cloneGameState,
  collectCommandTelemetry,
  commitAuthoritativePlayerWorld,
  createLegacySampleMapGameState,
  createTelemetryEvent,
  createTelemetryRecorder,
  derivedMetrics,
  eventsCausedBy,
  getCurrentExercise,
  importanceFor,
  reconstructChain,
  summarizeAi,
  summarizeGame,
  summarizePlayer,
  telemetryEventToRow,
  rowToTelemetryEvent,
  validateTelemetryEvent,
} from '../src';
import type {
  CommandRequest,
  GameState,
  TelemetryEvent,
  TelemetryStore,
} from '../src';
import { getWorkoutDefinition } from '../src/fitness/catalog';
import { MIN_ATTACKING_TROOPS } from '../src/army/strategicAttack';
import { plantCity, plantOwnedCities } from './worldTestHelpers';

export interface AnalyticsTestApi {
  test: (name: string, fn: () => void) => void;
}

const PLAYER_ID = 'player_1';
const PLAYER_FACTION = 'iron_kingdom';
const OTHER_FACTION = 'celestial_theocracy';
const TARGET = 'eastern_hills';
const HOME = 'iron_kingdom_east';

function cmd(commandId: string, parameters: Record<string, unknown> = {}, requestId?: string): CommandRequest {
  return {
    commandId,
    playerId: PLAYER_ID,
    requestId: requestId ?? `${commandId}_${Math.random().toString(36).slice(2, 8)}`,
    parameters,
  };
}

function playerState(): GameState {
  return createLegacySampleMapGameState({ seed: 17, playerFactionId: PLAYER_FACTION });
}

function instrumented(state: GameState = playerState()): {
  orch: Orchestrator;
  recorder: IsolatedTelemetryRecorder;
} {
  const recorder = createTelemetryRecorder();
  return { orch: new Orchestrator(state, undefined, recorder), recorder };
}

function finishActiveWorkout(orch: Orchestrator, now = 2_000): void {
  let clock = now;
  while (orch.getState().playerFitness.activeSession?.state === 'ACTIVE') {
    const session = orch.getState().playerFitness.activeSession!;
    const step = getCurrentExercise(session);
    assert.ok(step, 'expected current exercise');
    clock += 1_000;
    if (step.skippable && step.exerciseType === 'REST') {
      const skipped = orch.execute(cmd('SKIP_REST', { order: step.order, now: clock }));
      assert.strictEqual(skipped.success, true, skipped.errors[0]?.message);
      continue;
    }
    const parameters: Record<string, unknown> = { order: step.order, now: clock };
    if (step.prescription.kind === 'repetitions') {
      parameters.repetitions = step.prescription.repetitions;
    } else {
      parameters.durationSeconds = step.prescription.durationSeconds;
    }
    const recorded = orch.execute(cmd('RECORD_EXERCISE', parameters));
    assert.strictEqual(recorded.success, true, recorded.errors[0]?.message);
  }
}

class ThrowingStore implements TelemetryStore {
  append(): void {
    throw new Error('analytics unavailable');
  }
  getById(): undefined {
    return undefined;
  }
  query(): TelemetryEvent[] {
    return [];
  }
  all(): TelemetryEvent[] {
    return [];
  }
  outbox(): TelemetryEvent[] {
    return [];
  }
  flushOutbox(): { flushed: number; remaining: number } {
    return { flushed: 0, remaining: 0 };
  }
}

function sampleEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return createTelemetryEvent({
    eventId: overrides.eventId ?? 'tel_sample_1',
    eventType: overrides.eventType ?? 'workout.started',
    occurredAtWorldTick: overrides.occurredAtWorldTick ?? 0,
    worldId: overrides.worldId ?? DEFAULT_WORLD_ID,
    playerId: overrides.playerId ?? PLAYER_ID,
    sessionId: overrides.sessionId ?? null,
    correlationId: overrides.correlationId ?? 'corr_1',
    causationId: overrides.causationId,
    sourceSystem: overrides.sourceSystem ?? 'fitness',
    payload: overrides.payload ?? { sessionId: overrides.sessionId ?? 'wses_x' },
    metadata: overrides.metadata,
  });
}

export function registerAnalyticsTests(api: AnalyticsTestApi): void {
  const { test } = api;

  console.log('Gameplay telemetry foundation');

  test('taxonomy importance is defined by event type, not guessed', () => {
    assert.strictEqual(importanceFor('battle.resolved'), 'CRITICAL');
    assert.strictEqual(importanceFor('territory.conquered'), 'CRITICAL');
    assert.strictEqual(importanceFor('workout.reward_applied'), 'CRITICAL');
    assert.strictEqual(importanceFor('level.defeated'), 'CRITICAL');
    assert.strictEqual(importanceFor('level.completed'), 'CRITICAL');
    assert.strictEqual(importanceFor('level.transitioned'), 'CRITICAL');
    assert.strictEqual(importanceFor('tutorial.beat_changed'), 'IMPORTANT');
    assert.strictEqual(importanceFor('tutorial.scripted_invasion'), 'IMPORTANT');
    assert.strictEqual(importanceFor('attack.committed'), 'IMPORTANT');
    assert.strictEqual(importanceFor('ai.decision_selected'), 'IMPORTANT');
    assert.strictEqual(importanceFor('world.advanced'), 'INFORMATIONAL');
    assert.strictEqual(importanceFor('resource.consumed'), 'INFORMATIONAL');
    assert.strictEqual(importanceFor('stability.changed'), 'IMPORTANT');
    assert.strictEqual(importanceFor('city.founded'), 'IMPORTANT');
    assert.strictEqual(importanceFor('development.completed'), 'IMPORTANT');
    assert.strictEqual(importanceFor('building.destroyed'), 'IMPORTANT');
    assert.strictEqual(importanceFor('command.rejected'), 'DEBUG');
    assert.strictEqual(importanceFor('command.validation_failed'), 'DEBUG');
    for (const eventType of TELEMETRY_EVENT_TYPES) {
      assert.ok(importanceFor(eventType));
    }
  });

  test('canonical event schema validates and uses gameplay-telemetry.v1', () => {
    const event = sampleEvent();
    assert.strictEqual(event.schemaVersion, TELEMETRY_SCHEMA_VERSION);
    assert.deepStrictEqual(validateTelemetryEvent(event), []);
    assert.strictEqual(event.importance, 'IMPORTANT');
  });

  test('event ids are unique across a command sequence', () => {
    const { orch, recorder } = instrumented();
    orch.execute(cmd('SET_PLAYER_PAUSE', { paused: true }, 'pause_a'));
    orch.execute(cmd('SET_PLAYER_PAUSE', { paused: false }, 'pause_b'));
    const ids = recorder.getEvents().map((e) => e.eventId);
    assert.ok(ids.length >= 2);
    assert.strictEqual(new Set(ids).size, ids.length);
  });

  test('GET_GAME_STATE does not emit telemetry', () => {
    const { orch, recorder } = instrumented();
    const res = orch.execute(cmd('GET_GAME_STATE'));
    assert.strictEqual(res.success, true);
    assert.strictEqual(recorder.getEvents().length, 0);
  });

  test('meaningful gameplay command creates telemetry with catalog importance', () => {
    const { orch, recorder } = instrumented();
    const res = orch.execute(cmd('SET_PLAYER_PAUSE', { paused: true }, 'pause_1'));
    assert.strictEqual(res.success, true);
    const events = recorder.getEvents({ eventType: 'player.pause.started' });
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0]!.importance, 'CRITICAL');
    assert.strictEqual(events[0]!.commandId, 'SET_PLAYER_PAUSE');
  });

  test('rejected and invalid commands emit DEBUG telemetry without mutating success path', () => {
    const { orch, recorder } = instrumented();
    const missing = orch.execute(cmd('ATTACK', {}, 'atk_missing'));
    assert.strictEqual(missing.success, false);
    assert.strictEqual(missing.errors[0]!.code, ErrorCode.MISSING_PARAMETER);
    const validation = recorder.getEvents({ eventType: 'command.validation_failed' });
    assert.ok(validation.length >= 1);
    assert.strictEqual(validation[0]!.importance, 'DEBUG');

    const rejected = orch.execute(cmd('ATTACK', { territoryId: HOME }, 'atk_own'));
    assert.strictEqual(rejected.success, false);
    const debug = recorder.getEvents({ importance: 'DEBUG' });
    assert.ok(debug.some((e) => e.eventType === 'command.rejected' || e.eventType === 'command.validation_failed'));
  });

  test('analytics failure does not prevent gameplay', () => {
    const state = playerState();
    state.playerRewards.bankedTroops = 500;
    const orch = new Orchestrator(state, undefined, new IsolatedTelemetryRecorder(new ThrowingStore()));
    const res = orch.execute(cmd('ATTACK', { territoryId: TARGET, commitAmount: 300, seed: 7 }, 'atk_live'));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    assert.strictEqual(orch.getState().playerRewards.bankedTroops, 200);
  });

  test('duplicate event ids are ignored safely', () => {
    const store = new InMemoryTelemetryStore();
    const event = sampleEvent({ eventId: 'tel_dup' });
    store.append([event]);
    store.append([event]);
    assert.strictEqual(store.all().length, 1);
  });

  test('sink failure keeps events queryable and flush retries', () => {
    let fail = true;
    const store = new InMemoryTelemetryStore({
      persist() {
        if (fail) throw new Error('sink down');
      },
    });
    store.append([sampleEvent({ eventId: 'tel_retry' })]);
    assert.strictEqual(store.all().length, 1);
    assert.strictEqual(store.outbox().length, 1);
    fail = false;
    const flushed = store.flushOutbox();
    assert.strictEqual(flushed.flushed, 1);
    assert.strictEqual(flushed.remaining, 0);
    assert.strictEqual(store.query({ importance: 'IMPORTANT' }).length, 1);
  });

  test('events can be queried by importance, player, world, and session', () => {
    const { orch, recorder } = instrumented();
    orch.execute(cmd('START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      workoutId: 'wk_very_easy_mobility',
      sessionId: 'wses_query',
      now: 1_000,
    }, 'start_q'));
    orch.execute(cmd('SET_PLAYER_PAUSE', { paused: true }, 'pause_q'));
    const critical = recorder.getEvents({ importance: 'CRITICAL' });
    assert.ok(critical.some((e) => e.eventType === 'player.pause.started'));
    const player = recorder.getEvents({ playerId: PLAYER_ID });
    assert.ok(player.length >= 2);
    const world = recorder.getEvents({ worldId: DEFAULT_WORLD_ID });
    assert.strictEqual(world.length, player.length);
    const session = recorder.getEvents({ sessionId: 'wses_query' });
    assert.ok(session.some((e) => e.eventType === 'workout.started'));
    assert.ok(session.every((e) => e.sessionId === 'wses_query'));
  });

  test('workout → fitness → reward chain can be reconstructed', () => {
    const { orch, recorder } = instrumented();
    const start = orch.execute(cmd('START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      workoutId: 'wk_very_easy_mobility',
      sessionId: 'wses_chain',
      now: 1_000,
    }, 'wk_start'));
    assert.strictEqual(start.success, true, start.errors[0]?.message);
    finishActiveWorkout(orch);
    const feedback = orch.execute(cmd('SUBMIT_WORKOUT_FEEDBACK', { value: 'ABOUT_RIGHT', now: 20_000 }, 'wk_fb'));
    assert.strictEqual(feedback.success, true, feedback.errors[0]?.message);
    const fin = orch.execute(cmd('FINALIZE_WORKOUT', { now: 21_000 }, 'wk_fin'));
    assert.strictEqual(fin.success, true, fin.errors[0]?.message);

    const chain = reconstructChain(recorder.getEvents(), 'wses_chain');
    const types = chain.map((e) => e.eventType);
    assert.ok(types.includes('workout.started'));
    assert.ok(types.includes('workout.feedback_submitted'));
    assert.ok(types.includes('workout.completed'));
    assert.ok(types.includes('workout.fitness_result'));
    assert.ok(types.includes('workout.game_reward'));
    assert.ok(types.includes('workout.reward_applied'));
    const completed = chain.find((e) => e.eventType === 'workout.completed')!;
    const descendants = eventsCausedBy(recorder.getEvents(), completed.eventId, true);
    assert.ok(descendants.some((e) => e.eventType === 'workout.fitness_result'));
    assert.ok(descendants.some((e) => e.eventType === 'workout.reward_applied'));
    const reward = chain.find((e) => e.eventType === 'workout.reward_applied')!;
    assert.strictEqual(reward.importance, 'CRITICAL');
    assert.ok(!JSON.stringify(reward.payload).includes('exerciseContributions'));
  });

  test('attack → battle → conquest chain can be reconstructed', () => {
    const state = playerState();
    state.playerRewards.bankedTroops = 400;
    const { orch, recorder } = instrumented(state);
    const res = orch.execute(cmd('ATTACK', { territoryId: TARGET, commitAmount: 250, seed: 7 }, 'atk_chain'));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    const events = recorder.getEvents({ requestId: res.requestId });
    assert.ok(events.some((e) => e.eventType === 'attack.committed'));
    assert.ok(events.some((e) => e.eventType === 'battle.resolved'));
    const battle = events.find((e) => e.eventType === 'battle.resolved')!;
    assert.strictEqual(battle.importance, 'CRITICAL');
    assert.strictEqual(battle.causationId, events.find((e) => e.eventType === 'attack.committed')!.eventId);
    if (String(res.payload.territoryOutcome ?? battle.payload.territoryOutcome) === 'captured') {
      const conquest = events.find((e) => e.eventType === 'territory.conquered');
      assert.ok(conquest);
      assert.strictEqual(conquest!.causationId, battle.eventId);
    }
    assert.ok(!JSON.stringify(battle.payload).includes('readableLog'));
  });

  test('AI decision → action → outcome chain can be reconstructed', () => {
    const { orch, recorder } = instrumented();
    const decide = orch.execute(cmd('AI_DECIDE', { warlordId: OTHER_FACTION }, 'ai_decide'));
    assert.strictEqual(decide.success, true, decide.errors[0]?.message);
    const decision = recorder.getEvents({ eventType: 'ai.decision_selected' });
    assert.strictEqual(decision.length, 1);
    assert.strictEqual(decision[0]!.importance, 'IMPORTANT');
    const resolve = orch.execute(cmd('RESOLVE_COMMITMENT', { factionId: OTHER_FACTION }, 'ai_resolve'));
    if (resolve.success) {
      const resolved = recorder.getEvents({ eventType: 'ai.commitment_resolved' });
      assert.ok(resolved.length >= 1);
      assert.strictEqual(resolved[0]!.correlationId, decision[0]!.correlationId);
      assert.strictEqual(resolved[0]!.causationId, decision[0]!.eventId);
    } else {
      orch.execute(cmd('ADVANCE_WORLD', { elapsedTicks: 24 }, 'ai_adv'));
      const advanced = recorder.getEvents({ eventType: ['ai.decision_selected', 'ai.commitment_resolved'] });
      assert.ok(advanced.length >= 1);
    }
  });

  test('derived summaries match underlying events', () => {
    const { orch, recorder } = instrumented();
    orch.execute(cmd('SET_PLAYER_PAUSE', { paused: true }, 'sum_pause'));
    orch.execute(cmd('SET_PLAYER_PAUSE', { paused: false }, 'sum_unpause'));
    const events = recorder.getEvents();
    const game = summarizeGame(events);
    assert.strictEqual(game.pauses, 1);
    assert.strictEqual(game.criticalCount, events.filter((e) => e.importance === 'CRITICAL').length);
    const player = summarizePlayer(events, PLAYER_ID);
    assert.strictEqual(player.playerId, PLAYER_ID);
    const metrics = derivedMetrics(events);
    assert.strictEqual(metrics.constructionStarts, 0);
    const ai = summarizeAi(events);
    assert.strictEqual(ai.decisions, 0);
  });

  test('existing gameplay behavior is unchanged when telemetry is attached', () => {
    const a = playerState();
    a.playerRewards.bankedTroops = 500;
    const b = cloneGameState(a);
    const plain = new Orchestrator(a);
    const watched = new Orchestrator(b, undefined, createTelemetryRecorder());
    const req = cmd('ATTACK', { territoryId: TARGET, commitAmount: 300, seed: 7 }, 'atk_same');
    const plainRes = plain.execute({ ...req, parameters: { ...req.parameters } });
    const watchedRes = watched.execute({ ...req, parameters: { ...req.parameters } });
    assert.strictEqual(plainRes.success, watchedRes.success);
    assert.strictEqual(plain.getState().playerRewards.bankedTroops, watched.getState().playerRewards.bankedTroops);
    assert.strictEqual(
      plain.getState().territories.get(TARGET)?.owner,
      watched.getState().territories.get(TARGET)?.owner,
    );
  });

  test('persistence commit records save telemetry and isolation still applies', () => {
    const recorder = createTelemetryRecorder();
    const gameStore = new InMemoryGameStateStore();
    const historyStore = new InMemoryWorkoutHistoryStore();
    const state = playerState();
    const saved = commitAuthoritativePlayerWorld({
      gameStore,
      historyStore,
      playerId: PLAYER_ID,
      expectedVersion: 0,
      state,
      telemetry: recorder,
    });
    assert.strictEqual(saved.ok, true);
    assert.ok(recorder.getEvents({ eventType: 'persistence.saved' }).length >= 1);

    const throwing = new IsolatedTelemetryRecorder(new ThrowingStore());
    const saved2 = commitAuthoritativePlayerWorld({
      gameStore,
      historyStore,
      playerId: PLAYER_ID,
      expectedVersion: saved.ok ? saved.record.stateVersion : 0,
      state: playerState(),
      telemetry: throwing,
    });
    assert.strictEqual(saved2.ok, true);
  });

  test('supabase telemetry row mapping round-trips canonical fields', () => {
    const event = sampleEvent({ eventId: 'tel_map', sessionId: 'wses_map' });
    const row = telemetryEventToRow(event);
    const back = rowToTelemetryEvent(row);
    assert.strictEqual(back.eventId, event.eventId);
    assert.strictEqual(back.eventType, event.eventType);
    assert.strictEqual(back.importance, event.importance);
    assert.strictEqual(back.sessionId, 'wses_map');
  });

  test('collectCommandTelemetry never becomes a source of truth for command success', () => {
    const state = playerState();
    const response = {
      success: true,
      commandId: 'SET_PLAYER_PAUSE',
      requestId: 'pure_1',
      playerId: PLAYER_ID,
      stateChanges: [],
      events: [],
      notifications: [],
      presentation: null,
      resourcesChanged: [],
      territoriesChanged: [],
      armiesChanged: [],
      newlyAvailableActions: [],
      errors: [],
      payload: { paused: true, pausedAtTick: 0 },
    };
    const collected = collectCommandTelemetry({
      request: cmd('SET_PLAYER_PAUSE', { paused: true }, 'pure_1'),
      response,
      state,
    });
    assert.ok(collected.events.some((e) => e.eventType === 'player.pause.started'));
    assert.strictEqual(state.playerEmpirePause.paused, false);
  });

  test('scenario harness: workout → troops → attack → battle → construction/resources', () => {
    const state = playerState();
    plantOwnedCities(state);
    const { orch, recorder } = instrumented(state);
    assert.ok(getWorkoutDefinition('wk_very_easy_mobility'));

    const started = orch.execute(cmd('START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      workoutId: 'wk_very_easy_mobility',
      sessionId: 'wses_scenario',
      now: 1_000,
    }, 'sc_start'));
    assert.strictEqual(started.success, true, started.errors[0]?.message);
    finishActiveWorkout(orch);
    assert.strictEqual(orch.execute(cmd('SUBMIT_WORKOUT_FEEDBACK', { value: 'ABOUT_RIGHT', now: 30_000 }, 'sc_fb')).success, true);
    const finalized = orch.execute(cmd('FINALIZE_WORKOUT', { now: 31_000 }, 'sc_fin'));
    assert.strictEqual(finalized.success, true, finalized.errors[0]?.message);

    if (orch.getState().playerRewards.bankedTroops <= MIN_ATTACKING_TROOPS) {
      orch.getState().playerRewards.bankedTroops = MIN_ATTACKING_TROOPS + 80;
    }
    const committed = orch.getState().playerRewards.bankedTroops;
    const attack = orch.execute(cmd('ATTACK', {
      territoryId: TARGET,
      commitAmount: committed,
      seed: 11,
    }, 'sc_atk'));
    assert.strictEqual(attack.success, true, attack.errors[0]?.message);

    const built = orch.execute(cmd('START_CONSTRUCTION', {
      territoryId: HOME,
      constructionId: 'con_scenario',
    }, 'sc_con'));
    assert.strictEqual(built.success, true, built.errors[0]?.message);
    orch.execute(cmd('ADVANCE_WORLD', { elapsedTicks: 24 }, 'sc_adv'));
    orch.execute(cmd('COLLECT_RESOURCES', { territoryId: HOME }, 'sc_col'));

    const events = recorder.getEvents();
    const workout = reconstructChain(events, 'wses_scenario');
    assert.ok(workout.some((e) => e.eventType === 'workout.started'));
    assert.ok(workout.some((e) => e.eventType === 'workout.reward_applied'));
    assert.ok(events.some((e) => e.eventType === 'attack.committed'));
    assert.ok(events.some((e) => e.eventType === 'battle.resolved'));
    assert.ok(events.some((e) => e.eventType === 'construction.started'));
    assert.ok(events.some((e) => e.eventType === 'resource.collected' || e.eventType === 'world.advanced'));
    const player = summarizePlayer(events, PLAYER_ID);
    assert.strictEqual(player.workoutsCompleted, 1);
    assert.strictEqual(player.attacksCommitted, 1);
    assert.ok(player.constructionsStarted >= 1);
    const known = new Set<string>(COMMAND_INDEX.map((c) => c.commandId));
    for (const event of events) {
      if (event.commandId) assert.ok(known.has(event.commandId) || event.commandId.startsWith('PERSISTENCE_'));
    }
  });

  test('Level 1 world advance does not emit food consume telemetry', () => {
    const { orch, recorder } = instrumented();
    const res = orch.execute(cmd('ADVANCE_WORLD', { elapsedTicks: 60 }, 'adv_l1_food'));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    const food = res.payload.foodConsumption as { gated?: boolean } | undefined;
    assert.strictEqual(food?.gated, true);
    assert.strictEqual(recorder.getEvents({ eventType: 'resource.consumed' }).length, 0);
    assert.strictEqual(recorder.getEvents({ eventType: 'stability.changed' }).length, 0);
  });

  test('Food consume emits resource.consumed, not collected or spent', () => {
    const state = playerState();
    state.worldLevel = 2;
    const player = state.factions.get(PLAYER_FACTION)!;
    player.resources.food = 500;
    const { orch, recorder } = instrumented(state);
    const res = orch.execute(cmd('ADVANCE_WORLD', { elapsedTicks: 60 }, 'adv_food_paid'));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    const consumed = recorder.getEvents({ eventType: 'resource.consumed' });
    assert.ok(consumed.length >= 1);
    assert.ok(consumed.every((e) => e.payload.resource === 'food'));
    assert.ok(consumed.every((e) => e.importance === 'INFORMATIONAL'));
    const foodSpent = recorder.getEvents({ eventType: 'resource.spent' })
      .filter((e) => e.payload.resource === 'food');
    const foodCollected = recorder.getEvents({ eventType: 'resource.collected' })
      .filter((e) => e.payload.resource === 'food');
    assert.strictEqual(foodSpent.length, 0);
    assert.strictEqual(foodCollected.length, 0);
  });

  test('failed Food cycle emits stability.changed', () => {
    const state = playerState();
    state.worldLevel = 2;
    const response = {
      success: true,
      commandId: 'ADVANCE_WORLD',
      requestId: 'adv_food_fail',
      playerId: PLAYER_ID,
      stateChanges: [],
      events: [],
      notifications: [],
      presentation: null,
      resourcesChanged: [],
      territoriesChanged: [],
      armiesChanged: [],
      newlyAvailableActions: [],
      errors: [],
      payload: {
        ticksAdvanced: 60,
        worldAdvance: {
          ticksAdvanced: 60,
          previousWorldTick: 0,
          newWorldTick: 60,
          aiDecisions: [],
          commitmentProgress: [],
          commitmentResolutions: [],
          eventResults: [],
          movementResults: [],
          stateChanges: [],
          notifications: [],
          errors: [],
          events: [],
        },
        foodConsumption: {
          cycles: 1,
          gated: false,
          fromTick: 0,
          toTick: 60,
          factions: [{
            factionId: PLAYER_FACTION,
            demandPerCycle: 4,
            cycles: 1,
            demand: 4,
            paid: 0,
            failedCycles: 1,
            foodBefore: 0,
            foodAfter: 0,
            stabilityBefore: 80,
            stabilityAfter: 78,
          }],
        },
      },
    };
    const collected = collectCommandTelemetry({
      request: cmd('ADVANCE_WORLD', { elapsedTicks: 60 }, 'adv_food_fail'),
      response,
      state,
    });
    const consumed = collected.events.filter((e) => e.eventType === 'resource.consumed');
    assert.strictEqual(consumed.length, 1);
    assert.strictEqual(consumed[0]!.payload.resource, 'food');
    assert.strictEqual(consumed[0]!.payload.failedCycles, 1);
    assert.ok(!collected.events.some((e) => e.eventType === 'resource.spent' || e.eventType === 'resource.collected'));
    const stability = collected.events.filter((e) => e.eventType === 'stability.changed');
    assert.strictEqual(stability.length, 1);
    assert.strictEqual(stability[0]!.payload.reason, 'food_consumption_failed');
    assert.strictEqual(stability[0]!.payload.from, 80);
    assert.strictEqual(stability[0]!.payload.to, 78);
  });

  test('CITY completion emits city.founded beside construction.completed', () => {
    const { orch, recorder } = instrumented();
    const started = orch.execute(cmd('START_CONSTRUCTION', {
      territoryId: HOME,
      projectType: 'CITY',
      constructionId: 'con_city_tel',
    }, 'con_city_start'));
    assert.strictEqual(started.success, true, started.errors[0]?.message);
    const spent = recorder.getEvents({ eventType: 'resource.spent' });
    assert.ok(spent.some((e) => e.payload.resource === 'gold'));
    assert.ok(spent.some((e) => e.payload.resource === 'stone'));
    assert.ok(spent.some((e) => e.payload.resource === 'iron'));
    const advanced = orch.execute(cmd('ADVANCE_WORLD', { elapsedTicks: GAMEPLAY_CONFIG.cityConstructionDurationTicks }, 'con_city_adv'));
    assert.strictEqual(advanced.success, true, advanced.errors[0]?.message);
    const completed = recorder.getEvents({ eventType: 'construction.completed' })
      .filter((e) => e.payload.constructionId === 'con_city_tel');
    const founded = recorder.getEvents({ eventType: 'city.founded' });
    assert.strictEqual(completed.length, 1);
    assert.strictEqual(founded.length, 1);
    assert.strictEqual(founded[0]!.payload.projectType, 'CITY');
    assert.strictEqual(founded[0]!.payload.territoryId, HOME);
    assert.strictEqual(founded[0]!.importance, 'IMPORTANT');
  });

  test('Farm completion emits development.completed', () => {
    const { orch, recorder } = instrumented();
    const started = orch.execute(cmd('START_CONSTRUCTION', {
      territoryId: HOME,
      projectType: 'FARM',
      constructionId: 'con_farm_tel',
    }, 'con_farm_start'));
    assert.strictEqual(started.success, true, started.errors[0]?.message);
    const spent = recorder.getEvents({ eventType: 'resource.spent' });
    assert.ok(spent.some((e) => e.payload.resource === 'gold'));
    assert.ok(spent.some((e) => e.payload.resource === 'wood'));
    const advanced = orch.execute(cmd('ADVANCE_WORLD', { elapsedTicks: GAMEPLAY_CONFIG.farmConstructionDurationTicks }, 'con_farm_adv'));
    assert.strictEqual(advanced.success, true, advanced.errors[0]?.message);
    const developed = recorder.getEvents({ eventType: 'development.completed' });
    assert.strictEqual(developed.length, 1);
    assert.strictEqual(developed[0]!.payload.projectType, 'FARM');
    assert.strictEqual(developed[0]!.payload.development, 'FARM');
    assert.strictEqual(developed[0]!.payload.territoryId, HOME);
  });

  test('conquest with city and farm emits building.destroyed', () => {
    const state = playerState();
    plantCity(state, TARGET);
    const territory = state.territories.get(TARGET)!;
    territory.fortification = 2;
    const infra = state.territoryInfrastructure.get(TARGET)!;
    infra.farmCompletedAtTick = 1;
    state.playerRewards.bankedTroops = 500;
    const { orch, recorder } = instrumented(state);
    const attack = orch.execute(cmd('ATTACK', {
      territoryId: TARGET,
      commitAmount: 300,
      seed: 7,
    }, 'atk_destroy'));
    assert.strictEqual(attack.success, true, attack.errors[0]?.message);
    const destroyed = recorder.getEvents({ eventType: 'building.destroyed' });
    assert.strictEqual(destroyed.length, 1);
    assert.strictEqual(destroyed[0]!.payload.cityDestroyed, true);
    assert.strictEqual(destroyed[0]!.payload.farmDestroyed, true);
    assert.strictEqual(destroyed[0]!.payload.fortificationDestroyed, 2);
    assert.strictEqual(destroyed[0]!.importance, 'IMPORTANT');
  });

  test('conquest of an empty tile does not emit building.destroyed', () => {
    const state = playerState();
    const territory = state.territories.get(TARGET)!;
    territory.fortification = 0;
    state.playerRewards.bankedTroops = 500;
    const { orch, recorder } = instrumented(state);
    const attack = orch.execute(cmd('ATTACK', {
      territoryId: TARGET,
      commitAmount: 300,
      seed: 7,
    }, 'atk_empty'));
    assert.strictEqual(attack.success, true, attack.errors[0]?.message);
    assert.ok(recorder.getEvents({ eventType: 'territory.conquered' }).length >= 1);
    assert.strictEqual(recorder.getEvents({ eventType: 'building.destroyed' }).length, 0);
  });
}
