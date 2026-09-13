import { ConstructionProject, GameState } from '../../types/GameState';
import { completeConstruction } from './complete';

function lastProgressTick(project: ConstructionProject): number {
  return project.lastProgressTick ?? project.startedAtTick;
}

/** Display remaining ticks without mutating stored construction state. */
export function displayedRemainingTicks(project: ConstructionProject, worldTick: number): number {
  if (project.status !== 'in_progress') return 0;
  const elapsed = Math.max(0, worldTick - lastProgressTick(project));
  return Math.max(0, project.remainingTicks - elapsed);
}

/**
 * Catch up one project to `state.worldTick`. World-time elapsed is subtracted
 * from remainingTicks exactly once by advancing lastProgressTick to now.
 */
export function progressConstruction(state: GameState, project: ConstructionProject): ConstructionProject {
  if (project.status !== 'in_progress') return project;
  const elapsed = Math.max(0, state.worldTick - lastProgressTick(project));
  if (elapsed > 0) {
    project.remainingTicks = Math.max(0, project.remainingTicks - elapsed);
    project.lastProgressTick = state.worldTick;
  }
  if (project.remainingTicks <= 0) {
    completeConstruction(state, project);
  }
  return project;
}

export function progressAllConstructions(state: GameState): void {
  for (const project of state.constructions.values()) {
    progressConstruction(state, project);
  }
}

export function progressConstructionsOnTerritory(state: GameState, territoryId: string): void {
  for (const project of state.constructions.values()) {
    if (project.territoryId === territoryId) {
      progressConstruction(state, project);
    }
  }
}
