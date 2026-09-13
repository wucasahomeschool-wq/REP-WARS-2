import { ActiveInvasion, GameState } from '../../types/GameState';
import { DefenseMobilizationReward } from '../types';
import { applicationFailure } from './errors';
import { RewardApplicationContext, RewardApplicationFailure } from './types';
import { defenseCompletionDeadlineTick, isDeadlineElapsed, isOpenInvasion } from '../../gameplay/invasion/deadlines';
import { playerFacingTick } from '../../gameplay/invasion/eligibility';

export type InvasionLookup =
  | { ok: true; invasion: ActiveInvasion }
  | { ok: false; failure: RewardApplicationFailure };

/**
 * DEFENSE is a live response to an active invasion. Missing, inactive, or
 * foreign invasions fail; power is never stored as generic bankedDefensePower.
 */
export function findInvasionForDefense(
  state: GameState,
  context: RewardApplicationContext,
  playerFactionId: string,
): InvasionLookup {
  const invasionId = context.invasionId;
  if (typeof invasionId !== 'string' || invasionId.trim() === '') {
    return {
      ok: false,
      failure: applicationFailure('reward_application.no_active_invasion', 'DEFENSE rewards require an active invasion id'),
    };
  }

  const invasion = state.activeInvasions.get(invasionId);
  if (!invasion || !isOpenInvasion(invasion)) {
    return {
      ok: false,
      failure: applicationFailure(
        'reward_application.no_active_invasion',
        'No active invasion exists for this defense reward',
        { invasionId },
      ),
    };
  }

  if (invasion.defenderFactionId !== playerFactionId) {
    return {
      ok: false,
      failure: applicationFailure(
        'reward_application.invasion_not_owned',
        'Action not allowed',
        { invasionId, defenderFactionId: invasion.defenderFactionId, playerFactionId },
      ),
    };
  }

  if (invasion.defenseMobilization) {
    return {
      ok: false,
      failure: applicationFailure(
        'reward_application.invasion_already_defended',
        'This invasion already has a defense mobilization attached',
        { invasionId, existingApplicationId: invasion.defenseMobilization.applicationId },
      ),
    };
  }

  const started = context.workoutStartedAtTick ?? invasion.defenseWorkoutStartedAtTick;
  if (started === null || started === undefined) {
    return {
      ok: false,
      failure: applicationFailure(
        'reward_application.invalid_mode',
        'DEFENSE rewards require a recorded workout start tick',
        { invasionId },
      ),
    };
  }
  if (started > invasion.responseDeadlineTick) {
    return {
      ok: false,
      failure: applicationFailure(
        'reward_application.defense_deadline_missed',
        'Defense workout started after the response deadline',
        { invasionId, started, deadline: invasion.responseDeadlineTick },
      ),
    };
  }
  if (
    invasion.defenseCompletionDeadlineTick !== null
    && isDeadlineElapsed(playerFacingTick(state), invasion.defenseCompletionDeadlineTick)
  ) {
    return {
      ok: false,
      failure: applicationFailure(
        'reward_application.no_active_invasion',
        'Defense workout exceeded the maximum completion window',
        { invasionId, deadline: invasion.defenseCompletionDeadlineTick },
      ),
    };
  }

  return { ok: true, invasion };
}

export function attachDefenseMobilization(
  draft: GameState,
  invasionId: string,
  reward: DefenseMobilizationReward,
  applicationId: string,
  workoutStartedAtTick: number | null,
): void {
  const invasion = draft.activeInvasions.get(invasionId);
  if (!invasion) {
    throw new Error(`Missing invasion ${invasionId} during defense attach`);
  }
  invasion.defenseMobilization = {
    applicationId,
    sessionId: reward.sessionId,
    workoutId: reward.workoutId,
    playerId: reward.playerId,
    defensePower: reward.defensePower,
    attachedAtTick: draft.worldTick,
    workoutStartedAtTick,
    sourcePhysicalOutput: reward.sourcePhysicalOutput,
  };
  if (invasion.defenseWorkoutStartedAtTick === null && workoutStartedAtTick !== null) {
    invasion.defenseWorkoutStartedAtTick = workoutStartedAtTick;
  }
  if (invasion.status === 'pending_response') {
    invasion.status = 'defense_in_progress';
  }
  if (invasion.defenseCompletionDeadlineTick === null && invasion.defenseWorkoutStartedAtTick !== null) {
    invasion.defenseCompletionDeadlineTick = defenseCompletionDeadlineTick(invasion.defenseWorkoutStartedAtTick);
  }
  if (invasion.defenseSessionId === null) {
    invasion.defenseSessionId = reward.sessionId;
  }
}
