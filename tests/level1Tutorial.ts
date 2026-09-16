import assert from 'assert';
import {
  ErrorCode,
  FixedWorldTimeAuthority,
  GAME_STATE_SCHEMA_VERSION,
  InMemoryGameStateStore,
  InMemoryWorkoutHistoryStore,
  Orchestrator,
  PRODUCTION_LEVEL_1_WORLD_ID,
  checkGameStateInvariants,
  cloneGameState,
  commitAuthoritativePlayerWorld,
  createGameState,
  createTelemetryRecorder,
  evaluateWorldCompletion,
  getCurrentExercise,
  hydratePersistedPayload,
  initializePlayerWorld,
  snapshotGameState,
  syncPlayerWorld,
} from '../src';
import type { CommandRequest, Level1TutorialPublicView } from '../src';
import { MIN_ATTACKING_TROOPS } from '../src/army/strategicAttack';
import { LEVEL1_SCRIPTED_RAID_TROOPS } from '../src/gameplay/tutorial/level1';

export interface Level1TutorialTestApi {
  test: (name: string, fn: () => void) => void;
}

const PLAYER_ID = 'player_tutorial';
const PLAYER_HOME = 't_02';
const FIRST_ENEMY = 't_01';
const FINAL_ENEMY = 't_03';
const WORKOUT_ID = 'wk_moderate_full_body';

function cmd(commandId: string, parameters: Record<string, unknown> = {}, requestId?: string): CommandRequest {
  return {
    commandId,
    playerId: PLAYER_ID,
    requestId: requestId ?? `${commandId}_${PLAYER_ID}_${Math.random().toString(36).slice(2, 8)}`,
    parameters,
  };
}

function tutorialOf(orch: Orchestrator): Level1TutorialPublicView {
  const res = orch.execute(cmd('GET_GAME_STATE'));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  return (res.payload.gameState as { tutorial: Level1TutorialPublicView }).tutorial;
}

function finishActiveWorkout(orch: Orchestrator, now = 2_000): void {
  let clock = now;
  while (orch.getState().playerFitness.activeSession?.state === 'ACTIVE') {
    const session = orch.getState().playerFitness.activeSession!;
    const step = getCurrentExercise(session);
    assert.ok(step, 'expected current exercise');
    clock += 1_000;
    if (step.skippable && step.exerciseType === 'REST') {
      const skipped = orch.execute(cmd('SKIP_REST', { order: step.order, now: clock }, `skip_${step.order}_${clock}`));
      assert.strictEqual(skipped.success, true, skipped.errors[0]?.message);
      continue;
    }
    const parameters: Record<string, unknown> = { order: step.order, now: clock };
    if (step.prescription.kind === 'repetitions') {
      parameters.repetitions = step.prescription.repetitions;
    } else {
      parameters.durationSeconds = step.prescription.durationSeconds;
    }
    const recorded = orch.execute(cmd('RECORD_EXERCISE', parameters, `ex_${step.order}_${clock}`));
    assert.strictEqual(recorded.success, true, recorded.errors[0]?.message);
  }
}

function completeTroopsWorkout(orch: Orchestrator, sessionId: string, now: number): void {
  const started = orch.execute(cmd('START_WORKOUT', {
    purpose: 'NORMAL_TROOPS',
    sessionId,
    now,
  }, `${sessionId}_start`));
  assert.strictEqual(started.success, true, started.errors[0]?.message);
  finishActiveWorkout(orch, now + 1_000);
  assert.strictEqual(orch.execute(cmd('SUBMIT_WORKOUT_FEEDBACK', { value: 'ABOUT_RIGHT', now: now + 10_000 }, `${sessionId}_fb`)).success, true);
  const finalized = orch.execute(cmd('FINALIZE_WORKOUT', { now: now + 11_000 }, `${sessionId}_fin`));
  assert.strictEqual(finalized.success, true, finalized.errors[0]?.message);
}

function completeDefenseWorkout(orch: Orchestrator, invasionId: string, sessionId: string, now: number): void {
  const started = orch.execute(cmd('START_WORKOUT', {
    purpose: 'DEFENSE',
    invasionId,
    sessionId,
    now,
  }, `${sessionId}_start`));
  assert.strictEqual(started.success, true, started.errors[0]?.message);
  finishActiveWorkout(orch, now + 1_000);
  assert.strictEqual(orch.execute(cmd('SUBMIT_WORKOUT_FEEDBACK', { value: 'ABOUT_RIGHT', now: now + 10_000 }, `${sessionId}_fb`)).success, true);
  const finalized = orch.execute(cmd('FINALIZE_WORKOUT', { now: now + 11_000 }, `${sessionId}_fin`));
  assert.strictEqual(finalized.success, true, finalized.errors[0]?.message);
}

export function registerLevel1TutorialTests(api: Level1TutorialTestApi): void {
  const { test } = api;

  console.log('Level 1 tutorial controller');

  test('fresh Level 1 starts at FIRST_WORKOUT_PENDING and spectator worlds stay inactive', () => {
    const state = createGameState({ seed: 1 });
    assert.strictEqual(state.definitionWorldId, PRODUCTION_LEVEL_1_WORLD_ID);
    assert.ok(state.level1Tutorial);
    assert.strictEqual(state.level1Tutorial!.beat, 'FIRST_WORKOUT_PENDING');
    assert.strictEqual(state.level1Tutorial!.active, true);
    assert.strictEqual(state.level1Tutorial!.scriptedInvasionId, null);
    const orch = new Orchestrator(state);
    const view = tutorialOf(orch);
    assert.strictEqual(view.beat, 'FIRST_WORKOUT_PENDING');
    assert.strictEqual(view.expectedAction, 'START_WORKOUT_NORMAL_TROOPS');
    assert.strictEqual(view.expectedPurpose, 'NORMAL_TROOPS');
    assert.strictEqual(view.expectedWorkoutId, WORKOUT_ID);
    assert.strictEqual(view.nextActionAllowed, true);
    assert.strictEqual(view.scriptedInvasionOccurred, false);

    const spectator = createGameState({ seed: 2, playerFactionId: null });
    assert.strictEqual(spectator.level1Tutorial, null);
  });

  test('ATTACK is gated until the first workout, then first attack advances into the scripted raid', () => {
    const recorder = createTelemetryRecorder();
    const orch = new Orchestrator(initializePlayerWorld({ playerId: PLAYER_ID, seed: 3 }).state, undefined, recorder);
    const blocked = orch.execute(cmd('ATTACK', { territoryId: FIRST_ENEMY, commitAmount: 120, seed: 1 }, 'atk_early'));
    assert.strictEqual(blocked.success, false);
    assert.strictEqual(blocked.errors[0]?.code, ErrorCode.ACTION_NOT_ALLOWED);

    completeTroopsWorkout(orch, 'wses_first', 1_000);
    assert.ok(orch.getState().playerRewards.bankedTroops > MIN_ATTACKING_TROOPS);
    assert.strictEqual(tutorialOf(orch).beat, 'FIRST_ATTACK_AVAILABLE');
    assert.strictEqual(tutorialOf(orch).expectedAction, 'ATTACK');
    assert.deepStrictEqual(tutorialOf(orch).firstAttackTerritoryIds, [FIRST_ENEMY]);

    const extraWorkout = orch.execute(cmd('START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      workoutId: WORKOUT_ID,
      sessionId: 'wses_extra',
      now: 20_000,
    }, 'wk_extra'));
    assert.strictEqual(extraWorkout.success, false);

    const homeRaid = orch.execute(cmd('ATTACK', {
      territoryId: FINAL_ENEMY,
      commitAmount: MIN_ATTACKING_TROOPS + 20,
      seed: 2,
    }, 'atk_home'));
    assert.strictEqual(homeRaid.success, false);
    assert.strictEqual(homeRaid.errors[0]?.code, ErrorCode.INVALID_TARGET);

    const troops = orch.getState().playerRewards.bankedTroops;
    const first = orch.execute(cmd('ATTACK', {
      territoryId: FIRST_ENEMY,
      commitAmount: Math.min(troops, MIN_ATTACKING_TROOPS + 20),
      seed: 3,
    }, 'atk_first'));
    assert.strictEqual(first.success, true, first.errors[0]?.message);
    const view = first.payload.tutorial as Level1TutorialPublicView;
    assert.strictEqual(view.beat, 'DEFENSE_PENDING');
    assert.strictEqual(view.expectedAction, 'START_WORKOUT_DEFENSE');
    assert.strictEqual(view.expectedPurpose, 'DEFENSE');
    assert.strictEqual(view.expectedWorkoutId, WORKOUT_ID);
    assert.strictEqual(view.scriptedInvasionOccurred, true);
    assert.strictEqual(view.scriptedInvasionTargetId, FIRST_ENEMY);
    assert.strictEqual(orch.getState().activeInvasions.size, 1);
    const invasion = [...orch.getState().activeInvasions.values()][0]!;
    assert.strictEqual(invasion.territoryId, FIRST_ENEMY);
    assert.strictEqual(invasion.attackerFactionId, 'f_ai_01');
    const raidTroops = invasion.attackingArmyIds.reduce((sum, id) => {
      const army = orch.getState().armies.get(id);
      return sum + (army ? army.soldiers + army.knights + army.siegeEngines : 0);
    }, 0);
    assert.strictEqual(raidTroops, LEVEL1_SCRIPTED_RAID_TROOPS);
    assert.ok(recorder.getEvents().some((e) => e.eventType === 'tutorial.scripted_invasion'));
    assert.ok(recorder.getEvents().some((e) => e.eventType === 'invasion.started'));
  });

  test('ordinary AI cannot replace the scripted enemy attack, and the raid is idempotent', () => {
    const orch = new Orchestrator(initializePlayerWorld({ playerId: PLAYER_ID, seed: 4 }).state);
    completeTroopsWorkout(orch, 'wses_ai', 1_000);
    const beforeAttack = cloneGameState(orch.getState());
    const advanced = orch.execute(cmd('ADVANCE_WORLD', { elapsedTicks: 40 }, 'ai_pre'));
    assert.strictEqual(advanced.success, true, advanced.errors[0]?.message);
    assert.strictEqual(orch.getState().territories.get(PLAYER_HOME)?.owner, 'f_player');
    assert.strictEqual(orch.getState().territories.get(FIRST_ENEMY)?.owner, 'f_ai_01');
    assert.strictEqual(orch.getState().activeInvasions.size, 0);
    assert.strictEqual(tutorialOf(orch).beat, 'FIRST_ATTACK_AVAILABLE');
    const decide = orch.execute(cmd('AI_DECIDE', { warlordId: 'f_ai_01' }, 'ai_decide'));
    assert.strictEqual(decide.success, true);
    assert.strictEqual(decide.payload.tutorialAiSuppressed, true);
    assert.strictEqual(orch.getState().commitments.get('f_ai_01'), beforeAttack.commitments.get('f_ai_01'));

    const troops = orch.getState().playerRewards.bankedTroops;
    assert.strictEqual(orch.execute(cmd('ATTACK', {
      territoryId: FIRST_ENEMY,
      commitAmount: Math.min(troops, MIN_ATTACKING_TROOPS + 20),
      seed: 5,
    }, 'atk_script')).success, true);
    const invasionId = orch.getState().level1Tutorial!.scriptedInvasionId;
    assert.ok(invasionId);
    const again = orch.execute(cmd('ADVANCE_WORLD', { elapsedTicks: 4 }, 'ai_post'));
    assert.strictEqual(again.success, true, again.errors[0]?.message);
    assert.strictEqual(orch.getState().activeInvasions.size, 1);
    assert.strictEqual(orch.getState().level1Tutorial!.scriptedInvasionId, invasionId);
    assert.strictEqual(orch.getState().territories.get(FINAL_ENEMY)?.owner, 'f_ai_01');
  });

  test('defense workout is the only path out of DEFENSE_PENDING and repeated commands do not duplicate the raid', () => {
    const orch = new Orchestrator(initializePlayerWorld({ playerId: PLAYER_ID, seed: 5 }).state);
    completeTroopsWorkout(orch, 'wses_d1', 1_000);
    const troops = orch.getState().playerRewards.bankedTroops;
    assert.strictEqual(orch.execute(cmd('ATTACK', {
      territoryId: FIRST_ENEMY,
      commitAmount: Math.min(troops, MIN_ATTACKING_TROOPS + 20),
      seed: 6,
    }, 'atk_d')).success, true);
    const invasionId = [...orch.getState().activeInvasions.keys()][0]!;
    const troopsDuringDefense = orch.execute(cmd('START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      workoutId: WORKOUT_ID,
      sessionId: 'wses_blocked',
      now: 30_000,
    }, 'wk_blocked'));
    assert.strictEqual(troopsDuringDefense.success, false);
    completeDefenseWorkout(orch, invasionId, 'wses_def', 31_000);
    assert.strictEqual(orch.getState().activeInvasions.size, 0);
    assert.strictEqual(orch.getState().territories.get(FIRST_ENEMY)?.owner, 'f_player');
    assert.strictEqual(tutorialOf(orch).beat, 'FINAL_WORKOUT_PENDING');
    assert.strictEqual(orch.getState().level1Tutorial!.defenseResolved, true);
    assert.strictEqual(orch.getState().level1Tutorial!.scriptedInvasionId, invasionId);

    const replay = orch.execute(cmd('ADVANCE_WORLD', { elapsedTicks: 2 }, 'no_replay'));
    assert.strictEqual(replay.success, true);
    assert.strictEqual(orch.getState().activeInvasions.size, 0);
    assert.strictEqual(orch.getState().level1Tutorial!.scriptedInvasionId, invasionId);
  });

  test('save/load preserves the tutorial beat and catch-up does not replay the scripted invasion', () => {
    const store = new InMemoryGameStateStore();
    const history = new InMemoryWorkoutHistoryStore();
    const created = initializePlayerWorld({ playerId: PLAYER_ID, seed: 6, store });
    const orch = new Orchestrator(created.state);
    completeTroopsWorkout(orch, 'wses_persist', 1_000);
    const troops = orch.getState().playerRewards.bankedTroops;
    assert.strictEqual(orch.execute(cmd('ATTACK', {
      territoryId: FIRST_ENEMY,
      commitAmount: Math.min(troops, MIN_ATTACKING_TROOPS + 20),
      seed: 7,
    }, 'atk_p')).success, true);
    const invasionId = orch.getState().level1Tutorial!.scriptedInvasionId;
    const banked = orch.getState().playerRewards.bankedTroops;
    const saved = commitAuthoritativePlayerWorld({
      gameStore: store,
      historyStore: history,
      playerId: PLAYER_ID,
      expectedVersion: created.record?.stateVersion ?? 0,
      state: orch.getState(),
    });
    assert.strictEqual(saved.ok, true);

    const loaded = hydratePersistedPayload(snapshotGameState(orch.getState()));
    assert.strictEqual(loaded.schemaVersion, GAME_STATE_SCHEMA_VERSION);
    assert.strictEqual(loaded.level1Tutorial?.beat, 'DEFENSE_PENDING');
    assert.strictEqual(loaded.level1Tutorial?.scriptedInvasionId, invasionId);
    assert.strictEqual(loaded.playerRewards.bankedTroops, banked);

    const currentTick = orch.getState().worldTick;
    const synced = syncPlayerWorld({
      playerId: PLAYER_ID,
      requestedTick: currentTick + 5,
      authority: new FixedWorldTimeAuthority(currentTick + 5),
      store,
    });
    assert.strictEqual(synced.ok, true, synced.ok ? '' : synced.message);
    if (!synced.ok) return;
    assert.strictEqual(synced.state.level1Tutorial?.scriptedInvasionId, invasionId);
    assert.strictEqual(synced.state.activeInvasions.size, 1);
    assert.strictEqual(synced.state.level1Tutorial?.beat, 'DEFENSE_PENDING');
    assert.strictEqual(synced.state.playerRewards.bankedTroops, banked);
  });

  test('schema 11 Level 1 snapshots hydrate onto schema 12 without replaying a completed world', () => {
    const state = createGameState({ seed: 8 });
    for (const tile of state.territories.values()) tile.owner = 'f_player';
    for (const faction of state.factions.values()) {
      faction.territories = [...state.territories.values()]
        .filter((tile) => tile.owner === faction.id)
        .map((tile) => tile.id)
        .sort();
    }
    state.level1Tutorial = null;
    const snap = snapshotGameState(state) as Record<string, unknown>;
    snap.schemaVersion = 11;
    delete snap.level1Tutorial;
    const loaded = hydratePersistedPayload(snap);
    assert.strictEqual(loaded.schemaVersion, 12);
    assert.strictEqual(loaded.level1Tutorial?.completed, true);
    assert.strictEqual(evaluateWorldCompletion(loaded)?.complete, true);
  });

  test('final workout and attack complete Level 1 through the controller', () => {
    const orch = new Orchestrator(initializePlayerWorld({ playerId: PLAYER_ID, seed: 9 }).state);
    completeTroopsWorkout(orch, 'wses_end1', 1_000);
    const firstTroops = orch.getState().playerRewards.bankedTroops;
    assert.strictEqual(orch.execute(cmd('ATTACK', {
      territoryId: FIRST_ENEMY,
      commitAmount: Math.min(firstTroops, MIN_ATTACKING_TROOPS + 20),
      seed: 8,
    }, 'atk_end1')).success, true);
    const invasionId = [...orch.getState().activeInvasions.keys()][0]!;
    completeDefenseWorkout(orch, invasionId, 'wses_end_def', 40_000);
    completeTroopsWorkout(orch, 'wses_end2', 50_000);
    assert.strictEqual(tutorialOf(orch).beat, 'FINAL_ATTACK_AVAILABLE');
    const banked = orch.getState().playerRewards.bankedTroops;
    const finalAttack = orch.execute(cmd('ATTACK', {
      territoryId: FINAL_ENEMY,
      commitAmount: banked,
      seed: 9,
    }, 'atk_end2'));
    assert.strictEqual(finalAttack.success, true, finalAttack.errors[0]?.message);
    assert.strictEqual(orch.getState().territories.get(FINAL_ENEMY)?.owner, 'f_player');
    assert.ok(evaluateWorldCompletion(orch.getState())?.complete);
    assert.strictEqual(tutorialOf(orch).beat, 'COMPLETE');
    assert.strictEqual(tutorialOf(orch).completed, true);
    assert.strictEqual(tutorialOf(orch).active, false);
    assert.deepStrictEqual(checkGameStateInvariants(orch.getState()), []);

    const after = orch.execute(cmd('ADVANCE_WORLD', { elapsedTicks: 8 }, 'post_complete'));
    assert.strictEqual(after.success, true);
    assert.strictEqual(orch.getState().activeInvasions.size, 0);
    assert.strictEqual(orch.getState().level1Tutorial?.scriptedInvasionId, invasionId);
  });

  test('Level 1 first workout finalizes without feedback, awards Troops, and advances the tutorial', () => {
    const orch = new Orchestrator(initializePlayerWorld({ playerId: PLAYER_ID, seed: 11 }).state);
    const started = orch.execute(cmd('START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      sessionId: 'wses_first_nofb',
      now: 1_000,
    }, 'first_nofb_start'));
    assert.strictEqual(started.success, true, started.errors[0]?.message);
    finishActiveWorkout(orch, 2_000);
    const session = orch.getState().playerFitness.activeSession!;
    assert.strictEqual(session.state, 'COMPLETED');
    assert.strictEqual(session.feedbackState, 'NOT_APPLICABLE');
    assert.strictEqual(session.feedback, null);

    const deniedFeedbackPath = orch.execute(cmd('FINALIZE_WORKOUT', { now: 11_000 }, 'first_nofb_fin'));
    assert.strictEqual(deniedFeedbackPath.success, true, deniedFeedbackPath.errors[0]?.message);
    assert.ok(orch.getState().playerRewards.bankedTroops > MIN_ATTACKING_TROOPS);
    assert.strictEqual(tutorialOf(orch).beat, 'FIRST_ATTACK_AVAILABLE');
    assert.strictEqual(orch.getState().level1Tutorial?.firstWorkoutSessionId, 'wses_first_nofb');
    assert.strictEqual(orch.getState().playerFitness.activeSession, null);
  });

  test('later Level 1 troops workouts still require SUBMIT_WORKOUT_FEEDBACK', () => {
    const orch = new Orchestrator(initializePlayerWorld({ playerId: PLAYER_ID, seed: 12 }).state);
    completeTroopsWorkout(orch, 'wses_later_first', 1_000);
    const firstTroops = orch.getState().playerRewards.bankedTroops;
    assert.strictEqual(orch.execute(cmd('ATTACK', {
      territoryId: FIRST_ENEMY,
      commitAmount: Math.min(firstTroops, MIN_ATTACKING_TROOPS + 20),
      seed: 12,
    }, 'atk_later')).success, true);
    const invasionId = [...orch.getState().activeInvasions.keys()][0]!;
    completeDefenseWorkout(orch, invasionId, 'wses_later_def', 40_000);
    assert.strictEqual(tutorialOf(orch).beat, 'FINAL_WORKOUT_PENDING');

    const started = orch.execute(cmd('START_WORKOUT', {
      purpose: 'NORMAL_TROOPS',
      sessionId: 'wses_later_second',
      now: 50_000,
    }, 'later_start'));
    assert.strictEqual(started.success, true, started.errors[0]?.message);
    finishActiveWorkout(orch, 51_000);
    const session = orch.getState().playerFitness.activeSession!;
    assert.strictEqual(session.state, 'COMPLETED');
    assert.strictEqual(session.feedbackState, 'FEEDBACK_REQUIRED');
    const withoutFeedback = orch.execute(cmd('FINALIZE_WORKOUT', { now: 60_000 }, 'later_fin_denied'));
    assert.strictEqual(withoutFeedback.success, false);
    assert.strictEqual(withoutFeedback.errors[0]?.code, ErrorCode.WORKOUT_SESSION_INVALID);
    assert.strictEqual(orch.getState().playerFitness.activeSession?.state, 'COMPLETED');

    assert.strictEqual(orch.execute(cmd('SUBMIT_WORKOUT_FEEDBACK', { value: 'ABOUT_RIGHT', now: 61_000 }, 'later_fb')).success, true);
    const finalized = orch.execute(cmd('FINALIZE_WORKOUT', { now: 62_000 }, 'later_fin'));
    assert.strictEqual(finalized.success, true, finalized.errors[0]?.message);
    assert.strictEqual(tutorialOf(orch).beat, 'FINAL_ATTACK_AVAILABLE');
  });
}
