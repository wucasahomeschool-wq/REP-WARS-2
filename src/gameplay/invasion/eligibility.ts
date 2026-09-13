import { GameState } from '../../types/GameState';
import { playerProtectionTicks } from '../config';

export function playerFacingTick(state: GameState): number {
  if (state.playerEmpirePause.paused && state.playerEmpirePause.pausedAtTick !== null) {
    return state.playerEmpirePause.pausedAtTick;
  }
  return state.worldTick;
}

export function isPlayerEmpirePaused(state: GameState): boolean {
  return state.playerEmpirePause.paused === true;
}

export function isPlayerProtected(state: GameState, nowTick = playerFacingTick(state)): boolean {
  const last = state.playerFitness.lastWorkoutCompletedAtTick;
  if (last === null) return false;
  return nowTick < last + playerProtectionTicks();
}

export function attackerRecoveryUntil(state: GameState, attackerId: string): number | null {
  return state.attackerCooldowns.get(attackerId)?.recoveryUntilTick ?? null;
}

export function attackerContinuationUntil(state: GameState, attackerId: string): number | null {
  return state.attackerCooldowns.get(attackerId)?.continuationUntilTick ?? null;
}

export function isAttackerOnCooldown(state: GameState, attackerId: string, nowTick = state.worldTick): boolean {
  const rec = attackerRecoveryUntil(state, attackerId);
  if (rec !== null && nowTick < rec) return true;
  const cont = attackerContinuationUntil(state, attackerId);
  if (cont !== null && nowTick < cont) return true;
  return false;
}

export function canAiAttackPlayer(state: GameState, attackerId: string): boolean {
  if (!state.playerFactionId) return false;
  if (isPlayerEmpirePaused(state)) return false;
  if (isPlayerProtected(state)) return false;
  if (isAttackerOnCooldown(state, attackerId)) return false;
  return true;
}

export function isAttackForbiddenOnSnapshot(
  snapshot: {
    attackRestrictions?: {
      playerFactionId: string | null;
      worldTick: number;
      lastPlayerWorkoutCompletedAtTick: number | null;
      playerPaused: boolean;
      attackerRecoveryUntilTick: Map<string, number>;
      attackerContinuationUntilTick: Map<string, number>;
    };
  },
  attackerId: string,
  defenderOwnerId: string,
): boolean {
  const rules = snapshot.attackRestrictions;
  if (!rules || !rules.playerFactionId || defenderOwnerId !== rules.playerFactionId) {
    return false;
  }
  if (rules.playerPaused) return true;
  const last = rules.lastPlayerWorkoutCompletedAtTick;
  if (last !== null && rules.worldTick < last + playerProtectionTicks()) return true;
  const rec = rules.attackerRecoveryUntilTick.get(attackerId);
  if (rec !== undefined && rules.worldTick < rec) return true;
  const cont = rules.attackerContinuationUntilTick.get(attackerId);
  if (cont !== undefined && rules.worldTick < cont) return true;
  return false;
}
