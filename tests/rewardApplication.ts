import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  COMMAND_INDEX,
  GAME_REWARD_CONFIG,
  GAME_REWARD_CONFIG_VERSION,
  GAME_REWARD_MODEL_VERSION,
  PHYSICAL_OUTPUT_VERSION,
  PHYSICAL_RESULT_MODEL_VERSION,
  REWARD_APPLICATION_MODEL_VERSION,
  applyGameReward,
  checkGameStateInvariants,
  cloneGameState,
  clonePhysicalResult,
  convertGameReward,
  createActiveInvasion,
  createGameState,
} from '../src';
import { computeAttackerPower } from '../src/battle/CombatPower';
import type {
  ApplyGameRewardOutcome,
  GameRewardResult,
  GameState,
  PhysicalResult,
  RewardApplicationContext,
  RewardOpResult,
  TroopReward,
  WorkoutPurpose,
} from '../src';

export interface RewardApplicationTestApi {
  test: (name: string, fn: () => void) => void;
}

const PLAYER_ID = 'player_1';
const PLAYER_FACTION = 'iron_kingdom';
const OTHER_FACTION = 'ashen_horde';

function must<T>(result: RewardOpResult<T>, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error.code} ${result.error.message}`);
  return result.value;
}

function physical(overrides: Partial<PhysicalResult> = {}): PhysicalResult {
  return {
    modelVersion: PHYSICAL_RESULT_MODEL_VERSION,
    outputVersion: PHYSICAL_OUTPUT_VERSION,
    playerId: PLAYER_ID,
    sessionId: 'wses_apply_1',
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

function withPurpose(result: PhysicalResult, purpose: WorkoutPurpose): PhysicalResult {
  return { ...clonePhysicalResult(result), purpose };
}

function convert(result: PhysicalResult, purpose?: WorkoutPurpose): GameRewardResult {
  return must(convertGameReward({ physicalResult: result, purpose }), 'convert');
}

function playerState(): GameState {
  return createGameState({ seed: 17, playerFactionId: PLAYER_FACTION });
}

function bankedContext(overrides: Partial<RewardApplicationContext> = {}): RewardApplicationContext {
  return { playerId: PLAYER_ID, mode: 'banked', ...overrides };
}

function liveContext(overrides: Partial<RewardApplicationContext> = {}): RewardApplicationContext {
  return { playerId: PLAYER_ID, mode: 'live', ...overrides };
}

function applyMust(
  state: GameState,
  reward: GameRewardResult,
  context: RewardApplicationContext,
): Extract<ApplyGameRewardOutcome, { ok: true }> {
  const outcome = applyGameReward(state, reward, context);
  if (!outcome.ok) {
    throw new Error(`expected success: ${outcome.result.code} ${outcome.result.message}`);
  }
  return outcome;
}

function applyErr(
  state: GameState,
  reward: GameRewardResult,
  context: RewardApplicationContext,
): Extract<ApplyGameRewardOutcome, { ok: false }> {
  const outcome = applyGameReward(state, reward, context);
  assert.strictEqual(outcome.ok, false, 'expected application failure');
  return outcome as Extract<ApplyGameRewardOutcome, { ok: false }>;
}

function armyFingerprint(state: GameState) {
  return [...state.armies.values()]
    .map((a) => ({
      id: a.id,
      owner: a.owner,
      location: a.location,
      soldiers: a.soldiers,
      knights: a.knights,
      siegeEngines: a.siegeEngines,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function economyFingerprint(state: GameState) {
  return [...state.factions.values()]
    .map((f) => ({
      id: f.id,
      totalMilitaryPower: f.totalMilitaryPower,
      gold: f.resources.gold,
      food: f.resources.food,
      incomeGold: f.resourceIncome.gold,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function combatFingerprint(state: GameState) {
  return computeAttackerPower([...state.armies.values()]).effectivePower;
}

function seedInvasion(
  state: GameState,
  overrides: Partial<{ id: string; defenderFactionId: string; attackerFactionId: string }> = {},
): GameState {
  const next = cloneGameState(state);
  const defender = overrides.defenderFactionId ?? PLAYER_FACTION;
  const territory = [...next.territories.values()].find((t) => t.owner === defender)
    ?? [...next.territories.values()][0]!;
  const invasion = createActiveInvasion({
    id: overrides.id ?? 'inv_test',
    defenderFactionId: defender,
    attackerFactionId: overrides.attackerFactionId ?? OTHER_FACTION,
    territoryId: territory.id,
    startedAtTick: 100,
    notifiedAtTick: 100,
    responseDeadlineTick: 130,
  });
  next.activeInvasions.set(invasion.id, invasion);
  return next;
}

export function registerRewardApplicationTests(api: RewardApplicationTestApi): void {
  const { test } = api;

  console.log('Phase 17H — NORMAL_TROOPS banking');

  test('valid NORMAL_TROOPS reward increases bankedTroops by the converted amount', () => {
    const state = playerState();
    const reward = convert(physical());
    assert.strictEqual(reward.kind, 'TROOPS');
    const outcome = applyMust(state, reward, bankedContext());
    assert.strictEqual(outcome.result.kind, 'TROOPS');
    assert.strictEqual(outcome.state.playerRewards.bankedTroops, 280);
    assert.strictEqual(outcome.result.amountOrEffect.kind, 'TROOPS');
    if (outcome.result.amountOrEffect.kind === 'TROOPS') {
      assert.strictEqual(outcome.result.amountOrEffect.amount, 280);
      assert.strictEqual(outcome.result.amountOrEffect.bankedTroopsAfter, 280);
    }
    assert.strictEqual(outcome.result.factionId, PLAYER_FACTION);
    assert.strictEqual(outcome.result.playerId, PLAYER_ID);
    assert.strictEqual(outcome.result.sourceSessionId, 'wses_apply_1');
    assert.strictEqual(outcome.result.applicationModelVersion, REWARD_APPLICATION_MODEL_VERSION);
    assert.deepStrictEqual(checkGameStateInvariants(outcome.state), []);
    assert.strictEqual(state.playerRewards.bankedTroops, 0, 'input GameState must remain unchanged');
  });

  test('zero troop reward succeeds and adds exactly zero', () => {
    const reward = convert(physical({ totalPhysicalOutput: 0 }));
    const outcome = applyMust(playerState(), reward, bankedContext());
    assert.strictEqual(outcome.state.playerRewards.bankedTroops, 0);
    assert.strictEqual(outcome.result.alreadyApplied, false);
    assert.strictEqual(outcome.state.playerRewards.appliedRewards.length, 1);
  });

  test('different troop rewards accumulate in the bank', () => {
    const first = applyMust(
      playerState(),
      convert(physical({ sessionId: 'wses_a', totalPhysicalOutput: 10 })),
      bankedContext(),
    );
    const second = applyMust(
      first.state,
      convert(physical({ sessionId: 'wses_b', totalPhysicalOutput: 20 })),
      bankedContext(),
    );
    assert.strictEqual(second.state.playerRewards.bankedTroops, 300);
  });

  test('banked Troops do not modify deployed armies or CombatPower', () => {
    const state = playerState();
    const armiesBefore = armyFingerprint(state);
    const economyBefore = economyFingerprint(state);
    const powerBefore = combatFingerprint(state);
    const outcome = applyMust(state, convert(physical({ totalPhysicalOutput: 80 })), bankedContext());
    assert.strictEqual(outcome.state.playerRewards.bankedTroops, 800);
    assert.deepStrictEqual(armyFingerprint(outcome.state), armiesBefore);
    assert.deepStrictEqual(economyFingerprint(outcome.state), economyBefore);
    assert.strictEqual(combatFingerprint(outcome.state), powerBefore);
    assert.ok(!('bankedDefensePower' in outcome.state.playerRewards));
  });

  test('Prototype 1 has unlimited troop storage for large valid rewards', () => {
    let state = playerState();
    for (const sessionId of ['wses_cap_1', 'wses_cap_2', 'wses_cap_3']) {
      const reward = convert(physical({ sessionId, totalPhysicalOutput: 50_000 }));
      assert.ok(reward.kind === 'TROOPS' && reward.amount === GAME_REWARD_CONFIG.maxTroopsPerWorkout);
      const outcome = applyMust(state, reward, bankedContext());
      state = outcome.state;
    }
    assert.strictEqual(state.playerRewards.bankedTroops, GAME_REWARD_CONFIG.maxTroopsPerWorkout * 3);
    assert.deepStrictEqual(checkGameStateInvariants(state), []);
  });

  test('unsafe banked troop overflow is rejected without a capacity system', () => {
    const state = playerState();
    state.playerRewards.bankedTroops = Number.MAX_SAFE_INTEGER - 5;
    const reward = convert(physical({ totalPhysicalOutput: 10 }));
    const failed = applyErr(state, reward, bankedContext());
    assert.strictEqual(failed.result.code, 'reward_application.unsafe_numeric_value');
    assert.strictEqual(failed.state.playerRewards.bankedTroops, Number.MAX_SAFE_INTEGER - 5);
  });

  console.log('Phase 17H — construction and Golden Yield boundaries');

  test('EXTRA_CONSTRUCTION_WORKERS reaches pending acceleration state, not Troops', () => {
    const reward = convert(withPurpose(physical(), 'EXTRA_CONSTRUCTION_WORKERS'));
    const outcome = applyMust(playerState(), reward, liveContext());
    assert.strictEqual(outcome.state.playerRewards.bankedTroops, 0);
    assert.strictEqual(outcome.state.playerRewards.pendingConstructionEffects.length, 1);
    const effect = outcome.state.playerRewards.pendingConstructionEffects[0]!;
    assert.strictEqual(effect.workerPower, 7);
    assert.strictEqual(effect.permanence, 'TEMPORARY_ACCELERATION');
    assert.ok(outcome.state.cities instanceof Map);
    assert.ok(!('buildings' in outcome.state));
    assert.ok(!('constructionQueue' in outcome.state));
  });

  test('malformed construction reward is rejected', () => {
    const valid = convert(withPurpose(physical(), 'EXTRA_CONSTRUCTION_WORKERS'));
    const negative = { ...valid, workerPower: -4 } as GameRewardResult;
    const failed = applyErr(playerState(), negative, liveContext());
    assert.strictEqual(failed.result.code, 'reward_application.unsafe_numeric_value');
    assert.strictEqual(failed.state.playerRewards.pendingConstructionEffects.length, 0);
  });

  test('GOLDEN_YIELD stores a one-time effect and does not mint resources', () => {
    const state = playerState();
    const before = economyFingerprint(state);
    const reward = convert(withPurpose(physical({ totalPhysicalOutput: 40 }), 'GOLDEN_YIELD'));
    const outcome = applyMust(state, reward, liveContext());
    assert.strictEqual(outcome.state.playerRewards.pendingGoldenYieldEffects.length, 1);
    const effect = outcome.state.playerRewards.pendingGoldenYieldEffects[0]!;
    assert.strictEqual(effect.consumed, false);
    assert.strictEqual(effect.permanence, 'EPHEMERAL');
    assert.strictEqual(effect.effect, 'ONE_TIME_COLLECTION');
    assert.ok(effect.multiplier >= 1 && effect.multiplier <= 4);
    assert.deepStrictEqual(economyFingerprint(outcome.state), before);
    assert.strictEqual(outcome.state.playerRewards.bankedTroops, 0);
    assert.ok(!('goldenYieldMultiplier' in outcome.state.playerRewards));
  });

  test('malformed Golden Yield multiplier is rejected', () => {
    const valid = convert(withPurpose(physical(), 'GOLDEN_YIELD'));
    const huge = { ...valid, multiplier: 50 } as GameRewardResult;
    const failed = applyErr(playerState(), huge, liveContext());
    assert.strictEqual(failed.result.code, 'reward_application.invalid_reward');
    assert.strictEqual(failed.state.playerRewards.pendingGoldenYieldEffects.length, 0);
  });

  test('permanent Golden Yield semantics are rejected', () => {
    const valid = convert(withPurpose(physical(), 'GOLDEN_YIELD'));
    const permanent = { ...valid, permanence: 'PERMANENT' } as unknown as GameRewardResult;
    const failed = applyErr(playerState(), permanent, liveContext());
    assert.strictEqual(failed.result.code, 'reward_application.invalid_reward');
  });

  console.log('Phase 17H — DEFENSE invasion boundary');

  test('DEFENSE attaches to the matching active invasion and does not bank Troops', () => {
    const state = seedInvasion(playerState());
    state.worldTick = 40;
    const reward = convert(withPurpose(physical({ totalPhysicalOutput: 33 }), 'DEFENSE'));
    const outcome = applyMust(state, reward, liveContext({
      invasionId: 'inv_test',
      workoutStartedAtTick: 22,
    }));
    const invasion = outcome.state.activeInvasions.get('inv_test')!;
    assert.ok(invasion.defenseMobilization);
    assert.strictEqual(invasion.defenseMobilization!.defensePower, 33);
    assert.strictEqual(invasion.defenseMobilization!.playerId, PLAYER_ID);
    assert.strictEqual(invasion.defenseMobilization!.attachedAtTick, 40);
    assert.strictEqual(invasion.defenseMobilization!.workoutStartedAtTick, 22);
    assert.strictEqual(invasion.startedAtTick, 100);
    assert.strictEqual(invasion.notifiedAtTick, 100);
    assert.strictEqual(invasion.responseDeadlineTick, 130);
    assert.strictEqual(outcome.state.playerRewards.bankedTroops, 0);
    assert.deepStrictEqual(armyFingerprint(outcome.state), armyFingerprint(state));
    assert.strictEqual(outcome.state.territories.get(invasion.territoryId)!.owner, invasion.defenderFactionId);
  });

  test('DEFENSE without an active invasion is rejected and leaves state unchanged', () => {
    const state = playerState();
    const before = cloneGameState(state);
    const reward = convert(withPurpose(physical(), 'DEFENSE'));
    const failed = applyErr(state, reward, liveContext({ invasionId: 'inv_missing' }));
    assert.strictEqual(failed.result.code, 'reward_application.no_active_invasion');
    assert.deepStrictEqual(failed.state, before);
    assert.strictEqual(failed.state.playerRewards.appliedRewards.length, 0);
  });

  test('DEFENSE against another faction\'s invasion is rejected', () => {
    const state = seedInvasion(playerState(), { defenderFactionId: OTHER_FACTION });
    const before = cloneGameState(state);
    const reward = convert(withPurpose(physical(), 'DEFENSE'));
    const failed = applyErr(state, reward, liveContext({ invasionId: 'inv_test' }));
    assert.strictEqual(failed.result.code, 'reward_application.invasion_not_owned');
    assert.deepStrictEqual(failed.state, before);
    assert.strictEqual(failed.state.activeInvasions.get('inv_test')!.defenseMobilization, null);
  });

  test('DEFENSE cannot be applied as banked Troops', () => {
    const state = seedInvasion(playerState());
    const reward = convert(withPurpose(physical(), 'DEFENSE'));
    const failed = applyErr(state, reward, bankedContext({ invasionId: 'inv_test' }));
    assert.strictEqual(failed.result.code, 'reward_application.invalid_mode');
    assert.strictEqual(failed.state.playerRewards.bankedTroops, 0);
  });

  test('NORMAL_TROOPS cannot be applied as a live action', () => {
    const failed = applyErr(playerState(), convert(physical()), liveContext());
    assert.strictEqual(failed.result.code, 'reward_application.invalid_mode');
  });

  console.log('Phase 17H — authorization, trust, versions');

  test('player cannot apply another player\'s reward', () => {
    const reward = convert(physical());
    const failed = applyErr(playerState(), reward, bankedContext({ playerId: 'player_2' }));
    assert.strictEqual(failed.result.code, 'reward_application.unauthorized');
    assert.strictEqual(failed.state.playerRewards.bankedTroops, 0);
  });

  test('caller-supplied foreign factionId is rejected', () => {
    const failed = applyErr(
      playerState(),
      convert(physical()),
      bankedContext({ factionId: OTHER_FACTION }),
    );
    assert.strictEqual(failed.result.code, 'reward_application.faction_mismatch');
    assert.strictEqual(failed.state.playerRewards.bankedTroops, 0);
  });

  test('reward application requires a local player faction', () => {
    const state = createGameState({ seed: 17, playerFactionId: null });
    const failed = applyErr(state, convert(physical()), bankedContext());
    assert.strictEqual(failed.result.code, 'reward_application.no_player_faction');
  });

  test('fabricated troop payload is not blindly accepted', () => {
    const valid = convert(physical()) as TroopReward;
    const fake: TroopReward = { ...valid, amount: 999_999 };
    const failed = applyErr(playerState(), fake, bankedContext());
    assert.strictEqual(failed.result.code, 'reward_application.invalid_reward');
    assert.strictEqual(failed.state.playerRewards.bankedTroops, 0);
  });

  test('NaN, infinity, and negative troop amounts are rejected', () => {
    const valid = convert(physical()) as TroopReward;
    for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, -1, 10.5]) {
      const failed = applyErr(playerState(), { ...valid, amount }, bankedContext());
      assert.ok(
        failed.result.code === 'reward_application.unsafe_numeric_value'
        || failed.result.code === 'reward_application.invalid_reward',
        `amount ${String(amount)} => ${failed.result.code}`,
      );
      assert.strictEqual(failed.state.playerRewards.bankedTroops, 0);
    }
  });

  test('unsupported reward versions are rejected', () => {
    const valid = convert(physical());
    const failed = applyErr(
      playerState(),
      { ...valid, modelVersion: 'game-reward.v0' } as unknown as GameRewardResult,
      bankedContext(),
    );
    assert.strictEqual(failed.result.code, 'reward_application.unsupported_version');
  });

  test('there is no client APPLY_REWARD command', () => {
    assert.ok(!COMMAND_INDEX.some((command) => command.commandId === 'APPLY_REWARD'));
  });

  console.log('Phase 17H — transactionality, idempotency, determinism');

  test('invalid reward leaves GameState unchanged', () => {
    const state = playerState();
    const before = cloneGameState(state);
    const valid = convert(physical()) as TroopReward;
    applyErr(state, { ...valid, amount: -8 }, bankedContext());
    assert.deepStrictEqual(state, before);
  });

  test('failed defense application does not partially mutate state', () => {
    const state = playerState();
    const before = cloneGameState(state);
    const reward = convert(withPurpose(physical(), 'DEFENSE'));
    const failed = applyErr(state, reward, liveContext({ invasionId: 'inv_missing' }));
    assert.deepStrictEqual(failed.state, before);
    assert.strictEqual(failed.state.playerRewards.pendingConstructionEffects.length, 0);
    assert.strictEqual(failed.state.playerRewards.appliedRewards.length, 0);
    assert.strictEqual(failed.state.activeInvasions.size, 0);
  });

  test('the same application identity cannot grant twice', () => {
    const reward = convert(physical());
    const first = applyMust(playerState(), reward, bankedContext());
    const retry = applyMust(first.state, reward, bankedContext());
    assert.strictEqual(retry.result.alreadyApplied, true);
    assert.strictEqual(retry.result.applicationId, first.result.applicationId);
    assert.strictEqual(retry.state.playerRewards.bankedTroops, 280);
    assert.strictEqual(retry.state.playerRewards.appliedRewards.length, 1);
    assert.strictEqual(retry.result.sourceSessionId, first.result.sourceSessionId);
  });

  test('different valid rewards remain separately applicable', () => {
    const troops = applyMust(
      playerState(),
      convert(physical({ sessionId: 'wses_t' })),
      bankedContext(),
    );
    const workers = applyMust(
      troops.state,
      convert(withPurpose(physical({ sessionId: 'wses_c' }), 'EXTRA_CONSTRUCTION_WORKERS')),
      liveContext(),
    );
    assert.strictEqual(workers.state.playerRewards.bankedTroops, 280);
    assert.strictEqual(workers.state.playerRewards.pendingConstructionEffects.length, 1);
    assert.strictEqual(workers.state.playerRewards.appliedRewards.length, 2);
  });

  test('same state + reward + context is deterministic', () => {
    const state = playerState();
    const reward = convert(physical({ totalPhysicalOutput: 41 }));
    const a = applyMust(cloneGameState(state), reward, bankedContext());
    const b = applyMust(cloneGameState(state), reward, bankedContext());
    assert.deepStrictEqual(a.result, b.result);
    assert.deepStrictEqual(a.state.playerRewards, b.state.playerRewards);
  });

  test('application result is JSON-safe and auditable', () => {
    const outcome = applyMust(playerState(), convert(physical()), bankedContext());
    const roundTrip = JSON.parse(JSON.stringify(outcome.result));
    assert.deepStrictEqual(roundTrip, outcome.result);
    assert.strictEqual(roundTrip.modelVersion, GAME_REWARD_MODEL_VERSION);
    assert.strictEqual(roundTrip.configVersion, GAME_REWARD_CONFIG_VERSION);
    assert.strictEqual(roundTrip.physicalResultModelVersion, PHYSICAL_RESULT_MODEL_VERSION);
    assert.ok(Array.isArray(roundTrip.stateChanges));
    assert.ok(roundTrip.stateChanges[0].path.includes('bankedTroops'));
  });

  test('invariants catch negative banked Troops', () => {
    const state = playerState();
    state.playerRewards.bankedTroops = -1;
    const violations = checkGameStateInvariants(state);
    assert.ok(violations.some((v) => v.code === 'reward.invalid_banked_troops'));
  });

  test('invariants catch malformed pending Golden Yield semantics', () => {
    const state = playerState();
    state.playerRewards.pendingGoldenYieldEffects.push({
      applicationId: 'app_bad',
      sessionId: 'wses_bad',
      workoutId: 'wk_bad',
      playerId: PLAYER_ID,
      multiplier: Number.POSITIVE_INFINITY,
      effect: 'ONE_TIME_COLLECTION',
      permanence: 'EPHEMERAL',
      consumed: false,
      appliedAtTick: 0,
      sourcePhysicalOutput: 1,
    });
    const violations = checkGameStateInvariants(state);
    assert.ok(violations.some((v) => v.code === 'reward.invalid_golden_yield_multiplier'));
  });

  test('fitness code does not apply rewards or mutate GameState', () => {
    const fitnessDir = path.join(__dirname, '..', 'src', 'fitness');
    const files = fs.readdirSync(fitnessDir, { recursive: true, encoding: 'utf8' }) as string[];
    for (const file of files) {
      if (!file.endsWith('.ts')) continue;
      const src = fs.readFileSync(path.join(fitnessDir, file), 'utf8');
      assert.ok(!src.includes('applyGameReward'), `${file} must not apply game rewards`);
      assert.ok(!src.includes('bankedTroops'), `${file} must not know about banked Troops`);
    }
    const converter = fs.readFileSync(path.join(__dirname, '..', 'src', 'rewards', 'converter.ts'), 'utf8');
    assert.ok(!converter.includes('applyGameReward'));
    assert.ok(!converter.includes('runStateTransaction'));
  });
}
