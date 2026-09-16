import { ConstructionProject, ConstructionProjectType, GameState } from '../../types/GameState';
import { OrchestrationError, ErrorCode } from '../../orchestration/errors';
import { requireFactionSnapshot } from '../../orchestration/helpers';
import { acceleratedRemainingTicks } from '../config';
import { constructionCostEntries, getConstructionProjectDefinition } from './definitions';
import { progressConstruction, progressConstructionsOnTerritory } from './progress';
import { completeConstruction } from './complete';

/**
 * Start a timed construction project (CITY, FORTIFICATION, FARM, MINE, LUMBER).
 */
export function startConstruction(
  state: GameState,
  params: {
    factionId: string;
    territoryId: string;
    projectType?: ConstructionProjectType;
    projectId?: string;
  },
): ConstructionProject {
  const faction = requireFactionSnapshot(state, params.factionId);
  const projectType: ConstructionProjectType = params.projectType ?? 'FORTIFICATION';
  const definition = getConstructionProjectDefinition(projectType);
  definition.assertCanStart({ state, factionId: params.factionId, territoryId: params.territoryId });

  progressConstructionsOnTerritory(state, params.territoryId);
  for (const existing of state.constructions.values()) {
    if (existing.territoryId === params.territoryId && existing.status === 'in_progress') {
      throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Territory already has an in-progress construction');
    }
  }

  const { cost, durationTicks } = definition;
  const charges = constructionCostEntries(cost);
  for (const { resource, amount } of charges) {
    if (faction.resources[resource] < amount) {
      throw new OrchestrationError(ErrorCode.INSUFFICIENT_RESOURCES, 'Insufficient resources to start construction');
    }
  }

  const id = params.projectId ?? `con_${params.territoryId}_${state.worldTick}`;
  if (state.constructions.has(id)) {
    throw new OrchestrationError(ErrorCode.INVALID_PARAMETER, 'Construction id already exists');
  }

  for (const { resource, amount } of charges) {
    faction.resources[resource] -= amount;
  }

  const project: ConstructionProject = {
    id,
    factionId: params.factionId,
    territoryId: params.territoryId,
    projectType,
    startedAtTick: state.worldTick,
    lastProgressTick: state.worldTick,
    durationTicks,
    remainingTicks: durationTicks,
    status: 'in_progress',
    completedAtTick: null,
  };
  state.constructions.set(id, project);
  return project;
}

export function consumeConstructionEffect(
  state: GameState,
  params: { factionId: string; constructionId: string; playerId: string },
): ConstructionProject {
  const project = state.constructions.get(params.constructionId);
  if (!project) {
    throw new OrchestrationError(ErrorCode.INVALID_TARGET, 'Construction project not found');
  }
  if (project.factionId !== params.factionId) {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Action not allowed');
  }
  progressConstruction(state, project);
  if (project.status !== 'in_progress') {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Construction is no longer in progress');
  }
  const idx = state.playerRewards.pendingConstructionEffects.findIndex((effect) => effect.playerId === params.playerId);
  if (idx < 0) {
    throw new OrchestrationError(ErrorCode.INVALID_TARGET, 'No pending construction acceleration effect');
  }
  const [effect] = state.playerRewards.pendingConstructionEffects.splice(idx, 1);
  project.remainingTicks = acceleratedRemainingTicks(project.remainingTicks, effect!.workerPower);
  project.lastProgressTick = state.worldTick;
  if (project.remainingTicks <= 0) {
    completeConstruction(state, project);
  }
  return project;
}
