import { GameState } from '../../types/GameState';
import { abandonWorkoutSession } from '../../fitness/session/lifecycle';
import { WorkoutAbandonmentReason } from '../../fitness/session/types';
import { defenseCompletionDeadlineTick } from './deadlines';

export function abandonLinkedDefenseSession(
  state: GameState,
  invasionId: string,
  reason: WorkoutAbandonmentReason,
): void {
  const session = state.playerFitness.activeSession;
  if (!session) return;
  if (session.purpose !== 'DEFENSE') return;
  if (session.gameplayContext?.invasionId !== invasionId) return;
  if (session.state === 'COMPLETED' || session.state === 'ABANDONED') return;
  const abandoned = abandonWorkoutSession(session, state.worldTick, reason);
  if (abandoned.ok) {
    state.playerFitness.activeSession = abandoned.value;
  }
}

export function attachDefenseWorkoutToInvasion(
  state: GameState,
  invasionId: string,
  sessionId: string,
  startedAtTick: number,
): void {
  const invasion = state.activeInvasions.get(invasionId);
  if (!invasion) return;
  invasion.status = 'defense_in_progress';
  invasion.defenseWorkoutStartedAtTick = startedAtTick;
  invasion.defenseCompletionDeadlineTick = defenseCompletionDeadlineTick(startedAtTick);
  invasion.defenseSessionId = sessionId;
}
