import { ConstructionProject, GameState } from '../../types/GameState';
import { GAMEPLAY_CONFIG } from '../config';
import { ensureCity, syncCityFortification } from '../cities/city';
import { requireTerritory } from '../../orchestration/helpers';

export function completeConstruction(state: GameState, project: ConstructionProject): void {
  if (project.status === 'completed') return;
  const territory = requireTerritory(state, project.territoryId);
  ensureCity(state, project.territoryId, project.factionId);
  if (project.projectType === 'FORTIFICATION' && territory.fortification < GAMEPLAY_CONFIG.maxFortificationLevel) {
    territory.fortification += 1;
    syncCityFortification(state, project.territoryId, territory.fortification, state.worldTick);
  }
  project.remainingTicks = 0;
  project.lastProgressTick = state.worldTick;
  project.status = 'completed';
  project.completedAtTick = state.worldTick;
}
