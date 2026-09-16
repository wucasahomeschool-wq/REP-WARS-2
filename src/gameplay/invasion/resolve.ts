import { Army } from '../../types';
import { GameState } from '../../types/GameState';
import { BattleEngine, BattleInput } from '../../battle/BattleEngine';
import { applyBattleResultToGameState } from '../../orchestration/applyBattle';
import { OrchestrationError, ErrorCode } from '../../orchestration/errors';
import { GameEvent, HandlerResult } from '../../orchestration/protocol';
import { armiesInTerritory, requireFactionSnapshot, requireTerritory } from '../../orchestration/helpers';
import { clearAttackIntent } from '../../army/strategicAttack';
import { failedDefenseContinuationTicks, successfulDefenseRecoveryTicks } from '../config';
import { isOpenInvasion } from './deadlines';
import { defenseWorkoutMultiplier, withTerritoryCombatView } from '../defense/territoryDefense';
import { abandonLinkedDefenseSession } from './session';
import { isPlayerAnchorProtected } from '../anchors';

export type InvasionResolveReason =
  | 'defense_battle'
  | 'undefended'
  | 'defense_timeout'
  | 'defense_abandoned';

function emptyResult(): HandlerResult {
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

function setCooldown(
  state: GameState,
  attackerId: string,
  field: 'recoveryUntilTick' | 'continuationUntilTick',
  untilTick: number,
): void {
  const current = state.attackerCooldowns.get(attackerId) ?? { recoveryUntilTick: null, continuationUntilTick: null };
  current[field] = untilTick;
  state.attackerCooldowns.set(attackerId, current);
}

function attackingArmies(state: GameState, invasion: { attackingArmyIds: string[] }): Army[] {
  return invasion.attackingArmyIds
    .map((id) => state.armies.get(id))
    .filter((a): a is Army => !!a);
}

function releaseInvasionArmies(state: GameState, invasion: { attackingArmyIds: string[] }): void {
  for (const army of attackingArmies(state, invasion)) {
    const live = state.armies.get(army.id);
    if (!live) continue;
    live.movement = null;
    clearAttackIntent(live);
  }
}

function closeCommitment(state: GameState, invasion: { attackerFactionId: string; commitmentId: string | null }, success: boolean): void {
  if (!invasion.commitmentId) return;
  const commitment = state.commitments.get(invasion.attackerFactionId);
  if (commitment && commitment.id === invasion.commitmentId) {
    commitment.status = success ? 'completed' : 'failed';
    commitment.statusReason = success ? 'player defense succeeded' : 'player defense failed';
  }
}

function invasionResolveEvent(params: {
  invasionId: string;
  territoryId: string;
  attackerFactionId: string;
  invasionOutcome: string;
  winner: unknown;
  territoryOutcome: unknown;
  resolveReason: InvasionResolveReason;
  resolvedWithoutBattle?: boolean;
}): GameEvent {
  return {
    kind: 'battle',
    id: `invasion_${params.invasionId}`,
    title: params.invasionOutcome,
    summary: `Invasion ${params.invasionId} ${params.invasionOutcome}`,
    territoryId: params.territoryId,
    factionId: params.attackerFactionId,
    data: {
      winner: params.winner,
      territoryOutcome: params.territoryOutcome,
      invasionId: params.invasionId,
      invasionOutcome: params.invasionOutcome,
      resolveReason: params.resolveReason,
      resolvedWithoutBattle: params.resolvedWithoutBattle === true,
    },
  };
}

function outcomeForReason(reason: InvasionResolveReason, battleSuccess: boolean | null): string {
  if (reason === 'undefended') return 'undefended';
  if (reason === 'defense_timeout') return 'defense_timeout';
  if (reason === 'defense_abandoned') return 'defense_abandoned';
  return battleSuccess ? 'defense_success' : 'defense_failure';
}

/**
 * Resolve an open invasion exactly once. Terminal invasions are deleted from
 * `activeInvasions`. Timeout/abandon/undefended paths never mint a defense reward.
 */
export function resolveInvasionBattle(
  state: GameState,
  battle: BattleEngine,
  invasionId: string,
  reason: InvasionResolveReason = 'defense_battle',
): HandlerResult {
  const invasion = state.activeInvasions.get(invasionId);
  if (!invasion || !isOpenInvasion(invasion)) {
    throw new OrchestrationError(ErrorCode.INVALID_TARGET, 'No active invasion to resolve');
  }

  if (reason === 'defense_timeout') {
    abandonLinkedDefenseSession(state, invasionId, 'INVASION_TIMEOUT');
  } else if (reason === 'undefended' || reason === 'defense_abandoned') {
    abandonLinkedDefenseSession(state, invasionId, reason === 'defense_abandoned' ? 'PLAYER' : 'INVASION_TIMEOUT');
  }

  const useMobilization = reason === 'defense_battle';
  const attackers = attackingArmies(state, invasion);
  if (attackers.length === 0) {
    setCooldown(state, invasion.attackerFactionId, 'continuationUntilTick', state.worldTick + failedDefenseContinuationTicks());
    closeCommitment(state, invasion, false);
    releaseInvasionArmies(state, invasion);
    state.activeInvasions.delete(invasionId);
    const invasionOutcome = outcomeForReason(reason, false);
    return {
      ...emptyResult(),
      events: [invasionResolveEvent({
        invasionId,
        territoryId: invasion.territoryId,
        attackerFactionId: invasion.attackerFactionId,
        invasionOutcome,
        winner: 'defender',
        territoryOutcome: 'unchanged',
        resolveReason: reason,
        resolvedWithoutBattle: true,
      })],
      payload: {
        attackOutcome: 'battle_resolved',
        invasionOutcome,
        invasionId,
        winner: 'defender',
        territoryOutcome: 'unchanged',
        defensePower: 0,
        territoryId: invasion.territoryId,
        resolvedWithoutBattle: true,
        resolveReason: reason,
      },
    };
  }

  const target = requireTerritory(state, invasion.territoryId);
  if (isPlayerAnchorProtected(state, invasion.territoryId)) {
    setCooldown(state, invasion.attackerFactionId, 'continuationUntilTick', state.worldTick + failedDefenseContinuationTicks());
    closeCommitment(state, invasion, false);
    releaseInvasionArmies(state, invasion);
    state.activeInvasions.delete(invasionId);
    return {
      ...emptyResult(),
      events: [invasionResolveEvent({
        invasionId,
        territoryId: invasion.territoryId,
        attackerFactionId: invasion.attackerFactionId,
        invasionOutcome: 'anchor_protected',
        winner: 'defender',
        territoryOutcome: 'unchanged',
        resolveReason: reason,
        resolvedWithoutBattle: true,
      })],
      payload: {
        attackOutcome: 'failed',
        invasionOutcome: 'anchor_protected',
        invasionId,
        winner: 'defender',
        territoryOutcome: 'unchanged',
        defensePower: 0,
        territoryId: invasion.territoryId,
        resolvedWithoutBattle: true,
        resolveReason: reason,
        reason: 'anchor_protected',
      },
    };
  }
  const attackerSnap = requireFactionSnapshot(state, invasion.attackerFactionId);
  const defenderSnap = requireFactionSnapshot(state, invasion.defenderFactionId);
  const realDefenders = armiesInTerritory(state, invasion.territoryId).filter((a) => a.owner === invasion.defenderFactionId);
  const workoutFactor = defenseWorkoutMultiplier(state, invasion.territoryId);
  const defensePower = useMobilization && invasion.defenseMobilization
    ? Math.max(0, Math.round(invasion.defenseMobilization.defensePower * workoutFactor))
    : 0;
  const virtualDefender = defensePower > 0
    ? [{ soldiers: defensePower, knights: 0, siegeEngines: 0, morale: 80, supply: 80 }]
    : [];
  const input: BattleInput = {
    turn: state.turn,
    seed: invasion.battleSeed ?? 1,
    attackerFactionId: invasion.attackerFactionId,
    attackerFactionName: attackerSnap.name,
    defenderFactionId: invasion.defenderFactionId,
    defenderFactionName: defenderSnap.name,
    attackerArmies: attackers,
    defenderArmies: [...realDefenders, ...virtualDefender],
    defenderGarrison: target.garrison,
    territory: withTerritoryCombatView(state, target),
  };
  const validation = battle.validate(input);
  if (!validation.valid) {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, validation.errors.join('; '), { errors: validation.errors });
  }
  const result = battle.resolve(input);
  const applied = applyBattleResultToGameState(state, result, attackers, realDefenders, state.turn);
  const success = result.winner === 'defender' || (result.winner === 'draw' && target.owner === invasion.defenderFactionId);
  if (success && reason === 'defense_battle') {
    setCooldown(state, invasion.attackerFactionId, 'recoveryUntilTick', state.worldTick + successfulDefenseRecoveryTicks());
  } else {
    setCooldown(state, invasion.attackerFactionId, 'continuationUntilTick', state.worldTick + failedDefenseContinuationTicks());
  }
  closeCommitment(state, invasion, success && reason === 'defense_battle');
  releaseInvasionArmies(state, invasion);
  state.activeInvasions.delete(invasionId);
  const invasionOutcome = outcomeForReason(reason, success);
  return {
    ...emptyResult(),
    stateChanges: applied.stateChanges,
    territoriesChanged: applied.territoryChanges,
    armiesChanged: applied.armyChanges,
    events: [
      invasionResolveEvent({
        invasionId,
        territoryId: invasion.territoryId,
        attackerFactionId: invasion.attackerFactionId,
        invasionOutcome,
        winner: result.winner,
        territoryOutcome: result.territoryOutcome,
        resolveReason: reason,
      }),
      ...applied.events,
    ],
    payload: {
      attackOutcome: 'battle_resolved',
      invasionOutcome,
      invasionId,
      winner: result.winner,
      territoryOutcome: result.territoryOutcome,
      defensePower,
      territoryId: invasion.territoryId,
      battle: result,
      resolveReason: reason,
    },
  };
}
