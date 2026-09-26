import { PersistenceError } from '../errors';
import { supabaseRest } from './blockingRest';
import { SupabaseGameStateRow, SupabaseWorkoutHistoryRow } from './schema';

export const COMMIT_AUTHORITATIVE_PLAYER_WORLD_RPC = 'commit_authoritative_player_world';

export interface AtomicCommitResult {
  player_id: string;
  world_id: string;
  state_version: number;
}

export function persistenceErrorFromRpc(status: number, text: string, playerId: string): PersistenceError {
  let message = '';
  let details = '';
  try {
    const body = JSON.parse(text) as { message?: unknown; details?: unknown };
    message = typeof body.message === 'string' ? body.message : '';
    details = typeof body.details === 'string' ? body.details : '';
  } catch {
    message = '';
  }
  if (message === 'persistence.conflict') {
    const match = /^(\d+) (\d+)$/.exec(details);
    if (match) {
      const expectedVersion = Number(match[1]);
      const currentVersion = Number(match[2]);
      return new PersistenceError(
        'persistence.conflict',
        `Stale world write for ${playerId}: expected version ${expectedVersion}, stored ${currentVersion}`,
        { playerId, expectedVersion, currentVersion },
      );
    }
    return new PersistenceError('persistence.conflict', `Stale world write for ${playerId}`, { playerId });
  }
  if (message === 'persistence.invalid_state') {
    return new PersistenceError('persistence.invalid_state', 'Atomic persistence request was rejected', { playerId });
  }
  return new PersistenceError('persistence.save_failed', `Supabase request failed (${status})`, { playerId });
}

export function invokeCommitAuthoritativePlayerWorld(input: {
  playerId: string;
  expectedVersion: number;
  world: SupabaseGameStateRow;
  history: readonly SupabaseWorkoutHistoryRow[] | readonly unknown[];
}): AtomicCommitResult {
  const result = supabaseRest({
    method: 'POST',
    path: `rpc/${COMMIT_AUTHORITATIVE_PLAYER_WORLD_RPC}`,
    body: {
      p_expected_version: input.expectedVersion,
      p_world: input.world,
      p_history: input.history,
    },
  });
  if (result.status < 200 || result.status >= 300) {
    throw persistenceErrorFromRpc(result.status, result.text, input.playerId);
  }
  let parsed: AtomicCommitResult;
  try {
    parsed = JSON.parse(result.text) as AtomicCommitResult;
  } catch {
    throw new PersistenceError('persistence.corrupt', 'Supabase returned malformed JSON', { playerId: input.playerId });
  }
  if (!parsed || typeof parsed.state_version !== 'number' || parsed.player_id !== input.playerId) {
    throw new PersistenceError('persistence.corrupt', 'Supabase returned an incomplete commit result', { playerId: input.playerId });
  }
  return parsed;
}
