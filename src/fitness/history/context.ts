import { FitnessHistoryContext } from '../estimate/types';
import { WorkoutHistoryStore } from './types';

export function fitnessHistoryContextFromStore(
  store: WorkoutHistoryStore,
  playerId: string,
  now: number,
  excludeSessionId?: string,
): FitnessHistoryContext {
  const priorEvidence = store.evidenceForFitness(playerId, {
    before: now + 1,
    excludeSessionId,
    eligibleOnly: true,
  });
  return { now, priorEvidence };
}
