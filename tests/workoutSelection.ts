import assert from 'assert';
import {
  COMMAND_INDEX,
  DEFAULT_SELECTED_WORKOUT_ID,
  ErrorCode,
  FITNESS_MODEL_VERSION,
  Orchestrator,
  WORKOUT_PURPOSES,
  WORKOUT_SELECTION_BY_PURPOSE,
  checkGameStateInvariants,
  cloneGameState,
  createGameState,
  createTelemetryRecorder,
  getCurrentExercise,
  getWorkoutDefinition,
  initializePlayerWorld,
  listPurposeWorkoutSelections,
  personalizeWorkout,
  prescribeWorkoutBaseline,
  selectedWorkoutIdForPurpose,
} from '../src';
import type { CommandRequest, FitnessEstimate, Level1TutorialPublicView } from '../src';
import { MIN_ATTACKING_TROOPS } from '../src/army/strategicAttack';

export interface WorkoutSelectionTestApi {
  test: (name: string, fn: () => void) => void;
}

const PLAYER_ID = 'player_select';
const WORKOUT_ID = 'wk_moderate_full_body';

function cmd(commandId: string, parameters: Record<string, unknown> = {}, requestId?: string): CommandRequest {
  return {
    commandId,
    playerId: PLAYER_ID,
    requestId: requestId ?? `${commandId}_${PLAYER_ID}_${Math.random().toString(36).slice(2, 8)}`,
    parameters,
  };
}

function estimateAt(level: number, confidence: number, playerId = PLAYER_ID): FitnessEstimate {
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

function finishActiveWorkout(orch: Orchestrator, now = 2_000): void {
  let clock = now;
  while (orch.getState().playerFitness.activeSession?.state === 'ACTIVE') {
    const session = orch.getState().playerFitness.activeSession!;
    const step = getCurrentExercise(session);
    assert.ok(step, 'expected current exercise');
    clock += 1_000;
    if (step.skippable && step.exerciseType === 'REST') {
      const skipped = orch.execute(cmd('SKIP_REST', { order: step.order, now: clock }, `skip_${step.order}_${clock}`));
      assert.strictEqual(skipped.success, true, skipped.errors[0]?.message);
      continue;
    }
    const parameters: Record<string, unknown> = { order: step.order, now: clock };
    if (step.prescription.kind === 'repetitions') {
      parameters.repetitions = step.prescription.repetitions;
    } else {
      parameters.durationSeconds = step.prescription.durationSeconds;
    }
    const recorded = orch.execute(cmd('RECORD_EXERCISE', parameters, `ex_${step.order}_${clock}`));
    assert.strictEqual(recorded.success, true, recorded.errors[0]?.message);
  }
}

export function registerWorkoutSelectionTests(api: WorkoutSelectionTestApi): void {
  const { test } = api;

  console.log('Workout selection / prescription contract');

  test('every WorkoutPurpose maps to a catalog workout and the table is fail-closed', () => {
    const listed = listPurposeWorkoutSelections();
    assert.deepStrictEqual(listed.map((row) => row.purpose), [...WORKOUT_PURPOSES]);
    for (const purpose of WORKOUT_PURPOSES) {
      const id = selectedWorkoutIdForPurpose(purpose);
      assert.strictEqual(id, WORKOUT_SELECTION_BY_PURPOSE[purpose]);
      assert.strictEqual(id, DEFAULT_SELECTED_WORKOUT_ID);
      const definition = getWorkoutDefinition(id);
      assert.ok(definition, `missing catalog workout ${id} for ${purpose}`);
      assert.ok(!('purpose' in definition));
      assert.ok(definition.exercises.length > 0);
      assert.ok(definition.exercises.some((step) => step.role === 'REST'));
    }
    assert.throws(() => selectedWorkoutIdForPurpose('NOT_A_PURPOSE' as never));
  });

  test('GET_WORKOUT_SELECTION is catalogued as a read command', () => {
    const def = COMMAND_INDEX.find((c) => c.commandId === 'GET_WORKOUT_SELECTION');
    assert.ok(def);
    assert.strictEqual(def!.changesState, false);
    assert.strictEqual(def!.status, 'implemented');
    assert.ok(def!.requiredParameters.some((p) => p.name === 'purpose'));
    const start = COMMAND_INDEX.find((c) => c.commandId === 'START_WORKOUT');
    assert.ok(start);
    assert.ok(!start!.requiredParameters.some((p) => p.name === 'workoutId'));
    assert.ok(start!.optionalParameters.some((p) => p.name === 'workoutId'));
  });

  test('Level 1 first workout selection is authoritative, deterministic, and frontend-complete', () => {
    const orch = new Orchestrator(initializePlayerWorld({ playerId: PLAYER_ID, seed: 1 }).state);
    const first = orch.execute(cmd('GET_WORKOUT_SELECTION', { purpose: 'NORMAL_TROOPS' }, 'sel_first'));
    assert.strictEqual(first.success, true, first.errors[0]?.message);
    const payload = first.payload as {
      purpose: string;
      selectedWorkoutId: string;
      workout: { id: string; exercises: unknown[] };
      prescribedWorkout: { workoutId: string; exercises: unknown[]; personalized: boolean };
      source: string;
      tutorialBeat: string;
      expectedAction: string;
      allowed: boolean;
      constraints: { workoutIdMustMatchSelection: boolean };
    };
    assert.strictEqual(payload.purpose, 'NORMAL_TROOPS');
    assert.strictEqual(payload.selectedWorkoutId, WORKOUT_ID);
    assert.strictEqual(payload.workout.id, WORKOUT_ID);
    assert.ok(payload.workout.exercises.length > 0);
    assert.strictEqual(payload.prescribedWorkout.workoutId, WORKOUT_ID);
    assert.ok(payload.prescribedWorkout.exercises.length > 0);
    assert.strictEqual(payload.prescribedWorkout.personalized, false);
    assert.ok(!('personalization' in payload.prescribedWorkout));
    assert.strictEqual(payload.source, 'tutorial');
    assert.strictEqual(payload.tutorialBeat, 'FIRST_WORKOUT_PENDING');
    assert.strictEqual(payload.expectedAction, 'START_WORKOUT_NORMAL_TROOPS');
    assert.strictEqual(payload.allowed, true);
    assert.strictEqual(payload.constraints.workoutIdMustMatchSelection, true);

    const again = orch.execute(cmd('GET_WORKOUT_SELECTION', { purpose: 'NORMAL_TROOPS' }, 'sel_first_b'));
    assert.deepStrictEqual(again.payload, first.payload);
    assert.strictEqual(orch.getState().playerFitness.activeSession, null);

    const view = orch.execute(cmd('GET_GAME_STATE')).payload.gameState as { tutorial: Level1TutorialPublicView };
    assert.strictEqual(view.tutorial.expectedPurpose, 'NORMAL_TROOPS');
    assert.strictEqual(view.tutorial.expectedWorkoutId, WORKOUT_ID);

    const catalog = orch.execute(cmd('GET_FITNESS_CATALOG'));
    const selections = catalog.payload.purposeSelections as { purpose: string; selectedWorkoutId: string }[];
    assert.ok(selections.some((row) => row.purpose === 'NORMAL_TROOPS' && row.selectedWorkoutId === WORKOUT_ID));
  });

  test('Level 1 first, defense, and final troops workouts resolve without a client workoutId', () => {
    const orch = new Orchestrator(initializePlayerWorld({ playerId: PLAYER_ID, seed: 2 }).state);
    const firstSel = orch.execute(cmd('GET_WORKOUT_SELECTION', { purpose: 'NORMAL_TROOPS' }, 'sel_l1_1'));
    assert.strictEqual(firstSel.payload.selectedWorkoutId, WORKOUT_ID);
    assert.strictEqual(firstSel.payload.allowed, true);
    const first = orch.execute(cmd('START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      sessionId: 'wses_sel_1',
      now: 1_000,
    }, 'start_l1_1'));
    assert.strictEqual(first.success, true, first.errors[0]?.message);
    assert.strictEqual(first.payload.workoutId, WORKOUT_ID);
    assert.strictEqual(first.payload.selectedWorkoutId, WORKOUT_ID);
    const session = orch.getState().playerFitness.activeSession!;
    assert.strictEqual(session.workoutId, WORKOUT_ID);
    assert.deepStrictEqual(
      session.prescribedWorkout.exercises.map((step) => ({
        exerciseId: step.exerciseId,
        order: step.order,
        prescription: step.prescription,
      })),
      (firstSel.payload.prescribedWorkout as { exercises: { exerciseId: string; order: number; prescription: unknown }[] }).exercises.map((step) => ({
        exerciseId: step.exerciseId,
        order: step.order,
        prescription: step.prescription,
      })),
    );
    finishActiveWorkout(orch, 2_000);
    assert.strictEqual(orch.execute(cmd('SUBMIT_WORKOUT_FEEDBACK', { value: 'ABOUT_RIGHT', now: 20_000 }, 'fb_1')).success, true);
    assert.strictEqual(orch.execute(cmd('FINALIZE_WORKOUT', { now: 21_000 }, 'fin_1')).success, true);
    assert.ok(orch.getState().playerRewards.bankedTroops > MIN_ATTACKING_TROOPS);

    const troops = orch.getState().playerRewards.bankedTroops;
    assert.strictEqual(orch.execute(cmd('ATTACK', {
      territoryId: 't_01',
      commitAmount: Math.min(troops, MIN_ATTACKING_TROOPS + 20),
      seed: 3,
    }, 'atk_sel')).success, true);

    const defenseView = orch.execute(cmd('GET_GAME_STATE')).payload.gameState as { tutorial: Level1TutorialPublicView };
    assert.strictEqual(defenseView.tutorial.beat, 'DEFENSE_PENDING');
    assert.strictEqual(defenseView.tutorial.expectedPurpose, 'DEFENSE');
    assert.strictEqual(defenseView.tutorial.expectedWorkoutId, WORKOUT_ID);
    const defenseSel = orch.execute(cmd('GET_WORKOUT_SELECTION', { purpose: 'DEFENSE' }, 'sel_l1_def'));
    assert.strictEqual(defenseSel.success, true, defenseSel.errors[0]?.message);
    assert.strictEqual(defenseSel.payload.selectedWorkoutId, WORKOUT_ID);
    assert.strictEqual(defenseSel.payload.source, 'tutorial');
    assert.strictEqual(defenseSel.payload.allowed, true);
    assert.strictEqual(defenseSel.payload.recommendedInvasionId, defenseView.tutorial.defenseInvasionId);
    const invasionId = defenseSel.payload.recommendedInvasionId as string;
    assert.ok(invasionId);
    const defense = orch.execute(cmd('START_WORKOUT', {
      purpose: 'DEFENSE',
      invasionId,
      sessionId: 'wses_sel_def',
      now: 30_000,
    }, 'start_l1_def'));
    assert.strictEqual(defense.success, true, defense.errors[0]?.message);
    assert.strictEqual(defense.payload.workoutId, WORKOUT_ID);
    finishActiveWorkout(orch, 31_000);
    assert.strictEqual(orch.execute(cmd('SUBMIT_WORKOUT_FEEDBACK', { value: 'ABOUT_RIGHT', now: 40_000 }, 'fb_def')).success, true);
    assert.strictEqual(orch.execute(cmd('FINALIZE_WORKOUT', { now: 41_000 }, 'fin_def')).success, true);

    const finalSel = orch.execute(cmd('GET_WORKOUT_SELECTION', { purpose: 'NORMAL_TROOPS' }, 'sel_l1_2'));
    assert.strictEqual(finalSel.payload.tutorialBeat, 'FINAL_WORKOUT_PENDING');
    assert.strictEqual(finalSel.payload.selectedWorkoutId, WORKOUT_ID);
    assert.strictEqual(finalSel.payload.allowed, true);
    const final = orch.execute(cmd('START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      sessionId: 'wses_sel_2',
      now: 50_000,
    }, 'start_l1_2'));
    assert.strictEqual(final.success, true, final.errors[0]?.message);
    assert.strictEqual(final.payload.workoutId, WORKOUT_ID);
  });

  test('invalid workout references and purposes fail closed', () => {
    const orch = new Orchestrator(initializePlayerWorld({ playerId: PLAYER_ID, seed: 3 }).state);
    const missingPurpose = orch.execute(cmd('GET_WORKOUT_SELECTION', {}, 'sel_missing'));
    assert.strictEqual(missingPurpose.success, false);
    assert.strictEqual(missingPurpose.errors[0]?.code, ErrorCode.MISSING_PARAMETER);
    const badPurpose = orch.execute(cmd('GET_WORKOUT_SELECTION', { purpose: 'CARDIO' }, 'sel_bad'));
    assert.strictEqual(badPurpose.success, false);
    assert.strictEqual(badPurpose.errors[0]?.code, ErrorCode.INVALID_PARAMETER);
    const unknown = orch.execute(cmd('START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      workoutId: 'wk_does_not_exist',
      now: 1_000,
    }, 'start_unknown'));
    assert.strictEqual(unknown.success, false);
    assert.strictEqual(unknown.errors[0]?.code, ErrorCode.INVALID_PARAMETER);
    const mismatch = orch.execute(cmd('START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      workoutId: 'wk_very_easy_mobility',
      now: 1_000,
    }, 'start_mismatch'));
    assert.strictEqual(mismatch.success, false);
    assert.strictEqual(mismatch.errors[0]?.code, ErrorCode.INVALID_PARAMETER);
    assert.strictEqual(orch.getState().playerFitness.activeSession, null);
  });

  test('selected workout is personalized through the existing fitness pipeline', () => {
    const created = initializePlayerWorld({ playerId: PLAYER_ID, seed: 4 });
    created.state.playerFitness.estimate = estimateAt(8, 0.85);
    const orch = new Orchestrator(created.state);
    const definition = getWorkoutDefinition(WORKOUT_ID)!;
    const expected = personalizeWorkout(definition, {
      playerId: PLAYER_ID,
      fitnessEstimate: created.state.playerFitness.estimate!,
      desiredDifficulty: definition.intendedDifficulty,
      purpose: 'NORMAL_TROOPS',
    });
    assert.strictEqual(expected.ok, true);
    if (!expected.ok) return;
    const baseline = prescribeWorkoutBaseline(definition);
    const push = expected.value.exercises.find((step) => step.exerciseId === 'ex_push_ups')!;
    const baselinePush = baseline.exercises.find((step) => step.exerciseId === 'ex_push_ups')!;
    assert.notDeepStrictEqual(push.prescription, baselinePush.prescription);

    const selection = orch.execute(cmd('GET_WORKOUT_SELECTION', { purpose: 'NORMAL_TROOPS' }, 'sel_pers'));
    assert.strictEqual(selection.success, true, selection.errors[0]?.message);
    assert.strictEqual(selection.payload.prescribedWorkout.personalized, true);
    const selectedPush = (selection.payload.prescribedWorkout as {
      exercises: { exerciseId: string; prescription: unknown }[];
    }).exercises.find((step) => step.exerciseId === 'ex_push_ups');
    assert.deepStrictEqual(selectedPush?.prescription, push.prescription);

    const started = orch.execute(cmd('START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      sessionId: 'wses_pers',
      now: 1_000,
    }, 'start_pers'));
    assert.strictEqual(started.success, true, started.errors[0]?.message);
    const sessionPush = orch.getState().playerFitness.activeSession!.prescribedWorkout.exercises.find((step) => (
      step.exerciseId === 'ex_push_ups'
    ));
    assert.deepStrictEqual(sessionPush?.prescription, push.prescription);
  });

  test('direct catalog workoutId still works outside the Level 1 tutorial', () => {
    const orch = new Orchestrator(createGameState({ seed: 5, playerFactionId: null }));
    const selection = orch.execute(cmd('GET_WORKOUT_SELECTION', { purpose: 'NORMAL_TROOPS' }, 'sel_legacy'));
    assert.strictEqual(selection.success, true, selection.errors[0]?.message);
    assert.strictEqual(selection.payload.selectedWorkoutId, WORKOUT_ID);
    assert.strictEqual(selection.payload.source, 'purpose');
    assert.strictEqual(selection.payload.constraints.workoutIdMustMatchSelection, false);
    const easy = orch.execute(cmd('START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      workoutId: 'wk_very_easy_mobility',
      sessionId: 'wses_easy',
      now: 1_000,
    }, 'start_easy'));
    assert.strictEqual(easy.success, true, easy.errors[0]?.message);
    assert.strictEqual(easy.payload.workoutId, 'wk_very_easy_mobility');
    assert.strictEqual(easy.payload.selectedWorkoutId, WORKOUT_ID);
    assert.strictEqual(orch.getState().playerFitness.activeSession?.workoutId, 'wk_very_easy_mobility');
  });

  test('omitting workoutId on a non-tutorial world uses the authoritative selection', () => {
    const orch = new Orchestrator(createGameState({ seed: 6, playerFactionId: null }));
    const started = orch.execute(cmd('START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      sessionId: 'wses_default',
      now: 1_000,
    }, 'start_default'));
    assert.strictEqual(started.success, true, started.errors[0]?.message);
    assert.strictEqual(started.payload.workoutId, WORKOUT_ID);
    assert.strictEqual(orch.getState().playerFitness.activeSession?.workoutId, WORKOUT_ID);
    assert.deepStrictEqual(checkGameStateInvariants(orch.getState()), []);
  });

  test('GET_WORKOUT_SELECTION does not mutate GameState or emit telemetry', () => {
    const recorder = createTelemetryRecorder();
    const created = initializePlayerWorld({ playerId: PLAYER_ID, seed: 7 });
    const orch = new Orchestrator(created.state, undefined, recorder);
    const before = cloneGameState(orch.getState());
    assert.strictEqual(orch.execute(cmd('GET_WORKOUT_SELECTION', { purpose: 'GOLDEN_YIELD' }, 'sel_ro')).success, true);
    assert.strictEqual(orch.execute(cmd('GET_WORKOUT_SELECTION', { purpose: 'EXTRA_CONSTRUCTION_WORKERS' }, 'sel_ro2')).success, true);
    assert.deepStrictEqual(cloneGameState(orch.getState()), before);
    assert.strictEqual(recorder.getEvents().length, 0);
  });
}
