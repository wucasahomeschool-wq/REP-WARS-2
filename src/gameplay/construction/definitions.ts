import { Resources, ResourceType } from '../../types';
import { ConstructionProject, ConstructionProjectType, GameState } from '../../types/GameState';
import { OrchestrationError, ErrorCode, OrchestrationErrorBody } from '../../orchestration/errors';
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

/** Pure prerequisite probe shared with authoritative command validation.
 * Ordinary unavailable candidates need no Error/stack allocation. Resource,
 * slot and timing validation remain in their existing execution paths. */
export function constructionStartProblem(type: ConstructionProjectType, ctx: ConstructionStartContext): OrchestrationErrorBody | null {
  const territory = ctx.state.territories.get(ctx.territoryId);
  if (!territory) return { code: ErrorCode.INVALID_TERRITORY, message: `Unknown territory: ${ctx.territoryId}`, details: { territoryId: ctx.territoryId } };
  const unavailable = (message: string): OrchestrationErrorBody => ({ code: ErrorCode.ACTION_NOT_ALLOWED, message });
  if (territory.owner !== ctx.factionId) return unavailable('Can only start construction on owned territory');
  switch (type) {
    case 'CITY':
      return ctx.state.cities.get(cityIdFor(ctx.territoryId)) ? unavailable('Territory already has a city') : null;
    case 'FORTIFICATION':
      if (!ctx.state.cities.get(cityIdFor(ctx.territoryId))) return unavailable('Fortification requires a city on the territory');
      return territory.fortification >= GAMEPLAY_CONFIG.maxFortificationLevel ? unavailable('Territory is already at maximum fortification') : null;
    case 'FARM': return ctx.state.territoryInfrastructure.get(ctx.territoryId)?.farmCompletedAtTick != null ? unavailable('Territory already has a farm') : null;
    case 'MINE': return ctx.state.territoryInfrastructure.get(ctx.territoryId)?.mineCompletedAtTick != null ? unavailable('Territory already has a mine') : null;
    case 'LUMBER': return ctx.state.territoryInfrastructure.get(ctx.territoryId)?.lumberCompletedAtTick != null ? unavailable('Territory already has a lumber operation') : null;
  }
}
function assertConstructionCanStart(type: ConstructionProjectType, ctx: ConstructionStartContext): void {
  const problem = constructionStartProblem(type, ctx);
  if (problem) throw new OrchestrationError(problem.code, problem.message, problem.details);
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
    assertConstructionCanStart('CITY', ctx);
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
    assertConstructionCanStart('FORTIFICATION', ctx);
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
    assertConstructionCanStart('FARM', ctx);
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
    assertConstructionCanStart('MINE', ctx);
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
    assertConstructionCanStart('LUMBER', ctx);
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
