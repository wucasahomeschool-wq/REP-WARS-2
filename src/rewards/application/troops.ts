import { GameState } from '../../types/GameState';

/** Adds banked Troops. Does not touch armies, garrisons, or military power. */
export function addBankedTroops(draft: GameState, amount: number): { from: number; to: number } {
  const from = draft.playerRewards.bankedTroops;
  const to = from + amount;
  draft.playerRewards.bankedTroops = to;
  return { from, to };
}
