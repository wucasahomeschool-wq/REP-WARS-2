import { GameState, PendingConstructionEffect } from '../../types/GameState';

/** Stores pending construction acceleration. Does not complete buildings. */
export function addPendingConstructionEffect(
  draft: GameState,
  effect: PendingConstructionEffect,
): { from: number; to: number } {
  const from = draft.playerRewards.pendingConstructionEffects.length;
  draft.playerRewards.pendingConstructionEffects.push(effect);
  return { from, to: draft.playerRewards.pendingConstructionEffects.length };
}
