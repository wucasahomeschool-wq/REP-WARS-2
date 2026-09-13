import { FitnessEvidence } from '../evaluation/types';
import { cloneWorkoutHistoryEntry } from './record';
import {
  SameExerciseQuery,
  WorkoutHistoryEntry,
  WorkoutHistoryQuery,
  WorkoutHistoryStore,
} from './types';

export const DEFAULT_HISTORY_LIMIT = 64;

function applyQuery(entries: WorkoutHistoryEntry[], query: WorkoutHistoryQuery = {}): WorkoutHistoryEntry[] {
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

export class InMemoryWorkoutHistoryStore implements WorkoutHistoryStore {
  private readonly players = new Map<string, Map<string, WorkoutHistoryEntry>>();

  upsert(entry: WorkoutHistoryEntry): void {
    let bucket = this.players.get(entry.playerId);
    if (!bucket) {
      bucket = new Map();
      this.players.set(entry.playerId, bucket);
    }
    bucket.set(entry.sessionId, cloneWorkoutHistoryEntry(entry));
  }

  get(playerId: string, sessionId: string): WorkoutHistoryEntry | null {
    const found = this.players.get(playerId)?.get(sessionId);
    return found ? cloneWorkoutHistoryEntry(found) : null;
  }

  recentCompleted(playerId: string, query: WorkoutHistoryQuery = {}): WorkoutHistoryEntry[] {
    return applyQuery(this.all(playerId), { ...query, completedOnly: true, eligibleOnly: true });
  }

  completedSince(playerId: string, since: number, query: WorkoutHistoryQuery = {}): WorkoutHistoryEntry[] {
    return applyQuery(this.all(playerId), { ...query, since, completedOnly: true, eligibleOnly: true });
  }

  sameExercisePrior(playerId: string, query: SameExerciseQuery): WorkoutHistoryEntry[] {
    const matches = this.all(playerId).filter((entry) => entry.exerciseIds.includes(query.exerciseId));
    return applyQuery(matches, { ...query, completedOnly: true, eligibleOnly: true });
  }

  evidenceForFitness(playerId: string, query: WorkoutHistoryQuery = {}): FitnessEvidence[] {
    return this.recentCompleted(playerId, { ...query, eligibleOnly: true })
      .map((entry) => entry.evidence)
      .filter((evidence): evidence is FitnessEvidence => evidence !== null);
  }

  clonePlayer(playerId: string): WorkoutHistoryEntry[] {
    return this.all(playerId).map(cloneWorkoutHistoryEntry);
  }

  replacePlayer(playerId: string, entries: readonly WorkoutHistoryEntry[]): void {
    const bucket = new Map<string, WorkoutHistoryEntry>();
    for (const entry of entries) {
      bucket.set(entry.sessionId, cloneWorkoutHistoryEntry(entry));
    }
    this.players.set(playerId, bucket);
  }

  private all(playerId: string): WorkoutHistoryEntry[] {
    return [...(this.players.get(playerId)?.values() ?? [])];
  }
}
