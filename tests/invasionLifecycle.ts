import assert from 'assert';
import {
  AdjustableClock,
  COMMAND_INDEX,
  DecisionEngine,
  ErrorCode,
  GAME_STATE_SCHEMA_VERSION,
  GAMEPLAY_CONFIG,
  Orchestrator,
  applyGameReward,
  beginWorkoutSession,
  buildWarlordStates,
  canAiAttackPlayer,
  checkGameStateInvariants,
  cloneGameState,
  completeExercise,
  convertGameReward,
  createActiveInvasion,
  createGameState,
  createLegacySampleMapGameState,
  defenseResponseTicks,
  defenseWorkoutMaxDurationTicks,
  failedDefenseContinuationTicks,
  getCurrentExercise,
  isDeadlineElapsed,
  isPlayerProtected,
  playerProtectionTicks,
  processInvasionTimeouts,
  resolveInvasionBattle,
  runWorkoutRewardPipeline,
  skipExercise,
  submitWorkoutFeedback,
  successfulDefenseRecoveryTicks,
} from '../src';
import type {
  CommandRequest,
  GameState,
  PhysicalResult,
  SessionOpResult,
  WorkoutSession,
} from '../src';
import { BattleEngine, BattleInput } from '../src/battle/BattleEngine';
import { playerFacingTick } from '../src/gameplay/invasion/eligibility';
import { setPlayerEmpirePause } from '../src/gameplay/invasion/pause';
import { remainingDeadlineTicks } from '../src/gameplay/invasion/deadlines';
import { createDefaultRegistry } from '../src/orchestration';
import { toDecisionEngineSnapshot } from '../src/state';

export interface InvasionLifecycleTestApi {
  test: (name: string, fn: () => void) => void;
}

const PLAYER_ID = 'player_1';
const PLAYER_FACTION = 'iron_kingdom';
const OTHER_FACTION = 'celestial_theocracy';
const TARGET = 'eastern_hills';
const HOME = 'iron_kingdom_east';

function must<T>(result: SessionOpResult<T>, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error.code} ${result.error.message}`);
  return result.value;
}

function cmdReq(commandId: string, parameters: Record<string, unknown> = {}, playerId = PLAYER_ID): CommandRequest {
  return { commandId, playerId, requestId: `${commandId}_17k`, parameters };
}

function playerState(): GameState {
  const state = createLegacySampleMapGameState({ seed: 17, playerFactionId: PLAYER_FACTION });
  state.playerFitness.lastWorkoutCompletedAtTick = state.worldTick;
  return state;
}

class RecordingBattleEngine extends BattleEngine {
  readonly inputs: BattleInput[] = [];
  resolve(input: BattleInput) {
    this.inputs.push({
      ...input,
      attackerArmies: input.attackerArmies.map((army) => ({ ...army })),
      defenderArmies: (input.defenderArmies ?? []).map((army) => ({ ...army })),
    });
    return super.resolve(input);
  }
}

function placeArmyOn(state: GameState, factionId: string, territoryId: string, soldiers = 800): void {
  const army = [...state.armies.values()].find((a) => a.owner === factionId);
  assert.ok(army, `expected an army for ${factionId}`);
  army.location = territoryId;
  army.soldiers = soldiers;
  army.knights = 0;
  army.movement = null;
  army.attackIntent = null;
}

function attackerArmy(state: GameState) {
  const army = [...state.armies.values()].find((a) => a.owner === OTHER_FACTION);
  assert.ok(army);
  return army;
}

function holdArmy(state: GameState, invasionId: string): void {
  const army = attackerArmy(state);
  army.attackIntent = {
    targetTerritoryId: HOME,
    stagingTerritoryId: army.location,
    createdAtTick: state.worldTick,
    status: 'ready',
    commitmentId: null,
    battleSeed: 1,
    holdForInvasionId: invasionId,
    onlyArmyId: army.id,
  };
}

function seedInvasion(state: GameState, overrides: {
  id?: string;
  status?: 'pending_response' | 'defense_in_progress';
  notifiedAtTick?: number;
  responseDeadlineTick?: number;
  soldiers?: number;
  garrison?: number;
} = {}) {
  const notifiedAtTick = overrides.notifiedAtTick ?? state.worldTick;
  placeArmyOn(state, OTHER_FACTION, TARGET, overrides.soldiers ?? 400);
  if (overrides.garrison !== undefined) {
    state.territories.get(HOME)!.garrison = overrides.garrison;
  }
  const invasion = createActiveInvasion({
    id: overrides.id ?? 'inv_17k',
    defenderFactionId: PLAYER_FACTION,
    attackerFactionId: OTHER_FACTION,
    territoryId: HOME,
    startedAtTick: notifiedAtTick,
    notifiedAtTick,
    responseDeadlineTick: overrides.responseDeadlineTick ?? notifiedAtTick + defenseResponseTicks(),
    attackingArmyIds: [attackerArmy(state).id],
    battleSeed: 1,
    status: overrides.status ?? 'pending_response',
  });
  state.activeInvasions.set(invasion.id, invasion);
  holdArmy(state, invasion.id);
  return invasion;
}

function completeAll(session: WorkoutSession, clock: AdjustableClock): WorkoutSession {
  let current = session;
  while (current.state === 'ACTIVE') {
    const step = getCurrentExercise(current);
    assert.ok(step, 'expected current exercise');
    clock.advance(1_000);
    if (step.skippable && step.exerciseType === 'REST') {
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

function finishActiveSession(state: GameState): WorkoutSession {
  const session = state.playerFitness.activeSession;
  assert.ok(session);
  const clock = new AdjustableClock(2_000);
  let current = completeAll(session, clock);
  current = must(submitWorkoutFeedback(current, 'ABOUT_RIGHT', clock.now()), 'feedback');
  state.playerFitness.activeSession = current;
  return current;
}

function startDefense(orch: Orchestrator, invasionId: string, sessionId = 'wses_17k_def'): ReturnType<Orchestrator['execute']> {
  return orch.execute(cmdReq('START_WORKOUT', {
    purpose: 'DEFENSE',
    workoutId: 'wk_very_easy_mobility',
    invasionId,
    sessionId,
    now: 1_000,
  }));
}

function defensePhysical(sessionId: string): PhysicalResult {
  return {
    modelVersion: 'physical-result.v1',
    outputVersion: 'physical-output.v1',
    playerId: PLAYER_ID,
    sessionId,
    workoutId: 'wk_17k_tiny',
    purpose: 'DEFENSE',
    intendedDifficulty: 'MODERATE',
    completedAt: 5_000,
    fitnessLevelAtPrescription: 5,
    confidenceAtPrescription: 0.08,
    personalizationModelVersion: null,
    totalPhysicalOutput: 400,
    bodySectionOutput: { UPPER_BODY: 100, CORE: 100, LOWER_BODY: 100, GLOBAL: 0 },
    exerciseContributions: [],
    notes: [],
  };
}

export function registerInvasionLifecycleTests(api: InvasionLifecycleTestApi): void {
  const { test } = api;

  console.log('Phase 17K — invasion lifecycle & defense timeout');

  test('schema version is 12 and completion timeout is 12 hours, separate from the 30-minute response window', () => {
    const state = playerState();
    assert.strictEqual(state.schemaVersion, GAME_STATE_SCHEMA_VERSION);
    assert.strictEqual(GAME_STATE_SCHEMA_VERSION, 12);
    assert.strictEqual(GAMEPLAY_CONFIG.playerProtectionMinutes, 1440);
    assert.strictEqual(GAMEPLAY_CONFIG.defenseResponseMinutes, 30);
    assert.strictEqual(GAMEPLAY_CONFIG.defenseWorkoutMaxDurationMinutes, 12 * 60);
    assert.strictEqual(defenseWorkoutMaxDurationTicks(), 720);
    assert.strictEqual(defenseResponseTicks(), 30);
    assert.strictEqual(successfulDefenseRecoveryTicks(), 2880);
    assert.strictEqual(failedDefenseContinuationTicks(), 240);
    assert.notStrictEqual(defenseWorkoutMaxDurationTicks(), defenseResponseTicks());
  });

  test('inclusive deadline convention: now === deadline is valid; expired iff now > deadline', () => {
    assert.strictEqual(isDeadlineElapsed(130, 130), false);
    assert.strictEqual(isDeadlineElapsed(131, 130), true);
    assert.strictEqual(remainingDeadlineTicks(130, 130), 0);
    assert.strictEqual(remainingDeadlineTicks(129, 130), 1);
  });

  test('pending invasion remains defendable before and on the response deadline', () => {
    const before = playerState();
    before.worldTick = 129;
    seedInvasion(before, { notifiedAtTick: 100, responseDeadlineTick: 130 });
    const orchBefore = new Orchestrator(before);
    const startBefore = startDefense(orchBefore, 'inv_17k', 'wses_before');
    assert.strictEqual(startBefore.success, true, startBefore.errors[0]?.message);

    const on = playerState();
    on.worldTick = 130;
    seedInvasion(on, { notifiedAtTick: 100, responseDeadlineTick: 130, id: 'inv_on' });
    const orchOn = new Orchestrator(on);
    const startOn = startDefense(orchOn, 'inv_on', 'wses_on');
    assert.strictEqual(startOn.success, true, startOn.errors[0]?.message);
    assert.strictEqual(orchOn.getState().activeInvasions.get('inv_on')!.status, 'defense_in_progress');
  });

  test('response deadline + 1 resolves unanswered invasions with no defense reward', () => {
    const state = playerState();
    state.worldTick = 131;
    seedInvasion(state, { notifiedAtTick: 100, responseDeadlineTick: 130, soldiers: 5000, garrison: 1 });
    const results = processInvasionTimeouts(state, new BattleEngine());
    assert.strictEqual(state.activeInvasions.size, 0);
    assert.strictEqual(results[0]!.payload.invasionOutcome, 'undefended');
    assert.strictEqual(results[0]!.payload.defensePower, 0);
    assert.strictEqual(state.territories.get(HOME)!.owner, OTHER_FACTION);
    assert.strictEqual(state.playerRewards.appliedRewards.length, 0);
    assert.strictEqual(state.playerRewards.bankedTroops, 0);
    const army = [...state.armies.values()].find((a) => a.owner === OTHER_FACTION);
    if (army) {
      assert.strictEqual(army.attackIntent, null);
    }
  });

  test('exact response deadline is not yet expired; processInvasionTimeouts leaves it open', () => {
    const state = playerState();
    state.worldTick = 130;
    seedInvasion(state, { notifiedAtTick: 100, responseDeadlineTick: 130 });
    processInvasionTimeouts(state, new BattleEngine());
    assert.strictEqual(state.activeInvasions.size, 1);
    assert.strictEqual(state.activeInvasions.get('inv_17k')!.status, 'pending_response');
  });

  test('START_WORKOUT DEFENSE is rejected after the response deadline, for the wrong player, and for a missing invasion', () => {
    const late = playerState();
    late.worldTick = 131;
    seedInvasion(late, { notifiedAtTick: 100, responseDeadlineTick: 130, id: 'inv_late' });
    const lateRes = startDefense(new Orchestrator(late), 'inv_late');
    assert.strictEqual(lateRes.success, false);
    assert.strictEqual(lateRes.errors[0]!.code, ErrorCode.ACTION_NOT_ALLOWED);

    const missing = startDefense(new Orchestrator(playerState()), 'inv_missing');
    assert.strictEqual(missing.success, false);
    assert.strictEqual(missing.errors[0]!.code, ErrorCode.INVALID_TARGET);

    const foreign = playerState();
    foreign.worldTick = 100;
    const otherHome = [...foreign.territories.values()].find((t) => t.owner === OTHER_FACTION)!;
    const invasion = createActiveInvasion({
      id: 'inv_foreign',
      defenderFactionId: OTHER_FACTION,
      attackerFactionId: PLAYER_FACTION,
      territoryId: otherHome.id,
      startedAtTick: 100,
      notifiedAtTick: 100,
      responseDeadlineTick: 130,
    });
    foreign.activeInvasions.set(invasion.id, invasion);
    const wrongPlayer = startDefense(new Orchestrator(foreign), 'inv_foreign');
    assert.strictEqual(wrongPlayer.success, false);
    assert.strictEqual(wrongPlayer.errors[0]!.code, ErrorCode.ACTION_NOT_ALLOWED);
  });

  test('duplicate defense start and a second concurrent defense session are rejected', () => {
    const state = playerState();
    state.worldTick = 100;
    seedInvasion(state, { id: 'inv_a' });
    const secondTerritory = [...state.territories.values()].find((t) => t.owner === PLAYER_FACTION && t.id !== HOME);
    assert.ok(secondTerritory);
    state.activeInvasions.set('inv_b', createActiveInvasion({
      id: 'inv_b',
      defenderFactionId: PLAYER_FACTION,
      attackerFactionId: OTHER_FACTION,
      territoryId: secondTerritory.id,
      startedAtTick: 100,
      notifiedAtTick: 100,
      responseDeadlineTick: 130,
      attackingArmyIds: [attackerArmy(state).id],
      battleSeed: 2,
    }));
    const orch = new Orchestrator(state);
    const first = startDefense(orch, 'inv_a', 'wses_a');
    assert.strictEqual(first.success, true, first.errors[0]?.message);
    const dupSame = startDefense(orch, 'inv_a', 'wses_a2');
    assert.strictEqual(dupSame.success, false);
    const dupOther = startDefense(orch, 'inv_b', 'wses_b');
    assert.strictEqual(dupOther.success, false);
    assert.strictEqual(orch.getState().activeInvasions.get('inv_a')!.status, 'defense_in_progress');
    assert.strictEqual(orch.getState().activeInvasions.get('inv_b')!.status, 'pending_response');
  });

  test('a timely start may complete later within the 12-hour window and attach only to that invasion', () => {
    const battle = new RecordingBattleEngine();
    const reg = createDefaultRegistry();
    reg.registerBattle(battle);
    const state = playerState();
    state.worldTick = 100;
    seedInvasion(state, { soldiers: 120 });
    const orch = new Orchestrator(state, reg);
    const start = startDefense(orch, 'inv_17k');
    assert.strictEqual(start.success, true, start.errors[0]?.message);
    const invasion = orch.getState().activeInvasions.get('inv_17k')!;
    assert.strictEqual(invasion.status, 'defense_in_progress');
    assert.strictEqual(invasion.defenseWorkoutStartedAtTick, 100);
    assert.strictEqual(invasion.defenseCompletionDeadlineTick, 100 + defenseWorkoutMaxDurationTicks());
    orch.getState().worldTick = 400;
    finishActiveSession(orch.getState());
    const bankedBefore = orch.getState().playerRewards.bankedTroops;
    const fin = orch.execute(cmdReq('FINALIZE_WORKOUT', { now: 9_000 }));
    assert.strictEqual(fin.success, true, fin.errors[0]?.message);
    assert.ok(fin.payload.invasionOutcome === 'defense_success' || fin.payload.invasionOutcome === 'defense_failure');
    assert.strictEqual(fin.payload.kind, 'DEFENSE_MOBILIZATION');
    assert.strictEqual(orch.getState().playerRewards.bankedTroops, bankedBefore);
    assert.strictEqual(orch.getState().activeInvasions.size, 0);
    assert.strictEqual(battle.inputs.length, 1);
    assert.deepStrictEqual(checkGameStateInvariants(orch.getState()), []);
  });

  test('stale FINALIZE after invasion timeout cannot resurrect the invasion or mint defense power', () => {
    const state = playerState();
    state.worldTick = 100;
    seedInvasion(state, { soldiers: 5000, garrison: 1 });
    const orch = new Orchestrator(state);
    assert.strictEqual(startDefense(orch, 'inv_17k').success, true);
    finishActiveSession(orch.getState());
    orch.getState().worldTick = 100 + defenseWorkoutMaxDurationTicks() + 1;
    processInvasionTimeouts(orch.getState(), new BattleEngine());
    assert.strictEqual(orch.getState().activeInvasions.size, 0);
    const session = orch.getState().playerFitness.activeSession;
    assert.ok(session);
    assert.strictEqual(session.state, 'COMPLETED');
    const fin = orch.execute(cmdReq('FINALIZE_WORKOUT', { now: 9_000 }));
    assert.strictEqual(fin.success, false);
    assert.strictEqual(orch.getState().activeInvasions.size, 0);
    assert.strictEqual(orch.getState().playerRewards.appliedRewards.length, 0);
    assert.strictEqual(orch.getState().territories.get(HOME)!.owner, OTHER_FACTION);
  });

  test('abandoned defense resolves as a failed defense without a defense reward', () => {
    const state = playerState();
    state.worldTick = 100;
    seedInvasion(state, { soldiers: 5000, garrison: 1 });
    const orch = new Orchestrator(state);
    assert.strictEqual(startDefense(orch, 'inv_17k').success, true);
    const res = orch.execute(cmdReq('ABANDON_WORKOUT', { now: 2_000 }));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    assert.strictEqual(res.payload.invasionOutcome, 'defense_abandoned');
    assert.strictEqual(orch.getState().activeInvasions.size, 0);
    assert.strictEqual(orch.getState().playerFitness.activeSession!.state, 'ABANDONED');
    assert.strictEqual(orch.getState().playerFitness.activeSession!.abandonmentReason, 'PLAYER');
    assert.strictEqual(orch.getState().playerRewards.appliedRewards.length, 0);
    assert.strictEqual(orch.getState().territories.get(HOME)!.owner, OTHER_FACTION);
    const army = [...orch.getState().armies.values()].find((a) => a.owner === OTHER_FACTION);
    if (army) assert.strictEqual(army.attackIntent, null);
  });

  test('second integrity flag abandons the defense session and resolves the invasion', () => {
    const state = playerState();
    state.worldTick = 100;
    seedInvasion(state, { soldiers: 5000, garrison: 1 });
    const orch = new Orchestrator(state);
    assert.strictEqual(startDefense(orch, 'inv_17k').success, true);
    const warn = orch.execute(cmdReq('RECORD_INTEGRITY_FLAG', { now: 2_000 }));
    assert.strictEqual(warn.success, true, warn.errors[0]?.message);
    assert.strictEqual(orch.getState().playerFitness.activeSession!.state, 'ACTIVE');
    assert.strictEqual(orch.getState().activeInvasions.size, 1);
    const fatal = orch.execute(cmdReq('RECORD_INTEGRITY_FLAG', { now: 3_000 }));
    assert.strictEqual(fatal.success, true, fatal.errors[0]?.message);
    assert.strictEqual(fatal.payload.invasionOutcome, 'defense_abandoned');
    assert.strictEqual(orch.getState().playerFitness.activeSession!.state, 'ABANDONED');
    assert.strictEqual(orch.getState().playerFitness.activeSession!.abandonmentReason, 'INTEGRITY_FLAGS');
    assert.strictEqual(orch.getState().activeInvasions.size, 0);
    assert.strictEqual(orch.getState().playerRewards.appliedRewards.length, 0);
  });

  test('started defense expires through ADVANCE_WORLD without a per-minute loop', () => {
    const state = playerState();
    state.worldTick = 100;
    seedInvasion(state, { soldiers: 5000, garrison: 1 });
    const orch = new Orchestrator(state);
    assert.strictEqual(startDefense(orch, 'inv_17k').success, true);
    orch.getState().activeInvasions.get('inv_17k')!.defenseCompletionDeadlineTick = 102;
    const res = orch.execute(cmdReq('ADVANCE_WORLD', { elapsedTicks: 3 }));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    assert.strictEqual(orch.getState().worldTick, 103);
    assert.strictEqual(orch.getState().activeInvasions.size, 0);
    assert.strictEqual(orch.getState().playerFitness.activeSession!.state, 'ABANDONED');
    assert.strictEqual(orch.getState().playerFitness.activeSession!.abandonmentReason, 'INVASION_TIMEOUT');
    assert.strictEqual(orch.getState().playerRewards.appliedRewards.length, 0);
  });

  test('unanswered invasion expires through ADVANCE_WORLD', () => {
    const state = playerState();
    state.worldTick = 100;
    seedInvasion(state, { responseDeadlineTick: 102, soldiers: 5000, garrison: 1 });
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('ADVANCE_WORLD', { elapsedTicks: 3 }));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    assert.strictEqual(orch.getState().activeInvasions.size, 0);
    assert.strictEqual(orch.getState().territories.get(HOME)!.owner, OTHER_FACTION);
  });

  test('large world-tick jumps resolve crossed deadlines in one processor pass', () => {
    const state = playerState();
    state.worldTick = 1000;
    seedInvasion(state, { notifiedAtTick: 1000, responseDeadlineTick: 1500, soldiers: 5000, garrison: 1 });
    state.worldTick = 2000;
    const results = processInvasionTimeouts(state, new BattleEngine());
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0]!.payload.invasionOutcome, 'undefended');
    assert.strictEqual(state.activeInvasions.size, 0);
  });

  test('timeout processing works after cloning simulation state (close/reopen)', () => {
    const state = playerState();
    state.worldTick = 100;
    seedInvasion(state, { soldiers: 5000, garrison: 1 });
    const orch = new Orchestrator(state);
    assert.strictEqual(startDefense(orch, 'inv_17k').success, true);
    const reopened = cloneGameState(orch.getState());
    reopened.worldTick = 100 + defenseWorkoutMaxDurationTicks() + 5;
    processInvasionTimeouts(reopened, new BattleEngine());
    assert.strictEqual(reopened.activeInvasions.size, 0);
    assert.strictEqual(orch.getState().activeInvasions.size, 1);
  });

  test('paused player does not lose defense time; unpause restores remaining duration', () => {
    const state = playerState();
    state.worldTick = 100;
    seedInvasion(state);
    const orch = new Orchestrator(state);
    assert.strictEqual(startDefense(orch, 'inv_17k').success, true);
    const started = orch.getState().activeInvasions.get('inv_17k')!;
    const originalDefenseRemaining = remainingDeadlineTicks(100, started.defenseCompletionDeadlineTick!);
    const originalResponseRemaining = remainingDeadlineTicks(100, started.responseDeadlineTick);
    assert.strictEqual(originalDefenseRemaining, defenseWorkoutMaxDurationTicks());
    setPlayerEmpirePause(orch.getState(), true);
    orch.getState().worldTick = 5000;
    processInvasionTimeouts(orch.getState(), new BattleEngine());
    assert.strictEqual(orch.getState().activeInvasions.size, 1);
    assert.strictEqual(playerFacingTick(orch.getState()), 100);
    setPlayerEmpirePause(orch.getState(), false);
    const live = orch.getState().activeInvasions.get('inv_17k')!;
    assert.strictEqual(
      remainingDeadlineTicks(orch.getState().worldTick, live.defenseCompletionDeadlineTick!),
      originalDefenseRemaining,
    );
    assert.strictEqual(
      remainingDeadlineTicks(orch.getState().worldTick, live.responseDeadlineTick),
      originalResponseRemaining,
    );
  });

  test('successful defense retains territory, consumes mobilization, and applies ≥48h recovery once', () => {
    const battle = new RecordingBattleEngine();
    const state = playerState();
    state.worldTick = 50;
    seedInvasion(state, { id: 'inv_win', notifiedAtTick: 40, responseDeadlineTick: 70, soldiers: 120 });
    const converted = convertGameReward({ physicalResult: defensePhysical('wses_def_win') });
    assert.ok(converted.ok);
    const applied = applyGameReward(state, converted.value, {
      playerId: PLAYER_ID,
      mode: 'live',
      invasionId: 'inv_win',
      workoutStartedAtTick: 45,
    });
    assert.ok(applied.ok);
    assert.strictEqual(applied.state.activeInvasions.get('inv_win')!.status, 'defense_in_progress');
    const resolved = resolveInvasionBattle(applied.state, battle, 'inv_win', 'defense_battle');
    assert.strictEqual(resolved.payload.invasionOutcome, 'defense_success');
    assert.strictEqual(applied.state.territories.get(HOME)!.owner, PLAYER_FACTION);
    assert.strictEqual(applied.state.activeInvasions.size, 0);
    assert.strictEqual(battle.inputs.length, 1);
    const recovery = applied.state.attackerCooldowns.get(OTHER_FACTION)?.recoveryUntilTick;
    assert.ok(recovery !== null && recovery !== undefined);
    assert.ok(recovery - applied.state.worldTick >= successfulDefenseRecoveryTicks());
    assert.ok(!canAiAttackPlayer(applied.state, OTHER_FACTION));
    assert.throws(
      () => resolveInvasionBattle(applied.state, battle, 'inv_win', 'defense_battle'),
      (err: unknown) => err instanceof Error,
    );
    assert.strictEqual(battle.inputs.length, 1);
  });

  test('failed defense transfers territory, consumes defense, and applies the 4-hour continuation delay', () => {
    const state = playerState();
    state.worldTick = 80;
    seedInvasion(state, { id: 'inv_lose', notifiedAtTick: 50, responseDeadlineTick: 80, soldiers: 5000, garrison: 1 });
    const resolved = resolveInvasionBattle(state, new BattleEngine(), 'inv_lose', 'defense_battle');
    assert.strictEqual(resolved.payload.invasionOutcome, 'defense_failure');
    assert.strictEqual(state.territories.get(HOME)!.owner, OTHER_FACTION);
    assert.strictEqual(state.activeInvasions.size, 0);
    const cont = state.attackerCooldowns.get(OTHER_FACTION)?.continuationUntilTick;
    assert.strictEqual(cont! - state.worldTick, failedDefenseContinuationTicks());
    assert.ok(!canAiAttackPlayer(state, OTHER_FACTION));
    const army = [...state.armies.values()].find((a) => a.owner === OTHER_FACTION);
    if (army) assert.strictEqual(army.attackIntent, null);
  });

  test('24-hour protection still blocks AI vs player attacks after timeout changes', () => {
    const state = playerState();
    state.worldTick = 100;
    state.playerFitness.lastWorkoutCompletedAtTick = 100;
    assert.ok(isPlayerProtected(state));
    assert.ok(playerFacingTick(state) < 100 + playerProtectionTicks());
    const snapshot = toDecisionEngineSnapshot(state);
    const engine = new DecisionEngine();
    const ws = buildWarlordStates(state).get(OTHER_FACTION)!;
    const decision = engine.decide(ws, snapshot, state.turn);
    if (decision.action === 'ATTACK') {
      const target = state.territories.get(decision.targetId ?? '');
      assert.ok(!target || target.owner !== PLAYER_FACTION);
    }
    assert.strictEqual(canAiAttackPlayer(state, OTHER_FACTION), false);
  });

  test('repeated world advancement after resolution is harmless and cannot double-apply a defense reward', () => {
    const state = playerState();
    state.worldTick = 100;
    seedInvasion(state, { soldiers: 120 });
    const session = must(beginWorkoutSession({
      playerId: PLAYER_ID,
      purpose: 'DEFENSE',
      intendedDifficulty: 'VERY_EASY',
      workoutId: 'wk_very_easy_mobility',
      sessionId: 'wses_dup_def',
      now: 1_000,
      gameplayContext: { invasionId: 'inv_17k', startedAtWorldTick: 100 },
    }), 'begin');
    const clock = new AdjustableClock(2_000);
    const completed = must(submitWorkoutFeedback(completeAll(session, clock), 'ABOUT_RIGHT', clock.now()), 'fb');
    const first = runWorkoutRewardPipeline(state, completed, PLAYER_ID, { battle: new BattleEngine() });
    assert.ok(first.ok, first.error?.message);
    assert.strictEqual(state.activeInvasions.size, 0);
    const banked = state.playerRewards.bankedTroops;
    const applied = state.playerRewards.appliedRewards.length;
    const second = runWorkoutRewardPipeline(state, completed, PLAYER_ID, { battle: new BattleEngine() });
    assert.ok(second.ok);
    assert.strictEqual(second.alreadyProcessed, true);
    assert.strictEqual(state.playerRewards.bankedTroops, banked);
    assert.strictEqual(state.playerRewards.appliedRewards.length, applied);
    processInvasionTimeouts(state, new BattleEngine());
    processInvasionTimeouts(state, new BattleEngine());
    assert.strictEqual(state.activeInvasions.size, 0);
  });

  test('public views expose invasion status and remaining time but not attacking armies or battleSeed', () => {
    const state = playerState();
    state.worldTick = 100;
    seedInvasion(state, { id: 'inv_pub' });
    const orch = new Orchestrator(state);
    assert.strictEqual(startDefense(orch, 'inv_pub', 'wses_pub').success, true);
    const res = orch.execute(cmdReq('GET_GAME_STATE', {}));
    const view = res.payload.gameState as {
      playerGameplay?: { activeInvasionsAgainstPlayer: Array<Record<string, unknown>> };
    };
    const inv = view.playerGameplay?.activeInvasionsAgainstPlayer[0];
    assert.ok(inv);
    assert.strictEqual(inv.invasionId, 'inv_pub');
    assert.strictEqual(inv.status, 'defense_in_progress');
    assert.strictEqual(inv.attackerFactionId, OTHER_FACTION);
    assert.strictEqual(inv.territoryId, HOME);
    assert.strictEqual(inv.defenseInProgress, true);
    assert.ok(!('attackingArmyIds' in inv));
    assert.ok(!('battleSeed' in inv));
    assert.ok(!('defenseMobilization' in inv));
  });

  test('invasion records round-trip through JSON and clone isolation', () => {
    const state = playerState();
    state.worldTick = 100;
    seedInvasion(state);
    const orch = new Orchestrator(state);
    assert.strictEqual(startDefense(orch, 'inv_17k').success, true);
    const invasion = orch.getState().activeInvasions.get('inv_17k')!;
    const round = JSON.parse(JSON.stringify({
      ...invasion,
      attackingArmyIds: [...invasion.attackingArmyIds],
    }));
    assert.strictEqual(round.status, 'defense_in_progress');
    assert.strictEqual(round.defenseCompletionDeadlineTick, 100 + defenseWorkoutMaxDurationTicks());
    const live = orch.getState();
    const clone = cloneGameState(live);
    clone.activeInvasions.get('inv_17k')!.status = 'pending_response';
    assert.strictEqual(live.activeInvasions.get('inv_17k')!.status, 'defense_in_progress');
  });

  test('invariants reject impossible invasion combinations', () => {
    const pendingStart = playerState();
    pendingStart.worldTick = 100;
    seedInvasion(pendingStart);
    pendingStart.activeInvasions.get('inv_17k')!.defenseWorkoutStartedAtTick = 100;
    assert.ok(checkGameStateInvariants(pendingStart).some((v) => v.code === 'invasion.pending_has_defense_start'));

    const inProgress = playerState();
    inProgress.worldTick = 100;
    seedInvasion(inProgress, { status: 'defense_in_progress' });
    assert.ok(checkGameStateInvariants(inProgress).some((v) => v.code === 'invasion.missing_defense_start'));

    const staleHold = playerState();
    staleHold.worldTick = 100;
    seedInvasion(staleHold);
    staleHold.activeInvasions.delete('inv_17k');
    assert.ok(checkGameStateInvariants(staleHold).some((v) => v.code === 'army.hold_for_resolved_invasion'));
  });

  test('ABANDON_WORKOUT and RECORD_INTEGRITY_FLAG are catalogued; APPLY_REWARD is not', () => {
    assert.ok(COMMAND_INDEX.some((command) => command.commandId === 'ABANDON_WORKOUT'));
    assert.ok(COMMAND_INDEX.some((command) => command.commandId === 'RECORD_INTEGRITY_FLAG'));
    assert.ok(!COMMAND_INDEX.some((command) => command.commandId === 'APPLY_REWARD'));
  });
}
