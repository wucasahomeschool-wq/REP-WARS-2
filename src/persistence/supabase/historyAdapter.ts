import { FitnessEvidence } from '../../fitness/evaluation/types';
import { cloneWorkoutHistoryEntry } from '../../fitness/history/record';
import { filterWorkoutHistory } from '../../fitness/history/select';
import {
  SameExerciseQuery,
  WorkoutHistoryEntry,
  WorkoutHistoryQuery,
  WorkoutHistoryStore,
} from '../../fitness/history/types';
import { PersistenceError } from '../errors';
import { historyEntryToRow, rowToHistoryEntry } from './mapper';
import {
  MemoryWorkoutHistoryTable,
  SupabaseWorkoutHistoryTable,
  WorkoutHistoryTable,
} from './historyTable';

/**
 * Workout history for `workout_history`.
 * Pass a table in tests. The default table is the linked Supabase project.
 */
export class SupabaseWorkoutHistoryStore implements WorkoutHistoryStore {
  private readonly table: WorkoutHistoryTable | null;

  constructor(table?: WorkoutHistoryTable) {
    this.table = table ?? null;
  }

  private rows(): WorkoutHistoryTable {
    if (this.table) return this.table;
    return new SupabaseWorkoutHistoryTable();
  }

  upsert(entry: WorkoutHistoryEntry): void {
    if (!entry.playerId || !entry.sessionId) {
      throw new PersistenceError('persistence.invalid_state', 'Workout history requires a player id and session id');
    }
    this.rows().upsert(historyEntryToRow(cloneWorkoutHistoryEntry(entry)));
  }

  get(playerId: string, sessionId: string): WorkoutHistoryEntry | null {
    const row = this.rows().get(playerId, sessionId);
    return row ? cloneWorkoutHistoryEntry(rowToHistoryEntry(row)) : null;
  }

  recentCompleted(playerId: string, query: WorkoutHistoryQuery = {}): WorkoutHistoryEntry[] {
    return filterWorkoutHistory(this.all(playerId), { ...query, completedOnly: true, eligibleOnly: true });
  }

  completedSince(playerId: string, since: number, query: WorkoutHistoryQuery = {}): WorkoutHistoryEntry[] {
    return filterWorkoutHistory(this.all(playerId), { ...query, since, completedOnly: true, eligibleOnly: true });
  }

  sameExercisePrior(playerId: string, query: SameExerciseQuery): WorkoutHistoryEntry[] {
    const matches = this.all(playerId).filter((entry) => entry.exerciseIds.includes(query.exerciseId));
    return filterWorkoutHistory(matches, { ...query, completedOnly: true, eligibleOnly: true });
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
    const table = this.rows();
    const existing = table.list(playerId);
    const keep = new Set<string>();
    for (const entry of entries) {
      if (entry.playerId !== playerId) {
        throw new PersistenceError('persistence.invalid_state', 'History rollback entry is for a different player');
      }
      keep.add(entry.sessionId);
      table.upsert(historyEntryToRow(cloneWorkoutHistoryEntry(entry)));
    }
    const remove = existing.map((row) => row.session_id).filter((sessionId) => !keep.has(sessionId));
    if (remove.length > 0) table.deleteSessions(playerId, remove);
  }

  private all(playerId: string): WorkoutHistoryEntry[] {
    return this.rows().list(playerId).map((row) => rowToHistoryEntry(row));
  }
}

export { MemoryWorkoutHistoryTable };
