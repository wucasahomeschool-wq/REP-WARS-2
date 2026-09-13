import assert from 'assert';
import {
  AdjustableClock,
  WORKOUT_FEEDBACK_PROMPT,
  WORKOUT_FEEDBACK_VALUES,
  WORKOUT_PURPOSE_AWARDS_REWARDS,
  WORKOUT_SESSION_STATES,
  abandonWorkoutSession,
  beginWorkoutSession,
  buildWorkoutSessionSummary,
  canTransitionSession,
  cloneWorkoutSession,
  completeExercise,
  createWorkoutSession,
  finalizeCompletedWorkout,
  getCurrentExercise,
  getExerciseDefinition,
  getWorkoutDefinition,
  isEligibleForFitnessEvaluation,
  isTerminalSessionState,
  pauseWorkoutSession,
  recordIntegrityFlag,
  resumeWorkoutSession,
  skipExercise,
  startWorkoutSession,
  submitWorkoutFeedback,
  totalPausedMs,
} from '../src/fitness';
import type {
  SessionOpResult,
  WorkoutDefinition,
  WorkoutDifficulty,
  WorkoutPurpose,
  WorkoutSession,
} from '../src/fitness';
import { createGameState } from '../src/state';

export interface FitnessSessionTestApi {
  test: (name: string, fn: () => void) => void;
}

function must<T>(result: SessionOpResult<T>, label: string): T {
  if (!result.ok) {
    throw new Error(`${label}: ${result.error.code} ${result.error.message}`);
  }
  return result.value;
}

function errCode(result: SessionOpResult<unknown>): string {
  assert.strictEqual(result.ok, false, 'expected session error');
  return result.error.code;
}

function clockAt(ms = 1_000): AdjustableClock {
  return new AdjustableClock(ms);
}

function begin(
  clock: AdjustableClock,
  overrides: {
    playerId?: string;
    workoutId?: string;
    workout?: WorkoutDefinition;
    intendedDifficulty?: WorkoutDifficulty;
    purpose?: WorkoutPurpose;
    sessionId?: string;
  } = {},
): WorkoutSession {
  return must(beginWorkoutSession({
    playerId: overrides.playerId ?? 'player_1',
    workoutId: overrides.workoutId ?? 'wk_very_easy_mobility',
    workout: overrides.workout,
    intendedDifficulty: overrides.intendedDifficulty ?? 'VERY_EASY',
    purpose: overrides.purpose ?? 'NORMAL_TROOPS',
    sessionId: overrides.sessionId ?? `wses_${clock.now()}`,
    now: clock.now(),
  }), 'begin');
}

function completeMobility(
  session: WorkoutSession,
  clock: AdjustableClock,
  options: { skipRest?: boolean } = {},
): WorkoutSession {
  const durations = [20, 20, 20, 30];
  let current = session;
  for (let order = 0; order < 4; order++) {
    clock.advance(1_000);
    if (order === 2 && options.skipRest) {
      current = must(skipExercise(current, order, clock.now()), `skip ${order}`);
    } else {
      current = must(
        completeExercise(current, { order, durationSeconds: durations[order] }, clock.now()),
        `complete ${order}`,
      );
    }
  }
  return current;
}

export function registerFitnessSessionTests(api: FitnessSessionTestApi): void {
  const { test } = api;

  console.log('Phase 17B — session creation');

  test('valid session starts as NOT_STARTED until start', () => {
    const clock = clockAt();
    const created = must(createWorkoutSession({
      playerId: 'player_1',
      workoutId: 'wk_easy_core',
      intendedDifficulty: 'EASY',
      purpose: 'GOLDEN_YIELD',
      sessionId: 'wses_create',
      now: clock.now(),
    }), 'create');
    assert.strictEqual(created.state, 'NOT_STARTED');
    assert.strictEqual(created.currentExerciseIndex, null);
    assert.strictEqual(created.purpose, 'GOLDEN_YIELD');
    assert.strictEqual(created.intendedDifficulty, 'EASY');
    assert.strictEqual(created.workoutId, 'wk_easy_core');
    const started = must(startWorkoutSession(created, clock.now()), 'start');
    assert.strictEqual(started.state, 'ACTIVE');
    assert.strictEqual(started.currentExerciseIndex, 0);
    assert.strictEqual(getCurrentExercise(started)?.exerciseId, 'ex_neck_rolls');
    assert.strictEqual(created.state, 'NOT_STARTED');
  });

  test('empty sessionId is rejected', () => {
    const clock = clockAt();
    assert.strictEqual(errCode(createWorkoutSession({
      playerId: 'player_1',
      workoutId: 'wk_easy_core',
      intendedDifficulty: 'EASY',
      purpose: 'NORMAL_TROOPS',
      sessionId: '   ',
      now: clock.now(),
    })), 'session.invalid_session_id');
  });

  test('unknown workout is rejected', () => {
    const clock = clockAt();
    assert.strictEqual(errCode(createWorkoutSession({
      playerId: 'player_1',
      workoutId: 'wk_missing',
      intendedDifficulty: 'EASY',
      purpose: 'NORMAL_TROOPS',
      now: clock.now(),
    })), 'session.unknown_workout');
  });

  test('invalid player is rejected', () => {
    const clock = clockAt();
    assert.strictEqual(errCode(createWorkoutSession({
      playerId: '  ',
      workoutId: 'wk_easy_core',
      intendedDifficulty: 'EASY',
      purpose: 'NORMAL_TROOPS',
      now: clock.now(),
    })), 'session.invalid_player');
  });

  test('invalid difficulty is rejected', () => {
    const clock = clockAt();
    assert.strictEqual(errCode(createWorkoutSession({
      playerId: 'player_1',
      workoutId: 'wk_easy_core',
      intendedDifficulty: 'INSANE' as WorkoutDifficulty,
      purpose: 'NORMAL_TROOPS',
      now: clock.now(),
    })), 'session.invalid_difficulty');
  });

  test('invalid purpose is rejected', () => {
    const clock = clockAt();
    assert.strictEqual(errCode(createWorkoutSession({
      playerId: 'player_1',
      workoutId: 'wk_easy_core',
      intendedDifficulty: 'EASY',
      purpose: 'TROOPS' as WorkoutPurpose,
      now: clock.now(),
    })), 'session.invalid_purpose');
  });

  test('session stores an independent prescription snapshot', () => {
    const clock = clockAt();
    const definition = getWorkoutDefinition('wk_easy_core')!;
    const session = begin(clock, { workout: definition, intendedDifficulty: 'EASY', sessionId: 'wses_snap' });
    const sitUps = definition.exercises.find((step) => step.exerciseId === 'ex_sit_ups');
    assert.ok(sitUps && sitUps.prescription.kind === 'repetitions');
    if (sitUps.prescription.kind === 'repetitions') sitUps.prescription.repetitions = 1;
    const sessionSitUps = session.prescribedWorkout.exercises.find((step) => step.exerciseId === 'ex_sit_ups');
    assert.ok(sessionSitUps && sessionSitUps.prescription.kind === 'repetitions');
    assert.strictEqual(sessionSitUps.prescription.repetitions, 8);
    const catalog = getWorkoutDefinition('wk_easy_core')!;
    const catalogSitUps = catalog.exercises.find((step) => step.exerciseId === 'ex_sit_ups');
    assert.ok(catalogSitUps && catalogSitUps.prescription.kind === 'repetitions');
    assert.strictEqual(catalogSitUps.prescription.repetitions, 8);
  });

  console.log('Phase 17B — state transitions');

  test('all five session states exist and terminals have no outgoing transitions', () => {
    assert.deepStrictEqual([...WORKOUT_SESSION_STATES], ['NOT_STARTED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ABANDONED']);
    assert.strictEqual(isTerminalSessionState('COMPLETED'), true);
    assert.strictEqual(isTerminalSessionState('ABANDONED'), true);
    assert.strictEqual(canTransitionSession('COMPLETED', 'ACTIVE'), false);
    assert.strictEqual(canTransitionSession('ABANDONED', 'COMPLETED'), false);
    assert.strictEqual(canTransitionSession('ACTIVE', 'PAUSED'), true);
  });

  test('pause and resume can cycle multiple times', () => {
    const clock = clockAt();
    let session = begin(clock, { sessionId: 'wses_pause_cycle' });
    clock.advance(5_000);
    session = must(pauseWorkoutSession(session, clock.now()), 'pause 1');
    assert.strictEqual(session.state, 'PAUSED');
    clock.advance(60_000);
    session = must(resumeWorkoutSession(session, clock.now()), 'resume 1');
    clock.advance(2_000);
    session = must(pauseWorkoutSession(session, clock.now()), 'pause 2');
    clock.advance(10_000);
    session = must(resumeWorkoutSession(session, clock.now()), 'resume 2');
    assert.strictEqual(session.state, 'ACTIVE');
    assert.strictEqual(session.pauseCount, 2);
    assert.strictEqual(totalPausedMs(session, clock.now()), 70_000);
  });

  test('unlimited pause duration does not fail the session', () => {
    const clock = clockAt();
    let session = begin(clock, { sessionId: 'wses_long_pause' });
    session = must(pauseWorkoutSession(session, clock.now()), 'pause');
    clock.advance(86_400_000 * 30);
    session = must(resumeWorkoutSession(session, clock.now()), 'resume');
    session = completeMobility(session, clock, { skipRest: true });
    assert.strictEqual(session.state, 'COMPLETED');
  });

  test('invalid COMPLETED transitions are rejected', () => {
    const clock = clockAt();
    const completed = completeMobility(begin(clock, { sessionId: 'wses_done' }), clock);
    assert.strictEqual(completed.state, 'COMPLETED');
    assert.strictEqual(errCode(startWorkoutSession(completed, clock.now())), 'session.terminal');
    assert.strictEqual(errCode(pauseWorkoutSession(completed, clock.now())), 'session.terminal');
    assert.strictEqual(errCode(abandonWorkoutSession(completed, clock.now())), 'session.terminal');
    assert.strictEqual(errCode(completeExercise(completed, { order: 3, durationSeconds: 30 }, clock.now())), 'session.terminal');
  });

  test('invalid ABANDONED transitions are rejected', () => {
    const clock = clockAt();
    let session = begin(clock, { sessionId: 'wses_abandon_term' });
    session = must(abandonWorkoutSession(session, clock.now()), 'abandon');
    assert.strictEqual(errCode(startWorkoutSession(session, clock.now())), 'session.terminal');
    assert.strictEqual(errCode(pauseWorkoutSession(session, clock.now())), 'session.terminal');
    assert.strictEqual(errCode(resumeWorkoutSession(session, clock.now())), 'session.terminal');
    assert.strictEqual(errCode(completeExercise(session, { order: 0, durationSeconds: 20 }, clock.now())), 'session.terminal');
  });

  test('NOT_STARTED cannot pause, complete, or abandon', () => {
    const clock = clockAt();
    const created = must(createWorkoutSession({
      playerId: 'player_1',
      workoutId: 'wk_very_easy_mobility',
      intendedDifficulty: 'VERY_EASY',
      purpose: 'DEFENSE',
      sessionId: 'wses_not_started',
      now: clock.now(),
    }), 'create');
    assert.strictEqual(errCode(pauseWorkoutSession(created, clock.now())), 'session.invalid_state_transition');
    assert.strictEqual(errCode(abandonWorkoutSession(created, clock.now())), 'session.invalid_state_transition');
    assert.strictEqual(errCode(completeExercise(created, { order: 0, durationSeconds: 20 }, clock.now())), 'session.invalid_state_transition');
  });

  test('paused session cannot complete an exercise or jump to COMPLETED', () => {
    const clock = clockAt();
    let session = begin(clock, { sessionId: 'wses_paused_complete' });
    session = must(pauseWorkoutSession(session, clock.now()), 'pause');
    assert.strictEqual(errCode(completeExercise(session, { order: 0, durationSeconds: 20 }, clock.now())), 'session.invalid_state_transition');
    assert.strictEqual(canTransitionSession('PAUSED', 'COMPLETED'), false);
  });

  console.log('Phase 17B — exercise progression');

  test('session starts at the first exercise and advances in order', () => {
    const clock = clockAt();
    let session = begin(clock, { workoutId: 'wk_easy_core', intendedDifficulty: 'EASY', sessionId: 'wses_order' });
    assert.strictEqual(getCurrentExercise(session)?.order, 0);
    clock.advance(20_000);
    session = must(completeExercise(session, { order: 0, durationSeconds: 20 }, clock.now()), 'ex0');
    assert.strictEqual(getCurrentExercise(session)?.exerciseId, 'ex_sit_ups');
    assert.strictEqual(session.currentExerciseIndex, 1);
  });

  test('cannot complete a later exercise while an earlier one is current', () => {
    const clock = clockAt();
    const session = begin(clock, { sessionId: 'wses_wrong' });
    assert.strictEqual(errCode(completeExercise(session, { order: 2, durationSeconds: 20 }, clock.now())), 'session.wrong_exercise');
    assert.strictEqual(session.performances[0]!.status, 'PENDING');
  });

  test('cannot complete the same exercise twice', () => {
    const clock = clockAt();
    let session = begin(clock, { sessionId: 'wses_twice' });
    clock.advance(20_000);
    session = must(completeExercise(session, { order: 0, durationSeconds: 20 }, clock.now()), 'first');
    assert.strictEqual(errCode(completeExercise(session, { order: 0, durationSeconds: 20 }, clock.now())), 'session.exercise_already_completed');
  });

  test('completing the final exercise marks the session COMPLETED', () => {
    const clock = clockAt();
    const session = completeMobility(begin(clock, { sessionId: 'wses_final' }), clock);
    assert.strictEqual(session.state, 'COMPLETED');
    assert.ok(session.completedAt !== null);
    assert.strictEqual(session.currentExerciseIndex, null);
    assert.strictEqual(session.feedbackState, 'FEEDBACK_REQUIRED');
  });

  console.log('Phase 17B — rep exercises');

  test('full rep completion records prescribed vs actual reps', () => {
    const clock = clockAt();
    let session = begin(clock, { workoutId: 'wk_easy_core', intendedDifficulty: 'EASY', sessionId: 'wses_reps_full' });
    clock.advance(20_000);
    session = must(completeExercise(session, { order: 0, durationSeconds: 20 }, clock.now()), 'warmup');
    clock.advance(8_000);
    session = must(completeExercise(session, { order: 1, repetitions: 8 }, clock.now()), 'situps');
    const sitUps = session.performances[1]!;
    assert.strictEqual(sitUps.status, 'COMPLETED');
    assert.deepStrictEqual(sitUps.prescribed, { kind: 'repetitions', repetitions: 8 });
    assert.deepStrictEqual(sitUps.actual, { kind: 'repetitions', completedRepetitions: 8 });
    assert.ok(sitUps.activeDurationMs !== null);
  });

  test('partial reps are recorded as incomplete and do not advance', () => {
    const clock = clockAt();
    let session = begin(clock, { workoutId: 'wk_easy_core', intendedDifficulty: 'EASY', sessionId: 'wses_reps_partial' });
    clock.advance(20_000);
    session = must(completeExercise(session, { order: 0, durationSeconds: 20 }, clock.now()), 'warmup');
    session = must(completeExercise(session, { order: 1, repetitions: 5 }, clock.now()), 'partial');
    assert.strictEqual(session.state, 'ACTIVE');
    assert.strictEqual(session.currentExerciseIndex, 1);
    assert.strictEqual(session.performances[1]!.status, 'INCOMPLETE_MANDATORY');
    assert.deepStrictEqual(session.performances[1]!.actual, { kind: 'repetitions', completedRepetitions: 5 });
    session = must(completeExercise(session, { order: 1, repetitions: 8 }, clock.now()), 'finish');
    assert.strictEqual(session.performances[1]!.status, 'COMPLETED');
    assert.strictEqual(session.currentExerciseIndex, 2);
  });

  test('zero and invalid rep counts are rejected', () => {
    const clock = clockAt();
    let session = begin(clock, { workoutId: 'wk_easy_core', intendedDifficulty: 'EASY', sessionId: 'wses_reps_bad' });
    clock.advance(20_000);
    session = must(completeExercise(session, { order: 0, durationSeconds: 20 }, clock.now()), 'warmup');
    assert.strictEqual(errCode(completeExercise(session, { order: 1, repetitions: 0 }, clock.now())), 'session.invalid_repetitions');
    assert.strictEqual(errCode(completeExercise(session, { order: 1, repetitions: -2 }, clock.now())), 'session.invalid_repetitions');
    assert.strictEqual(errCode(completeExercise(session, { order: 1, durationSeconds: 8 }, clock.now())), 'session.prescription_mismatch');
    assert.strictEqual(session.performances[1]!.status, 'PENDING');
  });

  console.log('Phase 17B — timed exercises');

  test('full timed duration is recorded', () => {
    const clock = clockAt();
    let session = begin(clock, { sessionId: 'wses_timed_full' });
    clock.advance(20_000);
    session = must(completeExercise(session, { order: 0, durationSeconds: 20 }, clock.now()), 'timed');
    const first = session.performances[0]!;
    assert.strictEqual(first.status, 'COMPLETED');
    assert.deepStrictEqual(first.prescribed, { kind: 'duration', durationSeconds: 20 });
    assert.deepStrictEqual(first.actual, { kind: 'duration', completedDurationSeconds: 20 });
  });

  test('partial timed duration stays incomplete', () => {
    const clock = clockAt();
    let session = begin(clock, { sessionId: 'wses_timed_partial' });
    session = must(completeExercise(session, { order: 0, durationSeconds: 5 }, clock.now()), 'partial');
    assert.strictEqual(session.performances[0]!.status, 'INCOMPLETE_MANDATORY');
    assert.strictEqual(session.currentExerciseIndex, 0);
    session = must(completeExercise(session, { order: 0, durationSeconds: 20 }, clock.now()), 'full');
    assert.strictEqual(session.performances[0]!.status, 'COMPLETED');
  });

  test('invalid timed duration is rejected', () => {
    const clock = clockAt();
    const session = begin(clock, { sessionId: 'wses_timed_bad' });
    assert.strictEqual(errCode(completeExercise(session, { order: 0, durationSeconds: 0 }, clock.now())), 'session.invalid_duration');
    assert.strictEqual(errCode(completeExercise(session, { order: 0, durationSeconds: -1 }, clock.now())), 'session.invalid_duration');
    assert.strictEqual(errCode(completeExercise(session, { order: 0, repetitions: 20 }, clock.now())), 'session.prescription_mismatch');
  });

  console.log('Phase 17B — REST skipping');

  test('REST can be skipped without failing the session', () => {
    const clock = clockAt();
    const session = completeMobility(begin(clock, { sessionId: 'wses_skip_rest' }), clock, { skipRest: true });
    assert.strictEqual(session.state, 'COMPLETED');
    assert.strictEqual(session.performances[2]!.status, 'SKIPPED_REST');
    assert.deepStrictEqual(session.performances[2]!.actual, { kind: 'skipped_rest' });
    const summary = buildWorkoutSessionSummary(session);
    assert.strictEqual(summary.skippedRestCount, 1);
    assert.strictEqual(summary.state, 'COMPLETED');
  });

  test('REST can also be completed normally', () => {
    const clock = clockAt();
    const session = completeMobility(begin(clock, { sessionId: 'wses_rest_done' }), clock);
    assert.strictEqual(session.performances[2]!.status, 'COMPLETED');
    assert.deepStrictEqual(session.performances[2]!.actual, { kind: 'duration', completedDurationSeconds: 20 });
  });

  test('mandatory exercises cannot be skipped', () => {
    const clock = clockAt();
    const session = begin(clock, { sessionId: 'wses_no_skip' });
    assert.strictEqual(errCode(skipExercise(session, 0, clock.now())), 'session.cannot_skip_mandatory');
    assert.strictEqual(session.performances[0]!.status, 'PENDING');
  });

  console.log('Phase 17B — abandonment');

  test('active and paused sessions can be abandoned and retain performance facts', () => {
    const clock = clockAt();
    let active = begin(clock, { sessionId: 'wses_ab_active' });
    clock.advance(20_000);
    active = must(completeExercise(active, { order: 0, durationSeconds: 20 }, clock.now()), 'one');
    active = must(abandonWorkoutSession(active, clock.now()), 'abandon active');
    assert.strictEqual(active.state, 'ABANDONED');
    assert.strictEqual(active.abandonmentReason, 'PLAYER');
    assert.strictEqual(active.performances[0]!.status, 'COMPLETED');
    assert.strictEqual(active.feedbackState, 'NOT_APPLICABLE');

    let paused = begin(clock, { sessionId: 'wses_ab_paused' });
    paused = must(pauseWorkoutSession(paused, clock.now()), 'pause');
    paused = must(abandonWorkoutSession(paused, clock.now()), 'abandon paused');
    assert.strictEqual(paused.state, 'ABANDONED');
    assert.ok(paused.pauseIntervals[0]!.endedAt !== null);
  });

  test('abandoned sessions cannot resume, complete, or submit feedback', () => {
    const clock = clockAt();
    const abandoned = must(abandonWorkoutSession(begin(clock, { sessionId: 'wses_ab_lock' }), clock.now()), 'abandon');
    assert.strictEqual(errCode(resumeWorkoutSession(abandoned, clock.now())), 'session.terminal');
    assert.strictEqual(errCode(completeExercise(abandoned, { order: 0, durationSeconds: 20 }, clock.now())), 'session.terminal');
    assert.strictEqual(errCode(submitWorkoutFeedback(abandoned, 'ABOUT_RIGHT', clock.now())), 'session.feedback_not_allowed');
    assert.strictEqual(finalizeCompletedWorkout(abandoned).ok, false);
  });

  console.log('Phase 17B — completion and feedback');

  test('completed sessions are terminal, timestamped, and feedback-eligible', () => {
    const clock = clockAt();
    const session = completeMobility(begin(clock, { sessionId: 'wses_fb_req' }), clock, { skipRest: true });
    assert.strictEqual(session.state, 'COMPLETED');
    assert.ok(session.completedAt !== null);
    assert.strictEqual(isTerminalSessionState(session.state), true);
    assert.strictEqual(session.feedbackState, 'FEEDBACK_REQUIRED');
    assert.strictEqual(isEligibleForFitnessEvaluation(session), false);
  });

  test('feedback is rejected before completion and for abandoned sessions', () => {
    const clock = clockAt();
    const created = must(createWorkoutSession({
      playerId: 'player_1',
      workoutId: 'wk_very_easy_mobility',
      intendedDifficulty: 'VERY_EASY',
      purpose: 'NORMAL_TROOPS',
      sessionId: 'wses_fb_early',
      now: clock.now(),
    }), 'create');
    const active = must(startWorkoutSession(created, clock.now()), 'start');
    const paused = must(pauseWorkoutSession(active, clock.now()), 'pause');
    assert.strictEqual(errCode(submitWorkoutFeedback(created, 'EASY', clock.now())), 'session.feedback_not_allowed');
    assert.strictEqual(errCode(submitWorkoutFeedback(active, 'EASY', clock.now())), 'session.feedback_not_allowed');
    assert.strictEqual(errCode(submitWorkoutFeedback(paused, 'EASY', clock.now())), 'session.feedback_not_allowed');
  });

  test('all five feedback values are accepted once after completion', () => {
    for (const value of WORKOUT_FEEDBACK_VALUES) {
      const clock = clockAt();
      const completed = completeMobility(begin(clock, { sessionId: `wses_fb_${value}` }), clock);
      const submitted = must(submitWorkoutFeedback(completed, value, clock.now()), value);
      assert.strictEqual(submitted.feedbackState, 'FEEDBACK_SUBMITTED');
      assert.deepStrictEqual(submitted.feedback, {
        value,
        intendedDifficulty: 'VERY_EASY',
        submittedAt: clock.now(),
      });
      assert.strictEqual(errCode(submitWorkoutFeedback(submitted, 'ABOUT_RIGHT', clock.now())), 'session.feedback_already_submitted');
      assert.ok(!('fitnessLevel' in submitted));
      assert.strictEqual(isEligibleForFitnessEvaluation(submitted), true);
    }
    assert.ok(WORKOUT_FEEDBACK_PROMPT.includes('relative to the difficulty'));
  });

  test('purpose is recorded and does not change session physics or award Troops', () => {
    const clock = clockAt();
    const troops = completeMobility(begin(clock, { purpose: 'NORMAL_TROOPS', sessionId: 'wses_purpose_t' }), clock, { skipRest: true });
    const yieldSession = completeMobility(begin(clock, { purpose: 'GOLDEN_YIELD', sessionId: 'wses_purpose_g' }), clock, { skipRest: true });
    assert.strictEqual(troops.purpose, 'NORMAL_TROOPS');
    assert.strictEqual(yieldSession.purpose, 'GOLDEN_YIELD');
    assert.deepStrictEqual(
      troops.performances.map((p) => p.status),
      yieldSession.performances.map((p) => p.status),
    );
    assert.strictEqual(WORKOUT_PURPOSE_AWARDS_REWARDS.NORMAL_TROOPS, false);
    assert.ok(!('troops' in troops));
    assert.ok(!('rewards' in yieldSession));
  });

  console.log('Phase 17B — integrity flags');

  test('first flag is recorded and the session may continue', () => {
    const clock = clockAt();
    let session = begin(clock, { sessionId: 'wses_flag1' });
    session = must(recordIntegrityFlag(session, clock.now()), 'flag1');
    assert.strictEqual(session.state, 'ACTIVE');
    assert.strictEqual(session.integrityFlags.length, 1);
    assert.strictEqual(session.integrityFlags[0]!.index, 1);
    clock.advance(20_000);
    session = must(completeExercise(session, { order: 0, durationSeconds: 20 }, clock.now()), 'continue');
    assert.strictEqual(session.performances[0]!.status, 'COMPLETED');
  });

  test('second flag abandons the session and retains flag data', () => {
    const clock = clockAt();
    let session = begin(clock, { sessionId: 'wses_flag2' });
    session = must(recordIntegrityFlag(session, clock.now()), 'flag1');
    clock.advance(500);
    session = must(recordIntegrityFlag(session, clock.now()), 'flag2');
    assert.strictEqual(session.state, 'ABANDONED');
    assert.strictEqual(session.abandonmentReason, 'INTEGRITY_FLAGS');
    assert.strictEqual(session.integrityFlags.length, 2);
    assert.strictEqual(errCode(resumeWorkoutSession(session, clock.now())), 'session.terminal');
    assert.strictEqual(errCode(submitWorkoutFeedback(session, 'HARD', clock.now())), 'session.feedback_not_allowed');
  });

  console.log('Phase 17B — performance summary');

  test('session summary captures prescribed vs actual, pauses, skips, and timestamps', () => {
    const clock = clockAt(5_000);
    let session = begin(clock, { workoutId: 'wk_easy_core', intendedDifficulty: 'EASY', sessionId: 'wses_summary' });
    clock.advance(20_000);
    session = must(completeExercise(session, { order: 0, durationSeconds: 20 }, clock.now()), '0');
    clock.advance(8_000);
    session = must(completeExercise(session, { order: 1, repetitions: 8 }, clock.now()), '1');
    session = must(pauseWorkoutSession(session, clock.now()), 'pause');
    clock.advance(3_000);
    session = must(resumeWorkoutSession(session, clock.now()), 'resume');
    session = must(skipExercise(session, 2, clock.now()), 'skip rest');
    clock.advance(15_000);
    session = must(completeExercise(session, { order: 3, durationSeconds: 15 }, clock.now()), 'plank');
    session = must(skipExercise(session, 4, clock.now()), 'skip rest 2');
    clock.advance(30_000);
    session = must(completeExercise(session, { order: 5, durationSeconds: 30 }, clock.now()), 'close');
    session = must(submitWorkoutFeedback(session, 'ABOUT_RIGHT', clock.now()), 'feedback');

    const summary = buildWorkoutSessionSummary(session);
    assert.strictEqual(summary.sessionId, 'wses_summary');
    assert.strictEqual(summary.playerId, 'player_1');
    assert.strictEqual(summary.workoutId, 'wk_easy_core');
    assert.strictEqual(summary.purpose, 'NORMAL_TROOPS');
    assert.strictEqual(summary.state, 'COMPLETED');
    assert.strictEqual(summary.skippedRestCount, 2);
    assert.strictEqual(summary.mandatoryIncompleteCount, 0);
    assert.strictEqual(summary.pauseCount, 1);
    assert.strictEqual(summary.totalPausedMs, 3_000);
    assert.strictEqual(summary.feedback?.value, 'ABOUT_RIGHT');
    assert.strictEqual(summary.eligibleForFitnessEvaluation, true);
    assert.ok(summary.exercises[1]!.prescribed.kind === 'repetitions');
    assert.ok(summary.exercises[1]!.actual.kind === 'repetitions');
    assert.ok(summary.totalActiveDurationMs > 0);
    assert.ok(!('fitnessLevel' in summary));
    assert.ok(!('confidence' in summary));

    const record = must(finalizeCompletedWorkout(session), 'finalize');
    assert.strictEqual(record.kind, 'completed_workout_record');
    assert.strictEqual(record.eligibleForFitnessEvaluation, true);
    assert.strictEqual(record.feedback?.value, 'ABOUT_RIGHT');
  });

  test('completed record without feedback is not fitness-eligible', () => {
    const clock = clockAt();
    const session = completeMobility(begin(clock, { sessionId: 'wses_no_fb' }), clock);
    const record = must(finalizeCompletedWorkout(session), 'finalize');
    assert.strictEqual(record.eligibleForFitnessEvaluation, false);
    assert.strictEqual(record.feedback, null);
  });

  console.log('Phase 17B — serialization and immutability');

  test('session and completed record serialize without runtime-only fields', () => {
    const clock = clockAt();
    const session = must(
      submitWorkoutFeedback(completeMobility(begin(clock, { sessionId: 'wses_json' }), clock, { skipRest: true }), 'HARD', clock.now()),
      'feedback',
    );
    const sessionRoundTrip = JSON.parse(JSON.stringify(session)) as WorkoutSession;
    assert.deepStrictEqual(sessionRoundTrip, session);
    const record = must(finalizeCompletedWorkout(session), 'record');
    const recordRoundTrip = JSON.parse(JSON.stringify(record));
    assert.deepStrictEqual(recordRoundTrip, record);
    assert.strictEqual(typeof sessionRoundTrip.sessionId, 'string');
    assert.ok(!('clock' in sessionRoundTrip));
    assert.ok(!('catalog' in sessionRoundTrip));
  });

  test('mutating a session prescription does not mutate the catalog', () => {
    const clock = clockAt();
    const session = begin(clock, { sessionId: 'wses_immut' });
    const clone = cloneWorkoutSession(session);
    const first = session.prescribedWorkout.exercises[0]!;
    assert.ok(first.prescription.kind === 'duration');
    if (first.prescription.kind === 'duration') first.prescription.durationSeconds = 1;
    session.playerId = 'mutated';
    const catalog = getWorkoutDefinition('wk_very_easy_mobility')!;
    assert.strictEqual(catalog.exercises[0]!.prescription.kind, 'duration');
    if (catalog.exercises[0]!.prescription.kind === 'duration') {
      assert.strictEqual(catalog.exercises[0]!.prescription.durationSeconds, 20);
    }
    const neck = getExerciseDefinition('ex_neck_rolls')!;
    assert.deepStrictEqual(neck.defaultPrescription, { kind: 'duration', durationSeconds: 20 });
    assert.strictEqual(clone.playerId, 'player_1');
    assert.ok(clone.prescribedWorkout.exercises[0]!.prescription.kind === 'duration');
    if (clone.prescribedWorkout.exercises[0]!.prescription.kind === 'duration') {
      assert.strictEqual(clone.prescribedWorkout.exercises[0]!.prescription.durationSeconds, 20);
    }
  });

  test('operations do not mutate the input session object', () => {
    const clock = clockAt();
    const original = begin(clock, { sessionId: 'wses_pure' });
    const paused = must(pauseWorkoutSession(original, clock.now()), 'pause');
    assert.strictEqual(original.state, 'ACTIVE');
    assert.strictEqual(paused.state, 'PAUSED');
  });

  test('canonical GameState still has no workout session history', () => {
    const state = createGameState({ seed: 17 });
    assert.ok(!('workoutSessions' in state));
    assert.ok(!('fitness' in state));
    assert.ok(!('completedWorkouts' in state));
  });
}
