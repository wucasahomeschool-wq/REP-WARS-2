import assert from 'assert';
import {
  GAME_REWARD_CONFIG,
  GAME_REWARD_CONFIG_VERSION,
  GAME_REWARD_MODEL_VERSION,
  PHYSICAL_OUTPUT_VERSION,
  PHYSICAL_RESULT_MODEL_VERSION,
  cloneGameRewardResult,
  clonePhysicalResult,
  convertGameReward,
} from '../src';
import type {
  GameRewardResult,
  PhysicalResult,
  RewardOpResult,
  WorkoutPurpose,
} from '../src';
import { createGameState } from '../src/state';

export interface GameRewardTestApi {
  test: (name: string, fn: () => void) => void;
}

function must<T>(result: RewardOpResult<T>, label: string): T {
  if (!result.ok) {
    throw new Error(`${label}: ${result.error.code} ${result.error.message}`);
  }
  return result.value;
}

function errCode(result: RewardOpResult<unknown>): string {
  assert.strictEqual(result.ok, false, 'expected reward error');
  return result.error.code;
}

function physical(overrides: Partial<PhysicalResult> = {}): PhysicalResult {
  return {
    modelVersion: PHYSICAL_RESULT_MODEL_VERSION,
    outputVersion: PHYSICAL_OUTPUT_VERSION,
    playerId: 'player_1',
    sessionId: 'wses_reward',
    workoutId: 'wk_moderate_full_body',
    purpose: 'NORMAL_TROOPS',
    intendedDifficulty: 'MODERATE',
    completedAt: 5_000,
    fitnessLevelAtPrescription: 5,
    confidenceAtPrescription: 0.08,
    personalizationModelVersion: null,
    totalPhysicalOutput: 28,
    bodySectionOutput: { UPPER_BODY: 10, CORE: 10, LOWER_BODY: 8, GLOBAL: 0 },
    exerciseContributions: [],
    notes: ['output_from_completed_personalized_workload'],
    ...overrides,
  };
}

function convert(result: PhysicalResult, purpose?: WorkoutPurpose): GameRewardResult {
  return must(convertGameReward({ physicalResult: result, purpose }), 'convert');
}

function withPurpose(result: PhysicalResult, purpose: WorkoutPurpose): PhysicalResult {
  return { ...clonePhysicalResult(result), purpose };
}

export function registerGameRewardTests(api: GameRewardTestApi): void {
  const { test } = api;

  console.log('Phase 17G — NORMAL_TROOPS');

  test('valid PhysicalResult converts to a banked troop reward', () => {
    const result = convert(physical());
    assert.strictEqual(result.kind, 'TROOPS');
    assert.strictEqual(result.purpose, 'NORMAL_TROOPS');
    if (result.kind === 'TROOPS') {
      assert.strictEqual(result.amount, Math.floor(28 * GAME_REWARD_CONFIG.troopsPerPhysicalUnit));
      assert.ok(Number.isInteger(result.amount));
      assert.ok(!('workerPower' in result));
      assert.ok(!('multiplier' in result));
      assert.ok(!('defensePower' in result));
    }
    assert.strictEqual(result.modelVersion, GAME_REWARD_MODEL_VERSION);
    assert.strictEqual(result.configVersion, GAME_REWARD_CONFIG_VERSION);
    assert.strictEqual(result.sourcePhysicalOutput, 28);
  });

  test('larger PhysicalResult yields more troops', () => {
    const small = convert(physical({ totalPhysicalOutput: 10 }));
    const large = convert(physical({ totalPhysicalOutput: 80 }));
    assert.ok(small.kind === 'TROOPS' && large.kind === 'TROOPS');
    if (small.kind === 'TROOPS' && large.kind === 'TROOPS') {
      assert.ok(large.amount > small.amount);
      assert.strictEqual(small.amount, 100);
      assert.strictEqual(large.amount, 800);
    }
  });

  test('zero physical output yields zero troops rather than a fallback purpose', () => {
    const result = convert(physical({ totalPhysicalOutput: 0 }));
    assert.strictEqual(result.kind, 'TROOPS');
    if (result.kind === 'TROOPS') assert.strictEqual(result.amount, 0);
  });

  test('troop conversion is deterministic and capped', () => {
    const source = physical({ totalPhysicalOutput: 84.5 });
    const a = convert(source);
    const b = convert(source);
    assert.deepStrictEqual(a, b);
    assert.ok(a.kind === 'TROOPS' && a.amount === 845);
    const capped = convert(physical({ totalPhysicalOutput: 50_000 }));
    assert.ok(capped.kind === 'TROOPS' && capped.amount === GAME_REWARD_CONFIG.maxTroopsPerWorkout);
  });

  console.log('Phase 17G — construction, Golden Yield, defense');

  test('EXTRA_CONSTRUCTION_WORKERS produces temporary worker power, not Troops', () => {
    const result = convert(withPurpose(physical(), 'EXTRA_CONSTRUCTION_WORKERS'));
    assert.strictEqual(result.kind, 'EXTRA_CONSTRUCTION_WORKERS');
    assert.strictEqual(result.purpose, 'EXTRA_CONSTRUCTION_WORKERS');
    if (result.kind === 'EXTRA_CONSTRUCTION_WORKERS') {
      assert.strictEqual(result.workerPower, 7);
      assert.strictEqual(result.permanence, 'TEMPORARY_ACCELERATION');
      assert.ok(!('amount' in result));
      assert.notStrictEqual(result.kind, 'TROOPS');
    }
    const bigger = convert(withPurpose(physical({ totalPhysicalOutput: 80 }), 'EXTRA_CONSTRUCTION_WORKERS'));
    assert.ok(bigger.kind === 'EXTRA_CONSTRUCTION_WORKERS' && result.kind === 'EXTRA_CONSTRUCTION_WORKERS');
    if (bigger.kind === 'EXTRA_CONSTRUCTION_WORKERS' && result.kind === 'EXTRA_CONSTRUCTION_WORKERS') {
      assert.ok(bigger.workerPower > result.workerPower);
    }
  });

  test('GOLDEN_YIELD is a bounded one-time collection effect', () => {
    const result = convert(withPurpose(physical(), 'GOLDEN_YIELD'));
    assert.strictEqual(result.kind, 'GOLDEN_YIELD');
    if (result.kind === 'GOLDEN_YIELD') {
      assert.strictEqual(result.effect, 'ONE_TIME_COLLECTION');
      assert.strictEqual(result.permanence, 'EPHEMERAL');
      assert.ok(result.multiplier >= GAME_REWARD_CONFIG.goldenYieldMinMultiplier);
      assert.ok(result.multiplier <= GAME_REWARD_CONFIG.goldenYieldMaxMultiplier);
      assert.ok(!('goldYieldMultiplierPermanent' in result));
      assert.ok(!('amount' in result));
    }
    const huge = convert(withPurpose(physical({ totalPhysicalOutput: 10_000 }), 'GOLDEN_YIELD'));
    assert.ok(huge.kind === 'GOLDEN_YIELD' && result.kind === 'GOLDEN_YIELD');
    if (huge.kind === 'GOLDEN_YIELD' && result.kind === 'GOLDEN_YIELD') {
      assert.ok(huge.multiplier <= GAME_REWARD_CONFIG.goldenYieldMaxMultiplier);
      assert.ok(huge.multiplier > result.multiplier);
      assert.ok(huge.multiplier >= GAME_REWARD_CONFIG.goldenYieldMaxMultiplier - 0.05);
    }
    const zero = convert(withPurpose(physical({ totalPhysicalOutput: 0 }), 'GOLDEN_YIELD'));
    assert.ok(zero.kind === 'GOLDEN_YIELD' && zero.multiplier === 1);
  });

  test('DEFENSE produces mobilization and never banked Troops', () => {
    const result = convert(withPurpose(physical({ totalPhysicalOutput: 84.5 }), 'DEFENSE'));
    assert.strictEqual(result.kind, 'DEFENSE_MOBILIZATION');
    assert.strictEqual(result.purpose, 'DEFENSE');
    if (result.kind === 'DEFENSE_MOBILIZATION') {
      assert.strictEqual(result.defensePower, 84.5);
      assert.ok(!('amount' in result));
      assert.notStrictEqual(result.kind, 'TROOPS');
    }
    const larger = convert(withPurpose(physical({ totalPhysicalOutput: 120 }), 'DEFENSE'));
    assert.ok(larger.kind === 'DEFENSE_MOBILIZATION' && result.kind === 'DEFENSE_MOBILIZATION');
    if (larger.kind === 'DEFENSE_MOBILIZATION' && result.kind === 'DEFENSE_MOBILIZATION') {
      assert.ok(larger.defensePower > result.defensePower);
    }
  });

  console.log('Phase 17G — purpose separation and neutrality');

  test('the same physical output yields four distinct reward kinds by purpose', () => {
    const source = physical({ totalPhysicalOutput: 40 });
    const kinds = [
      convert(withPurpose(source, 'NORMAL_TROOPS')).kind,
      convert(withPurpose(source, 'EXTRA_CONSTRUCTION_WORKERS')).kind,
      convert(withPurpose(source, 'GOLDEN_YIELD')).kind,
      convert(withPurpose(source, 'DEFENSE')).kind,
    ];
    assert.deepStrictEqual(kinds, [
      'TROOPS',
      'EXTRA_CONSTRUCTION_WORKERS',
      'GOLDEN_YIELD',
      'DEFENSE_MOBILIZATION',
    ]);
    assert.strictEqual(new Set(kinds).size, 4);
  });

  test('one purpose produces exactly one primary reward', () => {
    const result = convert(physical());
    const keys = ['amount', 'workerPower', 'multiplier', 'defensePower'] as const;
    const present = keys.filter((key) => key in result);
    assert.deepStrictEqual(present, ['amount']);
  });

  test('Fitness Level, Confidence, and other fitness metadata do not change the reward', () => {
    const base = convert(physical({
      fitnessLevelAtPrescription: 2,
      confidenceAtPrescription: 0.1,
    }));
    const shifted = convert(physical({
      fitnessLevelAtPrescription: 9,
      confidenceAtPrescription: 0.95,
      notes: ['feedback_speed_frequency_do_not_scale_output', 'TOO_EASY'],
    }));
    assert.strictEqual(base.kind, shifted.kind);
    if (base.kind === 'TROOPS' && shifted.kind === 'TROOPS') {
      assert.strictEqual(base.amount, shifted.amount);
    }
  });

  test('changing PhysicalResult output changes the reward', () => {
    const low = convert(physical({ totalPhysicalOutput: 12 }));
    const high = convert(physical({ totalPhysicalOutput: 60 }));
    assert.ok(low.kind === 'TROOPS' && high.kind === 'TROOPS' && high.amount > low.amount);
  });

  test('requesting a different purpose than the PhysicalResult is rejected', () => {
    assert.strictEqual(errCode(convertGameReward({
      physicalResult: physical({ purpose: 'DEFENSE' }),
      purpose: 'NORMAL_TROOPS',
    })), 'reward.purpose_mismatch');
  });

  console.log('Phase 17G — validation, determinism, serialization');

  test('malformed PhysicalResults and invalid purposes are rejected', () => {
    assert.strictEqual(errCode(convertGameReward({
      physicalResult: physical({ playerId: '' }),
    })), 'reward.invalid_physical_result');
    assert.strictEqual(errCode(convertGameReward({
      physicalResult: physical({ totalPhysicalOutput: -1 }),
    })), 'reward.invalid_physical_result');
    assert.strictEqual(errCode(convertGameReward({
      physicalResult: physical({ modelVersion: 'physical-result.v0' as PhysicalResult['modelVersion'] }),
    })), 'reward.unsupported_version');
    assert.strictEqual(errCode(convertGameReward({
      physicalResult: physical({ purpose: 'INSANE' as WorkoutPurpose }),
    })), 'reward.invalid_physical_result');
    const withTroops = physical() as PhysicalResult & { troops: number };
    withTroops.troops = 99;
    assert.strictEqual(errCode(convertGameReward({ physicalResult: withTroops })), 'reward.invalid_physical_result');
  });

  test('invalid configuration is rejected', () => {
    assert.strictEqual(errCode(convertGameReward({
      physicalResult: physical(),
      configuration: { ...GAME_REWARD_CONFIG, troopsPerPhysicalUnit: -1 },
    })), 'reward.invalid_configuration');
  });

  test('identical inputs produce identical rewards and do not mutate inputs', () => {
    const source = physical({ totalPhysicalOutput: 33.3 });
    const before = clonePhysicalResult(source);
    const a = convert(source);
    const b = convert(source);
    assert.deepStrictEqual(a, b);
    assert.deepStrictEqual(source, before);
  });

  test('reward results survive JSON round-trip', () => {
    const result = convert(withPurpose(physical({ totalPhysicalOutput: 55 }), 'GOLDEN_YIELD'));
    const roundTrip = JSON.parse(JSON.stringify(result)) as GameRewardResult;
    assert.deepStrictEqual(roundTrip, result);
    const cloned = cloneGameRewardResult(roundTrip);
    if (cloned.kind === 'GOLDEN_YIELD') cloned.multiplier = 99;
    assert.ok(result.kind === 'GOLDEN_YIELD' && result.multiplier !== 99);
  });

  test('canonical GameState is not mutated by conversion', () => {
    const state = createGameState({ seed: 17 });
    const snapshot = JSON.stringify(state);
    convert(physical({ totalPhysicalOutput: 40 }));
    assert.strictEqual(JSON.stringify(state), snapshot);
    assert.ok(!('bankedTroops' in state));
    assert.ok(!('gameRewards' in state));
    assert.ok(!('goldenYield' in state));
    assert.strictEqual(state.playerRewards.bankedTroops, 0);
    assert.strictEqual(state.playerRewards.appliedRewards.length, 0);
  });
}
