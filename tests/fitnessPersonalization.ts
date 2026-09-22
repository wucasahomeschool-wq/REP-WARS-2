import assert from 'assert';
import {
  FITNESS_MODEL_VERSION,
  FITNESS_PERSONALIZATION_CONFIG,
  cloneFitnessEstimate,
  clonePrescribedWorkout,
  cloneWorkoutDefinition,
  computePersonalizationMapping,
  confidenceFactor,
  createInitialFitnessEstimate,
  createWorkoutSession,
  exerciseCatalogById,
  getExerciseDefinition,
  getWorkoutDefinition,
  personalizationDecisionForStep,
  personalizeWorkout,
  prescribeWorkoutBaseline,
  scaleDurationSeconds,
  scaleRepetitions,
  validatePersonalizationConfig,
} from '../src/fitness';
import type {
  EstimateOpResult,
  ExercisePrescription,
  FitnessEstimate,
  FitnessPersonalizationConfig,
  PersonalizationOpResult,
  PrescribedWorkout,
  SessionOpResult,
  WorkoutDefinition,
  WorkoutDifficulty,
  WorkoutPurpose,
} from '../src/fitness';
import { createGameState } from '../src/state';

export interface FitnessPersonalizationTestApi {
  test: (name: string, fn: () => void) => void;
}

function must<T>(
  result: PersonalizationOpResult<T> | SessionOpResult<T> | EstimateOpResult<T>,
  label: string,
): T {
  if (!result.ok) {
    throw new Error(`${label}: ${result.error.code} ${(result.error as { message: string }).message}`);
  }
  return result.value;
}

function errCode(result: PersonalizationOpResult<unknown>): string {
  assert.strictEqual(result.ok, false, 'expected personalization error');
  return result.error.code;
}

function estimateAt(
  level: number,
  confidence: number,
  playerId = 'player_1',
  extras: Partial<FitnessEstimate['bodySectionLevels']> = {},
): FitnessEstimate {
  return {
    modelVersion: FITNESS_MODEL_VERSION,
    playerId,
    level,
    confidence,
    bodySectionLevels: {
      GLOBAL: extras.GLOBAL ?? level,
      UPPER_BODY: extras.UPPER_BODY ?? level,
      CORE: extras.CORE ?? level,
      LOWER_BODY: extras.LOWER_BODY ?? level,
    },
    initializedAt: 1_000,
    lastUpdatedAt: 1_000,
    observationCount: confidence > 0.08 ? 4 : 0,
  };
}

function personalize(
  workout: WorkoutDefinition,
  estimate: FitnessEstimate,
  desiredDifficulty: WorkoutDifficulty = workout.intendedDifficulty,
  purpose?: WorkoutPurpose,
  configuration?: FitnessPersonalizationConfig,
): PrescribedWorkout {
  return must(personalizeWorkout(workout, {
    playerId: estimate.playerId,
    fitnessEstimate: estimate,
    desiredDifficulty,
    purpose,
    configuration,
  }), 'personalizeWorkout');
}

function qty(prescription: ExercisePrescription): number {
  return prescription.kind === 'repetitions' ? prescription.repetitions : prescription.durationSeconds;
}

function stepById(prescribed: PrescribedWorkout, exerciseId: string, order?: number) {
  const found = prescribed.exercises.find((step) => (
    step.exerciseId === exerciseId && (order === undefined || step.order === order)
  ));
  assert.ok(found, `missing ${exerciseId}`);
  return found;
}

function trainingLoad(prescribed: PrescribedWorkout, workout: WorkoutDefinition): number {
  const catalog = exerciseCatalogById();
  let load = 0;
  for (let i = 0; i < prescribed.exercises.length; i++) {
    const source = workout.exercises[i]!;
    const exercise = catalog.get(source.exerciseId);
    assert.ok(exercise);
    if (personalizationDecisionForStep(source, exercise) !== 'SCALE') continue;
    load += qty(prescribed.exercises[i]!.prescription);
  }
  return load;
}

function structuralUnchanged(
  personalized: PrescribedWorkout,
  baseline: PrescribedWorkout,
  workout: WorkoutDefinition,
): void {
  const catalog = exerciseCatalogById();
  for (let i = 0; i < workout.exercises.length; i++) {
    const source = workout.exercises[i]!;
    const exercise = catalog.get(source.exerciseId)!;
    if (personalizationDecisionForStep(source, exercise) === 'SCALE') continue;
    assert.deepStrictEqual(
      personalized.exercises[i]!.prescription,
      baseline.exercises[i]!.prescription,
      `structural step ${source.exerciseId} changed`,
    );
  }
}

export function registerFitnessPersonalizationTests(api: FitnessPersonalizationTestApi): void {
  const { test } = api;
  const moderate = getWorkoutDefinition('wk_moderate_full_body')!;
  const baselineModerate = prescribeWorkoutBaseline(moderate);

  console.log('Phase 17E — new player and confidence blending');

  test('initial estimate stays very close to the catalog baseline', () => {
    const initial = must(createInitialFitnessEstimate({ playerId: 'player_1', now: 1_000 }), 'initial');
    const prescribed = personalize(moderate, initial, 'MODERATE');
    assert.strictEqual(prescribed.intendedDifficulty, 'MODERATE');
    assert.strictEqual(prescribed.workoutId, moderate.id);
    assert.ok(prescribed.personalization);
    assert.strictEqual(prescribed.personalization.confidenceFactor, 0);
    assert.strictEqual(prescribed.personalization.effectiveMultiplier, 1);
    assert.strictEqual(trainingLoad(prescribed, moderate), trainingLoad(baselineModerate, moderate));
    assert.strictEqual(stepById(prescribed, 'ex_push_ups').prescription.kind, 'repetitions');
    if (stepById(prescribed, 'ex_push_ups').prescription.kind === 'repetitions') {
      assert.strictEqual(stepById(prescribed, 'ex_push_ups').prescription.repetitions, 10);
    }
  });

  test('high fitness with low confidence only nudges slightly toward the personalized target', () => {
    const prescribed = personalize(moderate, estimateAt(8, 0.1), 'MODERATE');
    const high = personalize(moderate, estimateAt(8, 0.85), 'MODERATE');
    assert.ok(prescribed.personalization);
    assert.ok(prescribed.personalization.effectiveMultiplier > 1);
    assert.ok(prescribed.personalization.effectiveMultiplier < high.personalization!.effectiveMultiplier);
    assert.ok(trainingLoad(prescribed, moderate) <= trainingLoad(high, moderate));
    const push = stepById(prescribed, 'ex_push_ups');
    const basePush = stepById(baselineModerate, 'ex_push_ups');
    if (push.prescription.kind === 'repetitions' && basePush.prescription.kind === 'repetitions') {
      assert.ok(push.prescription.repetitions - basePush.prescription.repetitions <= 1);
    }
  });

  test('high fitness with high confidence raises the prescription but stays bounded', () => {
    const prescribed = personalize(moderate, estimateAt(8, 0.85), 'MODERATE');
    assert.ok(prescribed.personalization);
    assert.ok(prescribed.personalization.confidenceFactor >= 1);
    assert.ok(prescribed.personalization.effectiveMultiplier > 1);
    assert.ok(prescribed.personalization.effectiveMultiplier <= FITNESS_PERSONALIZATION_CONFIG.maxMultiplier);
    assert.ok(trainingLoad(prescribed, moderate) > trainingLoad(baselineModerate, moderate));
    const push = stepById(prescribed, 'ex_push_ups');
    if (push.prescription.kind === 'repetitions') {
      assert.ok(push.prescription.repetitions > 10);
      assert.ok(push.prescription.repetitions <= 10 + FITNESS_PERSONALIZATION_CONFIG.maxAbsRepAdjustment);
      assert.ok(push.prescription.repetitions < 20);
    }
  });

  test('low fitness with high confidence lowers the prescription but stays bounded', () => {
    const prescribed = personalize(moderate, estimateAt(2.5, 0.85), 'MODERATE');
    assert.ok(prescribed.personalization);
    assert.ok(prescribed.personalization.effectiveMultiplier < 1);
    assert.ok(prescribed.personalization.effectiveMultiplier >= FITNESS_PERSONALIZATION_CONFIG.minMultiplier);
    assert.ok(trainingLoad(prescribed, moderate) < trainingLoad(baselineModerate, moderate));
    const push = stepById(prescribed, 'ex_push_ups');
    if (push.prescription.kind === 'repetitions') {
      assert.ok(push.prescription.repetitions < 10);
      assert.ok(push.prescription.repetitions >= 10 - FITNESS_PERSONALIZATION_CONFIG.maxAbsRepAdjustment);
      assert.ok(push.prescription.repetitions >= FITNESS_PERSONALIZATION_CONFIG.minRepetitions);
    }
  });

  console.log('Phase 17E — difficulty remains meaningful');

  test('same player receives ordered EASY < MODERATE < HARD workloads', () => {
    const estimate = estimateAt(6.5, 0.7);
    const easy = personalize(moderate, estimate, 'EASY');
    const mid = personalize(moderate, estimate, 'MODERATE');
    const hard = personalize(moderate, estimate, 'HARD');
    assert.strictEqual(easy.intendedDifficulty, 'EASY');
    assert.strictEqual(mid.intendedDifficulty, 'MODERATE');
    assert.strictEqual(hard.intendedDifficulty, 'HARD');
    assert.ok(trainingLoad(easy, moderate) < trainingLoad(mid, moderate));
    assert.ok(trainingLoad(mid, moderate) < trainingLoad(hard, moderate));
  });

  test('player-facing difficulty stays a named label, not a Fitness Level number', () => {
    const prescribed = personalize(moderate, estimateAt(6.37, 0.9), 'HARD');
    assert.strictEqual(prescribed.intendedDifficulty, 'HARD');
    assert.notStrictEqual(prescribed.intendedDifficulty, '6.37' as WorkoutDifficulty);
  });

  test('VERY_EASY stays easier than VERY_HARD for the same player and workout', () => {
    const estimate = estimateAt(5.5, 0.6);
    const veryEasy = personalize(moderate, estimate, 'VERY_EASY');
    const veryHard = personalize(moderate, estimate, 'VERY_HARD');
    assert.ok(trainingLoad(veryEasy, moderate) < trainingLoad(veryHard, moderate));
  });

  console.log('Phase 17E — players, confidence, and mapping');

  test('different players with meaningful confidence receive different prescriptions', () => {
    const low = personalize(moderate, estimateAt(2.5, 0.85, 'player_a'), 'MODERATE');
    const high = personalize(moderate, estimateAt(8.5, 0.85, 'player_b'), 'MODERATE');
    assert.notDeepStrictEqual(low.exercises.map((s) => s.prescription), high.exercises.map((s) => s.prescription));
    assert.ok(trainingLoad(low, moderate) < trainingLoad(high, moderate));
  });

  test('same Fitness Level with higher confidence personalizes more strongly', () => {
    const weak = personalize(moderate, estimateAt(8, 0.2), 'MODERATE');
    const strong = personalize(moderate, estimateAt(8, 0.9), 'MODERATE');
    assert.ok(weak.personalization!.confidenceFactor < strong.personalization!.confidenceFactor);
    assert.ok(weak.personalization!.effectiveMultiplier < strong.personalization!.effectiveMultiplier);
    assert.ok(trainingLoad(weak, moderate) <= trainingLoad(strong, moderate));
  });

  test('Fitness Level 5 maps to no fitness shift; confidence floor maps to factor 0', () => {
    const mapping = computePersonalizationMapping({
      fitnessLevel: 5,
      confidence: FITNESS_PERSONALIZATION_CONFIG.confidenceFloor,
      catalogDifficulty: 'MODERATE',
      desiredDifficulty: 'MODERATE',
    });
    assert.strictEqual(mapping.fitnessShift, 0);
    assert.strictEqual(mapping.difficultyShift, 0);
    assert.strictEqual(mapping.confidenceFactor, 0);
    assert.strictEqual(mapping.effectiveMultiplier, 1);
    assert.strictEqual(confidenceFactor(FITNESS_PERSONALIZATION_CONFIG.confidenceFull), 1);
  });

  test('absolute and multiplier bounds prevent huge jumps from high Fitness Level', () => {
    const prescribed = personalize(moderate, estimateAt(10, 1), 'VERY_HARD');
    assert.ok(prescribed.personalization!.effectiveMultiplier <= FITNESS_PERSONALIZATION_CONFIG.maxMultiplier);
    const push = stepById(prescribed, 'ex_push_ups');
    if (push.prescription.kind === 'repetitions') {
      assert.ok(push.prescription.repetitions <= 10 + FITNESS_PERSONALIZATION_CONFIG.maxAbsRepAdjustment);
      assert.notStrictEqual(push.prescription.repetitions, 97);
    }
    const plank = stepById(prescribed, 'ex_plank');
    if (plank.prescription.kind === 'duration') {
      assert.ok(plank.prescription.durationSeconds <= 20 + FITNESS_PERSONALIZATION_CONFIG.maxAbsDurationAdjustment);
    }
  });

  test('raw Fitness Level above the mapping reference still personalizes without recapping the estimate', () => {
    const prescribed = personalize(moderate, estimateAt(18, 0.95), 'MODERATE');
    assert.strictEqual(prescribed.personalization!.fitnessLevelUsed, 18);
    assert.ok(prescribed.personalization!.effectiveMultiplier <= FITNESS_PERSONALIZATION_CONFIG.maxMultiplier);
    assert.ok(prescribed.personalization!.fitnessShift <= FITNESS_PERSONALIZATION_CONFIG.maxFitnessShift);
  });

  console.log('Phase 17E — REST, stretching, body sections, purpose');

  test('REST prescriptions are not scaled as training volume', () => {
    const prescribed = personalize(moderate, estimateAt(9, 0.95), 'HARD');
    structuralUnchanged(prescribed, baselineModerate, moderate);
    const rest = prescribed.exercises.find((step) => step.role === 'REST');
    const baseRest = baselineModerate.exercises.find((step) => step.role === 'REST');
    assert.ok(rest && baseRest);
    assert.deepStrictEqual(rest.prescription, baseRest.prescription);
    assert.strictEqual(rest.skippable, true);
  });

  test('opening and final stretches remain structurally stable', () => {
    const prescribed = personalize(moderate, estimateAt(1, 0.95), 'VERY_EASY');
    for (const role of ['OPENING_STRETCH', 'FINAL_STRETCH'] as const) {
      const personalized = prescribed.exercises.filter((step) => step.role === role);
      const original = baselineModerate.exercises.filter((step) => step.role === role);
      assert.ok(personalized.length > 0);
      assert.deepStrictEqual(
        personalized.map((step) => step.prescription),
        original.map((step) => step.prescription),
      );
    }
  });

  test('body-section identity, order, and skippable flags survive personalization', () => {
    const prescribed = personalize(moderate, estimateAt(7, 0.75), 'MODERATE');
    assert.strictEqual(prescribed.exercises.length, moderate.exercises.length);
    for (let i = 0; i < moderate.exercises.length; i++) {
      const source = moderate.exercises[i]!;
      const step = prescribed.exercises[i]!;
      assert.strictEqual(step.exerciseId, source.exerciseId);
      assert.strictEqual(step.order, source.order);
      assert.strictEqual(step.role, source.role);
      assert.strictEqual(step.skippable, source.skippable);
      const definition = getExerciseDefinition(step.exerciseId)!;
      assert.ok(['UPPER_BODY', 'CORE', 'LOWER_BODY', 'GLOBAL'].includes(definition.bodySection));
    }
  });

  test('changing purpose alone does not change the physical prescription', () => {
    const estimate = estimateAt(7.2, 0.8);
    const troops = personalize(moderate, estimate, 'MODERATE', 'NORMAL_TROOPS');
    const yieldGoal = personalize(moderate, estimate, 'MODERATE', 'GOLDEN_YIELD');
    const defense = personalize(moderate, estimate, 'MODERATE', 'DEFENSE');
    assert.deepStrictEqual(troops.exercises, yieldGoal.exercises);
    assert.deepStrictEqual(troops.exercises, defense.exercises);
    assert.deepStrictEqual(troops.personalization, yieldGoal.personalization);
  });

  console.log('Phase 17E — rounding, timed work, and configuration');

  test('repetition rounding is nearest-integer and respects absolute caps', () => {
    assert.strictEqual(scaleRepetitions(10, 1), 10);
    assert.strictEqual(scaleRepetitions(10, 1.04), 10);
    assert.strictEqual(scaleRepetitions(10, 1.14), 11);
    assert.strictEqual(
      scaleRepetitions(10, 4),
      10 + FITNESS_PERSONALIZATION_CONFIG.maxAbsRepAdjustment,
    );
    assert.strictEqual(
      scaleRepetitions(10, 0.01),
      10 - FITNESS_PERSONALIZATION_CONFIG.maxAbsRepAdjustment,
    );
  });

  test('timed training duration rounds to nearest second and stays bounded', () => {
    const prescribed = personalize(moderate, estimateAt(8, 0.85), 'MODERATE');
    const plank = stepById(prescribed, 'ex_plank');
    assert.strictEqual(plank.prescription.kind, 'duration');
    if (plank.prescription.kind === 'duration') {
      assert.ok(Number.isInteger(plank.prescription.durationSeconds));
      assert.ok(plank.prescription.durationSeconds > 20);
      assert.ok(plank.prescription.durationSeconds <= 20 + FITNESS_PERSONALIZATION_CONFIG.maxAbsDurationAdjustment);
    }
    assert.strictEqual(scaleDurationSeconds(20, 1), 20);
    assert.strictEqual(
      scaleDurationSeconds(20, 5),
      20 + FITNESS_PERSONALIZATION_CONFIG.maxAbsDurationAdjustment,
    );
  });

  test('invalid configuration is rejected', () => {
    const bad = {
      ...FITNESS_PERSONALIZATION_CONFIG,
      minMultiplier: 1.5,
      maxMultiplier: 1.1,
    };
    assert.ok(validatePersonalizationConfig(bad).length > 0);
    const result = personalizeWorkout(moderate, {
      playerId: 'player_1',
      fitnessEstimate: estimateAt(5, 0.5),
      desiredDifficulty: 'MODERATE',
      configuration: bad,
    });
    assert.strictEqual(errCode(result), 'personalization.invalid_configuration');
  });

  console.log('Phase 17E — determinism, immutability, compounding, serialization');

  test('identical inputs produce identical personalized prescriptions', () => {
    const estimate = estimateAt(6.2, 0.66);
    const a = personalize(moderate, estimate, 'HARD');
    const b = personalize(moderate, estimate, 'HARD');
    assert.deepStrictEqual(a, b);
  });

  test('personalization does not mutate the catalog, definition, or FitnessEstimate', () => {
    const definition = getWorkoutDefinition('wk_hard_full_body_basics')!;
    const beforeDefinition = cloneWorkoutDefinition(definition);
    const beforeCatalog = getWorkoutDefinition('wk_hard_full_body_basics')!;
    const estimate = estimateAt(8.4, 0.88);
    const beforeEstimate = cloneFitnessEstimate(estimate);
    const prescribed = personalize(definition, estimate, 'HARD');
    assert.deepStrictEqual(definition, beforeDefinition);
    assert.deepStrictEqual(estimate, beforeEstimate);
    const push = prescribed.exercises.find((step) => step.exerciseId === 'ex_push_ups')!;
    if (push.prescription.kind === 'repetitions') push.prescription.repetitions = 999;
    assert.deepStrictEqual(getWorkoutDefinition('wk_hard_full_body_basics'), beforeCatalog);
  });

  test('personalizing the same definition twice does not compound adjustments', () => {
    const estimate = estimateAt(8, 0.85);
    const first = personalize(moderate, estimate, 'MODERATE');
    const second = personalize(moderate, estimate, 'MODERATE');
    assert.deepStrictEqual(first, second);
    const again = must(personalizeWorkout(cloneWorkoutDefinition(moderate), {
      playerId: 'player_1',
      fitnessEstimate: estimate,
      desiredDifficulty: 'MODERATE',
    }), 'again');
    assert.deepStrictEqual(again.exercises, first.exercises);
  });

  test('passing an already personalized prescription into session creation does not scale twice', () => {
    const estimate = estimateAt(8, 0.85);
    const prescribed = personalize(moderate, estimate, 'MODERATE');
    const session = must(createWorkoutSession({
      playerId: 'player_1',
      workout: moderate,
      intendedDifficulty: 'MODERATE',
      purpose: 'NORMAL_TROOPS',
      prescribedWorkout: prescribed,
      fitnessEstimate: estimate,
      now: 1_000,
      sessionId: 'wses_no_compound',
    }), 'session');
    const sessionPush = session.prescribedWorkout.exercises.find((step) => step.exerciseId === 'ex_push_ups')!;
    const prescribedPush = stepById(prescribed, 'ex_push_ups');
    assert.deepStrictEqual(sessionPush.prescription, prescribedPush.prescription);
  });

  test('personalized prescription survives JSON round-trip', () => {
    const prescribed = personalize(moderate, estimateAt(7.1, 0.73), 'HARD');
    const roundTrip = JSON.parse(JSON.stringify(prescribed)) as PrescribedWorkout;
    assert.deepStrictEqual(roundTrip, prescribed);
    const cloned = clonePrescribedWorkout(roundTrip);
    cloned.personalization!.effectiveMultiplier = 9;
    assert.notStrictEqual(prescribed.personalization!.effectiveMultiplier, 9);
  });

  console.log('Phase 17E — validation and session integration');

  test('invalid player, difficulty, estimate, workout, and mismatch are rejected', () => {
    const estimate = estimateAt(5, 0.4);
    assert.strictEqual(errCode(personalizeWorkout(moderate, {
      playerId: '',
      fitnessEstimate: estimate,
      desiredDifficulty: 'MODERATE',
    })), 'personalization.invalid_player');
    assert.strictEqual(errCode(personalizeWorkout(moderate, {
      playerId: 'player_1',
      fitnessEstimate: estimate,
      desiredDifficulty: 'INSANE' as WorkoutDifficulty,
    })), 'personalization.invalid_difficulty');
    assert.strictEqual(errCode(personalizeWorkout(moderate, {
      playerId: 'player_1',
      fitnessEstimate: { ...estimate, level: -1 },
      desiredDifficulty: 'MODERATE',
    })), 'personalization.invalid_estimate');
    assert.strictEqual(errCode(personalizeWorkout(moderate, {
      playerId: 'someone_else',
      fitnessEstimate: estimate,
      desiredDifficulty: 'MODERATE',
    })), 'personalization.player_mismatch');
    const empty: WorkoutDefinition = {
      ...moderate,
      exercises: [],
    };
    assert.strictEqual(errCode(personalizeWorkout(empty, {
      playerId: 'player_1',
      fitnessEstimate: estimate,
      desiredDifficulty: 'MODERATE',
    })), 'personalization.invalid_workout');
  });

  test('session creation with a FitnessEstimate uses the personalized prescription', () => {
    const estimate = estimateAt(8, 0.85);
    const prescribed = personalize(moderate, estimate, 'MODERATE');
    const personalizedSession = must(createWorkoutSession({
      playerId: 'player_1',
      workoutId: 'wk_moderate_full_body',
      intendedDifficulty: 'MODERATE',
      purpose: 'NORMAL_TROOPS',
      fitnessEstimate: estimate,
      now: 2_000,
      sessionId: 'wses_personalized',
    }), 'personalized session');
    const baselineSession = must(createWorkoutSession({
      playerId: 'player_1',
      workoutId: 'wk_moderate_full_body',
      intendedDifficulty: 'MODERATE',
      purpose: 'NORMAL_TROOPS',
      now: 2_000,
      sessionId: 'wses_baseline',
    }), 'baseline session');
    const personalizedPush = personalizedSession.prescribedWorkout.exercises.find((s) => s.exerciseId === 'ex_push_ups')!;
    const baselinePush = baselineSession.prescribedWorkout.exercises.find((s) => s.exerciseId === 'ex_push_ups')!;
    assert.deepStrictEqual(personalizedPush.prescription, stepById(prescribed, 'ex_push_ups').prescription);
    assert.notDeepStrictEqual(personalizedPush.prescription, baselinePush.prescription);
    assert.strictEqual(personalizedSession.intendedDifficulty, 'MODERATE');
  });

  test('canonical GameState still has no fitness estimate or personalized workout fields', () => {
    const state = createGameState({ seed: 17 });
    assert.ok(!('fitness' in state));
    assert.ok(!('fitnessEstimate' in state));
    assert.ok(!('personalizedWorkouts' in state));
    assert.ok(!('workoutSessions' in state));
  });
}
