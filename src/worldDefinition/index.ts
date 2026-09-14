export { WORLD_FORMAT_VERSION } from './types';
export type {
  ContainedWorldDefinition,
  RegionDefinition,
  TerritoryDefinition,
  WorldCompletion,
  WorldDefinition,
  WorldFactionDefinition,
  WorldLoadResult,
  WorldPersonalityDefinition,
  WorldPolygon,
  WorldStartingArmy,
  WorldValidationIssue,
  WorldVec2,
} from './types';
export { validateWorldDefinition, assertValidWorld } from './validate';
export { loadWorldDefinition, parseWorldJson } from './parse';
export {
  WorldCatalog,
  getDefaultWorldCatalog,
  loadTinyWorldDefinition,
  loadWorldDefinitionFromFile,
  requireWorldDefinition,
  resetDefaultWorldCatalogForTests,
  tinyWorldJsonPath,
} from './catalog';
export { createGameStateFromWorld, LEGACY_SAMPLE_REGION_ID, LEGACY_SAMPLE_WORLD_ID } from './instantiate';
export { regionDisplayName, withTerritoryBattleLabel } from './display';
