import { Resources } from '../../types';
import { ConstructionProject } from '../../types/GameState';
import { HandlerResult } from '../../orchestration/protocol';
import { recordAllResourceChanges } from '../../orchestration/helpers';

export function emptyHandlerResult(): HandlerResult {
  return {
    stateChanges: [],
    events: [],
    notifications: [],
    presentation: null,
    resourcesChanged: [],
    territoriesChanged: [],
    armiesChanged: [],
    newlyAvailableActions: [],
    payload: {},
  };
}

export function handlerResultForConstructionStart(
  project: ConstructionProject,
  territoryId: string,
  resourcesBefore: Resources,
  resourcesAfter: Resources,
  factionId: string,
): HandlerResult {
  const resourcesChanged: HandlerResult['resourcesChanged'] = [];
  recordAllResourceChanges(resourcesChanged, factionId, resourcesBefore, resourcesAfter);
  return {
    ...emptyHandlerResult(),
    stateChanges: [{
      entity: 'territory',
      id: territoryId,
      summary: `Started construction ${project.id}`,
    }],
    resourcesChanged,
    payload: {
      constructionId: project.id,
      projectType: project.projectType,
      remainingTicks: project.remainingTicks,
      status: project.status,
    },
  };
}
