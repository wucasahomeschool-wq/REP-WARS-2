import assert from 'assert';
import {
  AdjustableClock,
  COMMAND_INDEX,
  DecisionEngine,
  ErrorCode,
  Orchestrator,
  ScoringHelpers,
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
  defenseResponseTicks,
  failedDefenseContinuationTicks,
  getCurrentExercise,
  isPlayerProtected,
  playerProtectionTicks,
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
  WorkoutDefinition,
  WorkoutPurpose,
  WorkoutSession,
} from '../src';
import { BattleEngine, BattleInput } from '../src/battle/BattleEngine';
import { createDefaultRegistry } from '../src/orchestration';
import { toDecisionEngineSnapshot } from '../src/state';
import { startConstruction, consumeConstructionEffect, collectTerritoryYield } from '../src/gameplay';

export interface GameplayConsumptionTestApi {
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
  return { commandId, playerId, requestId: `${commandId}_17i`, parameters };
}

function playerState(): GameState {
  return createGameState({ seed: 17, playerFactionId: PLAYER_FACTION });
}

function tinyWorkout(): WorkoutDefinition {
  return {
    id: 'wk_17i_tiny',
    name: '17I Tiny',
    description: 'Fixture',
    intendedDifficulty: 'MODERATE',
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

function completedSession(purpose: WorkoutPurpose, sessionId: string, extras: {
  invasionId?: string;
  constructionId?: string;
  collectionTerritoryId?: string;
  startedAtWorldTick?: number;
} = {}): WorkoutSession {
  const clock = new AdjustableClock(1_000);
  let session = must(beginWorkoutSession({
    playerId: PLAYER_ID,
    purpose,
    intendedDifficulty: 'MODERATE',
    workout: tinyWorkout(),
    sessionId,
    now: clock.now(),
    gameplayContext: {
      invasionId: extras.invasionId,
      constructionId: extras.constructionId,
      collectionTerritoryId: extras.collectionTerritoryId,
      startedAtWorldTick: extras.startedAtWorldTick ?? 0,
    },
  }), 'begin');
  session = completeAll(session, clock);
  return must(submitWorkoutFeedback(session, 'ABOUT_RIGHT', clock.now()), 'feedback');
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

function militaryPower(state: GameState, factionId: string): number {
  const faction = state.factions.get(factionId)!;
  const armies = faction.armies.map((id) => state.armies.get(id)!).filter(Boolean);
  const territories = faction.territories.map((id) => state.territories.get(id)!).filter(Boolean);
  return ScoringHelpers.computeTotalMilitaryPower(armies, territories);
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

export function registerGameplayConsumptionTests(api: GameplayConsumptionTestApi): void {
  const { test } = api;

  console.log('Phase 17I — banked Troops attack');

  test('end-to-end NORMAL_TROOPS workout banks Troops', () => {
    const state = playerState();
    const beforePower = militaryPower(state, PLAYER_FACTION);
    const session = completedSession('NORMAL_TROOPS', 'wses_17i_troops');
    const result = runWorkoutRewardPipeline(state, session, PLAYER_ID);
    assert.ok(result.ok, result.error?.message);
    assert.ok(result.state.playerRewards.bankedTroops > 0);
    assert.strictEqual(militaryPower(result.state, PLAYER_FACTION), beforePower);
    assert.ok(result.state.playerFitness.estimate);
    assert.ok(result.state.playerFitness.compactHistory.some((e) => e.sessionId === 'wses_17i_troops'));
    assert.deepStrictEqual(checkGameStateInvariants(result.state), []);
  });

  test('player can commit an exact banked amount; remainder stays banked; battle sees only the commit', () => {
    const battle = new RecordingBattleEngine();
    const reg = createDefaultRegistry();
    reg.registerBattle(battle);
    const state = playerState();
    state.playerRewards.bankedTroops = 500;
    const orch = new Orchestrator(state, reg);
    const res = orch.execute(cmdReq('ATTACK', { territoryId: TARGET, commitAmount: 300, seed: 7 }));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    assert.strictEqual(orch.getState().playerRewards.bankedTroops, 200);
    assert.strictEqual(res.payload.committedTroops, 300);
    assert.strictEqual(battle.inputs.length, 1);
    const troops = battle.inputs[0]!.attackerArmies.reduce((s, a) => s + a.soldiers + a.knights, 0);
    assert.strictEqual(troops, 300);
    const casualties = (res.payload.battleResult as { attackerCasualties?: { total: number } })?.attackerCasualties?.total
      ?? 0;
    assert.ok(casualties <= 300);
  });

  test('uncommitted banked Troops are never sent to BattleEngine', () => {
    const battle = new RecordingBattleEngine();
    const reg = createDefaultRegistry();
    reg.registerBattle(battle);
    const state = playerState();
    state.playerRewards.bankedTroops = 500;
    const orch = new Orchestrator(state, reg);
    orch.execute(cmdReq('ATTACK', { territoryId: TARGET, commitAmount: 300, seed: 7 }));
    const atk = battle.inputs[0]!.attackerArmies;
    assert.ok(atk.every((a) => (a.soldiers + a.knights) <= 300));
    assert.strictEqual(orch.getState().playerRewards.bankedTroops, 200);
  });

  test('failed banked attack does not deduct Troops', () => {
    const state = playerState();
    state.playerRewards.bankedTroops = 500;
    const before = cloneGameState(state);
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('ATTACK', { territoryId: TARGET, commitAmount: 900 }));
    assert.strictEqual(res.success, false);
    assert.strictEqual(orch.getState().playerRewards.bankedTroops, 500);
    assert.deepStrictEqual(orch.getState().playerRewards, before.playerRewards);
  });

  test('Player A cannot spend Player B\'s troops via a foreign factionId', () => {
    const state = playerState();
    state.playerRewards.bankedTroops = 500;
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('ATTACK', {
      territoryId: TARGET,
      commitAmount: 300,
      factionId: OTHER_FACTION,
    }));
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errors[0]!.code, ErrorCode.ACTION_NOT_ALLOWED);
    assert.strictEqual(orch.getState().playerRewards.bankedTroops, 500);
  });

  console.log('Phase 17I — construction and Golden Yield');

  test('construction can start without a workout and a worker effect accelerates it once', () => {
    const state = playerState();
    const orch = new Orchestrator(state);
    const started = orch.execute(cmdReq('START_CONSTRUCTION', { territoryId: HOME, constructionId: 'con_17i' }));
    assert.strictEqual(started.success, true, started.errors[0]?.message);
    const project = orch.getState().constructions.get('con_17i')!;
    assert.strictEqual(project.status, 'in_progress');
    const remainingBefore = project.remainingTicks;

    const session = completedSession('EXTRA_CONSTRUCTION_WORKERS', 'wses_17i_con', { constructionId: 'con_17i' });
    const applied = runWorkoutRewardPipeline(orch.getState(), session, PLAYER_ID);
    assert.ok(applied.ok, applied.error?.message);
    assert.strictEqual(applied.state.playerRewards.pendingConstructionEffects.length, 1);
    assert.strictEqual(applied.state.playerRewards.bankedTroops, 0);

    const after = consumeConstructionEffect(applied.state, {
      factionId: PLAYER_FACTION,
      constructionId: 'con_17i',
      playerId: PLAYER_ID,
    });
    assert.ok(after.remainingTicks < remainingBefore || after.status === 'completed');
    assert.strictEqual(applied.state.playerRewards.pendingConstructionEffects.length, 0);

    assert.throws(() => consumeConstructionEffect(applied.state, {
      factionId: PLAYER_FACTION,
      constructionId: 'con_17i',
      playerId: PLAYER_ID,
    }));
  });

  test('Player A cannot consume Player B\'s construction effect', () => {
    const state = playerState();
    startConstruction(state, { factionId: PLAYER_FACTION, territoryId: HOME, projectId: 'con_b' });
    const session = completedSession('EXTRA_CONSTRUCTION_WORKERS', 'wses_17i_con_b', { constructionId: 'con_b' });
    const applied = runWorkoutRewardPipeline(state, session, PLAYER_ID);
    assert.ok(applied.ok);
    assert.throws(() => consumeConstructionEffect(applied.state, {
      factionId: PLAYER_FACTION,
      constructionId: 'con_b',
      playerId: 'player_2',
    }));
    assert.strictEqual(applied.state.playerRewards.pendingConstructionEffects.length, 1);
  });

  test('Golden Yield enhances one collection and is consumed', () => {
    const state = playerState();
    state.worldTick = 60;
    const base = collectTerritoryYield(cloneGameState(state), {
      factionId: PLAYER_FACTION,
      territoryId: 'iron_spire',
      playerId: PLAYER_ID,
      consumeGoldenYield: false,
    });
    const session = completedSession('GOLDEN_YIELD', 'wses_17i_gy', { collectionTerritoryId: 'iron_spire' });
    const applied = runWorkoutRewardPipeline(state, session, PLAYER_ID);
    assert.ok(applied.ok, applied.error?.message);
    assert.strictEqual(applied.state.playerRewards.pendingGoldenYieldEffects.length, 1);
    const first = collectTerritoryYield(applied.state, {
      factionId: PLAYER_FACTION,
      territoryId: 'iron_spire',
      playerId: PLAYER_ID,
      consumeGoldenYield: true,
    });
    assert.ok(first.multiplier > 1);
    assert.strictEqual(first.collected, Math.floor(first.base * first.multiplier));
    assert.ok(first.collected > base.collected || first.multiplier === 1);
    assert.strictEqual(applied.state.playerRewards.pendingGoldenYieldEffects.length, 0);

    const goldAfterFirst = applied.state.factions.get(PLAYER_FACTION)!.resources.gold;
    const second = collectTerritoryYield(applied.state, {
      factionId: PLAYER_FACTION,
      territoryId: 'iron_spire',
      playerId: PLAYER_ID,
      consumeGoldenYield: false,
    });
    assert.strictEqual(second.multiplier, 1);
    assert.strictEqual(applied.state.factions.get(PLAYER_FACTION)!.resources.gold, goldAfterFirst + second.collected);
  });

  console.log('Phase 17I — invasion, protection, defense');

  test('AI attack against an eligible player creates an ActiveInvasion with a 30-minute window', () => {
    const state = playerState();
    state.worldTick = 2000;
    state.playerFitness.lastWorkoutCompletedAtTick = 0;
    placeArmyOn(state, OTHER_FACTION, TARGET, 900);
    state.commitments.set(OTHER_FACTION, {
      id: 'cmt_inv',
      warlordId: OTHER_FACTION,
      action: 'ATTACK',
      targetId: HOME,
      targetName: HOME,
      status: 'committed',
      createdTurn: 1,
      originatingGoalId: null,
      reason: ['test'],
      priority: 100,
      score: 100,
      confidence: 1,
      personalityBias: 0,
      ambitionInfluence: 0,
      factorBreakdown: [],
      statusReason: null,
    });
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('RESOLVE_COMMITMENT', { factionId: OTHER_FACTION }));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    assert.strictEqual(res.payload.attackOutcome, 'invasion_created');
    const invasion = [...orch.getState().activeInvasions.values()][0]!;
    assert.strictEqual(invasion.defenderFactionId, PLAYER_FACTION);
    assert.strictEqual(invasion.responseDeadlineTick - invasion.notifiedAtTick, defenseResponseTicks());
    assert.strictEqual(orch.getState().territories.get(HOME)!.owner, PLAYER_FACTION);
  });

  test('24-hour protection rejects AI vs player attacks and AI selects another action', () => {
    const state = playerState();
    state.worldTick = 100;
    state.playerFitness.lastWorkoutCompletedAtTick = 100;
    const rel = state.factions.get(OTHER_FACTION)!.diplomacy.get(PLAYER_FACTION);
    if (rel) {
      rel.state = 'at_war';
      rel.opinion = -80;
    }
    assert.ok(isPlayerProtected(state));
    placeArmyOn(state, OTHER_FACTION, TARGET, 900);
    const snapshot = toDecisionEngineSnapshot(state);
    const engine = new DecisionEngine();
    const warlords = buildWarlordStates(state);
    const ws = warlords.get(OTHER_FACTION)!;
    const decision = engine.decide(ws, snapshot, state.turn);
    if (decision.action === 'ATTACK') {
      const target = state.territories.get(decision.targetId ?? '');
      assert.ok(!target || target.owner !== PLAYER_FACTION, 'protected player must not be the attack target');
    }
    assert.ok(canAiAttackPlayer(state, OTHER_FACTION) === false);
  });

  test('defense workout started before the deadline remains valid if completed later', () => {
    const state = playerState();
    state.worldTick = 100;
    placeArmyOn(state, OTHER_FACTION, TARGET, 400);
    const invasion = createActiveInvasion({
      id: 'inv_deadline',
      defenderFactionId: PLAYER_FACTION,
      attackerFactionId: OTHER_FACTION,
      territoryId: HOME,
      startedAtTick: 100,
      notifiedAtTick: 100,
      responseDeadlineTick: 130,
      attackingArmyIds: [[...state.armies.values()].find((a) => a.owner === OTHER_FACTION)!.id],
      battleSeed: 1,
    });
    state.activeInvasions.set(invasion.id, invasion);
    const orch = new Orchestrator(state);
    const start = orch.execute(cmdReq('START_WORKOUT', {
      purpose: 'DEFENSE',
      workoutId: 'wk_very_easy_mobility',
      invasionId: 'inv_deadline',
      sessionId: 'wses_def_ok',
      now: 1_000,
    }));
    assert.strictEqual(start.success, true, start.errors[0]?.message);
    orch.getState().worldTick = 200;
    const session = orch.getState().playerFitness.activeSession!;
    const clock = new AdjustableClock(2_000);
    let cur = session;
    cur = completeAll(cur, clock);
    cur = must(submitWorkoutFeedback(cur, 'ABOUT_RIGHT', clock.now()), 'fb');
    orch.getState().playerFitness.activeSession = cur;
    const fin = orch.execute(cmdReq('FINALIZE_WORKOUT', { now: clock.now() }));
    assert.strictEqual(fin.success, true, fin.errors[0]?.message);
    assert.ok(fin.payload.invasionOutcome === 'defense_success' || fin.payload.invasionOutcome === 'defense_failure');
    assert.strictEqual(orch.getState().activeInvasions.size, 0);
  });

  test('defense workout started after the deadline is invalid', () => {
    const state = playerState();
    state.worldTick = 200;
    const invasion = createActiveInvasion({
      id: 'inv_late',
      defenderFactionId: PLAYER_FACTION,
      attackerFactionId: OTHER_FACTION,
      territoryId: HOME,
      startedAtTick: 100,
      notifiedAtTick: 100,
      responseDeadlineTick: 130,
      attackingArmyIds: [],
    });
    state.activeInvasions.set(invasion.id, invasion);
    const orch = new Orchestrator(state);
    const start = orch.execute(cmdReq('START_WORKOUT', {
      purpose: 'DEFENSE',
      workoutId: 'wk_very_easy_mobility',
      invasionId: 'inv_late',
      now: 1_000,
    }));
    assert.strictEqual(start.success, false);
    assert.strictEqual(start.errors[0]!.code, ErrorCode.ACTION_NOT_ALLOWED);
    assert.strictEqual(orch.getState().playerFitness.activeSession, null);
  });

  test('successful defense retains territory, consumes mobilization, and applies ≥48h recovery', () => {
    const state = playerState();
    state.worldTick = 50;
    placeArmyOn(state, OTHER_FACTION, TARGET, 120);
    const attackerArmy = [...state.armies.values()].find((a) => a.owner === OTHER_FACTION)!;
    const invasion = createActiveInvasion({
      id: 'inv_win',
      defenderFactionId: PLAYER_FACTION,
      attackerFactionId: OTHER_FACTION,
      territoryId: HOME,
      startedAtTick: 40,
      notifiedAtTick: 40,
      responseDeadlineTick: 70,
      attackingArmyIds: [attackerArmy.id],
      battleSeed: 3,
    });
    state.activeInvasions.set(invasion.id, invasion);
    const physical: PhysicalResult = {
      modelVersion: 'physical-result.v1',
      outputVersion: 'physical-output.v1',
      playerId: PLAYER_ID,
      sessionId: 'wses_def_win',
      workoutId: 'wk_17i_tiny',
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
    const converted = convertGameReward({ physicalResult: physical });
    assert.ok(converted.ok);
    const applied = applyGameReward(state, converted.value, {
      playerId: PLAYER_ID,
      mode: 'live',
      invasionId: 'inv_win',
      workoutStartedAtTick: 45,
    });
    assert.ok(applied.ok);
    const resolved = resolveInvasionBattle(applied.state, new BattleEngine(), 'inv_win');
    assert.strictEqual(resolved.payload.invasionOutcome, 'defense_success');
    assert.strictEqual(applied.state.territories.get(HOME)!.owner, PLAYER_FACTION);
    assert.strictEqual(applied.state.activeInvasions.size, 0);
    const recovery = applied.state.attackerCooldowns.get(OTHER_FACTION)?.recoveryUntilTick;
    assert.ok(recovery !== null && recovery !== undefined);
    assert.ok(recovery - applied.state.worldTick >= successfulDefenseRecoveryTicks());
    assert.ok(recovery - applied.state.worldTick >= playerProtectionTicks());
    assert.ok(!canAiAttackPlayer(applied.state, OTHER_FACTION));
  });

  test('failed defense transfers according to battle and applies continuation delay', () => {
    const state = playerState();
    state.worldTick = 80;
    state.territories.get(HOME)!.garrison = 1;
    placeArmyOn(state, OTHER_FACTION, TARGET, 5000);
    const attackerArmy = [...state.armies.values()].find((a) => a.owner === OTHER_FACTION)!;
    const invasion = createActiveInvasion({
      id: 'inv_lose',
      defenderFactionId: PLAYER_FACTION,
      attackerFactionId: OTHER_FACTION,
      territoryId: HOME,
      startedAtTick: 50,
      notifiedAtTick: 50,
      responseDeadlineTick: 80,
      attackingArmyIds: [attackerArmy.id],
      battleSeed: 9,
    });
    state.activeInvasions.set(invasion.id, invasion);
    const resolved = resolveInvasionBattle(state, new BattleEngine(), 'inv_lose');
    assert.strictEqual(resolved.payload.invasionOutcome, 'defense_failure');
    assert.strictEqual(state.territories.get(HOME)!.owner, OTHER_FACTION);
    assert.strictEqual(state.activeInvasions.size, 0);
    const cont = state.attackerCooldowns.get(OTHER_FACTION)?.continuationUntilTick;
    assert.ok(cont !== null && cont !== undefined);
    assert.strictEqual(cont - state.worldTick, failedDefenseContinuationTicks());
    assert.ok(!canAiAttackPlayer(state, OTHER_FACTION));
  });

  test('duplicate workout completion does not double-grant rewards', () => {
    const state = playerState();
    const session = completedSession('NORMAL_TROOPS', 'wses_dup');
    const first = runWorkoutRewardPipeline(state, session, PLAYER_ID);
    assert.ok(first.ok);
    const banked = first.state.playerRewards.bankedTroops;
    const second = runWorkoutRewardPipeline(first.state, session, PLAYER_ID);
    assert.ok(second.ok);
    assert.strictEqual(second.alreadyProcessed, true);
    assert.strictEqual(second.state.playerRewards.bankedTroops, banked);
    assert.strictEqual(second.state.playerRewards.appliedRewards.length, 1);
  });

  test('public views expose player banked Troops but not hidden enemy invasion details', () => {
    const state = playerState();
    state.playerRewards.bankedTroops = 40;
    state.activeInvasions.set('inv_pub', createActiveInvasion({
      id: 'inv_pub',
      defenderFactionId: PLAYER_FACTION,
      attackerFactionId: OTHER_FACTION,
      territoryId: HOME,
      startedAtTick: 1,
      notifiedAtTick: 1,
      responseDeadlineTick: 31,
      attackingArmyIds: ['secret_army'],
      battleSeed: 99,
    }));
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('GET_GAME_STATE', {}));
    assert.strictEqual(res.success, true);
    const view = res.payload.gameState as {
      playerGameplay?: {
        bankedTroops: number;
        activeInvasionsAgainstPlayer: Array<Record<string, unknown>>;
      };
    };
    assert.strictEqual(view.playerGameplay?.bankedTroops, 40);
    const inv = view.playerGameplay?.activeInvasionsAgainstPlayer[0];
    assert.ok(inv);
    assert.strictEqual(inv.invasionId, 'inv_pub');
    assert.ok(!('attackingArmyIds' in inv));
    assert.ok(!('battleSeed' in inv));
    assert.ok(!('playerRewards' in view));
  });

  test('there is still no client APPLY_REWARD command', () => {
    assert.ok(!COMMAND_INDEX.some((command) => command.commandId === 'APPLY_REWARD'));
    assert.ok(COMMAND_INDEX.some((command) => command.commandId === 'FINALIZE_WORKOUT'));
  });

  test('paused player cannot receive a new invasion', () => {
    const state = playerState();
    state.worldTick = 3000;
    state.playerFitness.lastWorkoutCompletedAtTick = 0;
    state.playerEmpirePause.paused = true;
    state.playerEmpirePause.pausedAtTick = 3000;
    placeArmyOn(state, OTHER_FACTION, TARGET, 900);
    state.commitments.set(OTHER_FACTION, {
      id: 'cmt_pause',
      warlordId: OTHER_FACTION,
      action: 'ATTACK',
      targetId: HOME,
      targetName: HOME,
      status: 'committed',
      createdTurn: 1,
      originatingGoalId: null,
      reason: ['test'],
      priority: 100,
      score: 100,
      confidence: 1,
      personalityBias: 0,
      ambitionInfluence: 0,
      factorBreakdown: [],
      statusReason: null,
    });
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('RESOLVE_COMMITMENT', { factionId: OTHER_FACTION }));
    assert.strictEqual(res.success, false);
    assert.strictEqual(orch.getState().activeInvasions.size, 0);
  });
}
