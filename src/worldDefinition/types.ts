/**
 * Authoritative authored-world content (rep-wars-world.v1).
 * Immutable for a run. Mutable overlay lives on GameState, not here.
 *
 * Geometry stays on WorldDefinition. GameState stores IDs, owners, and
 * runtime fields only — polygons are not duplicated into the tick snapshot.
 */
import { FactionId, RegionId, RelationshipState, Resources, TerrainType, TerritoryId } from '../types';

export const WORLD_FORMAT_VERSION = 'rep-wars-world.v1' as const;
export type WorldFormatVersion = typeof WORLD_FORMAT_VERSION;

export interface WorldVec2 {
  x: number;
  y: number;
}

/** GeoJSON-like rings in world-local 2D (+x right, +y up). rings[0] is the exterior. */
export interface WorldPolygon {
  rings: WorldVec2[][];
}

export type WorldCompletion =
  | { type: 'control_fraction'; fraction: number }
  | { type: 'eliminate_ai' }
  | { type: 'manual' };

export interface ContainedWorldDefinition {
  worldId: string;
  regionId: RegionId;
  placement: {
    origin: WorldVec2;
    rotationDegrees: number;
    scale: number;
  };
}

export interface WorldPersonalityTraits {
  aggression: number;
  defensiveness: number;
  expansionism: number;
  opportunism: number;
  diplomacy: number;
  economics: number;
  riskTolerance: number;
  patience: number;
  forgivingness: number;
  loyalty: number;
}

export interface WorldPersonalityDefinition {
  id: string;
  label: string;
  ambition: number;
  traits: WorldPersonalityTraits;
}

export type WorldFactionRole = 'player' | 'ai';

export interface WorldStartingArmy {
  soldiers: number;
  knights: number;
  siegeEngines: number;
  locationTerritoryId: TerritoryId;
}

export interface WorldFactionDefinition {
  id: FactionId;
  role: WorldFactionRole;
  name: string;
  homeTerritoryId: TerritoryId;
  startingResources: Resources;
  startingArmy: WorldStartingArmy;
  personality: WorldPersonalityDefinition | null;
}

export interface WorldStartingDiplomacy {
  a: FactionId;
  b: FactionId;
  state: RelationshipState;
  opinion: number;
}

export interface RegionDefinition {
  id: RegionId;
  name: string;
  worldId: string;
  territoryIds: TerritoryId[];
}

export interface TerritoryDefinition {
  id: TerritoryId;
  regionId: RegionId;
  startingOwnerFactionId: FactionId;
  neighborIds: TerritoryId[];
  terrain: TerrainType;
  resourceOutput: Partial<Resources>;
  polygon: WorldPolygon;
}

export interface WorldDefinition {
  formatVersion: WorldFormatVersion;
  worldId: string;
  level: number;
  name: string;
  playerFactionId: FactionId;
  island: WorldPolygon;
  completion: WorldCompletion;
  containedWorlds: ContainedWorldDefinition[];
  factions: WorldFactionDefinition[];
  startingDiplomacy: WorldStartingDiplomacy[];
  regions: RegionDefinition[];
  territories: TerritoryDefinition[];
  /** Level 1 AI split may differ by more than 1 when explicitly allowed. */
  allowUnevenAiSplit?: boolean;
}

export interface WorldValidationIssue {
  code: string;
  message: string;
}

export type WorldLoadResult =
  | { ok: true; definition: WorldDefinition }
  | { ok: false; issues: WorldValidationIssue[] };
