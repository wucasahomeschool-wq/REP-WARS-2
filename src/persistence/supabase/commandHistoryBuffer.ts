import { cloneWorkoutHistoryEntry } from '../../fitness/history/record';
import { filterWorkoutHistory } from '../../fitness/history/select';
import {
  SameExerciseQuery,
  WorkoutHistoryEntry,
  WorkoutHistoryQuery,
  WorkoutHistoryStore,
} from '../../fitness/history/types';
import { FitnessEvidence } from '../../fitness/evaluation/types';
import { PersistenceError } from '../errors';

/**
 * Holds workout-history writes for one command until the atomic commit.
 * Reads see the stored rows plus these pending upserts.
 */
class PendingHistory {
  private readonly written = new Map<string, WorkoutHistoryEntry>();

  upsert(entry: WorkoutHistoryEntry): void {
    this.written.set(entry.sessionId, cloneWorkoutHistoryEntry(entry));
  }

  entries(): WorkoutHistoryEntry[] {
    return [...this.written.values()].map(cloneWorkoutHistoryEntry);
  }
}

/**
 * Supabase history store for the HTTP session.
 * Writes during a begun command stay in memory until commit_authoritative_player_world.
 */
export class RoutingHistoryStore implements WorkoutHistoryStore {
  private readonly pending = new Map<string, PendingHistory>();

  constructor(private readonly base: WorkoutHistoryStore) {}

  begin(playerId: string): void {
    if (this.pending.has(playerId)) {
      throw new PersistenceError('persistence.save_failed', `History commit is already open for ${playerId}`);
    }
    this.pending.set(playerId, new PendingHistory());
  }

  drain(playerId: string): WorkoutHistoryEntry[] {
    return this.pending.get(playerId)?.entries() ?? [];
  }

  end(playerId: string): void {
    this.pending.delete(playerId);
  }

  upsert(entry: WorkoutHistoryEntry): void {
    const pending = this.pending.get(entry.playerId);
    if (!pending) {
      this.base.upsert(entry);
      return;
    }
    pending.upsert(entry);
  }

  get(playerId: string, sessionId: string): WorkoutHistoryEntry | null {
    const pending = this.merged(playerId).find((entry) => entry.sessionId === sessionId);
    if (this.pending.has(playerId)) return pending ? cloneWorkoutHistoryEntry(pending) : null;
    return this.base.get(playerId, sessionId);
  }

  recentCompleted(playerId: string, query: WorkoutHistoryQuery = {}): WorkoutHistoryEntry[] {
    if (!this.pending.has(playerId)) return this.base.recentCompleted(playerId, query);
    return filterWorkoutHistory(this.merged(playerId), { ...query, completedOnly: true, eligibleOnly: true });
  }

  completedSince(playerId: string, since: number, query: WorkoutHistoryQuery = {}): WorkoutHistoryEntry[] {
    if (!this.pending.has(playerId)) return this.base.completedSince(playerId, since, query);
    return filterWorkoutHistory(this.merged(playerId), { ...query, since, completedOnly: true, eligibleOnly: true });
  }

  sameExercisePrior(playerId: string, query: SameExerciseQuery): WorkoutHistoryEntry[] {
    if (!this.pending.has(playerId)) return this.base.sameExercisePrior(playerId, query);
    const matches = this.merged(playerId).filter((entry) => entry.exerciseIds.includes(query.exerciseId));
    return filterWorkoutHistory(matches, { ...query, completedOnly: true, eligibleOnly: true });
  }

  evidenceForFitness(playerId: string, query: WorkoutHistoryQuery = {}): FitnessEvidence[] {
    return this.recentCompleted(playerId, { ...query, eligibleOnly: true })
      .map((entry) => entry.evidence)
      .filter((evidence): evidence is FitnessEvidence => evidence !== null);
  }

  clonePlayer(playerId: string): WorkoutHistoryEntry[] {
    if (!this.pending.has(playerId)) return this.base.clonePlayer(playerId);
    return this.merged(playerId).map(cloneWorkoutHistoryEntry);
  }

  replacePlayer(playerId: string, entries: readonly WorkoutHistoryEntry[]): void {
    if (this.pending.has(playerId)) {
      throw new PersistenceError('persistence.invalid_state', 'History replacement is inside an atomic commit');
    }
    this.base.replacePlayer(playerId, entries);
  }

  private merged(playerId: string): WorkoutHistoryEntry[] {
    const pending = this.pending.get(playerId);
    const stored = this.base.clonePlayer(playerId);
    if (!pending) return stored;
    const bySession = new Map(stored.map((entry) => [entry.sessionId, entry]));
    for (const entry of pending.entries()) bySession.set(entry.sessionId, entry);
    return [...bySession.values()];
  }
}

export function isRoutingHistoryStore(value: WorkoutHistoryStore): value is RoutingHistoryStore {
  return value instanceof RoutingHistoryStore;
}
