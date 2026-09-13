import assert from 'assert';
import {
  AdjustableClock,
  FITNESS_MODEL_VERSION,
  PHYSICAL_OUTPUT_VERSION,
  PHYSICAL_RESULT_CONFIG,
  PHYSICAL_RESULT_MODEL_VERSION,
  abandonWorkoutSession,
  beginWorkoutSession,
  calculatePhysicalResult,
  cloneFitnessEvidence,
  clonePhysicalResult,
  completeExercise,
  contributeExercise,
  createWorkoutSession,
  difficultyFactor,
  evaluateFitnessEvidence,
  finalizeCompletedWorkout,
  getCurrentExercise,
  getWorkoutDefinition,
  personalizeWorkout,
  skipExercise,
  submitWorkoutFeedback,
} from '../src/fitness';
import type {
  CompletedWorkoutRecord,
  EvaluationOpResult,
  FitnessEvidence,
  FitnessEstimate,
  PhysicalResult,
  PhysicalResultOpResult,
  SessionOpResult,
  WorkoutDefinition,
  WorkoutDifficulty,
  WorkoutFeedbackValue,
  WorkoutPurpose,
  WorkoutSession,
} from '../src/fitness';
import { createGameState } from '../src/state';

export interface FitnessPhysicalResultTestApi {
  test: (name: string, fn: () => void) => void;
}

function must<T>(
  result: SessionOpResult<T> | EvaluationOpResult<T> | PhysicalResultOpResult<T>,
  label: string,
): T {
  if (!result.ok) {
    throw new Error(`${label}: ${result.error.code} ${(result.error as { message: string }).message}`);
  }
  return result.value;
}

function errCode(result: PhysicalResultOpResult<unknown>): string {
  assert.strictEqual(result.ok, false, 'expected physical result error');
  return result.error.code;
}

function tinyWorkout(options: {
  id?: string;
  difficulty?: WorkoutDifficulty;
  pushReps?: number;
  squatReps?: number;
  plankSeconds?: number;
}): WorkoutDefinition {
  return {
    id: options.id ?? 'wk_physical_tiny',
    name: 'Physical Tiny',
    description: 'Fixture for PhysicalResult',
    intendedDifficulty: options.difficulty ?? 'MODERATE',
    exercises: [
      { exerciseId: 'ex_push_ups', order: 0, prescription: { kind: 'repetitions', repetitions: options.pushReps ?? 10 }, role: 'UPPER_BODY', skippable: false },
      { exerciseId: 'ex_rest', order: 1, prescription: { kind: 'duration', durationSeconds: 15 }, role: 'REST', skippable: true },
      { exerciseId: 'ex_plank', order: 2, prescription: { kind: 'duration', durationSeconds: options.plankSeconds ?? 20 }, role: 'CORE', skippable: false },
      { exerciseId: 'ex_squats', order: 3, prescription: { kind: 'repetitions', repetitions: options.squatReps ?? 8 }, role: 'LOWER_BODY', skippable: false },
      { exerciseId: 'ex_child_pose', order: 4, prescription: { kind: 'duration', durationSeconds: 10 }, role: 'FINAL_STRETCH', skippable: false },
    ],
    metadata: {},
  };
}

function estimateAt(level: number, confidence: number, playerId = 'player_1'): FitnessEstimate {
  return {
    modelVersion: FITNESS_MODEL_VERSION,
    playerId,
    level,
    confidence,
    bodySectionLevels: { GLOBAL: level, UPPER_BODY: level, CORE: level, LOWER_BODY: level },
    initializedAt: 1_000,
    lastUpdatedAt: 1_000,
    observationCount: 3,
  };
}

function completeAll(
  session: WorkoutSession,
  clock: AdjustableClock,
  options: { skipRest?: boolean; extraPauseMs?: number } = {},
): WorkoutSession {
  let current = session;
  while (current.state === 'ACTIVE') {
    const step = getCurrentExercise(current);
    assert.ok(step, 'expected a current exercise');
    if (options.extraPauseMs && step.order === 0) {
      clock.advance(options.extraPauseMs);
    } else {
      clock.advance(1_000);
    }
    if (options.skipRest && step.skippable && step.exerciseType === 'REST') {
      current = must(skipExercise(current, step.order, clock.now()), `skip ${step.order}`);
      continue;
    }
    if (step.prescription.kind === 'repetitions') {
      current = must(completeExercise(current, {
        order: step.order,
        repetitions: step.prescription.repetitions,
      }, clock.now()), `reps ${step.order}`);
    } else {
      current = must(completeExercise(current, {
        order: step.order,
        durationSeconds: step.prescription.durationSeconds,
      }, clock.now()), `timed ${step.order}`);
    }
  }
  return current;
}

function runWorkout(options: {
  sessionId: string;
  workout?: WorkoutDefinition;
  workoutId?: string;
  difficulty?: WorkoutDifficulty;
  purpose?: WorkoutPurpose;
  feedback?: WorkoutFeedbackValue;
  skipRest?: boolean;
  extraPauseMs?: number;
  fitnessEstimate?: FitnessEstimate;
  clock?: AdjustableClock;
}): { record: CompletedWorkoutRecord; evidence: FitnessEvidence; session: WorkoutSession } {
  const clock = options.clock ?? new AdjustableClock(1_000);
  const workout = options.workout ?? (options.workoutId ? undefined : tinyWorkout({}));
  const difficulty = options.difficulty ?? workout?.intendedDifficulty ?? 'MODERATE';
  let session = must(beginWorkoutSession({
    playerId: 'player_1',
    workout,
    workoutId: options.workoutId,
    intendedDifficulty: difficulty,
    purpose: options.purpose ?? 'NORMAL_TROOPS',
    fitnessEstimate: options.fitnessEstimate,
    sessionId: options.sessionId,
    now: clock.now(),
  }), 'begin');
  session = completeAll(session, clock, {
    skipRest: options.skipRest,
    extraPauseMs: options.extraPauseMs,
  });
  session = must(submitWorkoutFeedback(session, options.feedback ?? 'ABOUT_RIGHT', clock.now()), 'feedback');
  const record = must(finalizeCompletedWorkout(session), 'finalize');
  const evidence = must(evaluateFitnessEvidence(record), 'evidence');
  return { record, evidence, session };
}

function physicalOf(
  record: CompletedWorkoutRecord,
  evidence: FitnessEvidence,
  context?: Parameters<typeof calculatePhysicalResult>[0]['context'],
): PhysicalResult {
  return must(calculatePhysicalResult({ completedWorkout: record, evidence, context }), 'physical');
}

function contribution(result: PhysicalResult, exerciseId: string) {
  const row = result.exerciseContributions.find((item) => item.exerciseId === exerciseId);
  assert.ok(row, `missing contribution ${exerciseId}`);
  return row;
}

export function registerFitnessPhysicalResultTests(api: FitnessPhysicalResultTestApi): void {
  const { test } = api;

  console.log('Phase 17F — basic completion');

  test('valid completed workout produces a PhysicalResult', () => {
    const { record, evidence } = runWorkout({ sessionId: 'wses_phys_basic' });
    const result = physicalOf(record, evidence, { fitnessEstimate: estimateAt(5, 0.08) });
    assert.strictEqual(result.modelVersion, PHYSICAL_RESULT_MODEL_VERSION);
    assert.strictEqual(result.outputVersion, PHYSICAL_OUTPUT_VERSION);
    assert.strictEqual(result.playerId, 'player_1');
    assert.strictEqual(result.sessionId, 'wses_phys_basic');
    assert.strictEqual(result.purpose, 'NORMAL_TROOPS');
    assert.ok(result.totalPhysicalOutput > 0);
    assert.ok(!('fitnessScore' in result));
    assert.ok(!('physicalScore' in result));
    assert.strictEqual(result.fitnessLevelAtPrescription, 5);
    assert.strictEqual(result.confidenceAtPrescription, 0.08);
  });

  test('identical inputs produce identical PhysicalResults', () => {
    const { record, evidence } = runWorkout({ sessionId: 'wses_phys_det' });
    const estimate = estimateAt(6, 0.4);
    const a = physicalOf(record, evidence, { fitnessEstimate: estimate });
    const b = physicalOf(record, evidence, { fitnessEstimate: estimate });
    assert.deepStrictEqual(a, b);
  });

  test('PhysicalResult is JSON-safe', () => {
    const { record, evidence } = runWorkout({ sessionId: 'wses_phys_json' });
    const result = physicalOf(record, evidence);
    const roundTrip = JSON.parse(JSON.stringify(result)) as PhysicalResult;
    assert.deepStrictEqual(roundTrip, result);
    const cloned = clonePhysicalResult(roundTrip);
    cloned.totalPhysicalOutput = 999;
    assert.notStrictEqual(result.totalPhysicalOutput, 999);
  });

  console.log('Phase 17F — REP_BASED and TIMED');

  test('completed reps produce output and more reps produce more output', () => {
    const fewer = runWorkout({
      sessionId: 'wses_phys_reps_lo',
      workout: tinyWorkout({ id: 'wk_phys_reps_lo', pushReps: 8 }),
    });
    const more = runWorkout({
      sessionId: 'wses_phys_reps_hi',
      workout: tinyWorkout({ id: 'wk_phys_reps_hi', pushReps: 16 }),
    });
    const low = physicalOf(fewer.record, fewer.evidence);
    const high = physicalOf(more.record, more.evidence);
    assert.ok(contribution(low, 'ex_push_ups').physicalOutput > 0);
    assert.strictEqual(contribution(low, 'ex_push_ups').creditedRepetitions, 8);
    assert.strictEqual(contribution(high, 'ex_push_ups').creditedRepetitions, 16);
    assert.ok(contribution(high, 'ex_push_ups').physicalOutput > contribution(low, 'ex_push_ups').physicalOutput);
    assert.ok(high.totalPhysicalOutput > low.totalPhysicalOutput);
  });

  test('prescription snapshot values are credited, not a hidden catalog default', () => {
    const { record, evidence, session } = runWorkout({
      sessionId: 'wses_phys_snapshot',
      workout: tinyWorkout({ pushReps: 14 }),
    });
    const result = physicalOf(record, evidence);
    const push = session.prescribedWorkout.exercises.find((step) => step.exerciseId === 'ex_push_ups')!;
    assert.ok(push.prescription.kind === 'repetitions' && push.prescription.repetitions === 14);
    assert.strictEqual(contribution(result, 'ex_push_ups').prescribedRepetitions, 14);
    assert.strictEqual(contribution(result, 'ex_push_ups').creditedRepetitions, 14);
  });

  test('completed timed duration produces output and longer duration produces more', () => {
    const short = runWorkout({
      sessionId: 'wses_phys_time_lo',
      workout: tinyWorkout({ id: 'wk_phys_time_lo', plankSeconds: 12 }),
    });
    const long = runWorkout({
      sessionId: 'wses_phys_time_hi',
      workout: tinyWorkout({ id: 'wk_phys_time_hi', plankSeconds: 40 }),
    });
    const a = physicalOf(short.record, short.evidence);
    const b = physicalOf(long.record, long.evidence);
    assert.ok(contribution(a, 'ex_plank').physicalOutput > 0);
    assert.ok(contribution(b, 'ex_plank').physicalOutput > contribution(a, 'ex_plank').physicalOutput);
    assert.notStrictEqual(
      contribution(a, 'ex_plank').physicalOutput,
      contribution(a, 'ex_plank').creditedDurationSeconds,
    );
  });

  console.log('Phase 17F — REST and stretching');

  test('completed REST and skipped REST both produce zero physical output', () => {
    const completed = runWorkout({ sessionId: 'wses_phys_rest_done' });
    const skipped = runWorkout({ sessionId: 'wses_phys_rest_skip', skipRest: true });
    const done = physicalOf(completed.record, completed.evidence);
    const skip = physicalOf(skipped.record, skipped.evidence);
    assert.strictEqual(contribution(done, 'ex_rest').physicalOutput, 0);
    assert.strictEqual(contribution(skip, 'ex_rest').physicalOutput, 0);
    assert.strictEqual(contribution(skip, 'ex_rest').workClass, 'REST');
    assert.strictEqual(done.totalPhysicalOutput, skip.totalPhysicalOutput);
  });

  test('opening/final stretches produce zero output and cannot dominate training work', () => {
    const { record, evidence } = runWorkout({ sessionId: 'wses_phys_stretch' });
    const result = physicalOf(record, evidence);
    assert.strictEqual(contribution(result, 'ex_child_pose').physicalOutput, 0);
    assert.strictEqual(contribution(result, 'ex_child_pose').workClass, 'STRETCH');
    const training = result.exerciseContributions
      .filter((row) => row.workClass === 'TRAINING')
      .reduce((sum, row) => sum + row.physicalOutput, 0);
    const stretch = result.exerciseContributions
      .filter((row) => row.workClass === 'STRETCH')
      .reduce((sum, row) => sum + row.physicalOutput, 0);
    assert.ok(training > 0);
    assert.strictEqual(stretch, 0);
    assert.ok(training > stretch);
  });

  console.log('Phase 17F — difficulty, personalization, and non-multipliers');

  test('named difficulty modestly orders output for the same completed proportions', () => {
    const outputs: number[] = [];
    for (const difficulty of ['VERY_EASY', 'EASY', 'MODERATE', 'HARD', 'VERY_HARD'] as const) {
      const run = runWorkout({
        sessionId: `wses_phys_${difficulty}`,
        workout: tinyWorkout({ id: `wk_phys_${difficulty}`, difficulty }),
        difficulty,
      });
      outputs.push(physicalOf(run.record, run.evidence).totalPhysicalOutput);
    }
    for (let i = 1; i < outputs.length; i++) {
      assert.ok(outputs[i]! > outputs[i - 1]!, 'difficulty should increase output modestly');
    }
    assert.ok(outputs[4]! / outputs[0]! < 1.3);
    assert.ok(difficultyFactor('VERY_HARD') <= PHYSICAL_RESULT_CONFIG.difficultyFactorMax);
  });

  test('different personalized prescriptions yield different PhysicalResults from actual completed work', () => {
    const lowEst = estimateAt(2.5, 0.85);
    const highEst = estimateAt(8.5, 0.85);
    const workout = getWorkoutDefinition('wk_moderate_full_body')!;
    const lowRx = must(personalizeWorkout(workout, {
      playerId: 'player_1',
      fitnessEstimate: lowEst,
      desiredDifficulty: 'MODERATE',
    }), 'low rx');
    const highRx = must(personalizeWorkout(workout, {
      playerId: 'player_1',
      fitnessEstimate: highEst,
      desiredDifficulty: 'MODERATE',
    }), 'high rx');
    const low = runWorkout({
      sessionId: 'wses_phys_pers_lo',
      workout,
      fitnessEstimate: lowEst,
    });
    const high = runWorkout({
      sessionId: 'wses_phys_pers_hi',
      workout,
      fitnessEstimate: highEst,
    });
    const lowResult = physicalOf(low.record, low.evidence, { fitnessEstimate: lowEst, personalization: lowRx.personalization });
    const highResult = physicalOf(high.record, high.evidence, { fitnessEstimate: highEst, personalization: highRx.personalization });
    assert.ok(highResult.totalPhysicalOutput > lowResult.totalPhysicalOutput);
    assert.ok(contribution(highResult, 'ex_push_ups').creditedRepetitions! >= contribution(lowResult, 'ex_push_ups').creditedRepetitions!);
  });

  test('Fitness Level metadata alone does not change PhysicalResult output', () => {
    const { record, evidence } = runWorkout({ sessionId: 'wses_phys_level' });
    const low = physicalOf(record, evidence, { fitnessEstimate: estimateAt(2, 0.9) });
    const high = physicalOf(record, evidence, { fitnessEstimate: estimateAt(9, 0.9) });
    assert.strictEqual(low.totalPhysicalOutput, high.totalPhysicalOutput);
    assert.deepStrictEqual(
      low.exerciseContributions.map((row) => row.physicalOutput),
      high.exerciseContributions.map((row) => row.physicalOutput),
    );
    assert.strictEqual(low.fitnessLevelAtPrescription, 2);
    assert.strictEqual(high.fitnessLevelAtPrescription, 9);
  });

  test('Confidence metadata alone does not change PhysicalResult output', () => {
    const { record, evidence } = runWorkout({ sessionId: 'wses_phys_conf' });
    const a = physicalOf(record, evidence, { fitnessEstimate: estimateAt(7, 0.1) });
    const b = physicalOf(record, evidence, { fitnessEstimate: estimateAt(7, 0.95) });
    assert.strictEqual(a.totalPhysicalOutput, b.totalPhysicalOutput);
    assert.strictEqual(a.confidenceAtPrescription, 0.1);
    assert.strictEqual(b.confidenceAtPrescription, 0.95);
  });

  test('feedback alone does not change PhysicalResult', () => {
    const easy = runWorkout({ sessionId: 'wses_phys_fb_easy', feedback: 'TOO_EASY' });
    const hard = runWorkout({ sessionId: 'wses_phys_fb_hard', feedback: 'TOO_HARD' });
    assert.strictEqual(
      physicalOf(easy.record, easy.evidence).totalPhysicalOutput,
      physicalOf(hard.record, hard.evidence).totalPhysicalOutput,
    );
  });

  test('rep speed alone does not change PhysicalResult', () => {
    const slow = runWorkout({ sessionId: 'wses_phys_slow', extraPauseMs: 2_000 });
    const fast = runWorkout({ sessionId: 'wses_phys_fast', extraPauseMs: 20_000 });
    assert.strictEqual(
      physicalOf(slow.record, slow.evidence).totalPhysicalOutput,
      physicalOf(fast.record, fast.evidence).totalPhysicalOutput,
    );
  });

  test('frequency/history is not a PhysicalResult bonus', () => {
    const first = runWorkout({ sessionId: 'wses_phys_freq_a' });
    const second = runWorkout({ sessionId: 'wses_phys_freq_b' });
    const a = physicalOf(first.record, first.evidence);
    const b = physicalOf(second.record, second.evidence);
    assert.strictEqual(a.totalPhysicalOutput, b.totalPhysicalOutput);
    assert.ok(!('frequencyBonus' in a));
    assert.ok(!a.notes.some((note) => note.includes('frequency') && note.includes('bonus')));
  });

  test('purpose is metadata and does not change physical output', () => {
    const outputs: number[] = [];
    for (const purpose of ['NORMAL_TROOPS', 'GOLDEN_YIELD', 'DEFENSE', 'EXTRA_CONSTRUCTION_WORKERS'] as const) {
      const run = runWorkout({
        sessionId: `wses_phys_${purpose}`,
        purpose,
      });
      const result = physicalOf(run.record, run.evidence);
      assert.strictEqual(result.purpose, purpose);
      outputs.push(result.totalPhysicalOutput);
    }
    assert.ok(outputs.every((value) => value === outputs[0]));
  });

  console.log('Phase 17F — body sections, eligibility, immutability');

  test('body-section output is preserved and sums to the global total', () => {
    const { record, evidence } = runWorkout({ sessionId: 'wses_phys_sections' });
    const result = physicalOf(record, evidence);
    assert.ok(result.bodySectionOutput.UPPER_BODY > 0);
    assert.ok(result.bodySectionOutput.CORE > 0);
    assert.ok(result.bodySectionOutput.LOWER_BODY > 0);
    assert.strictEqual(result.bodySectionOutput.GLOBAL, 0);
    const summed = result.bodySectionOutput.UPPER_BODY
      + result.bodySectionOutput.CORE
      + result.bodySectionOutput.LOWER_BODY
      + result.bodySectionOutput.GLOBAL;
    assert.ok(Math.abs(summed - result.totalPhysicalOutput) < 0.002);
    assert.ok(result.exerciseContributions.every((row) => row.physicalOutput >= 0));
  });

  test('abandoned, incomplete, missing feedback, malformed, and impossible records are rejected', () => {
    const clock = new AdjustableClock(3_000);
    const abandoned = must(abandonWorkoutSession(must(beginWorkoutSession({
      playerId: 'player_1',
      workout: tinyWorkout({}),
      intendedDifficulty: 'MODERATE',
      purpose: 'NORMAL_TROOPS',
      sessionId: 'wses_phys_ab',
      now: clock.now(),
    }), 'begin ab'), clock.now()), 'abandon');
    const dummy = runWorkout({ sessionId: 'wses_phys_dummy' });
    const abandonedRecord = {
      ...dummy.record,
      sessionId: abandoned.sessionId,
      eligibleForFitnessEvaluation: false,
      summary: { ...dummy.record.summary, state: 'ABANDONED' as const, abandonedAt: clock.now() },
    };
    assert.strictEqual(errCode(calculatePhysicalResult({
      completedWorkout: abandonedRecord,
      evidence: dummy.evidence,
    })), 'physicalResult.not_eligible');

    const unfinished = must(beginWorkoutSession({
      playerId: 'player_1',
      workout: tinyWorkout({}),
      intendedDifficulty: 'MODERATE',
      purpose: 'NORMAL_TROOPS',
      sessionId: 'wses_phys_open',
      now: clock.now(),
    }), 'unfinished');
    assert.strictEqual(finalizeCompletedWorkout(unfinished).ok, false);

    const noFeedbackSession = completeAll(must(beginWorkoutSession({
      playerId: 'player_1',
      workout: tinyWorkout({}),
      intendedDifficulty: 'MODERATE',
      purpose: 'NORMAL_TROOPS',
      sessionId: 'wses_phys_nofb',
      now: clock.now(),
    }), 'nofb'), clock);
    const noFeedback = must(finalizeCompletedWorkout(noFeedbackSession), 'finalize nofb');
    assert.strictEqual(noFeedback.eligibleForFitnessEvaluation, false);
    assert.strictEqual(errCode(calculatePhysicalResult({
      completedWorkout: noFeedback,
      evidence: dummy.evidence,
    })), 'physicalResult.not_eligible');

    assert.strictEqual(errCode(calculatePhysicalResult({
      completedWorkout: { ...dummy.record, playerId: '' },
      evidence: dummy.evidence,
    })), 'physicalResult.malformed_record');

    const negative = JSON.parse(JSON.stringify(dummy.record)) as CompletedWorkoutRecord;
    negative.summary.exercises[0]!.actual = { kind: 'repetitions', completedRepetitions: -4 };
    assert.strictEqual(errCode(calculatePhysicalResult({
      completedWorkout: negative,
      evidence: dummy.evidence,
    })), 'physicalResult.malformed_record');

    assert.strictEqual(errCode(calculatePhysicalResult({
      completedWorkout: dummy.record,
      evidence: { ...dummy.evidence, sessionId: 'other' },
    })), 'physicalResult.evidence_mismatch');
  });

  test('calculation does not mutate record, evidence, or estimate', () => {
    const { record, evidence } = runWorkout({ sessionId: 'wses_phys_immut' });
    const estimate = estimateAt(8, 0.7);
    const beforeRecord = JSON.parse(JSON.stringify(record));
    const beforeEvidence = cloneFitnessEvidence(evidence);
    const beforeEstimate = { ...estimate, bodySectionLevels: { ...estimate.bodySectionLevels } };
    physicalOf(record, evidence, { fitnessEstimate: estimate });
    assert.deepStrictEqual(record, beforeRecord);
    assert.deepStrictEqual(evidence, beforeEvidence);
    assert.deepStrictEqual(estimate, beforeEstimate);
  });

  test('versions are explicit and output stays non-negative', () => {
    const { record, evidence } = runWorkout({ sessionId: 'wses_phys_ver' });
    const result = physicalOf(record, evidence);
    assert.strictEqual(result.modelVersion, 'physical-result.v1');
    assert.strictEqual(result.outputVersion, 'physical-output.v1');
    assert.ok(result.totalPhysicalOutput >= 0);
    const push = {
      order: 0,
      exerciseId: 'ex_push_ups',
      exerciseType: 'REP_BASED' as const,
      bodySection: 'UPPER_BODY' as const,
      isRest: false,
      status: 'COMPLETED' as const,
      prescribed: { kind: 'repetitions' as const, repetitions: 10 },
      actual: { kind: 'repetitions' as const, completedRepetitions: 10 },
      startedAt: 1,
      completedAt: 2,
      activeDurationMs: 1000,
    };
    const row = contributeExercise(push, 1);
    assert.strictEqual(row.physicalOutput, 10 * PHYSICAL_RESULT_CONFIG.repWorkUnit);
  });

  test('canonical GameState still has no PhysicalResult or reward conversion fields', () => {
    const state = createGameState({ seed: 17 });
    assert.ok(!('physicalResult' in state));
    assert.ok(!('physicalResults' in state));
    assert.ok(!('fitness' in state));
    assert.ok(!('troopsFromWorkouts' in state));
  });
}
