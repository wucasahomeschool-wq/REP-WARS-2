import assert from 'assert';
import {
  AdjustableClock,
  FITNESS_EVALUATION_CONFIG,
  FITNESS_MODEL_VERSION,
  MS_PER_DAY,
  applyFitnessEvaluation,
  beginWorkoutSession,
  cloneFitnessEstimate,
  completeExercise,
  createInitialFitnessEstimate,
  evaluateFitness,
  evaluateFitnessEvidence,
  finalizeCompletedWorkout,
  recencyFactor,
  skipExercise,
  submitWorkoutFeedback,
} from '../src/fitness';
import type {
  CompletedWorkoutRecord,
  EstimateOpResult,
  EvaluationOpResult,
  FitnessEstimate,
  FitnessEvidence,
  FitnessEvaluationResult,
  SessionOpResult,
  WorkoutDefinition,
  WorkoutDifficulty,
  WorkoutFeedbackValue,
  WorkoutSession,
} from '../src/fitness';
import { createGameState } from '../src/state';

export interface FitnessLevelTestApi {
  test: (name: string, fn: () => void) => void;
}

function must<T>(result: SessionOpResult<T> | EvaluationOpResult<T> | EstimateOpResult<T>, label: string): T {
  if (!result.ok) {
    throw new Error(`${label}: ${result.error.code} ${(result.error as { message: string }).message}`);
  }
  return result.value;
}

function errCode(result: EstimateOpResult<unknown>): string {
  assert.strictEqual(result.ok, false, 'expected estimate error');
  return result.error.code;
}

function tinyWorkout(intendedDifficulty: WorkoutDifficulty): WorkoutDefinition {
  return {
    id: 'wk_level_tiny',
    name: 'Level Tiny',
    description: 'Fitness Level fixture',
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

function finishTiny(session: WorkoutSession, clock: AdjustableClock, skipRest = false): WorkoutSession {
  let current = session;
  clock.advance(10_000);
  current = must(completeExercise(current, { order: 0, repetitions: 10 }, clock.now()), 'push-ups');
  clock.advance(1_000);
  current = skipRest
    ? must(skipExercise(current, 1, clock.now()), 'skip')
    : must(completeExercise(current, { order: 1, durationSeconds: 15 }, clock.now()), 'rest');
  clock.advance(20_000);
  current = must(completeExercise(current, { order: 2, durationSeconds: 20 }, clock.now()), 'plank');
  clock.advance(8_000);
  current = must(completeExercise(current, { order: 3, repetitions: 8 }, clock.now()), 'squats');
  clock.advance(10_000);
  return must(completeExercise(current, { order: 4, durationSeconds: 10 }, clock.now()), 'stretch');
}

function evidenceFor(
  feedback: WorkoutFeedbackValue,
  difficulty: WorkoutDifficulty,
  sessionId: string,
  options: { skipRest?: boolean; clock?: AdjustableClock } = {},
): FitnessEvidence {
  const clock = options.clock ?? new AdjustableClock(1_000);
  let session = must(beginWorkoutSession({
    playerId: 'player_1',
    workout: tinyWorkout(difficulty),
    intendedDifficulty: difficulty,
    purpose: 'NORMAL_TROOPS',
    sessionId,
    now: clock.now(),
  }), 'begin');
  session = finishTiny(session, clock, options.skipRest === true);
  session = must(submitWorkoutFeedback(session, feedback, clock.now()), 'feedback');
  const record = must(finalizeCompletedWorkout(session), 'finalize') as CompletedWorkoutRecord;
  return must(evaluateFitnessEvidence(record), 'evidence');
}

function initialEstimate(now = 1_000): FitnessEstimate {
  return must(createInitialFitnessEstimate({ playerId: 'player_1', now }), 'initial');
}

function runEval(
  evidence: FitnessEvidence,
  previous: FitnessEstimate | null = null,
  now?: number,
  prior: FitnessEvidence[] = [],
): FitnessEvaluationResult {
  return must(evaluateFitness({
    previousEstimate: previous,
    currentEvidence: evidence,
    historicalContext: { now: now ?? evidence.completedAt, priorEvidence: prior },
  }), 'evaluateFitness');
}

function contribution(result: FitnessEvaluationResult, source: string): number {
  return result.evidenceContributions.find((row) => row.source === source)?.weightedContribution ?? 0;
}

export function registerFitnessLevelTests(api: FitnessLevelTestApi): void {
  const { test } = api;

  console.log('Phase 17D — initialization');

  test('initial estimate is mid-scale with low confidence and valid bounds', () => {
    const estimate = initialEstimate();
    assert.strictEqual(estimate.modelVersion, FITNESS_MODEL_VERSION);
    assert.strictEqual(estimate.level, FITNESS_EVALUATION_CONFIG.levelInitial);
    assert.strictEqual(estimate.confidence, FITNESS_EVALUATION_CONFIG.confidenceInitial);
    assert.ok(estimate.confidence < 0.2);
    assert.strictEqual(estimate.bodySectionLevels.GLOBAL, estimate.level);
    assert.strictEqual(estimate.bodySectionLevels.UPPER_BODY, estimate.level);
    assert.ok(!('troops' in estimate));
    assert.ok(!('xp' in estimate));
  });

  test('empty playerId is rejected', () => {
    assert.strictEqual(errCode(createInitialFitnessEstimate({ playerId: '  ', now: 1 })), 'estimate.invalid_estimate');
  });

  console.log('Phase 17D — perceived difficulty direction');

  test('HARD + TOO_EASY increases the estimate meaningfully from the initial midpoint', () => {
    const result = runEval(evidenceFor('TOO_EASY', 'HARD', 'wses_up'));
    assert.strictEqual(result.netEvidenceDirection, 'UP');
    assert.ok(result.boundedLevelChange > 0.25);
    assert.ok(result.newLevel > result.previousLevel);
    assert.ok(contribution(result, 'PERCEIVED_DIFFICULTY') > contribution(result, 'COMPLETION'));
  });

  test('VERY_HARD + TOO_HARD decreases the estimate', () => {
    const result = runEval(evidenceFor('TOO_HARD', 'VERY_HARD', 'wses_down'));
    assert.strictEqual(result.netEvidenceDirection, 'DOWN');
    assert.ok(result.boundedLevelChange < 0);
    assert.ok(result.newLevel < result.previousLevel);
    assert.strictEqual(result.decreaseResistanceApplied, true);
  });

  test('ABOUT_RIGHT produces little directional change', () => {
    const result = runEval(evidenceFor('ABOUT_RIGHT', 'EASY', 'wses_ok'));
    assert.ok(Math.abs(result.boundedLevelChange) < 0.12);
    assert.ok(result.netEvidenceDirection === 'STABLE' || Math.abs(result.netEvidenceScore) < 0.08);
  });

  const relativeCases: Array<[WorkoutDifficulty, WorkoutFeedbackValue]> = [
    ['VERY_EASY', 'TOO_EASY'],
    ['EASY', 'ABOUT_RIGHT'],
    ['MODERATE', 'TOO_EASY'],
    ['HARD', 'TOO_EASY'],
    ['VERY_HARD', 'TOO_HARD'],
  ];
  for (const [difficulty, feedback] of relativeCases) {
    test(`${difficulty} + ${feedback} is interpreted relative to intended difficulty`, () => {
      const result = runEval(evidenceFor(feedback, difficulty, `wses_${difficulty}_${feedback}`));
      const perceived = result.evidenceContributions.find((row) => row.source === 'PERCEIVED_DIFFICULTY')!;
      assert.ok(perceived.notes.includes(difficulty));
      assert.ok(perceived.notes.includes(feedback));
      if (feedback === 'TOO_EASY') assert.ok(perceived.signal > 0);
      if (feedback === 'TOO_HARD') assert.ok(perceived.signal < 0);
      if (feedback === 'ABOUT_RIGHT') assert.strictEqual(perceived.signal, 0);
    });
  }

  test('HARD + TOO_EASY is a stronger upward signal than VERY_EASY + TOO_EASY', () => {
    const easy = runEval(evidenceFor('TOO_EASY', 'VERY_EASY', 'wses_ve_te'));
    const hard = runEval(evidenceFor('TOO_EASY', 'HARD', 'wses_h_te'));
    assert.ok(contribution(hard, 'PERCEIVED_DIFFICULTY') > contribution(easy, 'PERCEIVED_DIFFICULTY'));
    assert.ok(hard.boundedLevelChange > easy.boundedLevelChange);
  });

  console.log('Phase 17D — bounds and decrease resistance');

  test('level cannot exceed the maximum', () => {
    let estimate = initialEstimate();
    estimate.level = 9.6;
    estimate.bodySectionLevels = { GLOBAL: 9.6, UPPER_BODY: 9.6, CORE: 9.6, LOWER_BODY: 9.6 };
    for (let i = 0; i < 8; i++) {
      const result = runEval(evidenceFor('TOO_EASY', 'VERY_HARD', `wses_max_${i}`), estimate);
      estimate = must(applyFitnessEvaluation(estimate, result), 'apply max');
    }
    assert.ok(estimate.level <= FITNESS_EVALUATION_CONFIG.levelMax);
  });

  test('level cannot fall below the minimum', () => {
    let estimate = initialEstimate();
    estimate.level = 1.3;
    estimate.bodySectionLevels = { GLOBAL: 1.3, UPPER_BODY: 1.3, CORE: 1.3, LOWER_BODY: 1.3 };
    for (let i = 0; i < 8; i++) {
      const result = runEval(evidenceFor('TOO_HARD', 'VERY_EASY', `wses_min_${i}`), estimate);
      estimate = must(applyFitnessEvaluation(estimate, result), 'apply min');
    }
    assert.ok(estimate.level >= FITNESS_EVALUATION_CONFIG.levelMin);
  });

  test('ordinary negative evidence moves less than equivalent positive evidence', () => {
    const up = runEval(evidenceFor('TOO_EASY', 'MODERATE', 'wses_pos'));
    const down = runEval(evidenceFor('TOO_HARD', 'MODERATE', 'wses_neg'));
    assert.ok(up.boundedLevelChange > 0);
    assert.ok(down.boundedLevelChange < 0);
    assert.ok(Math.abs(down.boundedLevelChange) < Math.abs(up.boundedLevelChange) * 0.7);
    assert.strictEqual(down.decreaseResistanceApplied, true);
    assert.strictEqual(up.decreaseResistanceApplied, false);
  });

  test('repeated strong negative evidence can still reduce Fitness Level', () => {
    let estimate = initialEstimate();
    const start = estimate.level;
    for (let i = 0; i < 6; i++) {
      const result = runEval(evidenceFor('TOO_HARD', 'VERY_HARD', `wses_rep_down_${i}`), estimate);
      estimate = must(applyFitnessEvaluation(estimate, result), 'apply down');
    }
    assert.ok(estimate.level < start - 0.3);
  });

  console.log('Phase 17D — recency and confidence influence');

  test('low confidence responds more strongly than high confidence to the same evidence', () => {
    const evidence = evidenceFor('TOO_EASY', 'HARD', 'wses_conf_step');
    const low = initialEstimate();
    const high = cloneFitnessEstimate(low);
    high.confidence = 0.82;
    const lowResult = runEval(evidence, low);
    const highResult = runEval(evidence, high);
    assert.ok(lowResult.influenceScale > highResult.influenceScale);
    assert.ok(lowResult.boundedLevelChange > highResult.boundedLevelChange);
  });

  test('stale high-confidence beginner estimates lose influence so new evidence can raise the level', () => {
    const clock = new AdjustableClock(120 * MS_PER_DAY);
    const evidence = evidenceFor('TOO_EASY', 'HARD', 'wses_stale', { clock });
    const fresh = initialEstimate(evidence.completedAt);
    fresh.level = 3;
    fresh.confidence = 0.85;
    fresh.bodySectionLevels = { GLOBAL: 3, UPPER_BODY: 3, CORE: 3, LOWER_BODY: 3 };
    fresh.lastUpdatedAt = evidence.completedAt;
    const stale = cloneFitnessEstimate(fresh);
    stale.lastUpdatedAt = evidence.completedAt - 90 * MS_PER_DAY;
    const freshResult = runEval(evidence, fresh, evidence.completedAt);
    const staleResult = runEval(evidence, stale, evidence.completedAt);
    assert.ok(staleResult.recencyFactor < 0.05);
    assert.ok(staleResult.decayedConfidence < freshResult.decayedConfidence);
    assert.ok(staleResult.boundedLevelChange > freshResult.boundedLevelChange);
    const applied = must(applyFitnessEvaluation(stale, staleResult), 'apply stale');
    assert.ok(applied.level > 3);
  });

  test('recency factor is 1 at zero age and ~0.5 at one half-life', () => {
    assert.strictEqual(recencyFactor(0), 1);
    const half = recencyFactor(FITNESS_EVALUATION_CONFIG.recencyHalfLifeMs);
    assert.ok(Math.abs(half - 0.5) < 0.001);
  });

  console.log('Phase 17D — confidence');

  test('useful evidence increases confidence without instantly maxing it', () => {
    let estimate = initialEstimate();
    const start = estimate.confidence;
    const result = runEval(evidenceFor('ABOUT_RIGHT', 'MODERATE', 'wses_conf1'), estimate);
    estimate = must(applyFitnessEvaluation(estimate, result), 'apply conf');
    assert.ok(estimate.confidence > start);
    assert.ok(estimate.confidence < 0.45);
    assert.ok(result.confidenceCeiling < 1);
  });

  test('repeated similar workouts do not instantly produce perfect confidence', () => {
    let estimate = initialEstimate();
    for (let i = 0; i < 12; i++) {
      const result = runEval(evidenceFor('ABOUT_RIGHT', 'MODERATE', `wses_ident_${i}`), estimate);
      estimate = must(applyFitnessEvaluation(estimate, result), 'apply ident');
    }
    assert.ok(estimate.confidence < 0.85);
    assert.ok(estimate.confidence <= 1);
  });

  test('varied body-section evidence has a higher confidence ceiling than a one-section clone', () => {
    const varied = runEval(evidenceFor('ABOUT_RIGHT', 'MODERATE', 'wses_var'));
    const narrowEvidence = JSON.parse(JSON.stringify(evidenceFor('ABOUT_RIGHT', 'MODERATE', 'wses_narrow'))) as FitnessEvidence;
    for (const key of ['CORE', 'LOWER_BODY', 'GLOBAL'] as const) {
      narrowEvidence.components.bodySection.sections[key] = {
        exercisesPrescribed: 0,
        exercisesCompleted: 0,
        exercisesSkippedRest: 0,
        exercisesIncompleteMandatory: 0,
        prescribedRepetitions: 0,
        completedRepetitions: 0,
        prescribedTimedDurationSeconds: 0,
        completedTimedDurationSeconds: 0,
      };
    }
    narrowEvidence.components.bodySection.coreExercises = 0;
    narrowEvidence.components.bodySection.lowerBodyExercises = 0;
    narrowEvidence.components.bodySection.globalExercises = 0;
    narrowEvidence.components.bodySection.upperBodyExercises = 5;
    const narrow = runEval(narrowEvidence);
    assert.ok(varied.confidenceCeiling > narrow.confidenceCeiling);
  });

  console.log('Phase 17D — contradictory evidence');

  test('TOO_EASY feedback with weak completion is mixed rather than blindly up', () => {
    const evidence = evidenceFor('TOO_EASY', 'HARD', 'wses_mix_up');
    const mixed = JSON.parse(JSON.stringify(evidence)) as FitnessEvidence;
    mixed.components.completion.quality = 'PARTIAL';
    mixed.components.completion.exercisesIncompleteMandatory = 2;
    mixed.components.completion.mandatoryCompleted = 1;
    mixed.components.completion.mandatoryCompletionRatio = 0.4;
    mixed.components.workload.repetitionCompletionRatio = 0.4;
    mixed.components.workload.timedCompletionRatio = 0.4;
    mixed.components.workload.quality = 'PARTIAL';
    const result = runEval(mixed);
    const perceived = contribution(result, 'PERCEIVED_DIFFICULTY');
    const completion = contribution(result, 'COMPLETION');
    assert.ok(perceived > 0);
    assert.ok(completion < 0);
    assert.ok(result.boundedLevelChange < runEval(evidence).boundedLevelChange);
  });

  test('TOO_HARD feedback with strong completion does not fully override completion', () => {
    const result = runEval(evidenceFor('TOO_HARD', 'MODERATE', 'wses_mix_down'));
    assert.ok(contribution(result, 'PERCEIVED_DIFFICULTY') < 0);
    assert.ok(contribution(result, 'COMPLETION') > 0);
    assert.ok(result.netEvidenceScore > contribution(result, 'PERCEIVED_DIFFICULTY'));
  });

  console.log('Phase 17D — supporting signals');

  test('insufficient rep-speed data does not contribute a tempo signal', () => {
    const result = runEval(evidenceFor('ABOUT_RIGHT', 'MODERATE', 'wses_speed_none'));
    const speed = result.evidenceContributions.find((row) => row.source === 'REP_SPEED')!;
    assert.strictEqual(speed.signal, 0);
    assert.ok(speed.notes.includes('no_self_comparison_history') || speed.notes.includes('insufficient'));
  });

  test('self-relative faster reps contribute a cautious positive speed signal', () => {
    const prior = evidenceFor('ABOUT_RIGHT', 'MODERATE', 'wses_speed_prior');
    const current = JSON.parse(JSON.stringify(evidenceFor('ABOUT_RIGHT', 'MODERATE', 'wses_speed_now'))) as FitnessEvidence;
    current.completedAt = prior.completedAt + 3 * MS_PER_DAY;
    for (const row of current.components.repSpeed.exercises) {
      if (row.derived.available) {
        row.derived.averageMsPerRep = row.derived.averageMsPerRep * 0.7;
        if (row.raw.activeDurationMs !== null && row.raw.completedRepetitions) {
          row.raw.activeDurationMs = Math.round(row.derived.averageMsPerRep * row.raw.completedRepetitions);
        }
      }
    }
    if (current.components.repSpeed.aggregate.available) {
      current.components.repSpeed.aggregate.averageMsPerRep *= 0.7;
    }
    const result = runEval(current, initialEstimate(current.completedAt), current.completedAt, [prior]);
    const speed = result.evidenceContributions.find((row) => row.source === 'REP_SPEED')!;
    assert.ok(speed.signal > 0);
    assert.ok(speed.weightedContribution < contribution(result, 'PERCEIVED_DIFFICULTY') + 0.2);
    assert.ok(speed.notes.includes('self_relative'));
  });

  test('skipped rest is a weak supporting signal, not a dominant one', () => {
    const skipped = runEval(evidenceFor('ABOUT_RIGHT', 'MODERATE', 'wses_rest_skip', { skipRest: true }));
    const rest = skipped.evidenceContributions.find((row) => row.source === 'REST_SKIPPING')!;
    assert.ok(rest.weight <= 0.05);
    assert.ok(Math.abs(rest.weightedContribution) < 0.02);
  });

  test('frequency is unavailable without history and is not XP with large history', () => {
    const current = evidenceFor('ABOUT_RIGHT', 'MODERATE', 'wses_freq_now');
    const none = runEval(current);
    assert.strictEqual(none.frequency.available, false);
    assert.strictEqual(contribution(none, 'FREQUENCY'), 0);

    const modestPrior: FitnessEvidence[] = [];
    const grindPrior: FitnessEvidence[] = [];
    for (let i = 0; i < 3; i++) {
      const item = JSON.parse(JSON.stringify(current)) as FitnessEvidence;
      item.sessionId = `wses_modest_${i}`;
      item.completedAt = current.completedAt - (i + 1) * MS_PER_DAY;
      modestPrior.push(item);
    }
    for (let i = 0; i < 20; i++) {
      const item = JSON.parse(JSON.stringify(current)) as FitnessEvidence;
      item.sessionId = `wses_grind_${i}`;
      item.completedAt = current.completedAt - i * (MS_PER_DAY / 4);
      grindPrior.push(item);
    }
    const modest = runEval(current, initialEstimate(current.completedAt), current.completedAt, modestPrior);
    const grind = runEval(current, initialEstimate(current.completedAt), current.completedAt, grindPrior);
    assert.strictEqual(modest.frequency.available, true);
    assert.strictEqual(grind.frequency.available, true);
    assert.ok((grind.frequency.workoutsLastWeek ?? 0) >= 8);
    assert.ok(contribution(grind, 'FREQUENCY') <= contribution(modest, 'FREQUENCY'));
    assert.ok(Math.abs(grind.boundedLevelChange - modest.boundedLevelChange) < 0.15);
  });

  test('body-section levels are preserved and move with the sections used', () => {
    const result = runEval(evidenceFor('TOO_EASY', 'HARD', 'wses_sections'));
    assert.strictEqual(result.bodySectionLevels.GLOBAL, result.newLevel);
    assert.ok(result.bodySectionLevels.UPPER_BODY !== undefined);
    assert.ok(result.bodySectionLevels.CORE !== undefined);
    assert.ok(result.bodySectionLevels.LOWER_BODY !== undefined);
    if (result.boundedLevelChange > 0) {
      assert.ok(result.bodySectionLevels.UPPER_BODY > FITNESS_EVALUATION_CONFIG.levelInitial
        || result.bodySectionLevels.CORE > FITNESS_EVALUATION_CONFIG.levelInitial
        || result.bodySectionLevels.LOWER_BODY > FITNESS_EVALUATION_CONFIG.levelInitial);
    }
  });

  console.log('Phase 17D — determinism, immutability, serialization');

  test('identical inputs produce identical results', () => {
    const evidence = evidenceFor('EASY', 'MODERATE', 'wses_det');
    const estimate = initialEstimate(evidence.completedAt);
    const a = runEval(evidence, estimate, evidence.completedAt);
    const b = runEval(evidence, estimate, evidence.completedAt);
    assert.deepStrictEqual(a, b);
  });

  test('evaluation does not mutate estimate or evidence', () => {
    const evidence = evidenceFor('HARD', 'EASY', 'wses_immut');
    const estimate = initialEstimate(evidence.completedAt);
    const evidenceBefore = JSON.parse(JSON.stringify(evidence));
    const estimateBefore = JSON.parse(JSON.stringify(estimate));
    runEval(evidence, estimate, evidence.completedAt);
    assert.deepStrictEqual(evidence, evidenceBefore);
    assert.deepStrictEqual(estimate, estimateBefore);
  });

  test('estimate and evaluation result survive JSON round-trip', () => {
    const evidence = evidenceFor('TOO_EASY', 'HARD', 'wses_json');
    const result = runEval(evidence);
    const estimate = must(applyFitnessEvaluation(null, result), 'apply json');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(result)), result);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(estimate)), estimate);
    assert.ok(!('clock' in estimate));
  });

  test('player mismatch is rejected', () => {
    const evidence = evidenceFor('ABOUT_RIGHT', 'MODERATE', 'wses_mismatch');
    const other = initialEstimate();
    other.playerId = 'player_2';
    assert.strictEqual(errCode(evaluateFitness({
      previousEstimate: other,
      currentEvidence: evidence,
    })), 'estimate.player_mismatch');
  });

  test('canonical GameState still has no fitness estimate fields', () => {
    const state = createGameState({ seed: 17 });
    assert.ok(!('fitnessEstimate' in state));
    assert.ok(!('fitnessLevel' in state));
    assert.ok(!('fitnessConfidence' in state));
  });
}
