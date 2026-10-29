import { GameState, PendingGoldenYieldEffect } from '../../types/GameState';
import { OrchestrationError, ErrorCode } from '../../orchestration/errors';
import { requireFactionSnapshot, requireTerritory } from '../../orchestration/helpers';
import { RESOURCE_KEYS, emptyResources } from './config';
import { pendingProduction, persistTerritoryAccrual, peekCollectibleResources } from './accrual';
import { addResourcesChecked, resourcesTotal, scaleResources } from './production';

export interface CollectTerritoryYieldResult {
  /** Total base yield (all resources) before multiplier. */
  baseTotal: number;
  /** @deprecated Prefer baseResources; kept for telemetry compatibility. */
  base: number;
  baseResources: ReturnType<typeof emptyResources>;
  multiplier: number;
  /** Additional bonus credited by this collection; base production is already banked. */
  collectedTotal: number;
  /** @deprecated Prefer transferredResources; kept for telemetry compatibility. */
  collected: number;
  transferredResources: ReturnType<typeof emptyResources>;
  effectConsumed: boolean;
  /** @deprecated Use transferredResources */
  transferred: ReturnType<typeof emptyResources>;
}

/**
 * Acknowledges eligible production from an owned territory. Ordinary production
 * banks automatically; manual Golden Yield credits only floor(base * multiplier)
 * minus base, using the existing stored multiplier. Successful collection clears
 * the eligibility basis even without a Golden Yield effect.
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
  const multiplied = pending ? scaleResources(baseYield, multiplier) : baseYield;
  const transferred = emptyResources();
  for (const key of RESOURCE_KEYS) transferred[key] = multiplied[key] - baseYield[key];

  // Validate the complete result before changing bank, accrual watermark or effect.
  // Transaction/CAS remains the commit authority; this preflight also makes the
  // domain reducer safe on overflow without consuming an effect or eligibility.
  const next = addResourcesChecked(addResourcesChecked(faction.resources,
    pendingProduction(state, params.territoryId)), transferred);
  persistTerritoryAccrual(state, params.territoryId);
  faction.resources = next;

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
    baseTotal: resourcesTotal(baseYield),
    base: baseYield.gold,
    baseResources: { ...baseYield },
    multiplier,
    collectedTotal: resourcesTotal(transferred),
    collected: transferred.gold,
    transferredResources: transferred,
    effectConsumed: !!pending,
    transferred,
  };
}
