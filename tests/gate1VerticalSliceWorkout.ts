/**
 * Gate 1 Phase 1B — Workout → banked Troops on the vertical-slice scenario.
 *
 * Uses CommandRequest → Orchestrator → session → runWorkoutRewardPipeline.
 * Does not implement attack/conquest (1C) or persistence (1D).
 */
import assert from 'assert';
import {
  FITNESS_MODEL_VERSION,
  Orchestrator,
  checkGameStateInvariants,
  createTelemetryRecorder,
  getAuthoredWorkoutCatalog,
  getCurrentExercise,
  installAuthoredWorkoutCatalog,
} from '../src';
import type { CommandRequest, FitnessEstimate, RuntimeWorkoutCatalog } from '../src';
import {
  VERTICAL_SLICE_INITIAL_BANKED_TROOPS,
  VERTICAL_SLICE_PLAYER_FACTION_ID,
  VERTICAL_SLICE_TERRITORY_A,
  VERTICAL_SLICE_TERRITORY_B,
  VERTICAL_SLICE_TERRITORY_C,
  VERTICAL_SLICE_TERRITORY_D,
  VERTICAL_SLICE_WORLD_ID,
  VERTICAL_SLICE_WORKOUT_CATALOG_ID,
  createVerticalSliceScenario,
  type VerticalSliceScenario,
} from './fixtures/gate1VerticalSliceScenario';

export interface Gate1VerticalSliceWorkoutTestApi {
  test: (name: string, fn: () => void) => void;
}

/**
 * Deterministic WorkoutSelectionEngine pick for empty progression + STANDARD:
 * bridge preference selects aw_bridge_1a_1b over aw_foundations_standard.
 */
const EXPECTED_AUTHORED_SELECTED_ID = 'aw_bridge_1a_1b';

/** Session-form prescriptions for aw_bridge_1a_1b from sampleAuthoringDocumentV2. */
const EXPECTED_BRIDGE_PRESCRIPTIONS = [
  { kind: 'repetitions' as const, repetitions: 8 },
  { kind: 'repetitions' as const, repetitions: 5 },
];

function cmd(
  playerId: string,
  commandId: string,
  parameters: Record<string, unknown> = {},
  requestId?: string,
): CommandRequest {
  return {
    commandId,
    playerId,
    requestId: requestId ?? `${commandId}_${playerId}_${String(parameters.sessionId ?? parameters.now ?? 'x')}`,
    parameters,
  };
}

function estimateAt(level: number, confidence: number, playerId: string): FitnessEstimate {
  return {
    modelVersion: FITNESS_MODEL_VERSION,
    playerId,
    level,
    confidence,
    bodySectionLevels: {
      GLOBAL: level,
      UPPER_BODY: level,
      CORE: level,
      LOWER_BODY: level,
    },
    initializedAt: 1_000,
    lastUpdatedAt: 1_000,
    observationCount: confidence > 0.08 ? 4 : 0,
  };
}

function withCatalogInstalled<T>(
  scenario: VerticalSliceScenario,
  fn: (orch: Orchestrator, catalog: RuntimeWorkoutCatalog, recorder: ReturnType<typeof createTelemetryRecorder>) => T,
): T {
  installAuthoredWorkoutCatalog(scenario.workoutCatalog);
  try {
    assert.strictEqual(getAuthoredWorkoutCatalog()?.catalogId, VERTICAL_SLICE_WORKOUT_CATALOG_ID);
    const recorder = createTelemetryRecorder();
    const orch = new Orchestrator(scenario.state, undefined, recorder);
    return fn(orch, scenario.workoutCatalog, recorder);
  } finally {
    installAuthoredWorkoutCatalog(null);
    assert.strictEqual(getAuthoredWorkoutCatalog(), null);
  }
}

function finishActiveWorkout(orch: Orchestrator, playerId: string, now = 2_000): void {
  let clock = now;
  while (orch.getState().playerFitness.activeSession?.state === 'ACTIVE') {
    const session = orch.getState().playerFitness.activeSession!;
    const step = getCurrentExercise(session);
    assert.ok(step, 'expected current exercise');
    clock += 1_000;
    if (step.skippable && step.exerciseType === 'REST') {
      const skipped = orch.execute(cmd(playerId, 'SKIP_REST', { order: step.order, now: clock }));
      assert.strictEqual(skipped.success, true, skipped.errors[0]?.message);
      continue;
    }
    const parameters: Record<string, unknown> = { order: step.order, now: clock };
    if (step.prescription.kind === 'repetitions') {
      parameters.repetitions = step.prescription.repetitions;
    } else {
      parameters.durationSeconds = step.prescription.durationSeconds;
    }
    const recorded = orch.execute(cmd(playerId, 'RECORD_EXERCISE', parameters));
    assert.strictEqual(recorded.success, true, recorded.errors[0]?.message);
  }
}

function ownershipSnapshot(state: ReturnType<Orchestrator['getState']>): Record<string, string | null> {
  return {
    [VERTICAL_SLICE_TERRITORY_A]: state.territories.get(VERTICAL_SLICE_TERRITORY_A)?.owner ?? null,
    [VERTICAL_SLICE_TERRITORY_B]: state.territories.get(VERTICAL_SLICE_TERRITORY_B)?.owner ?? null,
    [VERTICAL_SLICE_TERRITORY_C]: state.territories.get(VERTICAL_SLICE_TERRITORY_C)?.owner ?? null,
    [VERTICAL_SLICE_TERRITORY_D]: state.territories.get(VERTICAL_SLICE_TERRITORY_D)?.owner ?? null,
  };
}

function playerArmyCount(state: ReturnType<Orchestrator['getState']>): number {
  return [...state.armies.values()].filter((a) => a.owner === VERTICAL_SLICE_PLAYER_FACTION_ID).length;
}

function assertPrescriptionsMatchAuthored(session: NonNullable<ReturnType<Orchestrator['getState']>['playerFitness']['activeSession']>): void {
  assert.strictEqual(session.performances.length, EXPECTED_BRIDGE_PRESCRIPTIONS.length);
  for (let i = 0; i < EXPECTED_BRIDGE_PRESCRIPTIONS.length; i++) {
    assert.deepStrictEqual(session.performances[i]!.prescribed, EXPECTED_BRIDGE_PRESCRIPTIONS[i]);
    assert.deepStrictEqual(session.prescribedWorkout.exercises[i]!.prescription, EXPECTED_BRIDGE_PRESCRIPTIONS[i]);
  }
}

export function registerGate1VerticalSliceWorkoutTests(api: Gate1VerticalSliceWorkoutTestApi): void {
  const { test } = api;

  console.log('Gate 1 Phase 1B — workout → banked Troops');

  test('authored selection without workoutId starts the fixture STANDARD workout', () => {
    const scenario = createVerticalSliceScenario();
    withCatalogInstalled(scenario, (orch, catalog) => {
      assert.strictEqual(orch.getState().playerRewards.bankedTroops, VERTICAL_SLICE_INITIAL_BANKED_TROOPS);
      assert.strictEqual(orch.getState().level1Tutorial, null);

      const selection = orch.execute(cmd(scenario.playerId, 'GET_WORKOUT_SELECTION', {
        purpose: 'NORMAL_TROOPS',
      }, 'g1_select'));
      assert.strictEqual(selection.success, true, selection.errors[0]?.message);
      assert.strictEqual(selection.payload.source, 'authored');
      assert.strictEqual(selection.payload.selectedWorkoutId, EXPECTED_AUTHORED_SELECTED_ID);
      assert.ok(catalog.workouts[EXPECTED_AUTHORED_SELECTED_ID], 'selected id must exist in installed catalog');
      assert.strictEqual(selection.payload.catalogId, catalog.catalogId);
      assert.strictEqual(selection.payload.catalogVersion, catalog.catalogVersion);
      const prescribed = selection.payload.prescribedWorkout as {
        personalized: boolean;
        exercises: Array<{ prescription: { kind: string; repetitions?: number; durationSeconds?: number } }>;
      };
      assert.strictEqual(prescribed.personalized, false);
      assert.deepStrictEqual(
        prescribed.exercises.map((e) => e.prescription),
        EXPECTED_BRIDGE_PRESCRIPTIONS,
      );

      const start = orch.execute(cmd(scenario.playerId, 'START_WORKOUT', {
        purpose: 'NORMAL_TROOPS',
        sessionId: 'wses_g1_select',
        now: 1_000,
        // intentionally omit workoutId — engine must select
      }, 'g1_start_select'));
      assert.strictEqual(start.success, true, start.errors[0]?.message);
      assert.strictEqual(start.payload.workoutId, EXPECTED_AUTHORED_SELECTED_ID);
      assert.strictEqual(start.payload.selectedWorkoutId, EXPECTED_AUTHORED_SELECTED_ID);
      const selectionMeta = start.payload.selection as { source: string; catalogId: string };
      assert.strictEqual(selectionMeta.source, 'authored');
      assert.strictEqual(selectionMeta.catalogId, catalog.catalogId);

      const session = orch.getState().playerFitness.activeSession!;
      assert.strictEqual(session.workoutId, EXPECTED_AUTHORED_SELECTED_ID);
      assert.ok(session.authoredCatalog);
      assert.strictEqual(session.authoredCatalog!.catalogId, catalog.catalogId);
      assert.strictEqual(session.authoredCatalog!.catalogVersion, catalog.catalogVersion);
      assertPrescriptionsMatchAuthored(session);
    });
  });

  test('FitnessEstimate does not rewrite authored prescriptions on start', () => {
    const scenario = createVerticalSliceScenario();
    scenario.state.playerFitness.estimate = estimateAt(9.5, 0.9, scenario.playerId);
    withCatalogInstalled(scenario, (orch) => {
      const start = orch.execute(cmd(scenario.playerId, 'START_WORKOUT', {
        purpose: 'NORMAL_TROOPS',
        sessionId: 'wses_g1_estimate',
        now: 1_000,
      }, 'g1_start_estimate'));
      assert.strictEqual(start.success, true, start.errors[0]?.message);
      const session = orch.getState().playerFitness.activeSession!;
      assert.strictEqual(session.workoutId, EXPECTED_AUTHORED_SELECTED_ID);
      assert.strictEqual(session.prescribedWorkout.personalization?.applied ?? false, false);
      assertPrescriptionsMatchAuthored(session);
      assert.ok(orch.getState().playerFitness.estimate);
      assert.strictEqual(orch.getState().playerFitness.estimate!.level, 9.5);
    });
  });

  test('complete authored workout banks Troops via the existing reward pipeline', () => {
    const scenario = createVerticalSliceScenario();
    const ownershipBefore = ownershipSnapshot(scenario.state);
    withCatalogInstalled(scenario, (orch, catalog, recorder) => {
      assert.strictEqual(playerArmyCount(orch.getState()), 0);
      assert.strictEqual(orch.getState().playerRewards.bankedTroops, 0);

      const start = orch.execute(cmd(scenario.playerId, 'START_WORKOUT', {
        purpose: 'NORMAL_TROOPS',
        sessionId: 'wses_g1_complete',
        now: 1_000,
      }, 'g1_start_complete'));
      assert.strictEqual(start.success, true, start.errors[0]?.message);

      const mid = orch.getState().playerFitness.activeSession!;
      assert.strictEqual(mid.workoutId, EXPECTED_AUTHORED_SELECTED_ID);
      const firstPrescribed = mid.performances[0]!.prescribed;
      assert.deepStrictEqual(firstPrescribed, { kind: 'repetitions', repetitions: 8 });
      assert.deepStrictEqual(mid.performances[0]!.actual, { kind: 'none' });

      finishActiveWorkout(orch, scenario.playerId, 2_000);

      const afterExercises = orch.getState().playerFitness.activeSession!;
      assert.strictEqual(afterExercises.state, 'COMPLETED');
      assert.strictEqual(afterExercises.feedbackState, 'FEEDBACK_REQUIRED');
      assert.deepStrictEqual(afterExercises.performances[0]!.prescribed, firstPrescribed);
      assert.deepStrictEqual(afterExercises.performances[0]!.actual, {
        kind: 'repetitions',
        completedRepetitions: 8,
      });
      assert.deepStrictEqual(afterExercises.performances[1]!.prescribed, {
        kind: 'repetitions',
        repetitions: 5,
      });
      assert.deepStrictEqual(afterExercises.performances[1]!.actual, {
        kind: 'repetitions',
        completedRepetitions: 5,
      });

      const feedback = orch.execute(cmd(scenario.playerId, 'SUBMIT_WORKOUT_FEEDBACK', {
        value: 'ABOUT_RIGHT',
        now: 40_000,
      }, 'g1_fb'));
      assert.strictEqual(feedback.success, true, feedback.errors[0]?.message);
      assert.strictEqual(orch.getState().playerFitness.activeSession!.feedbackState, 'FEEDBACK_SUBMITTED');
      assert.strictEqual(orch.getState().playerFitness.activeSession!.feedback?.value, 'ABOUT_RIGHT');

      const bankedBeforeFinalize = orch.getState().playerRewards.bankedTroops;
      assert.strictEqual(bankedBeforeFinalize, 0);

      const finalized = orch.execute(cmd(scenario.playerId, 'FINALIZE_WORKOUT', {
        now: 41_000,
      }, 'g1_fin'));
      assert.strictEqual(finalized.success, true, finalized.errors[0]?.message);
      assert.strictEqual(finalized.payload.alreadyProcessed, false);
      assert.ok(typeof finalized.payload.physicalOutput === 'number');
      assert.ok(typeof finalized.payload.applicationId === 'string');

      const state = orch.getState();
      const bankedAfter = state.playerRewards.bankedTroops;
      assert.ok(bankedAfter > 0, `expected bankedTroops > 0, got ${bankedAfter}`);
      assert.strictEqual(finalized.payload.bankedTroops, bankedAfter);
      assert.strictEqual(state.playerFitness.activeSession, null);
      assert.strictEqual(
        state.playerRewards.appliedRewards.filter((r) => r.sessionId === 'wses_g1_complete').length,
        1,
      );
      assert.strictEqual(playerArmyCount(state), 0, 'reward must not spawn a field army');
      assert.deepStrictEqual(ownershipSnapshot(state), ownershipBefore);
      assert.strictEqual(state.definitionWorldId, VERTICAL_SLICE_WORLD_ID);
      assert.strictEqual(state.playerFactionId, VERTICAL_SLICE_PLAYER_FACTION_ID);

      const evidence = state.playerFitness.progression.evidenceLog;
      assert.ok(evidence.length >= 1);
      assert.strictEqual(evidence[0]!.sessionId, 'wses_g1_complete');
      assert.strictEqual(evidence[0]!.catalogId, catalog.catalogId);
      assert.strictEqual(evidence[0]!.abandoned, false);
      assert.strictEqual(evidence[0]!.completed, true);
      assert.ok(finalized.payload.progression, 'progression payload after reward');

      const types = recorder.getEvents().map((e) => e.eventType);
      for (const required of [
        'workout.selected',
        'workout.started',
        'workout.exercise_recorded',
        'workout.feedback_submitted',
        'workout.completed',
        'workout.reward_applied',
        'progression.evidence_updated',
      ] as const) {
        assert.ok(types.includes(required), `missing telemetry ${required}`);
      }
      assert.ok(
        types.includes('workout.game_reward') || types.includes('workout.reward_applied'),
        'reward telemetry must be present (system emits workout.reward_applied / workout.game_reward)',
      );

      assert.deepStrictEqual(checkGameStateInvariants(state), []);

      const again = orch.execute(cmd(scenario.playerId, 'FINALIZE_WORKOUT', {
        now: 42_000,
      }, 'g1_fin_dup'));
      assert.strictEqual(again.success, false);
      assert.strictEqual(orch.getState().playerRewards.bankedTroops, bankedAfter);
      assert.strictEqual(
        orch.getState().playerRewards.appliedRewards.filter((r) => r.sessionId === 'wses_g1_complete').length,
        1,
      );
    });
  });

  test('abandon after start does not award normal completion Troops', () => {
    const scenario = createVerticalSliceScenario();
    withCatalogInstalled(scenario, (orch) => {
      const start = orch.execute(cmd(scenario.playerId, 'START_WORKOUT', {
        purpose: 'NORMAL_TROOPS',
        sessionId: 'wses_g1_abandon',
        now: 1_000,
      }, 'g1_start_abandon'));
      assert.strictEqual(start.success, true, start.errors[0]?.message);
      const abandoned = orch.execute(cmd(scenario.playerId, 'ABANDON_WORKOUT', {
        now: 2_000,
      }, 'g1_abandon'));
      assert.strictEqual(abandoned.success, true, abandoned.errors[0]?.message);
      assert.strictEqual(orch.getState().playerFitness.activeSession?.state, 'ABANDONED');
      assert.strictEqual(orch.getState().playerRewards.bankedTroops, 0);
      assert.strictEqual(orch.getState().playerRewards.appliedRewards.length, 0);
      assert.strictEqual(playerArmyCount(orch.getState()), 0);

      const fin = orch.execute(cmd(scenario.playerId, 'FINALIZE_WORKOUT', { now: 3_000 }, 'g1_fin_abandon'));
      assert.strictEqual(fin.success, false);
      assert.strictEqual(orch.getState().playerRewards.bankedTroops, 0);
    });
  });

  test('incomplete session cannot finalize for a normal completion reward', () => {
    const scenario = createVerticalSliceScenario();
    withCatalogInstalled(scenario, (orch) => {
      const start = orch.execute(cmd(scenario.playerId, 'START_WORKOUT', {
        purpose: 'NORMAL_TROOPS',
        sessionId: 'wses_g1_incomplete',
        now: 1_000,
      }, 'g1_start_incomplete'));
      assert.strictEqual(start.success, true, start.errors[0]?.message);
      assert.strictEqual(orch.getState().playerFitness.activeSession?.state, 'ACTIVE');

      const fin = orch.execute(cmd(scenario.playerId, 'FINALIZE_WORKOUT', { now: 2_000 }, 'g1_fin_incomplete'));
      assert.strictEqual(fin.success, false);
      assert.strictEqual(orch.getState().playerRewards.bankedTroops, 0);
      assert.strictEqual(orch.getState().playerRewards.appliedRewards.length, 0);
      assert.strictEqual(orch.getState().playerFitness.activeSession?.state, 'ACTIVE');
    });
  });

  test('catalog install is scoped to the test and uninstalled afterward', () => {
    assert.strictEqual(getAuthoredWorkoutCatalog(), null);
    const scenario = createVerticalSliceScenario();
    withCatalogInstalled(scenario, (orch) => {
      assert.ok(getAuthoredWorkoutCatalog());
      const selection = orch.execute(cmd(scenario.playerId, 'GET_WORKOUT_SELECTION', {
        purpose: 'NORMAL_TROOPS',
      }, 'g1_iso_select'));
      assert.strictEqual(selection.success, true);
      assert.strictEqual(selection.payload.source, 'authored');
    });
    assert.strictEqual(getAuthoredWorkoutCatalog(), null);

    const outside = createVerticalSliceScenario();
    const orch = new Orchestrator(outside.state);
    const selection = orch.execute(cmd(outside.playerId, 'GET_WORKOUT_SELECTION', {
      purpose: 'NORMAL_TROOPS',
    }, 'g1_outside_select'));
    assert.strictEqual(selection.success, true, selection.errors[0]?.message);
    assert.notStrictEqual(selection.payload.source, 'authored');
  });
}
