import { GameState } from '../../types/GameState';
import { WorkoutSession } from '../session/types';
import { getAuthoredWorkoutCatalog } from '../authoring/registry';
import { evaluateAuthoredProgression, ProgressionEvaluation } from './evaluator';
import { emptyPlayerProgressionState } from './types';

export interface ProgressionApplyResult {
  applied: boolean;
  evaluation: ProgressionEvaluation | null;
}

export function ensurePlayerProgression(state: GameState): void {
  if (!state.playerFitness.progression) {
    state.playerFitness.progression = emptyPlayerProgressionState();
  }
}

/**
 * Records authored progression evidence after rewards (or abandon).
 * Does not change the immediate workout reward.
 */
export function applyAuthoredProgression(
  state: GameState,
  session: WorkoutSession,
  now: number,
): ProgressionApplyResult {
  ensurePlayerProgression(state);
  const catalog = getAuthoredWorkoutCatalog();
  if (!catalog) return { applied: false, evaluation: null };
  const workout = catalog.workouts[session.workoutId];
  if (!workout && !session.authoredCatalog) return { applied: false, evaluation: null };
  if (!workout) return { applied: false, evaluation: null };
  if (state.playerFitness.progression.evidenceLog.some((entry) => entry.sessionId === session.sessionId)) {
    return { applied: false, evaluation: null };
  }
  const evaluation = evaluateAuthoredProgression({
    catalog,
    state: state.playerFitness.progression,
    session,
    workout,
    now,
  });
  state.playerFitness.progression = evaluation.next;
  return { applied: true, evaluation };
}

export function publicProgressionView(state: GameState): {
  currentBandId: string | null;
  movementReadiness: Record<string, string>;
  catalogId: string | null;
  catalogVersion: string | null;
  engineVersion: string;
} {
  ensurePlayerProgression(state);
  const progression = state.playerFitness.progression;
  return {
    currentBandId: progression.currentBandId,
    movementReadiness: { ...progression.movementReadiness },
    catalogId: progression.catalogId,
    catalogVersion: progression.catalogVersion,
    engineVersion: progression.engineVersion,
  };
}
