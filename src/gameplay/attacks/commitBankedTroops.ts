import { Army } from '../../types';
import { GameState } from '../../types/GameState';
import { MIN_ATTACKING_TROOPS, startStrategicAttack, StrategicAttackHost } from '../../army/strategicAttack';
import { OrchestrationError, ErrorCode } from '../../orchestration/errors';
import { HandlerResult } from '../../orchestration/protocol';
import { requireFactionSnapshot, requireTerritory } from '../../orchestration/helpers';
import { isLegalStagingTerritory, listLegalStagingTerritoryIds } from '../../army/strategicAttack';
import { assertPlayerCanSeeTarget } from './visibility';

function pickSpawnTerritory(state: GameState, factionId: string, targetId: string): string {
  const staging = listLegalStagingTerritoryIds(state, factionId, targetId);
  if (staging[0]) return staging[0];
  const owned = requireFactionSnapshot(state, factionId).territories;
  for (const originId of [...owned].sort()) {
    const origin = state.territories.get(originId);
    if (!origin) continue;
    for (const neighborId of origin.neighboring) {
      if (isLegalStagingTerritory(state, factionId, neighborId, targetId)) {
        return originId;
      }
    }
  }
  throw new OrchestrationError(
    ErrorCode.INSUFFICIENT_TROOPS,
    'No legal immediate or one-hop staging position for this attack',
  );
}

/**
 * Deducts banked Troops and creates a dedicated army for BattleEngine.
 * Existing map armies are not mixed into the committed force.
 */
export function commitBankedTroopsAndAttack(
  state: GameState,
  host: StrategicAttackHost,
  params: {
    factionId: string;
    territoryId: string;
    commitAmount: number;
    playerFactionId: string | null;
  },
): HandlerResult {
  if (params.playerFactionId !== params.factionId) {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Only the local player can commit banked Troops');
  }
  const amount = params.commitAmount;
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new OrchestrationError(ErrorCode.INVALID_PARAMETER, 'commitAmount must be a positive safe integer');
  }
  if (amount <= MIN_ATTACKING_TROOPS) {
    throw new OrchestrationError(
      ErrorCode.INSUFFICIENT_TROOPS,
      `Committed troops must exceed ${MIN_ATTACKING_TROOPS}`,
    );
  }
  if (amount > state.playerRewards.bankedTroops) {
    throw new OrchestrationError(ErrorCode.INSUFFICIENT_TROOPS, 'commitAmount exceeds banked Troops');
  }
  requireTerritory(state, params.territoryId);
  assertPlayerCanSeeTarget(state, params.factionId, params.territoryId);

  const spawnId = pickSpawnTerritory(state, params.factionId, params.territoryId);
  const armyId = `banked_${params.factionId}_${state.worldTick}_${amount}_${state.armies.size}`;
  if (state.armies.has(armyId)) {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'A committed attack army id collided');
  }
  const army: Army = {
    id: armyId,
    owner: params.factionId,
    location: spawnId,
    soldiers: amount,
    knights: 0,
    siegeEngines: 0,
    morale: 80,
    supply: 80,
    movement: null,
    attackIntent: null,
  };
  state.armies.set(armyId, army);
  const faction = requireFactionSnapshot(state, params.factionId);
  faction.armies.push(armyId);
  state.playerRewards.bankedTroops -= amount;

  const result = startStrategicAttack(state, host, {
    territoryId: params.territoryId,
    factionId: params.factionId,
    onlyArmyId: armyId,
  });
  result.stateChanges.push({
    entity: 'faction',
    id: params.factionId,
    field: 'bankedTroops',
    from: state.playerRewards.bankedTroops + amount,
    to: state.playerRewards.bankedTroops,
    summary: `Committed ${amount} banked Troops to attack ${params.territoryId}`,
  });
  result.payload = {
    ...result.payload,
    committedTroops: amount,
    remainingBankedTroops: state.playerRewards.bankedTroops,
    committedArmyId: armyId,
  };
  return result;
}
