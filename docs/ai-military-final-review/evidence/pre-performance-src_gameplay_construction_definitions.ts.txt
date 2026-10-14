import { Resources, ResourceType } from '../../types';
import { ConstructionProject, ConstructionProjectType, GameState } from '../../types/GameState';
import { OrchestrationError, ErrorCode } from '../../orchestration/errors';
import { requireTerritory } from '../../orchestration/helpers';
import { cityIdFor, ensureCity, syncCityFortification } from '../cities/city';
import { GAMEPLAY_CONFIG } from '../config';
import { RESOURCE_KEYS } from '../economy/config';
import { persistTerritoryAccrual } from '../economy/accrual';
import { ensureTerritoryInfrastructure } from '../economy/effectiveOutput';
import { syncFactionResourceIncome } from '../economy/resourceIncome';

/** Gold is always required. Other keys are charged only when present and > 0. */
export type ConstructionCost = Partial<Resources> & { gold: number };

export interface ConstructionStartContext {
  state: GameState;
  factionId: string;
  territoryId: string;
}

export interface ConstructionCompleteContext {
  state: GameState;
  project: ConstructionProject;
}

export interface ConstructionProjectDefinition {
  projectType: ConstructionProjectType;
  cost: ConstructionCost;
  durationTicks: number;
  assertCanStart(ctx: ConstructionStartContext): void;
  onComplete(ctx: ConstructionCompleteContext): void;
}

export const CONSTRUCTION_PROJECT_TYPES: readonly ConstructionProjectType[] = [
  'CITY',
  'FORTIFICATION',
  'FARM',
  'MINE',
  'LUMBER',
];

export function isConstructionProjectType(value: unknown): value is ConstructionProjectType {
  return value === 'CITY'
    || value === 'FORTIFICATION'
    || value === 'FARM'
    || value === 'MINE'
    || value === 'LUMBER';
}

function assertOwnedTerritory(ctx: ConstructionStartContext): void {
  const territory = requireTerritory(ctx.state, ctx.territoryId);
  if (territory.owner !== ctx.factionId) {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Can only start construction on owned territory');
  }
}

function completeDevelopment(
  ctx: ConstructionCompleteContext,
  field: 'farmCompletedAtTick' | 'mineCompletedAtTick' | 'lumberCompletedAtTick',
): void {
  persistTerritoryAccrual(ctx.state, ctx.project.territoryId);
  const infra = ensureTerritoryInfrastructure(ctx.state, ctx.project.territoryId);
  infra[field] = ctx.state.worldTick;
  syncFactionResourceIncome(ctx.state, ctx.project.factionId);
}

const CITY_DEFINITION: ConstructionProjectDefinition = {
  projectType: 'CITY',
  cost: {
    gold: GAMEPLAY_CONFIG.cityGoldCost,
    stone: GAMEPLAY_CONFIG.cityStoneCost,
    iron: GAMEPLAY_CONFIG.cityIronCost,
  },
  durationTicks: GAMEPLAY_CONFIG.cityConstructionDurationTicks,
  assertCanStart(ctx) {
    assertOwnedTerritory(ctx);
    if (ctx.state.cities.get(cityIdFor(ctx.territoryId))) {
      throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Territory already has a city');
    }
  },
  onComplete(ctx) {
    ensureCity(ctx.state, ctx.project.territoryId, ctx.project.factionId);
  },
};

const FORTIFICATION_DEFINITION: ConstructionProjectDefinition = {
  projectType: 'FORTIFICATION',
  cost: {
    gold: GAMEPLAY_CONFIG.constructionGoldCost,
    stone: GAMEPLAY_CONFIG.constructionStoneCost,
  },
  durationTicks: GAMEPLAY_CONFIG.defaultConstructionDurationTicks,
  assertCanStart(ctx) {
    assertOwnedTerritory(ctx);
    const territory = requireTerritory(ctx.state, ctx.territoryId);
    if (!ctx.state.cities.get(cityIdFor(ctx.territoryId))) {
      throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Fortification requires a city on the territory');
    }
    if (territory.fortification >= GAMEPLAY_CONFIG.maxFortificationLevel) {
      throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Territory is already at maximum fortification');
    }
  },
  onComplete(ctx) {
    const territory = requireTerritory(ctx.state, ctx.project.territoryId);
    const city = ctx.state.cities.get(cityIdFor(ctx.project.territoryId));
    if (city && territory.fortification < GAMEPLAY_CONFIG.maxFortificationLevel) {
      territory.fortification += 1;
      syncCityFortification(
        ctx.state,
        ctx.project.territoryId,
        territory.fortification,
        ctx.state.worldTick,
      );
    }
  },
};

const FARM_DEFINITION: ConstructionProjectDefinition = {
  projectType: 'FARM',
  cost: {
    gold: GAMEPLAY_CONFIG.farmGoldCost,
    wood: GAMEPLAY_CONFIG.farmWoodCost,
  },
  durationTicks: GAMEPLAY_CONFIG.farmConstructionDurationTicks,
  assertCanStart(ctx) {
    assertOwnedTerritory(ctx);
    const infra = ctx.state.territoryInfrastructure.get(ctx.territoryId);
    if (infra?.farmCompletedAtTick != null) {
      throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Territory already has a farm');
    }
  },
  onComplete(ctx) {
    completeDevelopment(ctx, 'farmCompletedAtTick');
  },
};

const MINE_DEFINITION: ConstructionProjectDefinition = {
  projectType: 'MINE',
  cost: {
    gold: GAMEPLAY_CONFIG.mineGoldCost,
    wood: GAMEPLAY_CONFIG.mineWoodCost,
  },
  durationTicks: GAMEPLAY_CONFIG.mineConstructionDurationTicks,
  assertCanStart(ctx) {
    assertOwnedTerritory(ctx);
    const infra = ctx.state.territoryInfrastructure.get(ctx.territoryId);
    if (infra?.mineCompletedAtTick != null) {
      throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Territory already has a mine');
    }
  },
  onComplete(ctx) {
    completeDevelopment(ctx, 'mineCompletedAtTick');
  },
};

const LUMBER_DEFINITION: ConstructionProjectDefinition = {
  projectType: 'LUMBER',
  cost: {
    gold: GAMEPLAY_CONFIG.lumberGoldCost,
    stone: GAMEPLAY_CONFIG.lumberStoneCost,
  },
  durationTicks: GAMEPLAY_CONFIG.lumberConstructionDurationTicks,
  assertCanStart(ctx) {
    assertOwnedTerritory(ctx);
    const infra = ctx.state.territoryInfrastructure.get(ctx.territoryId);
    if (infra?.lumberCompletedAtTick != null) {
      throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Territory already has a lumber operation');
    }
  },
  onComplete(ctx) {
    completeDevelopment(ctx, 'lumberCompletedAtTick');
  },
};

const DEFINITIONS: Readonly<Record<ConstructionProjectType, ConstructionProjectDefinition>> = Object.freeze({
  CITY: CITY_DEFINITION,
  FORTIFICATION: FORTIFICATION_DEFINITION,
  FARM: FARM_DEFINITION,
  MINE: MINE_DEFINITION,
  LUMBER: LUMBER_DEFINITION,
});

export function getConstructionProjectDefinition(
  projectType: ConstructionProjectType,
): ConstructionProjectDefinition {
  const definition = DEFINITIONS[projectType];
  if (!definition) {
    throw new OrchestrationError(ErrorCode.INVALID_PARAMETER, `Unknown construction project type ${String(projectType)}`);
  }
  return definition;
}

export function listConstructionProjectTypes(): readonly ConstructionProjectType[] {
  return CONSTRUCTION_PROJECT_TYPES;
}

export function constructionCostAmount(cost: ConstructionCost, key: ResourceType): number {
  const amount = cost[key];
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0 ? amount : 0;
}

/** Positive spend keys for a project. Missing and zero keys are not charged. */
export function constructionCostEntries(cost: ConstructionCost): Array<{ resource: ResourceType; amount: number }> {
  const entries: Array<{ resource: ResourceType; amount: number }> = [];
  for (const resource of RESOURCE_KEYS) {
    const amount = constructionCostAmount(cost, resource);
    if (amount > 0) entries.push({ resource, amount });
  }
  return entries;
}
