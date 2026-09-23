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

/** Stable visual-theme identity. Descriptive library text is not stored here. */
export interface WorldThemeRef {
  themeId: string;
}

/**
 * Data-only challenge / rule-profile reference.
 * The engine interprets challengeId (+ optional config); Map Assistant does not execute it.
 */
export interface WorldChallengeRef {
  challengeId: string;
  /** Plain JSON scalars only when present. */
  config?: Record<string, string | number | boolean | null>;
}

export interface WorldCameraOverrides {
  minZoom: number;
  maxZoom: number;
  initialZoom: number;
}

/** Authored visual scale / framing intent. Runtime camera systems consume this. */
export interface WorldPresentationProfile {
  scaleProfileId?: string;
  cameraProfileId?: string;
  lodProfileId?: string;
  camera?: WorldCameraOverrides;
}

export type SemanticLocationKind = 'city' | 'mine' | 'farm' | 'landmark' | 'settlement';

/** Gameplay-relevant place (not a decorative prop). */
export interface SemanticLocationDefinition {
  id: string;
  kind: SemanticLocationKind;
  territoryId: TerritoryId;
  position: WorldVec2;
  name?: string;
  /** Optional composition / art reference; not the gameplay entity itself. */
  visualAssetId?: string;
}

export type CompositionImportance = 'background' | 'normal' | 'landmark';

/** Authored visual prop instance. Local scale is independent of nested-world placement. */
export interface CompositionInstanceDefinition {
  instanceId: string;
  assetId: string;
  position: WorldVec2;
  rotationDegrees: number;
  /** null / omitted means use the asset defaultScale from asset-scale.json. */
  scale: number | null;
  anchor: string;
  depth: number;
  importance?: CompositionImportance;
  lodProfileId?: string;
  territoryId?: TerritoryId | null;
}

export interface WorldCompositionDefinition {
  instances: CompositionInstanceDefinition[];
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
  /** Optional authored blurb. Omitted on older worlds. */
  description?: string;
  /** Optional theme identity. Omitted on older worlds. */
  theme?: WorldThemeRef;
  /** Zero or more challenge refs. Omitted when empty / absent on older worlds. */
  challenges?: WorldChallengeRef[];
  /** Optional presentation / camera / scale profile. */
  presentation?: WorldPresentationProfile;
  /** Optional semantic gameplay locations (city/mine/farm/…). */
  locations?: SemanticLocationDefinition[];
  /** Optional visual composition (props). Omitted when empty. */
  composition?: WorldCompositionDefinition;
}

export interface WorldValidationIssue {
  code: string;
  message: string;
}

export type WorldLoadResult =
  | { ok: true; definition: WorldDefinition }
  | { ok: false; issues: WorldValidationIssue[] };
