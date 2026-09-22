import assert from 'assert';
import {
  COMMAND_INDEX,
  ErrorCode,
  Orchestrator,
  applyAuthoredProgression,
  compileAuthoringDocument,
  createLegacySampleMapGameState,
  createTelemetryRecorder,
  eligibleAuthoredWorkouts,
  emptyPlayerProgressionState,
  evaluateAuthoredProgression,
  getCurrentExercise,
  initializePlayerWorld,
  installAuthoredWorkoutCatalog,
  sampleAuthoringDocumentV2,
  selectAuthoredWorkout,
  stageMeetsMinimum,
  workoutRequirementsSatisfied,
} from '../src';
import type { CommandRequest, PlayerProgressionState, RuntimeWorkoutCatalog, WorkoutSession } from '../src';

export interface WorkoutProgressionTestApi {
  test: (name: string, fn: () => void) => void;
}

const PLAYER_ID = 'player_authored_prog';
const PLAYER_FACTION = 'iron_kingdom';

function cmd(commandId: string, parameters: Record<string, unknown> = {}, requestId?: string): CommandRequest {
  return {
    commandId,
    playerId: PLAYER_ID,
    requestId: requestId ?? `${commandId}_${Math.random().toString(36).slice(2, 8)}`,
    parameters,
  };
}

function compileFixture(): RuntimeWorkoutCatalog {
  const compiled = compileAuthoringDocument(sampleAuthoringDocumentV2());
  assert.ok(compiled.ok && compiled.catalog, compiled.issues.map((i) => i.message).join('; '));
  return compiled.catalog!;
}

function withCatalog<T>(fn: (catalog: RuntimeWorkoutCatalog) => T): T {
  const catalog = compileFixture();
  installAuthoredWorkoutCatalog(catalog);
  try {
    return fn(catalog);
  } finally {
    installAuthoredWorkoutCatalog(null);
  }
}

function orchWithCatalog(): { orch: Orchestrator; catalog: RuntimeWorkoutCatalog } {
  const catalog = compileFixture();
  installAuthoredWorkoutCatalog(catalog);
  const recorder = createTelemetryRecorder();
  const orch = new Orchestrator(
    createLegacySampleMapGameState({ seed: 21, playerFactionId: PLAYER_FACTION }),
    undefined,
    recorder,
  );
  return { orch, catalog };
}

function finishActiveWorkout(orch: Orchestrator, actualScale = 1, now = 2_000): void {
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
      parameters.repetitions = Math.round(step.prescription.repetitions * actualScale);
    } else {
      parameters.durationSeconds = Math.round(step.prescription.durationSeconds * actualScale);
    }
    const recorded = orch.execute(cmd('RECORD_EXERCISE', parameters));
    assert.strictEqual(recorded.success, true, recorded.errors[0]?.message);
  }
}

function completeAuthored(orch: Orchestrator, feedback: string, sessionId: string, size?: string): void {
  const start = orch.execute(cmd('START_WORKOUT', {
    purpose: 'NORMAL_TROOPS',
    sessionId,
    now: 1_000,
    ...(size ? { size } : {}),
  }));
  assert.strictEqual(start.success, true, start.errors[0]?.message);
  finishActiveWorkout(orch, 1, 2_000);
  const fb = orch.execute(cmd('SUBMIT_WORKOUT_FEEDBACK', { value: feedback, now: 20_000 }));
  assert.strictEqual(fb.success, true, fb.errors[0]?.message);
  const fin = orch.execute(cmd('FINALIZE_WORKOUT', { now: 21_000 }));
  assert.strictEqual(fin.success, true, fin.errors[0]?.message);
}

export function registerWorkoutProgressionTests(api: WorkoutProgressionTestApi): void {
  const { test } = api;

  test('movement readiness is family-specific and not a universal scalar', () => {
    const catalog = compileFixture();
    const state = emptyPlayerProgressionState();
    const push = catalog.movementFamilies.mf_horizontal_push!;
    const squat = catalog.movementFamilies.mf_squat!;
    assert.notStrictEqual(push.stages.length, squat.stages.length);
    assert.strictEqual(stageMeetsMinimum(push, 'ms_hp_1', 'ms_hp_1'), true);
    assert.strictEqual(stageMeetsMinimum(squat, 'ms_sq_1', 'ms_sq_2'), false);
    state.movementReadiness.mf_horizontal_push = 'ms_hp_2';
    state.movementReadiness.mf_squat = 'ms_sq_1';
    assert.strictEqual(workoutRequirementsSatisfied(catalog, state, 'aw_foundations_standard'), true);
    assert.strictEqual(workoutRequirementsSatisfied(catalog, state, 'aw_squat_stage2'), false);
    state.movementReadiness.mf_squat = 'ms_sq_2';
    assert.strictEqual(workoutRequirementsSatisfied(catalog, state, 'aw_squat_stage2'), true);
    assert.ok(!('level' in state));
    assert.ok(!('fitnessScore' in state));
  });

  test('exercise stage may exceed a family minimum requirement', () => {
    const catalog = compileFixture();
    const workout = catalog.workouts.aw_foundations_standard!;
    const stages = workout.exercises.map((step) => catalog.exercises[step.exerciseId]!.movementStageId);
    assert.ok(stages.includes('ms_hp_1'));
    assert.ok(stages.includes('ms_hp_2'));
    assert.strictEqual(workout.movementRequirements.length, 1);
    assert.strictEqual(workout.movementRequirements[0]!.minimumStageId, 'ms_hp_1');
    assert.strictEqual(workoutRequirementsSatisfied(catalog, emptyPlayerProgressionState(), workout.id), true);
  });

  test('selection window is authored, not a ±1 math rule', () => {
    const catalog = compileFixture();
    const state: PlayerProgressionState = { ...emptyPlayerProgressionState(), currentBandId: 'band_1a' };
    const ids = eligibleAuthoredWorkouts(catalog, state, { size: 'STANDARD' }).map((row) => row.id);
    assert.ok(ids.includes('aw_foundations_standard'));
    assert.ok(ids.includes('aw_bridge_1a_1b'));
    assert.ok(!ids.includes('aw_band2a_standard'));
    state.currentBandId = 'band_2a';
    const later = eligibleAuthoredWorkouts(catalog, state, { size: 'STANDARD' }).map((row) => row.id);
    assert.ok(later.includes('aw_band2a_standard'));
    assert.ok(!later.includes('aw_foundations_standard'));
  });

  test('SHORT STANDARD LONG select independently authored variants', () => {
    const catalog = compileFixture();
    const state = emptyPlayerProgressionState();
    const short = selectAuthoredWorkout(catalog, state, { size: 'SHORT' });
    const standard = selectAuthoredWorkout(catalog, state, { size: 'STANDARD' });
    const long = selectAuthoredWorkout(catalog, state, { size: 'LONG' });
    assert.ok(short.ok && standard.ok && long.ok);
    assert.strictEqual(short.value.size, 'SHORT');
    assert.strictEqual(short.value.workout.id, 'aw_foundations_short');
    assert.strictEqual(standard.value.size, 'STANDARD');
    assert.strictEqual(long.value.size, 'LONG');
    assert.strictEqual(long.value.workout.id, 'aw_foundations_long');
    assert.notStrictEqual(short.value.workout.exercises.length, standard.value.workout.exercises.length);
    assert.notStrictEqual(standard.value.workout.exercises.length, long.value.workout.exercises.length);
  });

  test('bridge workouts are preferred when they match the current band', () => {
    const catalog = compileFixture();
    const selected = selectAuthoredWorkout(catalog, emptyPlayerProgressionState(), { size: 'STANDARD' });
    assert.ok(selected.ok);
    assert.strictEqual(selected.value.workout.id, 'aw_bridge_1a_1b');
    assert.strictEqual(selected.value.usedBridgePreference, true);
    assert.deepStrictEqual(selected.value.workout.bridge, { fromBandId: 'band_1a', toBandId: 'band_1b' });
  });

  test('squat stage-2 requirement blocks until that family is ready', () => {
    const catalog = compileFixture();
    const blocked = emptyPlayerProgressionState();
    assert.ok(!eligibleAuthoredWorkouts(catalog, blocked).some((row) => row.id === 'aw_squat_stage2'));
    const ready: PlayerProgressionState = {
      ...emptyPlayerProgressionState(),
      movementReadiness: { mf_squat: 'ms_sq_2' },
    };
    assert.ok(eligibleAuthoredWorkouts(catalog, ready).some((row) => row.id === 'aw_squat_stage2'));
  });

  test('GET_WORKOUT_SELECTION and START_WORKOUT use the authored catalog when installed', () => {
    withCatalog((catalog) => {
      const { orch } = orchWithCatalog();
      try {
        const selection = orch.execute(cmd('GET_WORKOUT_SELECTION', { purpose: 'NORMAL_TROOPS', size: 'SHORT' }));
        assert.strictEqual(selection.success, true, selection.errors[0]?.message);
        assert.strictEqual(selection.payload.source, 'authored');
        assert.strictEqual(selection.payload.selectedWorkoutId, 'aw_foundations_short');
        assert.strictEqual(selection.payload.prescribedWorkout.personalized, false);
        const started = orch.execute(cmd('START_WORKOUT', {
          purpose: 'NORMAL_TROOPS',
          size: 'SHORT',
          sessionId: 'wses_authored_short',
          now: 1_000,
        }));
        assert.strictEqual(started.success, true, started.errors[0]?.message);
        assert.strictEqual(started.payload.workoutId, 'aw_foundations_short');
        const session = orch.getState().playerFitness.activeSession!;
        assert.strictEqual(session.workoutId, 'aw_foundations_short');
        assert.ok(session.authoredCatalog);
        assert.strictEqual(session.authoredCatalog!.catalogId, catalog.catalogId);
        const first = session.performances[0]!;
        assert.deepStrictEqual(first.prescribed, { kind: 'repetitions', repetitions: 6 });
        assert.deepStrictEqual(first.actual, { kind: 'none' });
      } finally {
        installAuthoredWorkoutCatalog(null);
      }
    });
  });

  test('authored prescriptions stay distinct from recorded performance', () => {
    const { orch } = orchWithCatalog();
    try {
      const started = orch.execute(cmd('START_WORKOUT', {
        purpose: 'NORMAL_TROOPS',
        workoutId: 'aw_foundations_short',
        sessionId: 'wses_authored_perf',
        now: 1_000,
      }));
      assert.strictEqual(started.success, true, started.errors[0]?.message);
      const session = orch.getState().playerFitness.activeSession!;
      const prescribed = session.performances[0]!.prescribed;
      assert.deepStrictEqual(prescribed, { kind: 'repetitions', repetitions: 6 });
      const recorded = orch.execute(cmd('RECORD_EXERCISE', {
        order: 0,
        repetitions: 4,
        now: 2_000,
      }));
      assert.strictEqual(recorded.success, true, recorded.errors[0]?.message);
      const after = orch.getState().playerFitness.activeSession!;
      assert.deepStrictEqual(after.performances[0]!.prescribed, prescribed);
      assert.deepStrictEqual(after.performances[0]!.actual, { kind: 'repetitions', completedRepetitions: 4 });
    } finally {
      installAuthoredWorkoutCatalog(null);
    }
  });

  test('two strong completions advance one band; one feedback does not', () => {
    const catalog = compileFixture();
    const sessionLike = (id: string, feedback: 'ABOUT_RIGHT' | 'TOO_EASY' | 'TOO_HARD', ratio = 1) => ({
      sessionId: id,
      playerId: PLAYER_ID,
      workoutId: 'aw_foundations_standard',
      intendedDifficulty: 'EASY' as const,
      purpose: 'NORMAL_TROOPS' as const,
      state: 'COMPLETED' as const,
      prescribedWorkout: { workoutId: 'aw_foundations_standard', intendedDifficulty: 'EASY' as const, exercises: [] },
      currentExerciseIndex: null,
      performances: [
        {
          exerciseId: 'ax_hp_incline',
          order: 0,
          exerciseType: 'REP_BASED' as const,
          prescribed: { kind: 'repetitions' as const, repetitions: 10 },
          actual: { kind: 'repetitions' as const, completedRepetitions: Math.round(10 * ratio) },
          status: 'COMPLETED' as const,
          startedAt: 1,
          completedAt: 2,
          activeDurationMs: 1,
        },
      ],
      createdAt: 1,
      startedAt: 1,
      completedAt: 2,
      abandonedAt: null,
      abandonmentReason: null,
      pauseIntervals: [],
      pauseCount: 0,
      integrityFlags: [],
      feedbackState: 'FEEDBACK_SUBMITTED' as const,
      feedback: { value: feedback, intendedDifficulty: 'EASY' as const, submittedAt: 3 },
    }) as WorkoutSession;
    const first = evaluateAuthoredProgression({
      catalog,
      state: emptyPlayerProgressionState(),
      session: sessionLike('s1', 'TOO_EASY'),
      workout: catalog.workouts.aw_foundations_standard!,
      now: 10,
    });
    assert.strictEqual(first.decision, 'HOLD');
    assert.strictEqual(first.bandAfter, 'band_1a');
    const second = evaluateAuthoredProgression({
      catalog,
      state: first.next,
      session: sessionLike('s2', 'ABOUT_RIGHT'),
      workout: catalog.workouts.aw_foundations_standard!,
      now: 20,
    });
    assert.strictEqual(second.decision, 'ADVANCE');
    assert.strictEqual(second.bandAfter, 'band_1b');
  });

  test('abandoned sessions do not produce advancement evidence', () => {
    const catalog = compileFixture();
    const { orch } = orchWithCatalog();
    try {
      orch.execute(cmd('START_WORKOUT', {
        purpose: 'NORMAL_TROOPS',
        workoutId: 'aw_foundations_short',
        sessionId: 'wses_authored_abandon',
        now: 1_000,
      }));
      const abandoned = orch.execute(cmd('ABANDON_WORKOUT', { now: 2_000 }));
      assert.strictEqual(abandoned.success, true, abandoned.errors[0]?.message);
      assert.strictEqual(orch.getState().playerFitness.progression.currentBandId, 'band_1a');
      assert.strictEqual(orch.getState().playerFitness.progression.evidenceLog[0]?.abandoned, true);
      assert.strictEqual(orch.getState().playerFitness.progression.evidenceLog[0]?.decision, 'NONE');
      const evaled = evaluateAuthoredProgression({
        catalog,
        state: emptyPlayerProgressionState(),
        session: orch.getState().playerFitness.activeSession!,
        workout: catalog.workouts.aw_foundations_short!,
        now: 3,
      });
      assert.strictEqual(evaled.decision, 'NONE');
    } finally {
      installAuthoredWorkoutCatalog(null);
    }
  });

  test('completion still runs the existing reward pipeline', () => {
    const { orch } = orchWithCatalog();
    try {
      completeAuthored(orch, 'ABOUT_RIGHT', 'wses_authored_reward', 'SHORT');
      assert.ok(orch.getState().playerRewards.appliedRewards.length >= 1);
      assert.ok(orch.getState().playerFitness.progression.evidenceLog.length >= 1);
      assert.strictEqual(orch.getState().playerFitness.progression.evidenceLog[0]!.decision, 'HOLD');
    } finally {
      installAuthoredWorkoutCatalog(null);
    }
  });

  test('Level 1 tutorial still uses the purpose table even if a catalog is installed', () => {
    withCatalog(() => {
      const orch = new Orchestrator(initializePlayerWorld({ playerId: PLAYER_ID, seed: 3 }).state);
      const selection = orch.execute(cmd('GET_WORKOUT_SELECTION', { purpose: 'NORMAL_TROOPS' }));
      assert.strictEqual(selection.success, true, selection.errors[0]?.message);
      assert.strictEqual(selection.payload.source, 'tutorial');
      assert.strictEqual(selection.payload.selectedWorkoutId, 'wk_moderate_full_body');
    });
  });

  test('START_WORKOUT is catalogued so omitted workoutId is backend-selected', () => {
    const def = COMMAND_INDEX.find((row) => row.commandId === 'START_WORKOUT');
    assert.ok(def);
    assert.ok(!def!.requiredParameters.some((p) => p.name === 'workoutId'));
    assert.ok(def!.optionalParameters.some((p) => p.name === 'workoutId'));
    assert.ok(def!.optionalParameters.some((p) => p.name === 'size'));
  });

  test('workout.selected telemetry precedes workout.started', () => {
    const catalog = compileFixture();
    installAuthoredWorkoutCatalog(catalog);
    const recorder = createTelemetryRecorder();
    const orch = new Orchestrator(
      createLegacySampleMapGameState({ seed: 22, playerFactionId: PLAYER_FACTION }),
      undefined,
      recorder,
    );
    try {
      const started = orch.execute(cmd('START_WORKOUT', {
        purpose: 'NORMAL_TROOPS',
        size: 'SHORT',
        sessionId: 'wses_tel_select',
        now: 1_000,
      }));
      assert.strictEqual(started.success, true, started.errors[0]?.message);
      const types = recorder.getEvents({ sessionId: 'wses_tel_select' }).map((event) => event.eventType);
      assert.ok(types.includes('workout.selected'));
      assert.ok(types.includes('workout.started'));
      assert.ok(types.indexOf('workout.selected') < types.indexOf('workout.started'));
    } finally {
      installAuthoredWorkoutCatalog(null);
    }
  });

  test('applyAuthoredProgression is a no-op without a catalog', () => {
    installAuthoredWorkoutCatalog(null);
    const orch = new Orchestrator(createLegacySampleMapGameState({ seed: 9, playerFactionId: PLAYER_FACTION }));
    orch.execute(cmd('START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      workoutId: 'wk_very_easy_mobility',
      sessionId: 'wses_no_catalog',
      now: 1_000,
    }));
    const result = applyAuthoredProgression(orch.getState(), orch.getState().playerFitness.activeSession!, 5);
    assert.strictEqual(result.applied, false);
  });

  test('unknown authored size is rejected', () => {
    const { orch } = orchWithCatalog();
    try {
      const res = orch.execute(cmd('GET_WORKOUT_SELECTION', { purpose: 'NORMAL_TROOPS', size: 'HUGE' }));
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.errors[0]?.code, ErrorCode.INVALID_PARAMETER);
    } finally {
      installAuthoredWorkoutCatalog(null);
    }
  });
}
