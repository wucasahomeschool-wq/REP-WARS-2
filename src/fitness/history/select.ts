import { cloneWorkoutHistoryEntry } from './record';
import { WorkoutHistoryEntry, WorkoutHistoryQuery } from './types';

export const DEFAULT_HISTORY_LIMIT = 64;

export function filterWorkoutHistory(
  entries: WorkoutHistoryEntry[],
  query: WorkoutHistoryQuery = {},
): WorkoutHistoryEntry[] {
  const limit = query.limit ?? DEFAULT_HISTORY_LIMIT;
  const exclude = query.excludeSessionId;
  const since = query.since;
  const before = query.before;
  const filtered = entries.filter((entry) => {
    if (exclude && entry.sessionId === exclude) return false;
    if (query.completedOnly && entry.completionState !== 'COMPLETED') return false;
    if (query.eligibleOnly && !entry.eligibleForFitnessEvaluation) return false;
    const at = entry.completedAt ?? entry.abandonedAt ?? entry.createdAt;
    if (since !== undefined && at < since) return false;
    if (before !== undefined && at >= before) return false;
    return true;
  });
  filtered.sort((a, b) => {
    const aAt = a.completedAt ?? a.abandonedAt ?? a.createdAt;
    const bAt = b.completedAt ?? b.abandonedAt ?? b.createdAt;
    return bAt - aAt;
  });
  return filtered.slice(0, Math.max(0, limit)).map(cloneWorkoutHistoryEntry);
}
