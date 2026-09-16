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
}
