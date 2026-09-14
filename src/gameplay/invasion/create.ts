import { Army } from '../../types';
import { ActiveInvasion, createActiveInvasion, GameState } from '../../types/GameState';
import { listImmediateAttackingArmies } from '../../army/strategicAttack';
import { deriveBattleSeed, requireTerritory } from '../../orchestration/helpers';
import { OrchestrationError, ErrorCode } from '../../orchestration/errors';
import { HandlerResult } from '../../orchestration/protocol';
import { defenseResponseTicks } from '../config';
import { canAiAttackPlayer } from './eligibility';
import { isOpenInvasion } from './deadlines';

function empty(): HandlerResult {
  return {
    stateChanges: [],
    events: [],
    notifications: [],
    presentation: null,
    resourcesChanged: [],
    territoriesChanged: [],
    armiesChanged: [],
    newlyAvailableActions: [],
    payload: {},
  };
}

export function beginInvasionAgainstPlayer(
  state: GameState,
  params: {
    attackerId: string;
    territoryId: string;
    armies: Army[];
    commitmentId?: string | null;
    battleSeed?: number;
  },
): HandlerResult {
  if (!state.playerFactionId) {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'No player faction to invade');
  }
  if (!canAiAttackPlayer(state, params.attackerId)) {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Player is protected, paused, or attacker is on cooldown');
  }
  const target = requireTerritory(state, params.territoryId);
  if (target.owner !== state.playerFactionId) {
    throw new OrchestrationError(ErrorCode.INVALID_TARGET, 'Invasion defender must be the local player');
  }
  for (const existing of state.activeInvasions.values()) {
    if (existing.territoryId === params.territoryId && isOpenInvasion(existing)) {
      throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'An active invasion already targets this territory');
    }
  }
  const notifiedAtTick = state.worldTick;
  const invasion = createActiveInvasion({
    id: `inv_${params.attackerId}_${params.territoryId}_${state.worldTick}`,
    defenderFactionId: state.playerFactionId,
    attackerFactionId: params.attackerId,
    territoryId: params.territoryId,
    startedAtTick: state.worldTick,
    notifiedAtTick,
    responseDeadlineTick: notifiedAtTick + defenseResponseTicks(),
    attackingArmyIds: params.armies.map((a) => a.id),
    battleSeed: params.battleSeed ?? deriveBattleSeed(state.worldSeed, state.turn, params.attackerId, state.playerFactionId, params.territoryId),
    commitmentId: params.commitmentId ?? null,
  });
  state.activeInvasions.set(invasion.id, invasion);
  for (const army of params.armies) {
    const live = state.armies.get(army.id);
    if (!live) continue;
    live.attackIntent = {
      targetTerritoryId: params.territoryId,
      stagingTerritoryId: live.location,
      createdAtTick: state.worldTick,
      status: 'ready',
      commitmentId: params.commitmentId ?? null,
      battleSeed: invasion.battleSeed ?? 0,
      holdForInvasionId: invasion.id,
      onlyArmyId: live.id,
    };
  }
  return {
    ...empty(),
    stateChanges: [{
      entity: 'territory',
      id: params.territoryId,
      summary: `Invasion ${invasion.id} notified against ${params.territoryId}`,
    }],
    notifications: [{
      severity: 'warning',
      title: 'Invasion',
      body: `Defend ${params.territoryId} before tick ${invasion.responseDeadlineTick}`,
    }],
    payload: {
      attackOutcome: 'invasion_created',
      invasionId: invasion.id,
      responseDeadlineTick: invasion.responseDeadlineTick,
      notifiedAtTick: invasion.notifiedAtTick,
      arrivalPending: true,
      skipped: true,
    },
  };
}

export function armiesForImmediateInvasion(
  state: GameState,
  attackerId: string,
  territoryId: string,
): Army[] {
  return listImmediateAttackingArmies(state, attackerId, territoryId);
}

export function existingInvasionForAttack(
  state: GameState,
  attackerId: string,
  territoryId: string,
): ActiveInvasion | undefined {
  return [...state.activeInvasions.values()].find((invasion) => (
    isOpenInvasion(invasion)
    && invasion.attackerFactionId === attackerId
    && invasion.territoryId === territoryId
  ));
}

/**
 * If this is an AI attack against the local player, create or hold an
 * ActiveInvasion instead of resolving BattleEngine immediately.
 * Returns null when the normal strategic-attack path should continue
 * (player attacker, AI-vs-AI, or delayed hop with no staging army yet).
 */
export function maybeHoldAttackAsInvasion(
  state: GameState,
  params: {
    attackerId: string;
    territoryId: string;
    armies: Army[];
    commitmentId?: string | null;
    battleSeed?: number;
  },
): HandlerResult | null {
  if (!state.playerFactionId || params.attackerId === state.playerFactionId) return null;
  const target = state.territories.get(params.territoryId);
  if (!target || target.owner !== state.playerFactionId) return null;
  const existing = existingInvasionForAttack(state, params.attackerId, params.territoryId);
  if (existing) {
    return {
      ...empty(),
      payload: {
        attackOutcome: 'awaiting_defense',
        invasionId: existing.id,
        skipped: true,
        arrivalPending: true,
      },
    };
  }
  if (params.armies.length === 0) return null;
  return beginInvasionAgainstPlayer(state, params);
}
