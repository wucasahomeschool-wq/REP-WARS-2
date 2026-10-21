import { WorkoutSession } from '../session/types';
import { toWorkoutHistoryEntry } from './record';
import { WorkoutHistoryStore } from './types';
import { FitnessEvidence } from '../evaluation/types';
import { PhysicalResult } from '../physicalResult/types';

export function persistTerminalSessionHistory(
  history: WorkoutHistoryStore | null | undefined,
  session: WorkoutSession | null | undefined,
  extras: {
    rewardSettlement?: import('./types').WorkoutHistoryEntry['rewardSettlement'];
    completedAtWorldTick?: number | null;
    evidence?: FitnessEvidence | null;
    physicalResult?: PhysicalResult | null;
    rewardKind?: string | null;
    rewardApplicationId?: string | null;
  } = {},
): void {
  if (!history || !session) return;
  if (session.state !== 'COMPLETED' && session.state !== 'ABANDONED') return;
  const previous = history.get(session.playerId, session.sessionId);
  history.upsert(toWorkoutHistoryEntry(session, {
    completedAtWorldTick: previous?.completedAtWorldTick,
    evidence: previous?.evidence, physicalResult: previous?.physicalResult,
    rewardKind: previous?.rewardKind, rewardApplicationId: previous?.rewardApplicationId,
    rewardSettlement: previous?.rewardSettlement,
    ...extras,
  }));
}
