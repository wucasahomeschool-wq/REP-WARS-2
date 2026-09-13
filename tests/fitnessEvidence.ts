import assert from 'assert';
import {
  AdjustableClock,
  FEEDBACK_RELATIVE_OFFSET,
  FITNESS_EVIDENCE_VERSION,
  WORKOUT_FEEDBACK_VALUES,
  abandonWorkoutSession,
  beginWorkoutSession,
  cloneFitnessEvidence,
  completeExercise,
  createWorkoutSession,
  evaluateFitnessEvidence,
  evaluateSessionFitnessEvidence,
  finalizeCompletedWorkout,
  pauseWorkoutSession,
  resumeWorkoutSession,
  skipExercise,
  submitWorkoutFeedback,
} from '../src/fitness';
import type {
  CompletedWorkoutRecord,
  EvaluationOpResult,
  FitnessEvidence,
  SessionOpResult,
  WorkoutDefinition,
  WorkoutDifficulty,
  WorkoutFeedbackValue,
  WorkoutSession,
} from '../src/fitness';
import { createGameState } from '../src/state';

export interface FitnessEvidenceTestApi {
  test: (name: string, fn: () => void) => void;
}

function must<T>(result: SessionOpResult<T> | EvaluationOpResult<T>, label: string): T {
  if (!result.ok) {
    throw new Error(`${label}: ${result.error.code} ${(result.error as { message: string }).message}`);
  }
  return result.value;
}

function errCode(result: EvaluationOpResult<unknown>): string {
  assert.strictEqual(result.ok, false, 'expected evaluation error');
  return result.error.code;
}

function tinyWorkout(intendedDifficulty: WorkoutDifficulty): WorkoutDefinition {
  return {
    id: 'wk_eval_tiny',
    name: 'Evaluation Tiny',
    description: 'Mixed fixture for evidence evaluation',
    intendedDifficulty,
    exercises: [
      { exerciseId: 'ex_push_ups', order: 0, prescription: { kind: 'repetitions', repetitions: 10 }, role: 'UPPER_BODY', skippable: false },
      { exerciseId: 'ex_rest', order: 1, prescription: { kind: 'duration', durationSeconds: 15 }, role: 'REST', skippable: true },
      { exerciseId: 'ex_plank', order: 2, prescription: { kind: 'duration', durationSeconds: 20 }, role: 'CORE', skippable: false },
      { exerciseId: 'ex_squats', order: 3, prescription: { kind: 'repetitions', repetitions: 8 }, role: 'LOWER_BODY', skippable: false },
      { exerciseId: 'ex_child_pose', order: 4, prescription: { kind: 'duration', durationSeconds: 10 }, role: 'FINAL_STRETCH', skippable: false },
    ],
    metadata: {},
  };
}

function beginTiny(
  clock: AdjustableClock,
  intendedDifficulty: WorkoutDifficulty,
  sessionId: string,
): WorkoutSession {
  return must(beginWorkoutSession({
    playerId: 'player_1',
    workout: tinyWorkout(intendedDifficulty),
    intendedDifficulty,
    purpose: 'NORMAL_TROOPS',
    sessionId,
    now: clock.now(),
  }), 'begin tiny');
}

function finishTiny(
  session: WorkoutSession,
  clock: AdjustableClock,
  options: { skipRest?: boolean; pauseDuringFirstReps?: boolean } = {},
): WorkoutSession {
  let current = session;
  if (options.pauseDuringFirstReps) {
    current = must(pauseWorkoutSession(current, clock.now()), 'pause');
    clock.advance(50_000);
    current = must(resumeWorkoutSession(current, clock.now()), 'resume');
  }
  clock.advance(10_000);
  current = must(completeExercise(current, { order: 0, repetitions: 10 }, clock.now()), 'push-ups');
  clock.advance(1_000);
  if (options.skipRest) {
    current = must(skipExercise(current, 1, clock.now()), 'skip rest');
  } else {
    current = must(completeExercise(current, { order: 1, durationSeconds: 15 }, clock.now()), 'rest');
  }
  clock.advance(20_000);
  current = must(completeExercise(current, { order: 2, durationSeconds: 20 }, clock.now()), 'plank');
  clock.advance(8_000);
  current = must(completeExercise(current, { order: 3, repetitions: 8 }, clock.now()), 'squats');
  clock.advance(10_000);
  current = must(completeExercise(current, { order: 4, durationSeconds: 10 }, clock.now()), 'stretch');
  return current;
}

function completedRecord(
  clock: AdjustableClock,
  feedback: WorkoutFeedbackValue,
  options: {
    difficulty?: WorkoutDifficulty;
    skipRest?: boolean;
    pauseDuringFirstReps?: boolean;
    sessionId?: string;
  } = {},
): CompletedWorkoutRecord {
  const difficulty = options.difficulty ?? 'MODERATE';
  let session = beginTiny(clock, difficulty, options.sessionId ?? `wses_${clock.now()}`);
  session = finishTiny(session, clock, options);
  session = must(submitWorkoutFeedback(session, feedback, clock.now()), 'feedback');
  return must(finalizeCompletedWorkout(session), 'finalize');
}

function evaluate(record: CompletedWorkoutRecord, evaluatedAt?: number): FitnessEvidence {
  return must(evaluateFitnessEvidence(record, evaluatedAt === undefined ? {} : { evaluatedAt }), 'evaluate');
}

export function registerFitnessEvidenceTests(api: FitnessEvidenceTestApi): void {
  const { test } = api;

  console.log('Phase 17C — valid evaluation');

  test('completed workout with ABOUT_RIGHT produces structured evidence', () => {
    const record = completedRecord(new AdjustableClock(1_000), 'ABOUT_RIGHT', { sessionId: 'wses_about' });
    const evidence = evaluate(record);
    assert.strictEqual(evidence.evaluationVersion, FITNESS_EVIDENCE_VERSION);
    assert.strictEqual(evidence.playerId, 'player_1');
    assert.strictEqual(evidence.sessionId, 'wses_about');
    assert.strictEqual(evidence.workoutId, 'wk_eval_tiny');
    assert.strictEqual(evidence.intendedDifficulty, 'MODERATE');
    assert.strictEqual(evidence.feedback, 'ABOUT_RIGHT');
    assert.strictEqual(evidence.components.perceivedDifficulty.reading, 'AS_INTENDED');
    assert.strictEqual(evidence.components.perceivedDifficulty.relativeOffset, 0);
    assert.ok(!('fitnessLevel' in evidence));
    assert.ok(!('fitnessScore' in evidence));
    assert.ok(!('fitnessDelta' in evidence));
    assert.ok(!('confidence' in evidence));
    assert.strictEqual(evidence.components.frequency.quality, 'UNAVAILABLE');
    assert.strictEqual(evidence.components.regrouping.quality, 'UNAVAILABLE');
  });

  for (const value of WORKOUT_FEEDBACK_VALUES) {
    test(`completed workout + ${value} preserves feedback independently of difficulty`, () => {
      const evidence = evaluate(completedRecord(new AdjustableClock(1_000), value, { sessionId: `wses_fb_${value}` }));
      assert.strictEqual(evidence.feedback, value);
      assert.strictEqual(evidence.components.perceivedDifficulty.perceivedRelative, value);
      assert.strictEqual(evidence.components.perceivedDifficulty.relativeOffset, FEEDBACK_RELATIVE_OFFSET[value]);
      assert.strictEqual(evidence.intendedDifficulty, 'MODERATE');
    });
  }

  console.log('Phase 17C — relative difficulty');

  const relativeCases: Array<[WorkoutDifficulty, WorkoutFeedbackValue, string, number]> = [
    ['VERY_EASY', 'HARD', 'HARDER_THAN_INTENDED', 1],
    ['EASY', 'ABOUT_RIGHT', 'AS_INTENDED', 0],
    ['MODERATE', 'EASY', 'EASIER_THAN_INTENDED', -1],
    ['HARD', 'TOO_EASY', 'EASIER_THAN_INTENDED', -2],
    ['VERY_HARD', 'ABOUT_RIGHT', 'AS_INTENDED', 0],
  ];
  for (const [difficulty, feedback, reading, offset] of relativeCases) {
    test(`${difficulty} + ${feedback} keeps intended and perceived separate`, () => {
      const evidence = evaluate(completedRecord(new AdjustableClock(1_000), feedback, {
        difficulty,
        sessionId: `wses_${difficulty}_${feedback}`,
      }));
      assert.strictEqual(evidence.intendedDifficulty, difficulty);
      assert.strictEqual(evidence.feedback, feedback);
      assert.strictEqual(evidence.components.perceivedDifficulty.intendedDifficulty, difficulty);
      assert.strictEqual(evidence.components.perceivedDifficulty.perceivedRelative, feedback);
      assert.strictEqual(evidence.components.perceivedDifficulty.reading, reading);
      assert.strictEqual(evidence.components.perceivedDifficulty.relativeOffset, offset);
      assert.ok(evidence.components.perceivedDifficulty.intendedDifficultyRank >= 1);
      assert.ok(evidence.components.perceivedDifficulty.intendedDifficultyRank <= 5);
    });
  }

  console.log('Phase 17C — performance evidence');

  test('full REP_BASED and TIMED completion preserves original units', () => {
    const evidence = evaluate(completedRecord(new AdjustableClock(1_000), 'ABOUT_RIGHT', { sessionId: 'wses_full' }));
    const completion = evidence.components.completion;
    assert.strictEqual(completion.repBased.prescribedRepetitions, 18);
    assert.strictEqual(completion.repBased.completedRepetitions, 18);
    assert.strictEqual(completion.timed.prescribedDurationSeconds, 30);
    assert.strictEqual(completion.timed.completedDurationSeconds, 30);
    assert.strictEqual(completion.mandatoryCompletionRatio, 1);
    assert.ok(!('workloadScore' in evidence.components.workload));
    assert.strictEqual(evidence.components.workload.totalPrescribedRepetitions, 18);
    assert.strictEqual(evidence.components.workload.totalPrescribedTimedDurationSeconds, 30);
  });

  test('partial REP_BASED data is preserved without becoming a score', () => {
    const record = completedRecord(new AdjustableClock(1_000), 'HARD', { sessionId: 'wses_partial_rep' });
    const mutated = JSON.parse(JSON.stringify(record)) as CompletedWorkoutRecord;
    mutated.summary.exercises[0]!.status = 'INCOMPLETE_MANDATORY';
    mutated.summary.exercises[0]!.actual = { kind: 'repetitions', completedRepetitions: 6 };
    mutated.summary.mandatoryIncompleteCount = 1;
    const evidence = evaluate(mutated);
    assert.strictEqual(evidence.components.completion.quality, 'PARTIAL');
    assert.strictEqual(evidence.components.completion.repBased.completedRepetitions, 14);
    assert.strictEqual(evidence.components.completion.exercisesIncompleteMandatory, 1);
    assert.strictEqual(evidence.components.workload.quality, 'PARTIAL');
  });

  test('partial TIMED data stays in seconds', () => {
    const record = completedRecord(new AdjustableClock(1_000), 'EASY', { sessionId: 'wses_partial_timed' });
    const mutated = JSON.parse(JSON.stringify(record)) as CompletedWorkoutRecord;
    mutated.summary.exercises[2]!.status = 'INCOMPLETE_MANDATORY';
    mutated.summary.exercises[2]!.actual = { kind: 'duration', completedDurationSeconds: 8 };
    mutated.summary.mandatoryIncompleteCount = 1;
    const evidence = evaluate(mutated);
    assert.strictEqual(evidence.components.completion.timed.completedDurationSeconds, 18);
    assert.strictEqual(evidence.components.completion.timed.exercisesIncomplete, 1);
  });

  test('completed REST and skipped REST are distinct facts', () => {
    const completed = evaluate(completedRecord(new AdjustableClock(1_000), 'ABOUT_RIGHT', { sessionId: 'wses_rest_done', skipRest: false }));
    assert.strictEqual(completed.components.restSkipping.restExercisesCompleted, 1);
    assert.strictEqual(completed.components.restSkipping.restExercisesSkipped, 0);
    assert.strictEqual(completed.components.restSkipping.restSkipRate, 0);
    const skipped = evaluate(completedRecord(new AdjustableClock(1_000), 'ABOUT_RIGHT', { sessionId: 'wses_rest_skip', skipRest: true }));
    assert.strictEqual(skipped.components.restSkipping.restExercisesCompleted, 0);
    assert.strictEqual(skipped.components.restSkipping.restExercisesSkipped, 1);
    assert.strictEqual(skipped.components.restSkipping.restSkipRate, 1);
    assert.strictEqual(skipped.components.completion.exercisesSkippedRest, 1);
    assert.strictEqual(skipped.components.completion.quality, 'STRONG');
  });

  console.log('Phase 17C — rep speed');

  test('valid multi-rep timing derives averageMsPerRep from active duration', () => {
    const evidence = evaluate(completedRecord(new AdjustableClock(1_000), 'ABOUT_RIGHT', { sessionId: 'wses_speed' }));
    const push = evidence.components.repSpeed.exercises.find((row) => row.exerciseId === 'ex_push_ups');
    assert.ok(push && push.derived.available);
    if (push.derived.available) {
      assert.strictEqual(push.raw.completedRepetitions, 10);
      assert.strictEqual(push.raw.activeDurationMs, 10_000);
      assert.strictEqual(push.derived.averageMsPerRep, 1_000);
    }
    assert.ok(evidence.components.repSpeed.aggregate.available);
    if (evidence.components.repSpeed.aggregate.available) {
      assert.strictEqual(evidence.components.repSpeed.aggregate.totalCompletedRepetitions, 18);
      assert.strictEqual(evidence.components.repSpeed.timingPrecision, 'session_clock_minus_pauses');
    }
  });

  test('pause time is excluded from rep-speed evidence', () => {
    const evidence = evaluate(completedRecord(new AdjustableClock(1_000), 'ABOUT_RIGHT', {
      sessionId: 'wses_speed_pause',
      pauseDuringFirstReps: true,
    }));
    const push = evidence.components.repSpeed.exercises.find((row) => row.exerciseId === 'ex_push_ups');
    assert.ok(push && push.derived.available);
    if (push.derived.available) {
      assert.strictEqual(push.raw.activeDurationMs, 10_000);
      assert.strictEqual(push.derived.averageMsPerRep, 1_000);
      assert.ok((push.raw.activeDurationMs ?? 0) < 50_000);
    }
  });

  test('insufficient timing is unavailable rather than invented', () => {
    const record = completedRecord(new AdjustableClock(1_000), 'ABOUT_RIGHT', { sessionId: 'wses_speed_missing' });
    const mutated = JSON.parse(JSON.stringify(record)) as CompletedWorkoutRecord;
    for (const step of mutated.summary.exercises) {
      if (step.exerciseType === 'REP_BASED') step.activeDurationMs = null;
    }
    const evidence = evaluate(mutated);
    assert.strictEqual(evidence.components.repSpeed.quality, 'UNAVAILABLE');
    assert.strictEqual(evidence.components.repSpeed.aggregate.available, false);
    if (!evidence.components.repSpeed.aggregate.available) {
      assert.strictEqual(evidence.components.repSpeed.aggregate.reason, 'insufficient_timing');
    }
    const push = evidence.components.repSpeed.exercises.find((row) => row.exerciseId === 'ex_push_ups');
    assert.ok(push && !push.derived.available);
    if (!push.derived.available) assert.strictEqual(push.derived.reason, 'missing_active_duration');
  });

  test('zero or invalid speed inputs are not turned into a tempo', () => {
    const record = completedRecord(new AdjustableClock(1_000), 'ABOUT_RIGHT', { sessionId: 'wses_speed_zero' });
    const mutated = JSON.parse(JSON.stringify(record)) as CompletedWorkoutRecord;
    mutated.summary.exercises[0]!.activeDurationMs = 0;
    mutated.summary.exercises[3]!.actual = { kind: 'repetitions', completedRepetitions: 0 };
    mutated.summary.exercises[3]!.activeDurationMs = 8_000;
    const evidence = evaluate(mutated);
    const push = evidence.components.repSpeed.exercises.find((row) => row.exerciseId === 'ex_push_ups');
    const squats = evidence.components.repSpeed.exercises.find((row) => row.exerciseId === 'ex_squats');
    assert.ok(push && !push.derived.available);
    if (!push.derived.available) assert.strictEqual(push.derived.reason, 'non_positive_duration');
    assert.ok(squats && !squats.derived.available);
    if (!squats.derived.available) assert.strictEqual(squats.derived.reason, 'non_positive_repetitions');
  });

  console.log('Phase 17C — rest skipping');

  test('zero skipped rest reports a skip rate of zero', () => {
    const evidence = evaluate(completedRecord(new AdjustableClock(1_000), 'ABOUT_RIGHT', { sessionId: 'wses_skip0' }));
    assert.strictEqual(evidence.components.restSkipping.restExercisesPrescribed, 1);
    assert.strictEqual(evidence.components.restSkipping.restExercisesSkipped, 0);
    assert.strictEqual(evidence.components.restSkipping.restSkipRate, 0);
  });

  test('all skippable REST skipped is recorded without a fitness judgment', () => {
    const evidence = evaluate(completedRecord(new AdjustableClock(1_000), 'TOO_EASY', { sessionId: 'wses_skip_all', skipRest: true }));
    assert.strictEqual(evidence.components.restSkipping.restSkipRate, 1);
    assert.ok(!('restIsBad' in evidence.components.restSkipping));
    assert.ok(!('fitnessBonus' in evidence.components.restSkipping));
  });

  console.log('Phase 17C — body sections');

  test('mixed workout preserves upper, core, lower, and global counts', () => {
    const evidence = evaluate(completedRecord(new AdjustableClock(1_000), 'ABOUT_RIGHT', { sessionId: 'wses_sections' }));
    const body = evidence.components.bodySection;
    assert.strictEqual(body.quality, 'STRONG');
    assert.strictEqual(body.upperBodyExercises, 1);
    assert.strictEqual(body.coreExercises, 1);
    assert.strictEqual(body.lowerBodyExercises, 1);
    assert.strictEqual(body.globalExercises, 2);
    assert.strictEqual(body.sections.UPPER_BODY.prescribedRepetitions, 10);
    assert.strictEqual(body.sections.LOWER_BODY.prescribedRepetitions, 8);
    assert.strictEqual(body.sections.CORE.prescribedTimedDurationSeconds, 20);
    assert.strictEqual(body.sections.GLOBAL.exercisesSkippedRest + body.sections.GLOBAL.exercisesCompleted, 2);
  });

  console.log('Phase 17C — eligibility');

  test('completed + feedback evaluates; completed without feedback is rejected', () => {
    const clock = new AdjustableClock(1_000);
    const completed = finishTiny(beginTiny(clock, 'EASY', 'wses_no_fb'), clock);
    assert.strictEqual(errCode(evaluateSessionFitnessEvidence(completed)), 'evaluation.not_eligible');
    const withFeedback = must(submitWorkoutFeedback(completed, 'ABOUT_RIGHT', clock.now()), 'fb');
    const evidence = must(evaluateSessionFitnessEvidence(withFeedback), 'eval session');
    assert.strictEqual(evidence.feedback, 'ABOUT_RIGHT');
  });

  test('abandoned, active, paused, and not-started sessions are rejected', () => {
    const clock = new AdjustableClock(2_000);
    const created = must(createWorkoutSession({
      playerId: 'player_1',
      workout: tinyWorkout('EASY'),
      intendedDifficulty: 'EASY',
      purpose: 'DEFENSE',
      sessionId: 'wses_states',
      now: clock.now(),
    }), 'create');
    const active = must(beginWorkoutSession({
      playerId: 'player_1',
      workout: tinyWorkout('EASY'),
      intendedDifficulty: 'EASY',
      purpose: 'DEFENSE',
      sessionId: 'wses_active',
      now: clock.now(),
    }), 'active');
    const paused = must(pauseWorkoutSession(active, clock.now()), 'pause');
    const abandoned = must(abandonWorkoutSession(active, clock.now()), 'abandon');
    assert.strictEqual(errCode(evaluateSessionFitnessEvidence(created)), 'evaluation.not_eligible');
    assert.strictEqual(errCode(evaluateSessionFitnessEvidence(active)), 'evaluation.not_eligible');
    assert.strictEqual(errCode(evaluateSessionFitnessEvidence(paused)), 'evaluation.not_eligible');
    assert.strictEqual(errCode(evaluateSessionFitnessEvidence(abandoned)), 'evaluation.not_eligible');
    assert.ok(evaluateSessionFitnessEvidence(abandoned).ok === false
      && evaluateSessionFitnessEvidence(abandoned).error.message.includes('Abandoned'));
  });

  test('malformed records and impossible values are rejected', () => {
    const record = completedRecord(new AdjustableClock(1_000), 'ABOUT_RIGHT', { sessionId: 'wses_bad' });
    assert.strictEqual(errCode(evaluateFitnessEvidence({ ...record, playerId: '' })), 'evaluation.invalid_ids');
    assert.strictEqual(errCode(evaluateFitnessEvidence({ ...record, intendedDifficulty: 'INSANE' })), 'evaluation.invalid_difficulty');
    const badFeedback = JSON.parse(JSON.stringify(record)) as CompletedWorkoutRecord;
    badFeedback.feedback = { ...badFeedback.feedback!, value: 'IMPOSSIBLE' as WorkoutFeedbackValue };
    assert.strictEqual(errCode(evaluateFitnessEvidence(badFeedback)), 'evaluation.invalid_feedback');
    const negative = JSON.parse(JSON.stringify(record)) as CompletedWorkoutRecord;
    negative.summary.exercises[0]!.actual = { kind: 'repetitions', completedRepetitions: -1 };
    assert.strictEqual(errCode(evaluateFitnessEvidence(negative)), 'evaluation.invalid_values');
    assert.strictEqual(errCode(evaluateFitnessEvidence({ kind: 'nope' })), 'evaluation.malformed_record');
  });

  console.log('Phase 17C — determinism and serialization');

  test('identical record and context produce identical evidence', () => {
    const record = completedRecord(new AdjustableClock(1_000), 'HARD', { sessionId: 'wses_det', skipRest: true });
    const a = must(evaluateFitnessEvidence(record, { evaluatedAt: 9_000 }), 'a');
    const b = must(evaluateFitnessEvidence(record, { evaluatedAt: 9_000 }), 'b');
    assert.deepStrictEqual(a, b);
    assert.strictEqual(a.evaluatedAt, 9_000);
  });

  test('evidence JSON round-trip preserves meaning', () => {
    const evidence = evaluate(completedRecord(new AdjustableClock(1_000), 'TOO_HARD', { sessionId: 'wses_json', skipRest: true }));
    const roundTrip = JSON.parse(JSON.stringify(evidence)) as FitnessEvidence;
    assert.deepStrictEqual(roundTrip, evidence);
    assert.deepStrictEqual(cloneFitnessEvidence(evidence), evidence);
    assert.ok(!('clock' in roundTrip));
  });

  test('frequency stays unavailable even if context lists other records', () => {
    const record = completedRecord(new AdjustableClock(1_000), 'ABOUT_RIGHT', { sessionId: 'wses_freq' });
    const evidence = must(evaluateFitnessEvidence(record, {
      recentCompletedWorkouts: [record],
      historicalCompletedWorkouts: [record],
      regrouping: { resumedBeforeRegroupingEnded: true },
    }), 'context');
    assert.strictEqual(evidence.components.frequency.quality, 'UNAVAILABLE');
    assert.strictEqual(evidence.components.regrouping.quality, 'UNAVAILABLE');
  });

  test('canonical GameState still has no fitness history', () => {
    const state = createGameState({ seed: 17 });
    assert.ok(!('fitnessEvidence' in state));
    assert.ok(!('workoutHistory' in state));
  });
}
