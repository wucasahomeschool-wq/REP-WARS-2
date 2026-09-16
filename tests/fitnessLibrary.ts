import assert from 'assert';
import {
  ALL_STRETCH_EXERCISE_IDS,
  ErrorCode,
  LIBRARY_DEFAULT_DURATION_SECONDS,
  LIBRARY_DEFAULT_REPETITIONS,
  LIBRARY_EXERCISES,
  LIBRARY_REUSED_EXERCISE_IDS,
  LIBRARY_STRETCH_EXERCISE_IDS,
  LIBRARY_TEMPLATES,
  Orchestrator,
  PHYSICAL_RESULT_CONFIG,
  beginWorkoutSession,
  createGameState,
  exerciseCatalogById,
  getExerciseDefinition,
  getWorkoutDefinition,
  initializePlayerWorld,
  listExerciseDefinitions,
  listWorkoutDefinitions,
  personalizeWorkout,
  prescribeWorkoutBaseline,
  selectedWorkoutIdForPurpose,
  validateExerciseCatalog,
  validateWorkoutCatalog,
  validateWorkoutDefinition,
} from '../src';
import type { CommandRequest, FitnessEstimate } from '../src';
import { FITNESS_MODEL_VERSION } from '../src/fitness';

export interface FitnessLibraryTestApi {
  test: (name: string, fn: () => void) => void;
}

const PLAYER_ID = 'player_library';

function cmd(commandId: string, parameters: Record<string, unknown> = {}, requestId?: string): CommandRequest {
  return {
    commandId,
    playerId: PLAYER_ID,
    requestId: requestId ?? `${commandId}_${PLAYER_ID}`,
    parameters,
  };
}

function estimateAt(level: number, confidence: number): FitnessEstimate {
  return {
    modelVersion: FITNESS_MODEL_VERSION,
    playerId: PLAYER_ID,
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
    observationCount: 4,
  };
}

export function registerFitnessLibraryTests(api: FitnessLibraryTestApi): void {
  const { test } = api;
  const catalog = exerciseCatalogById();

  console.log('Workout library import / normalization');

  test('every imported exercise is valid in the Rep Wars catalog', () => {
    assert.strictEqual(LIBRARY_EXERCISES.length, 67);
    assert.strictEqual(LIBRARY_STRETCH_EXERCISE_IDS.length, 8);
    assert.strictEqual(validateExerciseCatalog(listExerciseDefinitions()).length, 0);
    for (const spec of LIBRARY_EXERCISES) {
      const def = getExerciseDefinition(spec.id);
      assert.ok(def, spec.id);
      assert.strictEqual(def!.name, spec.name);
      assert.strictEqual(def!.type, spec.type);
      assert.strictEqual(def!.bodySection, spec.bodySection);
      assert.strictEqual(def!.isRest, false);
      if (spec.type === 'REP_BASED') {
        assert.deepStrictEqual(def!.defaultPrescription, {
          kind: 'repetitions',
          repetitions: LIBRARY_DEFAULT_REPETITIONS,
        });
      } else {
        assert.deepStrictEqual(def!.defaultPrescription, {
          kind: 'duration',
          durationSeconds: LIBRARY_DEFAULT_DURATION_SECONDS,
        });
      }
      if (spec.kind === 'stretch') {
        assert.strictEqual(def!.type, 'TIMED');
        assert.strictEqual(def!.metadata.notes, 'Stretch');
      }
    }
    for (const id of LIBRARY_REUSED_EXERCISE_IDS) {
      assert.ok(catalog.has(id), id);
    }
  });

  test('imported stretches stay classified as stretches', () => {
    for (const id of ALL_STRETCH_EXERCISE_IDS) {
      assert.ok(catalog.has(id), id);
      const def = catalog.get(id)!;
      assert.strictEqual(def.type, 'TIMED');
      assert.strictEqual(def.isRest, false);
    }
    for (const id of LIBRARY_STRETCH_EXERCISE_IDS) {
      assert.ok((PHYSICAL_RESULT_CONFIG.stretchExerciseIds as readonly string[]).includes(id), id);
    }
    assert.ok(!LIBRARY_STRETCH_EXERCISE_IDS.includes('ex_plank'));
    assert.ok(!LIBRARY_STRETCH_EXERCISE_IDS.includes('ex_calf_raises'));
  });

  test('every imported template references valid exercises and preserves order and repeats', () => {
    assert.strictEqual(LIBRARY_TEMPLATES.length, 51);
    assert.strictEqual(validateWorkoutCatalog(listWorkoutDefinitions(), catalog).length, 0);
    for (const spec of LIBRARY_TEMPLATES) {
      const workout = getWorkoutDefinition(spec.id);
      assert.ok(workout, spec.id);
      assert.strictEqual(validateWorkoutDefinition(workout!, catalog).length, 0);
      assert.strictEqual(workout!.name, spec.name);
      assert.ok(!/kex/i.test(workout!.name));
      assert.strictEqual(workout!.exercises.length, spec.exerciseIds.length);
      assert.deepStrictEqual(workout!.exercises.map((step) => step.exerciseId), [...spec.exerciseIds]);
      assert.deepStrictEqual(workout!.exercises.map((step) => step.order), spec.exerciseIds.map((_, index) => index));
      assert.ok(workout!.exercises.every((step) => !step.skippable));
      assert.ok(!workout!.exercises.some((step) => step.role === 'REST'));
      assert.ok(!('purpose' in workout!));
    }
    const plankHold = getWorkoutDefinition('wk_core_04')!;
    assert.deepStrictEqual(plankHold.exercises.map((step) => step.exerciseId), [
      'ex_plank',
      'ex_hollow_body_hold',
      'ex_side_plank',
      'ex_boat_pose_hold',
      'ex_superman_hold',
      'ex_plank',
      'ex_side_plank',
    ]);
    assert.strictEqual(plankHold.exercises.filter((step) => step.exerciseId === 'ex_plank').length, 2);
    assert.strictEqual(plankHold.exercises.filter((step) => step.exerciseId === 'ex_side_plank').length, 2);
    const flutterRepeat = getWorkoutDefinition('wk_core_16')!;
    assert.strictEqual(flutterRepeat.exercises.filter((step) => step.exerciseId === 'ex_flutter_kicks').length, 2);
    assert.strictEqual(flutterRepeat.exercises.filter((step) => step.exerciseId === 'ex_scissor_kicks').length, 2);
  });

  test('library prescriptions are Rep Wars defaults, not source-app numbers', () => {
    for (const spec of LIBRARY_TEMPLATES) {
      const workout = getWorkoutDefinition(spec.id)!;
      for (const step of workout.exercises) {
        const def = catalog.get(step.exerciseId)!;
        assert.deepStrictEqual(step.prescription, def.defaultPrescription);
        if (def.id === 'ex_squats') {
          assert.deepStrictEqual(step.prescription, { kind: 'repetitions', repetitions: 12 });
        }
        if (LIBRARY_EXERCISES.some((item) => item.id === def.id && item.type === 'REP_BASED')) {
          assert.deepStrictEqual(step.prescription, { kind: 'repetitions', repetitions: LIBRARY_DEFAULT_REPETITIONS });
        }
        if (LIBRARY_EXERCISES.some((item) => item.id === def.id && item.type === 'TIMED')) {
          assert.deepStrictEqual(step.prescription, { kind: 'duration', durationSeconds: LIBRARY_DEFAULT_DURATION_SECONDS });
        }
      }
    }
  });

  test('catalog text does not carry source-app branding or unusual workout names', () => {
    const blob = JSON.stringify({
      exercises: listExerciseDefinitions(),
      workouts: listWorkoutDefinitions(),
    });
    assert.ok(!/kex/i.test(blob));
    assert.ok(!/plank of doom/i.test(blob));
    assert.ok(!/banana boat/i.test(blob));
    assert.ok(!/favorite things/i.test(blob));
    assert.ok(blob.includes('Star plank hold'));
    assert.ok(blob.includes('Plank'));
  });

  test('rep-based and timed library exercises personalize through the existing pipeline', () => {
    const workout = getWorkoutDefinition('wk_core_01')!;
    const baseline = prescribeWorkoutBaseline(workout);
    const personalized = personalizeWorkout(workout, {
      playerId: PLAYER_ID,
      fitnessEstimate: estimateAt(8, 0.85),
      desiredDifficulty: 'MODERATE',
      purpose: 'NORMAL_TROOPS',
    });
    assert.strictEqual(personalized.ok, true);
    if (!personalized.ok) return;
    assert.deepStrictEqual(
      personalized.value.exercises.map((step) => step.exerciseId),
      baseline.exercises.map((step) => step.exerciseId),
    );
    const crunch = personalized.value.exercises.find((step) => step.exerciseId === 'ex_crunches')!;
    const baseCrunch = baseline.exercises.find((step) => step.exerciseId === 'ex_crunches')!;
    assert.notDeepStrictEqual(crunch.prescription, baseCrunch.prescription);
    const session = beginWorkoutSession({
      playerId: PLAYER_ID,
      purpose: 'NORMAL_TROOPS',
      intendedDifficulty: 'MODERATE',
      workoutId: 'wk_core_01',
      fitnessEstimate: estimateAt(8, 0.85),
      now: 1_000,
      sessionId: 'wses_lib_core',
    });
    assert.strictEqual(session.ok, true);
    if (!session.ok) return;
    const sessionCrunch = session.value.prescribedWorkout.exercises.find((step) => step.exerciseId === 'ex_crunches')!;
    assert.deepStrictEqual(sessionCrunch.prescription, crunch.prescription);
  });

  test('Level 1 selection and wk_moderate_full_body content are unchanged', () => {
    assert.strictEqual(selectedWorkoutIdForPurpose('NORMAL_TROOPS'), 'wk_moderate_full_body');
    assert.strictEqual(selectedWorkoutIdForPurpose('DEFENSE'), 'wk_moderate_full_body');
    const moderate = getWorkoutDefinition('wk_moderate_full_body')!;
    assert.deepStrictEqual(moderate.exercises.map((step) => step.exerciseId), [
      'ex_neck_rolls',
      'ex_arm_circles',
      'ex_push_ups',
      'ex_rest',
      'ex_squats',
      'ex_rest',
      'ex_sit_ups',
      'ex_plank',
      'ex_shoulder_stretch',
      'ex_quad_stretch',
    ]);
    const orch = new Orchestrator(initializePlayerWorld({ playerId: PLAYER_ID, seed: 1 }).state);
    const selection = orch.execute(cmd('GET_WORKOUT_SELECTION', { purpose: 'NORMAL_TROOPS' }));
    assert.strictEqual(selection.success, true, selection.errors[0]?.message);
    assert.strictEqual(selection.payload.selectedWorkoutId, 'wk_moderate_full_body');
    const catalogRes = orch.execute(cmd('GET_FITNESS_CATALOG'));
    const workouts = catalogRes.payload.workouts as { id: string }[];
    assert.ok(workouts.some((row) => row.id === 'wk_core_01'));
    assert.ok(workouts.some((row) => row.id === 'wk_upper_01'));
    assert.ok(workouts.some((row) => row.id === 'wk_lower_01'));
    assert.ok(workouts.length >= 5 + LIBRARY_TEMPLATES.length);
    const started = orch.execute(cmd('START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      sessionId: 'wses_lib_l1',
      now: 1_000,
    }));
    assert.strictEqual(started.success, true, started.errors[0]?.message);
    assert.strictEqual(started.payload.workoutId, 'wk_moderate_full_body');
  });

  test('an imported template can start a session without becoming the purpose-selection default', () => {
    const orch = new Orchestrator(createGameState({ seed: 2, playerFactionId: null }));
    const started = orch.execute(cmd('START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      workoutId: 'wk_upper_01',
      sessionId: 'wses_lib_upper',
      now: 1_000,
    }));
    assert.strictEqual(started.success, true, started.errors[0]?.message);
    assert.strictEqual(started.payload.workoutId, 'wk_upper_01');
    assert.strictEqual(started.payload.selectedWorkoutId, 'wk_moderate_full_body');
    assert.deepStrictEqual(
      orch.getState().playerFitness.activeSession?.prescribedWorkout.exercises.map((step) => step.exerciseId),
      [...LIBRARY_TEMPLATES.find((row) => row.id === 'wk_upper_01')!.exerciseIds],
    );
    const other = new Orchestrator(createGameState({ seed: 3, playerFactionId: null }));
    const missing = other.execute(cmd('START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      workoutId: 'wk_core_99',
      now: 1_000,
    }));
    assert.strictEqual(missing.success, false);
    assert.strictEqual(missing.errors[0]?.code, ErrorCode.INVALID_PARAMETER);
  });
}
