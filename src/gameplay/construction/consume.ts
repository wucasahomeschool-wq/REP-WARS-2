import { ConstructionProject, GameState } from '../../types/GameState';
import { OrchestrationError, ErrorCode } from '../../orchestration/errors';
import { requireFactionSnapshot, requireTerritory } from '../../orchestration/helpers';
import { GAMEPLAY_CONFIG, acceleratedRemainingTicks } from '../config';
import { ensureCity } from '../cities/city';
import { completeConstruction } from './complete';
import { progressConstruction, progressConstructionsOnTerritory } from './progress';

/**
 * Prototype 1 construction rule: at most one in-progress project per
 * territory/city. No queue. Starting construction spends Gold and Stone
 * and does not require a workout.
 */
export function startConstruction(
  state: GameState,
  params: { factionId: string; territoryId: string; projectId?: string },
): ConstructionProject {
  const faction = requireFactionSnapshot(state, params.factionId);
  const territory = requireTerritory(state, params.territoryId);
  if (territory.owner !== params.factionId) {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Can only start construction on owned territory');
  }
  if (territory.fortification >= GAMEPLAY_CONFIG.maxFortificationLevel) {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Territory is already at maximum fortification');
  }
  progressConstructionsOnTerritory(state, params.territoryId);
  for (const existing of state.constructions.values()) {
    if (existing.territoryId === params.territoryId && existing.status === 'in_progress') {
      throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Territory already has an in-progress construction');
    }
  }
  if (faction.resources.gold < GAMEPLAY_CONFIG.constructionGoldCost
    || faction.resources.stone < GAMEPLAY_CONFIG.constructionStoneCost) {
    throw new OrchestrationError(ErrorCode.INSUFFICIENT_RESOURCES, 'Insufficient resources to start construction');
  }
  const id = params.projectId ?? `con_${params.territoryId}_${state.worldTick}`;
  if (state.constructions.has(id)) {
    throw new OrchestrationError(ErrorCode.INVALID_PARAMETER, 'Construction id already exists');
  }
  ensureCity(state, params.territoryId, params.factionId);
  faction.resources.gold -= GAMEPLAY_CONFIG.constructionGoldCost;
  faction.resources.stone -= GAMEPLAY_CONFIG.constructionStoneCost;
  const project: ConstructionProject = {
    id,
    factionId: params.factionId,
    territoryId: params.territoryId,
    projectType: 'FORTIFICATION',
    startedAtTick: state.worldTick,
    lastProgressTick: state.worldTick,
    durationTicks: GAMEPLAY_CONFIG.defaultConstructionDurationTicks,
    remainingTicks: GAMEPLAY_CONFIG.defaultConstructionDurationTicks,
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
