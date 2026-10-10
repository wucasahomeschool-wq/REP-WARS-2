import { activeOperations, settleOperation } from '../../engine/operations';
import { FactionId, TerritoryId, Resources } from '../../types';
import { GameState } from '../../types/GameState';
import { cityIdFor, removeCity } from '../cities/city';
import { emptyResources } from './config';
import { persistTerritoryAccrual } from './accrual';
import { clearTerritoryInfrastructure } from './effectiveOutput';
import { syncFactionResourceIncome } from './resourceIncome';

export interface TerritoryDestructionReport {
  territoryId: TerritoryId;
  previousOwner: FactionId | null;
  newOwner: FactionId | null;
  cityDestroyed: boolean;
  cityId: string | null;
  fortificationDestroyed: number;
  farmDestroyed: boolean;
  mineDestroyed: boolean;
  lumberDestroyed: boolean;
  constructionCancelled: number;
  resourcesLost:Resources;
  undeployedTroopsLost:number;
}

export function territoryDestructionHasLosses(report: TerritoryDestructionReport): boolean {
  return report.cityDestroyed
    || report.fortificationDestroyed > 0
    || report.farmDestroyed
    || report.mineDestroyed
    || report.lumberDestroyed
    || report.constructionCancelled > 0;
}

function snapshotTerritoryDestruction(
  state: GameState,
  territoryId: TerritoryId,
  newOwner: FactionId | null,
  previousOwner: FactionId | null,
): TerritoryDestructionReport {
  const cityId = cityIdFor(territoryId);
  const cityDestroyed = state.cities.has(cityId);
  const infra = state.territoryInfrastructure.get(territoryId);
  const territory = state.territories.get(territoryId);
  let constructionCancelled = 0;
  for (const project of state.constructions.values()) {
    if (project.territoryId === territoryId && project.status === 'in_progress') {
      constructionCancelled += 1;
    }
  }
  return {
    territoryId,
    previousOwner,
    newOwner,
    cityDestroyed,
    cityId: cityDestroyed ? cityId : null,
    fortificationDestroyed: territory?.fortification ?? 0,
    farmDestroyed: infra?.farmCompletedAtTick != null,
    mineDestroyed: infra?.mineCompletedAtTick != null,
    lumberDestroyed: infra?.lumberCompletedAtTick != null,
    constructionCancelled,
    resourcesLost:emptyResources(),
    undeployedTroopsLost:state.territoryRecruitment.get(territoryId)?.troops??0,
  };
}

/** PROVISIONAL IMPLEMENTATION POLICY — PRODUCT CONFIRMATION REQUIRED.
 * Narrow local-garrison analogue: undeployed troops/fraction are destroyed on
 * ownership transfer. No capture, retreat or redistribution rule is inferred.
 * Replace this policy here if product confirms different pool treatment; the
 * canonical pool/claim architecture does not require destruction.
 */
export function applyLocalPoolConquestPolicy(state: GameState, territoryId: TerritoryId): void {
  state.territoryRecruitment.delete(territoryId);
}

/**
 * Ownership-transfer settlement:
 * 1. Stop the previous owner's production clock.
 * 2. Forfeit uncollected yield.
 * 3. Cancel in-progress construction without refund.
 * 4. Destroy city, fortification, and resource developments. Authored resourceOutput stays.
 */
export function settleTerritoryOwnershipChange(
  state: GameState,
  territoryId: TerritoryId,
  newOwner: FactionId | null,
  previousOwner: FactionId | null = null,
): TerritoryDestructionReport {
  const report = snapshotTerritoryDestruction(state, territoryId, newOwner, previousOwner);
  for(const op of activeOperations(state).filter(op=>op.plan?.action==='REINFORCE'&&op.plan.territoryId===territoryId))
    settleOperation(state,op.id,'failed','Local reinforcement source ownership changed');
  applyLocalPoolConquestPolicy(state, territoryId);
  persistTerritoryAccrual(state, territoryId);
  const rec = state.territoryEconomy.get(territoryId);
  if (rec) {
    report.resourcesLost={...rec.uncollected};
    rec.uncollected = emptyResources();
    rec.lastAccrualTick = state.worldTick;
    if(rec.foodAccrualTick!==undefined)rec.foodAccrualTick=state.worldTick;
  }
  for (const [id, project] of [...state.constructions.entries()]) {
    if (project.territoryId === territoryId && project.status === 'in_progress') {
      state.constructions.delete(id);
      if (project.aiOperationId) settleOperation(state, project.aiOperationId, 'failed', 'construction destroyed by ownership change');
    }
  }
  removeCity(state, territoryId);
  clearTerritoryInfrastructure(state, territoryId);
  const territory = state.territories.get(territoryId);
  if (territory) {
    territory.fortification = 0;
    territory.garrison = 0;
  }
  if (previousOwner) syncFactionResourceIncome(state, previousOwner);
  if (newOwner) syncFactionResourceIncome(state, newOwner);
  return report;
}
