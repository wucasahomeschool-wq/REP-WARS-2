/**
 * Player/faction authorization for reward application.
 *
 * Reuses Phase 16.5A principles: the target faction is GameState.playerFactionId.
 * A caller-supplied factionId is untrusted. Fitness playerId is not a faction id.
 */
import { GameState } from '../../types/GameState';
import { GameRewardResult } from '../types';
import { applicationFailure } from './errors';
import { RewardApplicationContext, RewardApplicationFailure } from './types';

export type RewardAuthorization =
  | { ok: true; factionId: string }
  | { ok: false; failure: RewardApplicationFailure };

export function authorizeRewardApplication(
  state: GameState,
  reward: GameRewardResult,
  context: RewardApplicationContext,
): RewardAuthorization {
  if (typeof context.playerId !== 'string' || context.playerId.trim() === '') {
    return { ok: false, failure: applicationFailure('reward_application.unauthorized', 'playerId is required') };
  }
  if (context.playerId !== reward.playerId) {
    return {
      ok: false,
      failure: applicationFailure(
        'reward_application.unauthorized',
        'Reward playerId does not match the authorized player',
        { rewardPlayerId: reward.playerId, contextPlayerId: context.playerId },
      ),
    };
  }

  const playerFactionId = state.playerFactionId;
  if (playerFactionId === null) {
    return {
      ok: false,
      failure: applicationFailure(
        'reward_application.no_player_faction',
        'Reward application requires GameState.playerFactionId',
      ),
    };
  }
  if (!state.factions.has(playerFactionId)) {
    return {
      ok: false,
      failure: applicationFailure(
        'reward_application.invalid_target',
        'playerFactionId does not reference a known faction',
        { factionId: playerFactionId },
      ),
    };
  }

  if (context.factionId !== undefined) {
    if (typeof context.factionId !== 'string' || context.factionId.trim() === '') {
      return {
        ok: false,
        failure: applicationFailure('reward_application.faction_mismatch', 'factionId is invalid'),
      };
    }
    if (context.factionId !== playerFactionId) {
      return {
        ok: false,
        failure: applicationFailure(
          'reward_application.faction_mismatch',
          'Action not allowed',
          { requested: context.factionId, playerFactionId },
        ),
      };
    }
  }

  return { ok: true, factionId: playerFactionId };
}
