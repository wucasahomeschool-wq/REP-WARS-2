import { PersistenceError } from '../errors';
import { WorkoutHistoryEntry, WorkoutHistoryStore } from '../../fitness/history/types';
import { FitnessEvidence } from '../../fitness/evaluation/types';
import { SameExerciseQuery, WorkoutHistoryQuery } from '../../fitness/history/types';

/** Future live adapter. Tests use InMemoryWorkoutHistoryStore. */
export class SupabaseWorkoutHistoryStore implements WorkoutHistoryStore {
  upsert(_entry: WorkoutHistoryEntry): void {
    throw new PersistenceError('persistence.not_configured', 'SupabaseWorkoutHistoryStore is not configured in this phase');
  }
  get(_playerId: string, _sessionId: string): WorkoutHistoryEntry | null {
    throw new PersistenceError('persistence.not_configured', 'SupabaseWorkoutHistoryStore is not configured in this phase');
  }
  recentCompleted(_playerId: string, _query?: WorkoutHistoryQuery): WorkoutHistoryEntry[] {
    throw new PersistenceError('persistence.not_configured', 'SupabaseWorkoutHistoryStore is not configured in this phase');
  }
  completedSince(_playerId: string, _since: number, _query?: WorkoutHistoryQuery): WorkoutHistoryEntry[] {
    throw new PersistenceError('persistence.not_configured', 'SupabaseWorkoutHistoryStore is not configured in this phase');
  }
  sameExercisePrior(_playerId: string, _query: SameExerciseQuery): WorkoutHistoryEntry[] {
    throw new PersistenceError('persistence.not_configured', 'SupabaseWorkoutHistoryStore is not configured in this phase');
  }
  evidenceForFitness(_playerId: string, _query?: WorkoutHistoryQuery): FitnessEvidence[] {
    throw new PersistenceError('persistence.not_configured', 'SupabaseWorkoutHistoryStore is not configured in this phase');
  }
  clonePlayer(_playerId: string): WorkoutHistoryEntry[] {
    throw new PersistenceError('persistence.not_configured', 'SupabaseWorkoutHistoryStore is not configured in this phase');
  }
  replacePlayer(_playerId: string, _entries: readonly WorkoutHistoryEntry[]): void {
    throw new PersistenceError('persistence.not_configured', 'SupabaseWorkoutHistoryStore is not configured in this phase');
  }
}
