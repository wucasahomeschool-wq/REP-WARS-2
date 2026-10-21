import { GameState } from '../../types/GameState';
import { WorkoutSession } from '../../fitness/session/types';
import { cloneWorkoutSession } from '../../fitness/session/clone';
import { finalizeCompletedWorkout, isEligibleForFitnessEvaluation } from '../../fitness/session/summary';
import { evaluateFitnessEvidence } from '../../fitness/evaluation/evaluator';
import { cloneFitnessEstimate } from '../../fitness/estimate/clone';
import { evaluateFitness, applyFitnessEvaluation } from '../../fitness/estimate/evaluator';
import { fitnessHistoryContextFromStore } from '../../fitness/history/context';
import { persistTerminalSessionHistory } from '../../fitness/history/persistSession';
import { WorkoutHistoryStore } from '../../fitness/history/types';
import { applyAuthoredProgression } from '../../fitness/progression';
import { GAMEPLAY_CONFIG } from '../../gameplay/config';
import { applyLockedCompletionReward } from '../application/apply';
import type { WorkoutPipelineResult } from './runWorkoutRewardPipeline';
import { isDeepStrictEqual } from 'node:util';

/** Optional fitness work uses existing rules. Missing feedback never becomes invented evidence. */
export function evaluateLockedWorkoutFitness(state: GameState, session: WorkoutSession, history: WorkoutHistoryStore): boolean {
  const previous = history.get(session.playerId, session.sessionId);
  if (!isEligibleForFitnessEvaluation(session)) return false;
  if (previous?.evidence) return true;
  const finalized = finalizeCompletedWorkout(session);
  if (!finalized.ok) return false;
  const evidence = evaluateFitnessEvidence(finalized.value);
  if (!evidence.ok) return false;
  const estimate = state.playerFitness.estimate ? cloneFitnessEstimate(state.playerFitness.estimate) : null;
  // Late feedback is evaluated at submission/current-estimate time. Preserve the
  // original evidence timestamp without winding permanent fitness state backward.
  const evaluatedAt = Math.max(evidence.value.completedAt, session.feedback?.submittedAt ?? 0, estimate?.lastUpdatedAt ?? 0);
  const evaluation = evaluateFitness({ previousEstimate: estimate, currentEvidence: evidence.value,
    historicalContext: fitnessHistoryContextFromStore(history, session.playerId, evaluatedAt, session.sessionId) });
  if (!evaluation.ok) return false;
  const next = applyFitnessEvaluation(estimate, evaluation.value, evaluatedAt);
  if (!next.ok) return false;
  state.playerFitness.estimate = next.value;
  state.playerFitness.compactHistory = [...state.playerFitness.compactHistory.filter(row => row.sessionId !== session.sessionId), {
    sessionId: session.sessionId, completedAt: session.completedAt!, completedAtTick: state.worldTick, purpose: session.purpose,
  }].slice(-GAMEPLAY_CONFIG.maxFitnessHistoryEntries);
  applyAuthoredProgression(state, session, session.feedback?.submittedAt ?? session.completedAt!);
  persistTerminalSessionHistory(history, session, { evidence: evidence.value });
  return true;
}

/** Same transaction/ledger as legacy rewards; no new pending store or paid flag. */
export function settleLockedWorkout(state: GameState, session: WorkoutSession, history?: WorkoutHistoryStore | null): WorkoutPipelineResult {
  const base = { state, sessionId: session.sessionId, purpose: session.purpose, alreadyProcessed: false };
  if (!history) return { ...base, ok: false, error: { code: 'pipeline.history_required', message: 'Workout history is required for locked settlement' } };
  const previous = history.get(session.playerId, session.sessionId);
  const original = previous?.completionRewardEntitlement;
  if (original && !isDeepStrictEqual(original, session.completionRewardEntitlement)) {
    return { ...base, ok: false, error: { code: 'pipeline.entitlement_changed', message: 'Persisted completion terms cannot be replaced' } };
  }
  const applied = applyLockedCompletionReward(state, session);
  if (!applied.ok) return { ...base, ok: false, application: applied, error: { code: applied.result.code, message: applied.result.message } };
  if (applied.state !== state) Object.assign(state, applied.state);
  // Existing completion protection belongs to first settlement, not optional
  // feedback. Replaying history (including after a world change) cannot renew it.
  if (!applied.result.alreadyApplied) state.playerFitness.lastWorkoutCompletedAtTick = state.worldTick;
  persistTerminalSessionHistory(history, session, {
    completedAtWorldTick: previous?.completedAtWorldTick ?? state.worldTick, rewardKind: 'TROOPS',
    rewardApplicationId: applied.result.applicationId, rewardSettlement: { ...applied.result, alreadyApplied: false },
  });
  evaluateLockedWorkoutFitness(state, session, history);
  // Keep the paid terminal session available for old clients' unqualified retry/feedback.
  // New START may replace it; the history snapshot then supports explicit sessionId targeting.
  if (state.playerFitness.activeSession?.sessionId === session.sessionId) {
    state.playerFitness.activeSession = cloneWorkoutSession(session);
  }
  return { ...base, ok: true, alreadyProcessed: applied.result.alreadyApplied, application: applied };
}
