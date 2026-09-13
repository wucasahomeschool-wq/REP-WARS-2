import { GameState, PendingGoldenYieldEffect } from '../../types/GameState';

/** Stores a one-time Golden Yield effect. Does not mint resources. */
export function addPendingGoldenYieldEffect(
  draft: GameState,
  effect: PendingGoldenYieldEffect,
): { from: number; to: number } {
  const from = draft.playerRewards.pendingGoldenYieldEffects.length;
  draft.playerRewards.pendingGoldenYieldEffects.push(effect);
  return { from, to: draft.playerRewards.pendingGoldenYieldEffects.length };
}
