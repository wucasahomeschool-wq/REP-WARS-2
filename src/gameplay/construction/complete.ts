import { settleOperation } from '../../engine/operations';
import { ConstructionProject, GameState } from '../../types/GameState';
import { getConstructionProjectDefinition } from './definitions';

export function completeConstruction(state: GameState, project: ConstructionProject): void {
  if (project.status === 'completed') return;
  const definition = getConstructionProjectDefinition(project.projectType);
  definition.onComplete({ state, project });
  project.remainingTicks = 0;
  project.lastProgressTick = state.worldTick;
  project.status = 'completed';
  project.completedAtTick = state.worldTick;
  if (project.aiOperationId) settleOperation(state, project.aiOperationId, 'completed', 'construction completed');
}
