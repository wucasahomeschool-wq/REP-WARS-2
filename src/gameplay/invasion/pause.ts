import { GameState } from '../../types/GameState';
import { GAMEPLAY_CONFIG } from '../config';

export function setPlayerEmpirePause(state: GameState, paused: boolean): void {
  if (paused) {
    if (!state.playerEmpirePause.paused) {
      state.playerEmpirePause.paused = true;
      state.playerEmpirePause.pausedAtTick = state.worldTick;
    }
    return;
  }
  if (state.playerEmpirePause.paused && state.playerEmpirePause.pausedAtTick !== null) {
    const frozen = state.playerEmpirePause.pausedAtTick;
    const elapsed = Math.max(0, state.worldTick - frozen);
    for (const invasion of state.activeInvasions.values()) {
      if (invasion.defenderFactionId === state.playerFactionId) {
        invasion.responseDeadlineTick += elapsed;
        if (invasion.defenseCompletionDeadlineTick !== null) {
          invasion.defenseCompletionDeadlineTick += elapsed;
        }
      }
    }
  }
  state.playerEmpirePause.paused = false;
  state.playerEmpirePause.pausedAtTick = null;
}

export function defenseDeadlineTick(notifiedAtTick: number): number {
  return notifiedAtTick + GAMEPLAY_CONFIG.defenseResponseMinutes * GAMEPLAY_CONFIG.ticksPerMinute;
}
