import { WorldDefinition } from './types';

/**
 * Clone the authored WorldDefinition for GET_WORLD_DEFINITION.
 * Geometry (island / territory polygons) lives here, not on GameState.
 */
export function serializeWorldDefinitionForClient(definition: WorldDefinition): WorldDefinition {
  return JSON.parse(JSON.stringify(definition)) as WorldDefinition;
}
