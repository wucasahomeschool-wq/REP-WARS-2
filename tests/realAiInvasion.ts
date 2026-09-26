/**
 * Real AI invasion, then both defense outcomes through the production
 * workout pipeline and BattleEngine. Run with:
 * npx ts-node --project tsconfig.tests.json --transpile-only tests/realAiInvasion.ts
 */
import assert from 'assert';
import { createGameState, Orchestrator } from '../src';
import { getCurrentExercise } from '../src/fitness/session/progress';
import { LEVEL1_SCRIPTED_RAID_TROOPS } from '../src/gameplay/tutorial/level1';
import { MIN_ATTACKING_TROOPS } from '../src/army/strategicAttack';
import {
  AiInvasionFixtureMode,
  arrangeLevel1SoAiAttacks,
  openAiInvasionFromDecision,
} from '../src/server/aiInvasionFixture';
import { CommandRequest } from '../src/orchestration/protocol';

const PLAYER_ID = 'player_local';

function cmd(commandId: string, parameters: Record<string, unknown> = {}, requestId?: string): CommandRequest {
  return {
    commandId,
    playerId: PLAYER_ID,
    requestId: requestId ?? `${commandId}_${Math.random().toString(36).slice(2, 8)}`,
    parameters,
  };
}

function finishActiveWorkout(orchestrator: Orchestrator, now: number): void {
  let clock = now;
  while (orchestrator.getState().playerFitness.activeSession?.state === 'ACTIVE') {
    const session = orchestrator.getState().playerFitness.activeSession!;
    const step = getCurrentExercise(session);
    assert.ok(step, 'expected a current exercise');
    clock += 1000;
    if (step.skippable && step.exerciseType === 'REST') {
      const skipped = orchestrator.execute(cmd('SKIP_REST', { order: step.order, now: clock }));
      assert.strictEqual(skipped.success, true, skipped.errors[0]?.message);
      continue;
    }
    const parameters: Record<string, unknown> = { order: step.order, now: clock };
    if (step.prescription.kind === 'repetitions') parameters.repetitions = step.prescription.repetitions;
    else parameters.durationSeconds = step.prescription.durationSeconds;
    const recorded = orchestrator.execute(cmd('RECORD_EXERCISE', parameters));
    assert.strictEqual(recorded.success, true, recorded.errors[0]?.message);
  }
}

function defend(orchestrator: Orchestrator, invasionId: string): Record<string, unknown> {
  const started = orchestrator.execute(cmd('START_WORKOUT', {
    purpose: 'DEFENSE',
    invasionId,
    now: 1000,
  }, `def_start_${invasionId}`));
  assert.strictEqual(started.success, true, started.errors[0]?.message);
  finishActiveWorkout(orchestrator, 2000);
  const session = orchestrator.getState().playerFitness.activeSession;
  assert.ok(session);
  assert.strictEqual(session.state, 'COMPLETED');
  if (session.feedbackState === 'FEEDBACK_REQUIRED') {
    const feedback = orchestrator.execute(cmd('SUBMIT_WORKOUT_FEEDBACK', {
      value: 'ABOUT_RIGHT',
      now: 20000,
    }, `def_fb_${invasionId}`));
    assert.strictEqual(feedback.success, true, feedback.errors[0]?.message);
  }
  const finalized = orchestrator.execute(cmd('FINALIZE_WORKOUT', { now: 21000 }, `def_fin_${invasionId}`));
  assert.strictEqual(finalized.success, true, finalized.errors[0]?.message);
  return finalized.payload;
}

function play(mode: AiInvasionFixtureMode): { payload: Record<string, unknown>; owner: string | null | undefined } {
  const state = createGameState();
  arrangeLevel1SoAiAttacks(state, mode);
  const orchestrator = new Orchestrator(state);
  const opened = openAiInvasionFromDecision(orchestrator, PLAYER_ID);
  assert.strictEqual(opened.action, 'ATTACK');
  assert.strictEqual(opened.targetId, 't_02');
  assert.strictEqual(opened.attackOutcome, 'invasion_created');
  assert.ok(opened.attackerSoldiers > MIN_ATTACKING_TROOPS);
  assert.notStrictEqual(opened.attackerSoldiers, LEVEL1_SCRIPTED_RAID_TROOPS);
  assert.strictEqual(orchestrator.getState().level1Tutorial?.scriptedInvasionId ?? null, null);
  assert.strictEqual(orchestrator.getState().level1Tutorial?.beat, 'COMPLETE');
  const payload = defend(orchestrator, opened.invasionId);
  console.log(mode, payload.invasionOutcome, payload.winner, payload.territoryOutcome, payload.kind, payload.physicalOutput);
  assert.strictEqual(orchestrator.getState().activeInvasions.size, 0);
  return { payload, owner: orchestrator.getState().territories.get('t_02')?.owner };
}

const won = play('success');
assert.strictEqual(won.payload.purpose, 'DEFENSE');
assert.strictEqual(won.payload.invasionOutcome, 'defense_success');
assert.strictEqual(won.payload.winner, 'defender');
assert.strictEqual(won.owner, 'f_player');

const lost = play('failure');
assert.strictEqual(lost.payload.purpose, 'DEFENSE');
assert.strictEqual(lost.payload.invasionOutcome, 'defense_failure');
assert.strictEqual(lost.payload.winner, 'attacker');
assert.strictEqual(lost.owner, 'f_ai_01');

console.log('real AI invasion defense: success and failure');
