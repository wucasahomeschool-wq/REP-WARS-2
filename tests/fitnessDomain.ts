import assert from 'assert';
import {
  BODY_SECTIONS,
  EXERCISE_TYPES,
  WORKOUT_DIFFICULTIES,
  WORKOUT_PURPOSE_AWARDS_REWARDS,
  WORKOUT_PURPOSES,
  cloneWorkoutDefinition,
  exerciseCatalogById,
  expectedPrescriptionKind,
  getExerciseDefinition,
  getWorkoutDefinition,
  isBodySection,
  isExerciseType,
  isWorkoutPurpose,
  listExerciseDefinitions,
  listWorkoutDefinitions,
  parseWorkoutDifficulty,
  prescribeWorkoutBaseline,
  skippableForExerciseType,
  validateExerciseCatalog,
  validateExerciseDefinition,
  validateWorkoutCatalog,
  validateWorkoutDefinition,
  workoutDifficultyRank,
} from '../src/fitness';
import type {
  ExerciseDefinition,
  ExerciseId,
  WorkoutDefinition,
  WorkoutExercise,
} from '../src/fitness';
import { createGameState } from '../src/state';

export interface FitnessDomainTestApi {
  test: (name: string, fn: () => void) => void;
}

function codes(issues: { code: string }[]): string[] {
  return issues.map((issue) => issue.code);
}

function repExercise(overrides: Partial<ExerciseDefinition> = {}): ExerciseDefinition {
  return {
    id: 'ex_test_push_ups',
    name: 'Push-ups',
    type: 'REP_BASED',
    bodySection: 'UPPER_BODY',
    defaultPrescription: { kind: 'repetitions', repetitions: 10 },
    isRest: false,
    metadata: {},
    ...overrides,
  };
}

function timedExercise(overrides: Partial<ExerciseDefinition> = {}): ExerciseDefinition {
  return {
    id: 'ex_test_plank',
    name: 'Plank',
    type: 'TIMED',
    bodySection: 'CORE',
    defaultPrescription: { kind: 'duration', durationSeconds: 20 },
    isRest: false,
    metadata: {},
    ...overrides,
  };
}

function restExercise(overrides: Partial<ExerciseDefinition> = {}): ExerciseDefinition {
  return {
    id: 'ex_test_rest',
    name: 'Rest',
    type: 'REST',
    bodySection: 'GLOBAL',
    defaultPrescription: { kind: 'duration', durationSeconds: 30 },
    isRest: true,
    metadata: {},
    ...overrides,
  };
}

function exerciseMap(exercises: ExerciseDefinition[]): Map<ExerciseId, ExerciseDefinition> {
  return new Map(exercises.map((exercise) => [exercise.id, exercise]));
}

function workoutFromSteps(
  exercises: ExerciseDefinition[],
  steps: WorkoutExercise[],
  overrides: Partial<WorkoutDefinition> = {},
): WorkoutDefinition {
  return {
    id: 'wk_test',
    name: 'Test Workout',
    description: 'Validation fixture',
    intendedDifficulty: 'MODERATE',
    exercises: steps,
    metadata: {},
    ...overrides,
  };
}

function step(
  exercise: ExerciseDefinition,
  order: number,
  extras: Partial<WorkoutExercise> = {},
): WorkoutExercise {
  return {
    exerciseId: exercise.id,
    order,
    prescription: extras.prescription ?? { ...exercise.defaultPrescription },
    role: extras.role ?? (exercise.type === 'REST' ? 'REST' : 'MAIN'),
    skippable: extras.skippable ?? skippableForExerciseType(exercise.type),
  };
}

export function registerFitnessDomainTests(api: FitnessDomainTestApi): void {
  const { test } = api;
  const catalogExercises = exerciseCatalogById();

  console.log('Phase 17A — exercise definitions');

  test('valid rep-based exercise', () => {
    assert.strictEqual(validateExerciseDefinition(repExercise()).length, 0);
  });

  test('valid timed exercise', () => {
    assert.strictEqual(validateExerciseDefinition(timedExercise()).length, 0);
  });

  test('valid rest exercise', () => {
    const rest = restExercise();
    assert.strictEqual(validateExerciseDefinition(rest).length, 0);
    assert.strictEqual(rest.isRest, true);
    assert.strictEqual(rest.type, 'REST');
  });

  test('invalid body section is rejected', () => {
    const issues = validateExerciseDefinition(repExercise({ bodySection: 'ARMS' as ExerciseDefinition['bodySection'] }));
    assert.ok(codes(issues).includes('exercise.invalid_body_section'));
  });

  test('REP_BASED with duration-only prescription is rejected', () => {
    const issues = validateExerciseDefinition(repExercise({
      defaultPrescription: { kind: 'duration', durationSeconds: 20 },
    }));
    assert.ok(codes(issues).includes('exercise.prescription_type_mismatch'));
  });

  test('TIMED with repetitions-only prescription is rejected', () => {
    const issues = validateExerciseDefinition(timedExercise({
      defaultPrescription: { kind: 'repetitions', repetitions: 10 },
    }));
    assert.ok(codes(issues).includes('exercise.prescription_type_mismatch'));
  });

  test('REST with repetitions is rejected', () => {
    const issues = validateExerciseDefinition(restExercise({
      defaultPrescription: { kind: 'repetitions', repetitions: 10 },
    }));
    assert.ok(codes(issues).includes('exercise.prescription_type_mismatch'));
  });

  test('isRest must match REST type', () => {
    const asRest = validateExerciseDefinition(repExercise({ isRest: true }));
    assert.ok(codes(asRest).includes('exercise.is_rest_mismatch'));
    const notRest = validateExerciseDefinition(restExercise({ isRest: false }));
    assert.ok(codes(notRest).includes('exercise.is_rest_mismatch'));
  });

  test('supported exercise types and body sections are strongly typed', () => {
    assert.deepStrictEqual([...EXERCISE_TYPES], ['REP_BASED', 'TIMED', 'REST']);
    assert.ok(BODY_SECTIONS.includes('UPPER_BODY'));
    assert.ok(BODY_SECTIONS.includes('CORE'));
    assert.ok(BODY_SECTIONS.includes('LOWER_BODY'));
    assert.ok(BODY_SECTIONS.includes('GLOBAL'));
    assert.ok(isExerciseType('REP_BASED'));
    assert.ok(isBodySection('GLOBAL'));
    assert.strictEqual(isExerciseType('CARDIO'), false);
    assert.strictEqual(isBodySection('ARMS'), false);
  });

  console.log('Phase 17A — workout definitions');

  test('valid mixed workout with repeated exercises', () => {
    const push = repExercise();
    const plank = timedExercise();
    const rest = restExercise();
    const workout = workoutFromSteps([push, plank, rest], [
      step(push, 0, { role: 'UPPER_BODY' }),
      step(rest, 1),
      step(push, 2, { role: 'UPPER_BODY' }),
      step(plank, 3, { role: 'CORE' }),
    ]);
    assert.strictEqual(validateWorkoutDefinition(workout, exerciseMap([push, plank, rest])).length, 0);
    assert.strictEqual(workout.exercises.filter((s) => s.exerciseId === push.id).length, 2);
  });

  test('empty workout is rejected', () => {
    const issues = validateWorkoutDefinition(workoutFromSteps([], []), exerciseMap([]));
    assert.ok(codes(issues).includes('workout.empty'));
  });

  test('ordered exercises must be dense from zero', () => {
    const push = repExercise();
    const gapped = workoutFromSteps([push], [
      step(push, 0),
      step(push, 2),
    ]);
    assert.ok(codes(validateWorkoutDefinition(gapped, exerciseMap([push]))).includes('workout.order_not_dense'));

    const duplicated = workoutFromSteps([push], [
      step(push, 0),
      { ...step(push, 0), order: 0 },
    ]);
    assert.ok(codes(validateWorkoutDefinition(duplicated, exerciseMap([push]))).includes('workout.duplicate_order'));
  });

  test('unknown exercise references are rejected', () => {
    const push = repExercise();
    const workout = workoutFromSteps([push], [step(push, 0)]);
    workout.exercises[0]!.exerciseId = 'ex_missing';
    const issues = validateWorkoutDefinition(workout, exerciseMap([push]));
    assert.ok(codes(issues).includes('workout.unknown_exercise'));
  });

  test('workout may mix body sections and exercise types', () => {
    const push = repExercise();
    const squat = repExercise({ id: 'ex_test_squats', name: 'Squats', bodySection: 'LOWER_BODY' });
    const plank = timedExercise();
    const rest = restExercise();
    const workout = workoutFromSteps([push, squat, plank, rest], [
      step(push, 0, { role: 'UPPER_BODY' }),
      step(rest, 1),
      step(squat, 2, { role: 'LOWER_BODY' }),
      step(plank, 3, { role: 'CORE' }),
    ]);
    assert.strictEqual(validateWorkoutDefinition(workout, exerciseMap([push, squat, plank, rest])).length, 0);
    const sections = new Set(
      workout.exercises.map((s) => exerciseMap([push, squat, plank, rest]).get(s.exerciseId)!.bodySection),
    );
    assert.ok(sections.has('UPPER_BODY') && sections.has('LOWER_BODY') && sections.has('CORE') && sections.has('GLOBAL'));
  });

  test('non-empty name and valid difficulty are required', () => {
    const push = repExercise();
    const unnamed = workoutFromSteps([push], [step(push, 0)], { name: '   ' });
    assert.ok(codes(validateWorkoutDefinition(unnamed, exerciseMap([push]))).includes('workout.invalid_name'));
    const badDifficulty = workoutFromSteps([push], [step(push, 0)], {
      intendedDifficulty: 'INSANE' as WorkoutDefinition['intendedDifficulty'],
    });
    assert.ok(codes(validateWorkoutDefinition(badDifficulty, exerciseMap([push]))).includes('workout.invalid_difficulty'));
  });

  console.log('Phase 17A — skippable REST only');

  test('REST steps are skippable', () => {
    const rest = restExercise();
    const workout = workoutFromSteps([rest], [step(rest, 0, { skippable: true })]);
    assert.strictEqual(validateWorkoutDefinition(workout, exerciseMap([rest])).length, 0);
    assert.strictEqual(skippableForExerciseType('REST'), true);
  });

  test('mandatory exercises are not skippable', () => {
    assert.strictEqual(skippableForExerciseType('REP_BASED'), false);
    assert.strictEqual(skippableForExerciseType('TIMED'), false);
  });

  test('marking a mandatory exercise skippable is rejected', () => {
    const push = repExercise();
    const workout = workoutFromSteps([push], [step(push, 0, { skippable: true })]);
    const issues = validateWorkoutDefinition(workout, exerciseMap([push]));
    assert.ok(codes(issues).includes('workout.mandatory_marked_skippable'));
  });

  test('REST marked not skippable is rejected', () => {
    const rest = restExercise();
    const workout = workoutFromSteps([rest], [step(rest, 0, { skippable: false })]);
    const issues = validateWorkoutDefinition(workout, exerciseMap([rest]));
    assert.ok(codes(issues).includes('workout.rest_not_skippable'));
  });

  console.log('Phase 17A — difficulty');

  test('all five user-facing difficulties exist', () => {
    assert.deepStrictEqual([...WORKOUT_DIFFICULTIES], ['VERY_EASY', 'EASY', 'MODERATE', 'HARD', 'VERY_HARD']);
  });

  test('difficulty rank mapping is centralized and deterministic', () => {
    const ranks = WORKOUT_DIFFICULTIES.map(workoutDifficultyRank);
    assert.deepStrictEqual(ranks, [1, 2, 3, 4, 5]);
    assert.deepStrictEqual(WORKOUT_DIFFICULTIES.map(workoutDifficultyRank), ranks);
  });

  test('invalid difficulty is rejected', () => {
    assert.strictEqual(parseWorkoutDifficulty('HARD'), 'HARD');
    assert.strictEqual(parseWorkoutDifficulty('hard'), null);
    assert.strictEqual(parseWorkoutDifficulty(4), null);
    assert.strictEqual(parseWorkoutDifficulty('NIGHTMARE'), null);
  });

  console.log('Phase 17A — prescriptions');

  test('repetitions must be a positive integer', () => {
    assert.ok(codes(validateExerciseDefinition(repExercise({
      defaultPrescription: { kind: 'repetitions', repetitions: 0 },
    }))).includes('prescription.invalid_repetitions'));
    assert.ok(codes(validateExerciseDefinition(repExercise({
      defaultPrescription: { kind: 'repetitions', repetitions: -3 },
    }))).includes('prescription.invalid_repetitions'));
    assert.ok(codes(validateExerciseDefinition(repExercise({
      defaultPrescription: { kind: 'repetitions', repetitions: 1.5 },
    }))).includes('prescription.invalid_repetitions'));
  });

  test('duration must be positive', () => {
    assert.ok(codes(validateExerciseDefinition(timedExercise({
      defaultPrescription: { kind: 'duration', durationSeconds: 0 },
    }))).includes('prescription.invalid_duration'));
    assert.ok(codes(validateExerciseDefinition(restExercise({
      defaultPrescription: { kind: 'duration', durationSeconds: -1 },
    }))).includes('prescription.invalid_duration'));
  });

  test('workout step prescription must match exercise type', () => {
    const push = repExercise();
    const rest = restExercise();
    const timed = timedExercise();
    const repWithDuration = workoutFromSteps([push], [{
      ...step(push, 0),
      prescription: { kind: 'duration', durationSeconds: 10 },
    }]);
    assert.ok(codes(validateWorkoutDefinition(repWithDuration, exerciseMap([push]))).includes('workout.prescription_type_mismatch'));

    const restWithReps = workoutFromSteps([rest], [{
      ...step(rest, 0),
      prescription: { kind: 'repetitions', repetitions: 5 },
    }]);
    assert.ok(codes(validateWorkoutDefinition(restWithReps, exerciseMap([rest]))).includes('workout.prescription_type_mismatch'));

    const timedWithReps = workoutFromSteps([timed], [{
      ...step(timed, 0),
      prescription: { kind: 'repetitions', repetitions: 8 },
    }]);
    assert.ok(codes(validateWorkoutDefinition(timedWithReps, exerciseMap([timed]))).includes('workout.prescription_type_mismatch'));
  });

  test('baseline prescription does not mutate the source definition', () => {
    const original = getWorkoutDefinition('wk_hard_full_body_basics')!;
    const before = cloneWorkoutDefinition(original);
    const prescribed = prescribeWorkoutBaseline(original, { playerId: 'player_a' });
    const push = prescribed.exercises.find((s) => s.exerciseId === 'ex_push_ups');
    assert.ok(push && push.prescription.kind === 'repetitions');
    if (push.prescription.kind === 'repetitions') {
      push.prescription.repetitions = 999;
    }
    push.skippable = true;
    assert.deepStrictEqual(original, before);
    assert.deepStrictEqual(getWorkoutDefinition('wk_hard_full_body_basics'), before);
  });

  test('different players receive independent prescription objects', () => {
    const workout = getWorkoutDefinition('wk_easy_core')!;
    const forA = prescribeWorkoutBaseline(workout, { playerId: 'player_a' });
    const forB = prescribeWorkoutBaseline(workout, { playerId: 'player_b' });
    assert.deepStrictEqual(forA, forB);
    assert.notStrictEqual(forA, forB);
    assert.notStrictEqual(forA.exercises, forB.exercises);
    const first = forA.exercises[1]!;
    if (first.prescription.kind === 'repetitions') {
      first.prescription.repetitions = 1;
    }
    assert.notDeepStrictEqual(forA, forB);
  });

  test('baseline prescription is deterministic and keeps intended difficulty', () => {
    const workout = getWorkoutDefinition('wk_hard_full_body_basics')!;
    const a = prescribeWorkoutBaseline(workout);
    const b = prescribeWorkoutBaseline(workout);
    assert.deepStrictEqual(a, b);
    assert.strictEqual(a.intendedDifficulty, 'HARD');
    assert.strictEqual(a.workoutId, workout.id);
    assert.ok(!('purpose' in a));
  });

  test('expected prescription kind is type-specific, not a shared quantity', () => {
    assert.strictEqual(expectedPrescriptionKind('REP_BASED'), 'repetitions');
    assert.strictEqual(expectedPrescriptionKind('TIMED'), 'duration');
    assert.strictEqual(expectedPrescriptionKind('REST'), 'duration');
  });

  console.log('Phase 17A — workout purpose');

  test('all initial purposes are valid session metadata', () => {
    assert.deepStrictEqual(
      [...WORKOUT_PURPOSES],
      ['NORMAL_TROOPS', 'EXTRA_CONSTRUCTION_WORKERS', 'GOLDEN_YIELD', 'DEFENSE'],
    );
    for (const purpose of WORKOUT_PURPOSES) {
      assert.strictEqual(isWorkoutPurpose(purpose), true);
    }
    assert.strictEqual(isWorkoutPurpose('TROOPS'), false);
  });

  test('purpose is not bound to WorkoutDefinition and awards no Troops', () => {
    for (const workout of listWorkoutDefinitions()) {
      assert.ok(!('purpose' in workout));
      assert.ok(!('workoutPurpose' in workout));
    }
    for (const purpose of WORKOUT_PURPOSES) {
      assert.strictEqual(WORKOUT_PURPOSE_AWARDS_REWARDS[purpose], false);
    }
  });

  console.log('Phase 17A — catalog');

  test('every catalog exercise validates', () => {
    const listed = listExerciseDefinitions();
    assert.ok(listed.length >= 8);
    assert.strictEqual(validateExerciseCatalog(listed).length, 0);
  });

  test('every catalog workout validates and references existing exercises', () => {
    const workouts = listWorkoutDefinitions();
    assert.strictEqual(workouts.length, 5);
    assert.strictEqual(validateWorkoutCatalog(workouts, catalogExercises).length, 0);
    for (const workout of workouts) {
      for (const stepEntry of workout.exercises) {
        assert.ok(catalogExercises.has(stepEntry.exerciseId), stepEntry.exerciseId);
      }
    }
  });

  test('catalog IDs are unique', () => {
    const exerciseIds = listExerciseDefinitions().map((e) => e.id);
    assert.strictEqual(exerciseIds.length, new Set(exerciseIds).size);
    const workoutIds = listWorkoutDefinitions().map((w) => w.id);
    assert.strictEqual(workoutIds.length, new Set(workoutIds).size);
  });

  test('catalog demonstrates difficulties, types, REST, repeats, stretches, and body sections', () => {
    const workouts = listWorkoutDefinitions();
    const difficulties = new Set(workouts.map((w) => w.intendedDifficulty));
    assert.deepStrictEqual([...difficulties].sort(), [...WORKOUT_DIFFICULTIES].sort());

    const lengths = workouts.map((w) => w.exercises.length);
    assert.ok(Math.min(...lengths) < Math.max(...lengths));

    const hard = getWorkoutDefinition('wk_hard_full_body_basics')!;
    assert.strictEqual(hard.name, 'Full Body Basics');
    assert.strictEqual(hard.exercises.filter((s) => s.exerciseId === 'ex_push_ups').length, 2);
    assert.ok(hard.exercises.some((s) => s.role === 'OPENING_STRETCH'));
    assert.ok(hard.exercises.some((s) => s.role === 'FINAL_STRETCH'));
    assert.ok(hard.exercises.some((s) => s.role === 'REST' && s.skippable));
    assert.ok(hard.exercises.some((s) => s.prescription.kind === 'repetitions'));
    assert.ok(hard.exercises.some((s) => s.prescription.kind === 'duration' && s.exerciseId !== 'ex_rest'));
    const usedSections = new Set(
      hard.exercises.map((s) => catalogExercises.get(s.exerciseId)!.bodySection),
    );
    assert.ok(usedSections.has('UPPER_BODY'));
    assert.ok(usedSections.has('CORE'));
    assert.ok(usedSections.has('LOWER_BODY'));
  });

  test('duplicate catalog IDs are rejected', () => {
    const push = repExercise();
    assert.ok(codes(validateExerciseCatalog([push, { ...push }])).includes('catalog.duplicate_exercise_id'));
    const workout = workoutFromSteps([push], [step(push, 0)]);
    assert.ok(codes(validateWorkoutCatalog([workout, { ...workout }], exerciseMap([push]))).includes('catalog.duplicate_workout_id'));
  });

  test('returned catalog entries are clones of source data', () => {
    const listed = getExerciseDefinition('ex_push_ups')!;
    if (listed.defaultPrescription.kind === 'repetitions') {
      listed.defaultPrescription.repetitions = 3;
    }
    listed.name = 'mutated';
    const again = getExerciseDefinition('ex_push_ups')!;
    assert.strictEqual(again.name, 'Push-ups');
    assert.deepStrictEqual(again.defaultPrescription, { kind: 'repetitions', repetitions: 10 });
  });

  console.log('Phase 17A — serialization');

  test('exercise and workout definitions survive JSON round-trip', () => {
    const exercise = getExerciseDefinition('ex_plank')!;
    const exerciseRoundTrip = JSON.parse(JSON.stringify(exercise)) as ExerciseDefinition;
    assert.deepStrictEqual(exerciseRoundTrip, exercise);
    assert.strictEqual(validateExerciseDefinition(exerciseRoundTrip).length, 0);

    const workout = getWorkoutDefinition('wk_moderate_full_body')!;
    const workoutRoundTrip = JSON.parse(JSON.stringify(workout)) as WorkoutDefinition;
    assert.deepStrictEqual(workoutRoundTrip, workout);
    assert.strictEqual(validateWorkoutDefinition(workoutRoundTrip, catalogExercises).length, 0);
  });

  test('cloned definitions remain independent after serialization-style copies', () => {
    const workout = getWorkoutDefinition('wk_very_easy_mobility')!;
    const cloned = cloneWorkoutDefinition(workout);
    cloned.name = 'changed';
    cloned.exercises[0]!.skippable = true;
    assert.strictEqual(workout.name, 'Easy Mobility');
    assert.strictEqual(workout.exercises[0]!.skippable, false);
  });

  console.log('Phase 17A — GameState isolation');

  test('canonical GameState is not given fitness or workout history', () => {
    const state = createGameState({ seed: 17 });
    assert.ok(!('fitness' in state));
    assert.ok(!('workoutSessions' in state));
    assert.ok(!('workoutHistory' in state));
    assert.ok(!('exerciseCatalog' in state));
  });
}
