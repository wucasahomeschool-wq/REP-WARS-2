import { WorkoutSession } from '../session/types';
import { toWorkoutHistoryEntry } from './record';
import { WorkoutHistoryStore } from './types';
import { FitnessEvidence } from '../evaluation/types';
import { PhysicalResult } from '../physicalResult/types';

export function persistTerminalSessionHistory(
  history: WorkoutHistoryStore | null | undefined,
  session: WorkoutSession | null | undefined,
  extras: {
    completedAtWorldTick?: number | null;
    evidence?: FitnessEvidence | null;
    physicalResult?: PhysicalResult | null;
    rewardKind?: string | null;
    rewardApplicationId?: string | null;
  } = {},
): void {
  if (!history || !session) return;
  if (session.state !== 'COMPLETED' && session.state !== 'ABANDONED') return;
  history.upsert(toWorkoutHistoryEntry(session, extras));
}
