import assert from 'assert';
import { createGameState, PersistenceError, WORKOUT_HISTORY_FORMAT } from '../src';
import type { WorkoutHistoryEntry } from '../src/fitness/history/types';
import { cloneGameState } from '../src/state/cloneGameState';
import { MemoryPlayerWorldTable, SupabaseGameStateStore } from '../src/persistence/supabase/adapter';
import {
  invokeCommitAuthoritativePlayerWorld,
  persistenceErrorFromRpc,
} from '../src/persistence/supabase/atomicCommit';
import { SupabaseWorkoutHistoryStore } from '../src/persistence/supabase/historyAdapter';
import { SupabasePlayerWorldTable } from '../src/persistence/supabase/playerWorldTable';
import { SupabaseWorkoutHistoryTable } from '../src/persistence/supabase/historyTable';

export interface AtomicCommitTestApi {
  test: (name: string, fn: () => void) => void;
}

function historyEntry(playerId: string, sessionId: string, output: number): WorkoutHistoryEntry {
  return {
    formatVersion: WORKOUT_HISTORY_FORMAT,
    playerId,
    sessionId,
    workoutId: 'wk_1',
    purpose: 'NORMAL_TROOPS',
    intendedDifficulty: 'MODERATE',
    completionState: 'COMPLETED',
    eligibleForFitnessEvaluation: true,
    createdAt: 1,
    startedAt: 1,
    completedAt: 5,
    abandonedAt: null,
    abandonmentReason: null,
    completedAtWorldTick: 2,
    feedback: null,
    integrityFlags: [],
    pauseCount: 0,
    prescribedWorkout: { workoutId: 'wk_1', intendedDifficulty: 'MODERATE', exercises: [] },
    performances: [],
    summary: null,
    exerciseIds: ['ex_neck_rolls'],
    evidence: null,
    physicalOutput: output,
    physicalResult: null,
    rewardKind: 'TROOPS',
    rewardApplicationId: 'reward_1',
    gameplayContext: null,
    sessionState: 'COMPLETED',
  };
}

export function registerAtomicCommitTests(api: AtomicCommitTestApi): void {
  const { test } = api;
  console.log('Atomic Supabase commit');

  test('rpc failures map onto persistence errors without the database body', () => {
    const conflict = persistenceErrorFromRpc(400, JSON.stringify({
      message: 'persistence.conflict',
      details: '1 4',
      hint: 'select secret',
    }), 'player_atomic');
    assert.strictEqual(conflict.code, 'persistence.conflict');
    assert.strictEqual(conflict.message, 'Stale world write for player_atomic: expected version 1, stored 4');
    assert.ok(!conflict.message.includes('select'));

    const invalid = persistenceErrorFromRpc(400, JSON.stringify({
      message: 'persistence.invalid_state',
      details: 'null value in column payload',
    }), 'player_atomic');
    assert.strictEqual(invalid.code, 'persistence.invalid_state');
    assert.ok(!invalid.message.includes('payload'));

    const other = persistenceErrorFromRpc(500, '{"message":"duplicate key"}', 'player_atomic');
    assert.strictEqual(other.code, 'persistence.save_failed');
    assert.ok(!other.message.includes('duplicate'));
  });

  test('an injected world table does not pretend to use the remote transaction', () => {
    const store = new SupabaseGameStateStore(new MemoryPlayerWorldTable());
    assert.strictEqual(store.usesRemoteCommit(), false);
  });
}

export async function runAtomicCommitProof(): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('  · live atomic commit skipped; credentials are not set');
    return;
  }
  const playerId = `repwars_atomic_${Date.now()}`;
  const worlds = new SupabasePlayerWorldTable();
  const historyTable = new SupabaseWorkoutHistoryTable();
  const history = new SupabaseWorkoutHistoryStore(historyTable);
  try {
    const first = new SupabaseGameStateStore();
    const second = new SupabaseGameStateStore();
    const created = first.commitWithHistory(playerId, createGameState(), 0, [historyEntry(playerId, 'sess_a', 44)]);
    assert.strictEqual(created.ok, true, created.ok ? '' : created.message);
    if (!created.ok) return;
    assert.strictEqual(created.record.stateVersion, 1);
    assert.strictEqual(history.get(playerId, 'sess_a')?.physicalOutput, 44);

    const seen = second.load(playerId);
    assert.strictEqual(seen.ok, true);
    if (!seen.ok) return;
    const forA = cloneGameState(seen.state);
    const forB = cloneGameState(seen.state);
    forA.worldTick = 4;
    const advanced = first.commitWithHistory(playerId, forA, seen.record.stateVersion, [historyEntry(playerId, 'sess_a', 45)]);
    assert.strictEqual(advanced.ok, true, advanced.ok ? '' : advanced.message);
    if (!advanced.ok) return;
    assert.strictEqual(advanced.record.stateVersion, seen.record.stateVersion + 1);

    forB.worldTick = 9;
    const stale = second.commitWithHistory(playerId, forB, seen.record.stateVersion, [historyEntry(playerId, 'sess_b', 1)]);
    assert.strictEqual(stale.ok, false);
    if (!stale.ok) assert.strictEqual(stale.code, 'persistence.conflict');
    const afterStale = new SupabaseGameStateStore().load(playerId);
    assert.strictEqual(afterStale.ok, true);
    if (!afterStale.ok) return;
    assert.strictEqual(afterStale.state.worldTick, 4);
    assert.strictEqual(afterStale.record.stateVersion, seen.record.stateVersion + 1);
    assert.strictEqual(history.get(playerId, 'sess_b'), null);
    assert.strictEqual(history.get(playerId, 'sess_a')?.physicalOutput, 45);

    const current = worlds.find(playerId);
    assert.ok(current);
    assert.throws(
      () => invokeCommitAuthoritativePlayerWorld({
        playerId,
        expectedVersion: current!.state_version,
        world: { ...current!, world_tick: 77 },
        history: [{ player_id: playerId, session_id: 'sess_bad' }],
      }),
      (err: unknown) => err instanceof PersistenceError && err.code === 'persistence.invalid_state',
    );
    const afterHistoryFailure = worlds.find(playerId);
    assert.strictEqual(afterHistoryFailure?.state_version, current!.state_version);
    assert.strictEqual(afterHistoryFailure?.world_tick, 4);
    assert.strictEqual(history.get(playerId, 'sess_bad'), null);
    assert.strictEqual(history.get(playerId, 'sess_a')?.physicalOutput, 45);

    assert.throws(
      () => invokeCommitAuthoritativePlayerWorld({
        playerId,
        expectedVersion: current!.state_version,
        world: { ...current!, schema_version: 'nope' as unknown as number },
        history: [historyEntry(playerId, 'sess_c', 7)].map((entry) => ({
          player_id: entry.playerId,
          session_id: entry.sessionId,
          workout_id: entry.workoutId,
          purpose: entry.purpose,
          completion_state: entry.completionState,
          eligible_for_fitness: entry.eligibleForFitnessEvaluation,
          completed_at: entry.completedAt,
          completed_at_world_tick: entry.completedAtWorldTick,
          exercise_ids: entry.exerciseIds,
          payload: entry,
        })),
      }),
      (err: unknown) => err instanceof PersistenceError && err.code === 'persistence.invalid_state',
    );
    const afterWorldFailure = worlds.find(playerId);
    assert.strictEqual(afterWorldFailure?.state_version, current!.state_version);
    assert.strictEqual(afterWorldFailure?.world_tick, 4);
    assert.strictEqual(history.get(playerId, 'sess_c'), null);
  } finally {
    historyTable.deletePlayer(playerId);
    worlds.deletePlayer(playerId);
  }
}
