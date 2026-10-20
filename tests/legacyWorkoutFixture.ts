import assert from 'assert';
import { Orchestrator } from '../src/orchestration/orchestrator';
import { CommandRequest } from '../src/orchestration/protocol';
import { beginWorkoutSession } from '../src/fitness/session';
import { WorkoutSession } from '../src/fitness/session/types';
import { parseWorkoutSize, resolveStartWorkout } from '../src/gameplay/workoutSelection';

/**
 * Explicit pre-R1-D active-session fixture for legacy payout/progression tests.
 * This does NOT execute START_WORKOUT, manufacture an entitlement, or grant a
 * reward. All subsequent exercise/finalize/persistence commands use real runtime
 * paths. Fresh normal-start authority is tested in workoutStartRewards.ts.
 */
export function seedLegacyWorkoutSession(orch: Orchestrator, historicalStart: CommandRequest): WorkoutSession {
  const state = orch.getState(), params = historicalStart.parameters ?? {};
  assert.strictEqual(params.purpose, 'NORMAL_TROOPS');
  const resolved = resolveStartWorkout(state, 'NORMAL_TROOPS', params.workoutId as string | undefined,
    parseWorkoutSize(params.size as string | undefined));
  const created = beginWorkoutSession({ playerId: historicalStart.playerId, purpose: 'NORMAL_TROOPS',
    workout: resolved.definition, intendedDifficulty: (params.intendedDifficulty ?? resolved.definition.intendedDifficulty) as WorkoutSession['intendedDifficulty'],
    sessionId: params.sessionId as string | undefined, now: params.now as number,
    fitnessEstimate: resolved.definition.metadata.authored ? undefined : state.playerFitness.estimate ?? undefined,
    gameplayContext: { startedAtWorldTick: state.worldTick } });
  if (!created.ok) throw new Error(created.error.message);
  assert.strictEqual(created.value.completionRewardEntitlement, undefined);
  state.playerFitness.activeSession = created.value;
  return created.value;
}
