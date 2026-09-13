import { GameState, PendingGoldenYieldEffect } from '../../types/GameState';
import { OrchestrationError, ErrorCode } from '../../orchestration/errors';
import { requireFactionSnapshot, requireTerritory } from '../../orchestration/helpers';
import { emptyResources } from './config';
import { peekCollectibleResources } from './accrual';
import { addResourcesChecked, resourcesTotal, scaleResources } from './production';

export interface CollectTerritoryYieldResult {
  base: number;
  multiplier: number;
  collected: number;
  effectConsumed: boolean;
  transferred: ReturnType<typeof emptyResources>;
}

/**
 * Collects currently collectible yield from an owned territory into the
 * faction resource reserve. Golden Yield, if requested, multiplies that
 * one collection using the stored pending multiplier and is consumed only
 * on success.
 */
export function collectTerritoryYield(
  state: GameState,
  params: { factionId: string; territoryId: string; playerId: string; consumeGoldenYield: boolean },
): CollectTerritoryYieldResult {
  const territory = requireTerritory(state, params.territoryId);
  if (territory.owner !== params.factionId) {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Can only collect from owned territory');
  }
  const faction = requireFactionSnapshot(state, params.factionId);

  let pendingIndex = -1;
  let pending: PendingGoldenYieldEffect | undefined;
  if (params.consumeGoldenYield) {
    pendingIndex = state.playerRewards.pendingGoldenYieldEffects.findIndex((effect) => effect.playerId === params.playerId);
    if (pendingIndex < 0) {
      throw new OrchestrationError(ErrorCode.INVALID_TARGET, 'No pending Golden Yield effect');
    }
    pending = state.playerRewards.pendingGoldenYieldEffects[pendingIndex];
  }

  const baseYield = peekCollectibleResources(state, params.territoryId);
  if (params.consumeGoldenYield && resourcesTotal(baseYield) <= 0) {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'No collectible yield for Golden Yield');
  }

  const multiplier = pending ? pending.multiplier : 1;
  const transferred = pending ? scaleResources(baseYield, multiplier) : { ...baseYield };

  const previous = { ...faction.resources };
  try {
    const next = addResourcesChecked(faction.resources, transferred);
    faction.resources.gold = next.gold;
    faction.resources.food = next.food;
    faction.resources.iron = next.iron;
    faction.resources.wood = next.wood;
    faction.resources.stone = next.stone;
  } catch (err) {
    faction.resources.gold = previous.gold;
    faction.resources.food = previous.food;
    faction.resources.iron = previous.iron;
    faction.resources.wood = previous.wood;
    faction.resources.stone = previous.stone;
    throw err;
  }

  if (pending && pendingIndex >= 0) {
    state.playerRewards.pendingGoldenYieldEffects.splice(pendingIndex, 1);
  }

  const rec = state.territoryEconomy.get(params.territoryId);
  if (rec) {
    rec.uncollected = emptyResources();
    rec.lastAccrualTick = state.worldTick;
  } else {
    state.territoryEconomy.set(params.territoryId, {
      territoryId: params.territoryId,
      lastAccrualTick: state.worldTick,
      uncollected: emptyResources(),
    });
  }

  return {
    base: baseYield.gold,
    multiplier,
    collected: transferred.gold,
    effectConsumed: !!pending,
    transferred,
  };
}
