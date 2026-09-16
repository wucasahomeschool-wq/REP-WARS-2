import assert from 'assert';
import {
  COMMAND_INDEX,
  ErrorCode,
  IsolatedTelemetryRecorder,
  InMemoryGameStateStore,
  Orchestrator,
  cloneGameState,
  createLegacySampleMapGameState,
  getCurrentExercise,
  hydratePersistedPayload,
  snapshotGameState,
} from '../src';
import type { CommandRequest, GameState } from '../src';

export interface WorkoutPauseResumeTestApi {
  test: (name: string, fn: () => void) => void;
}

const PLAYER_ID = 'player_pause';
const PLAYER_FACTION = 'iron_kingdom';
const WORKOUT_ID = 'wk_very_easy_mobility';

function cmd(commandId: string, parameters: Record<string, unknown> = {}, requestId?: string): CommandRequest {
  return {
    commandId,
    playerId: PLAYER_ID,
    requestId: requestId ?? `${commandId}_${PLAYER_ID}`,
    parameters,
  };
}

function freshState(seed = 21): GameState {
  return createLegacySampleMapGameState({ seed, playerFactionId: PLAYER_FACTION });
}

function startMobility(orch: Orchestrator, sessionId: string, now: number): void {
  const started = orch.execute(cmd('START_WORKOUT', {
    purpose: 'NORMAL_TROOPS',
    workoutId: WORKOUT_ID,
    sessionId,
    now,
  }, `${sessionId}_start`));
  assert.strictEqual(started.success, true, started.errors[0]?.message);
  assert.strictEqual(orch.getState().playerFitness.activeSession?.state, 'ACTIVE');
}

function finishActiveWorkout(orch: Orchestrator, now: number): number {
  let clock = now;
  while (orch.getState().playerFitness.activeSession?.state === 'ACTIVE') {
    const session = orch.getState().playerFitness.activeSession!;
    const step = getCurrentExercise(session);
    assert.ok(step, 'expected current exercise');
    clock += 1_000;
    if (step.skippable && step.exerciseType === 'REST') {
      const skipped = orch.execute(cmd('SKIP_REST', { order: step.order, now: clock }, `skip_${step.order}`));
      assert.strictEqual(skipped.success, true, skipped.errors[0]?.message);
      continue;
    }
    const parameters: Record<string, unknown> = { order: step.order, now: clock };
    if (step.prescription.kind === 'repetitions') {
      parameters.repetitions = step.prescription.repetitions;
    } else {
      parameters.durationSeconds = step.prescription.durationSeconds;
    }
    const recorded = orch.execute(cmd('RECORD_EXERCISE', parameters, `ex_${step.order}`));
    assert.strictEqual(recorded.success, true, recorded.errors[0]?.message);
  }
  return clock;
}

function reloadState(state: GameState): GameState {
  const store = new InMemoryGameStateStore();
  const saved = store.save(PLAYER_ID, state, 0);
  assert.ok(saved.ok, saved.ok ? '' : saved.message);
  const loaded = store.load(PLAYER_ID);
  assert.ok(loaded.ok, loaded.ok ? '' : loaded.message);
  return hydratePersistedPayload(snapshotGameState(loaded.state));
}

export function registerWorkoutPauseResumeTests(api: WorkoutPauseResumeTestApi): void {
  const { test } = api;

  console.log('Authoritative workout pause / resume');

  test('PAUSE_WORKOUT and RESUME_WORKOUT are in the command catalog', () => {
    const pause = COMMAND_INDEX.find((c) => c.commandId === 'PAUSE_WORKOUT');
    const resume = COMMAND_INDEX.find((c) => c.commandId === 'RESUME_WORKOUT');
    assert.ok(pause);
    assert.ok(resume);
    assert.strictEqual(pause!.status, 'implemented');
    assert.strictEqual(resume!.status, 'implemented');
    assert.strictEqual(pause!.changesState, true);
    assert.strictEqual(resume!.changesState, true);
  });

  test('start → pause → resume → complete excludes paused time', () => {
    const recorder = new IsolatedTelemetryRecorder();
    const orch = new Orchestrator(freshState(1), undefined, recorder);
    startMobility(orch, 'wses_pause_ok', 1_000);
    const paused = orch.execute(cmd('PAUSE_WORKOUT', { now: 2_000 }, 'pause_ok'));
    assert.strictEqual(paused.success, true, paused.errors[0]?.message);
    assert.strictEqual(orch.getState().playerFitness.activeSession?.state, 'PAUSED');
    assert.strictEqual(orch.getState().playerFitness.activeSession?.pauseCount, 1);

    const resumed = orch.execute(cmd('RESUME_WORKOUT', { now: 12_000 }, 'resume_ok'));
    assert.strictEqual(resumed.success, true, resumed.errors[0]?.message);
    assert.strictEqual(orch.getState().playerFitness.activeSession?.state, 'ACTIVE');

    const doneAt = finishActiveWorkout(orch, 13_000);
    const session = orch.getState().playerFitness.activeSession!;
    assert.strictEqual(session.state, 'COMPLETED');
    const first = session.performances[0];
    assert.ok(first);
    assert.ok((first.activeDurationMs ?? 0) < 12_000, `paused interval must not count as active duration, got ${first.activeDurationMs}`);
    assert.ok((first.activeDurationMs ?? 0) >= 1_000);

    assert.strictEqual(orch.execute(cmd('SUBMIT_WORKOUT_FEEDBACK', { value: 'ABOUT_RIGHT', now: doneAt + 1_000 })).success, true);
    const finalized = orch.execute(cmd('FINALIZE_WORKOUT', { now: doneAt + 2_000 }));
    assert.strictEqual(finalized.success, true, finalized.errors[0]?.message);
    assert.ok(recorder.getEvents({ eventType: 'workout.paused' }).length >= 1);
    assert.ok(recorder.getEvents({ eventType: 'workout.resumed' }).length >= 1);
  });

  test('pause when no workout exists is rejected', () => {
    const orch = new Orchestrator(freshState(2));
    const paused = orch.execute(cmd('PAUSE_WORKOUT', { now: 1_000 }));
    assert.strictEqual(paused.success, false);
    assert.strictEqual(paused.errors[0]?.code, ErrorCode.WORKOUT_SESSION_INVALID);
  });

  test('pause twice is rejected', () => {
    const orch = new Orchestrator(freshState(3));
    startMobility(orch, 'wses_pause_twice', 1_000);
    assert.strictEqual(orch.execute(cmd('PAUSE_WORKOUT', { now: 2_000 })).success, true);
    const again = orch.execute(cmd('PAUSE_WORKOUT', { now: 3_000 }));
    assert.strictEqual(again.success, false);
    assert.strictEqual(again.errors[0]?.code, ErrorCode.WORKOUT_SESSION_INVALID);
    assert.strictEqual(orch.getState().playerFitness.activeSession?.state, 'PAUSED');
    assert.strictEqual(orch.getState().playerFitness.activeSession?.pauseCount, 1);
  });

  test('resume when not paused is rejected', () => {
    const orch = new Orchestrator(freshState(4));
    startMobility(orch, 'wses_resume_active', 1_000);
    const resumed = orch.execute(cmd('RESUME_WORKOUT', { now: 2_000 }));
    assert.strictEqual(resumed.success, false);
    assert.strictEqual(resumed.errors[0]?.code, ErrorCode.WORKOUT_SESSION_INVALID);
    assert.strictEqual(orch.getState().playerFitness.activeSession?.state, 'ACTIVE');
  });

  test('resume twice is rejected', () => {
    const orch = new Orchestrator(freshState(5));
    startMobility(orch, 'wses_resume_twice', 1_000);
    assert.strictEqual(orch.execute(cmd('PAUSE_WORKOUT', { now: 2_000 })).success, true);
    assert.strictEqual(orch.execute(cmd('RESUME_WORKOUT', { now: 3_000 })).success, true);
    const again = orch.execute(cmd('RESUME_WORKOUT', { now: 4_000 }));
    assert.strictEqual(again.success, false);
    assert.strictEqual(again.errors[0]?.code, ErrorCode.WORKOUT_SESSION_INVALID);
    assert.strictEqual(orch.getState().playerFitness.activeSession?.state, 'ACTIVE');
  });

  test('pause then save/reload keeps the paused session', () => {
    const orch = new Orchestrator(freshState(6));
    startMobility(orch, 'wses_pause_persist', 1_000);
    assert.strictEqual(orch.execute(cmd('PAUSE_WORKOUT', { now: 2_000 })).success, true);
    const reloaded = reloadState(orch.getState());
    assert.strictEqual(reloaded.playerFitness.activeSession?.sessionId, 'wses_pause_persist');
    assert.strictEqual(reloaded.playerFitness.activeSession?.state, 'PAUSED');
    assert.strictEqual(reloaded.playerFitness.activeSession?.pauseCount, 1);
    assert.strictEqual(reloaded.playerFitness.activeSession?.pauseIntervals[0]?.endedAt, null);
  });

  test('resume after reload continues the same session', () => {
    const orch = new Orchestrator(freshState(7));
    startMobility(orch, 'wses_resume_persist', 1_000);
    assert.strictEqual(orch.execute(cmd('PAUSE_WORKOUT', { now: 2_000 })).success, true);
    const resumedOrch = new Orchestrator(reloadState(orch.getState()));
    const resumed = resumedOrch.execute(cmd('RESUME_WORKOUT', { now: 9_000 }));
    assert.strictEqual(resumed.success, true, resumed.errors[0]?.message);
    assert.strictEqual(resumedOrch.getState().playerFitness.activeSession?.state, 'ACTIVE');
    assert.ok(resumedOrch.getState().playerFitness.activeSession?.pauseIntervals[0]?.endedAt === 9_000);
  });

  test('completed session cannot be paused', () => {
    const orch = new Orchestrator(freshState(8));
    startMobility(orch, 'wses_done_pause', 1_000);
    finishActiveWorkout(orch, 2_000);
    assert.strictEqual(orch.getState().playerFitness.activeSession?.state, 'COMPLETED');
    const paused = orch.execute(cmd('PAUSE_WORKOUT', { now: 20_000 }));
    assert.strictEqual(paused.success, false);
    assert.strictEqual(paused.errors[0]?.code, ErrorCode.WORKOUT_SESSION_INVALID);
    assert.strictEqual(orch.getState().playerFitness.activeSession?.state, 'COMPLETED');
  });

  test('abandoned session cannot be resumed', () => {
    const orch = new Orchestrator(freshState(9));
    startMobility(orch, 'wses_ab_resume', 1_000);
    assert.strictEqual(orch.execute(cmd('PAUSE_WORKOUT', { now: 2_000 })).success, true);
    assert.strictEqual(orch.execute(cmd('ABANDON_WORKOUT', { now: 3_000 })).success, true);
    assert.strictEqual(orch.getState().playerFitness.activeSession?.state, 'ABANDONED');
    const resumed = orch.execute(cmd('RESUME_WORKOUT', { now: 4_000 }));
    assert.strictEqual(resumed.success, false);
    assert.strictEqual(resumed.errors[0]?.code, ErrorCode.WORKOUT_SESSION_INVALID);
    assert.strictEqual(orch.getState().playerFitness.activeSession?.state, 'ABANDONED');
  });

  test('pause does not mutate an unrelated clone of prior state', () => {
    const orch = new Orchestrator(freshState(10));
    startMobility(orch, 'wses_clone', 1_000);
    const before = cloneGameState(orch.getState());
    assert.strictEqual(orch.execute(cmd('PAUSE_WORKOUT', { now: 2_000 })).success, true);
    assert.strictEqual(before.playerFitness.activeSession?.state, 'ACTIVE');
    assert.strictEqual(orch.getState().playerFitness.activeSession?.state, 'PAUSED');
  });
}
