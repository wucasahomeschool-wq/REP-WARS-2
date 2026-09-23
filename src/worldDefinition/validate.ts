import { TerrainType } from '../types';
import { collectNeighborGraphIssues } from '../map/graphInvariants';
import {
  allVerticesInside,
  polygonExterior,
  ringArea,
  sharedEdgeLength,
  uniqueRingVertices,
  WORLD_GEOM_EPS,
} from './geometry';
import {
  WorldDefinition,
  WorldFactionDefinition,
  WorldPersonalityDefinition,
  WorldPolygon,
  WorldValidationIssue,
  WORLD_FORMAT_VERSION,
} from './types';

const TERRAIN: readonly TerrainType[] = [
  'plains', 'mountain', 'hills', 'forest', 'coastal', 'desert', 'river', 'fortress',
];

const TRAIT_KEYS = [
  'aggression', 'defensiveness', 'expansionism', 'opportunism', 'diplomacy',
  'economics', 'riskTolerance', 'patience', 'forgivingness', 'loyalty',
] as const;

function issue(code: string, message: string): WorldValidationIssue {
  return { code, message };
}

function checkPolygon(poly: WorldPolygon, label: string): WorldValidationIssue[] {
  const out: WorldValidationIssue[] = [];
  if (!poly || !Array.isArray(poly.rings) || poly.rings.length === 0) {
    return [issue('geometry.missing_ring', `${label} has no exterior ring`)];
  }
  if (poly.rings.length > 1) {
    out.push(issue('geometry.holes_unsupported', `${label} has holes; v1 territories/island must be a simple exterior`));
  }
  const ring = polygonExterior(poly);
  if (!ring) {
    return [issue('geometry.missing_ring', `${label} exterior is empty`)];
  }
  for (const p of ring) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      out.push(issue('geometry.non_finite', `${label} has a non-finite vertex`));
      break;
    }
  }
  const verts = uniqueRingVertices(ring);
  if (verts.length < 3) {
    out.push(issue('geometry.too_few_vertices', `${label} needs at least 3 distinct vertices`));
  }
  const area = Math.abs(ringArea(ring));
  if (verts.length >= 3 && area <= WORLD_GEOM_EPS) {
    out.push(issue('geometry.zero_area', `${label} has zero area`));
  }
  return out;
}

function personalityIssues(p: WorldPersonalityDefinition, factionId: string): WorldValidationIssue[] {
  const out: WorldValidationIssue[] = [];
  if (!p.id || typeof p.id !== 'string') {
    out.push(issue('personality.missing_id', `AI faction ${factionId} personality is missing id`));
  }
  if (!Number.isFinite(p.ambition) || p.ambition < 0 || p.ambition > 1) {
    out.push(issue('personality.ambition', `AI faction ${factionId} ambition must be in [0, 1]`));
  }
  for (const key of TRAIT_KEYS) {
    const v = p.traits?.[key];
    if (!Number.isFinite(v) || v < 0 || v > 1) {
      out.push(issue('personality.trait', `AI faction ${factionId} trait ${key} must be in [0, 1]`));
    }
  }
  return out;
}

function graphConnected(ids: string[], neighborsOf: (id: string) => string[]): boolean {
  if (ids.length === 0) return false;
  const seen = new Set<string>();
  const stack = [ids[0]!];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const n of neighborsOf(id)) stack.push(n);
  }
  return seen.size === ids.length;
}

/**
 * Deterministic structural + geometry validation for an authored world.
 * Does not invent missing data.
 */
export function validateWorldDefinition(def: WorldDefinition): WorldValidationIssue[] {
  const issues: WorldValidationIssue[] = [];
  const push = (code: string, message: string) => issues.push(issue(code, message));

  if (def.formatVersion !== WORLD_FORMAT_VERSION) {
    push('format.unsupported', `formatVersion must be ${WORLD_FORMAT_VERSION}`);
  }
  if (!def.worldId || typeof def.worldId !== 'string') {
    push('world.missing_id', 'worldId is required');
  }
  if (!Number.isInteger(def.level) || def.level < 1) {
    push('world.invalid_level', 'level must be an integer >= 1');
  }
  if (!def.name || typeof def.name !== 'string') {
    push('world.missing_name', 'world name is required');
  }

  issues.push(...checkPolygon(def.island, 'island'));
  const islandRing = polygonExterior(def.island);

  if (!Array.isArray(def.territories) || def.territories.length === 0) {
    push('territory.empty', 'world must contain at least one territory');
    return issues;
  }
  if (!Array.isArray(def.regions) || def.regions.length === 0) {
    push('region.empty', 'world must contain at least one named region');
  }
  if (!Array.isArray(def.factions) || def.factions.length === 0) {
    push('faction.empty', 'world must contain factions');
  }

  const territoryIds = new Set<string>();
  for (const t of def.territories) {
    if (!t.id) push('territory.missing_id', 'territory is missing id');
    else if (territoryIds.has(t.id)) push('territory.duplicate_id', `duplicate territory id ${t.id}`);
    else territoryIds.add(t.id);
    if (t.id && typeof (t as { name?: unknown }).name === 'string') {
      push('territory.named', `territory ${t.id} must not have a player-facing name`);
    }
    if (!TERRAIN.includes(t.terrain)) {
      push('territory.terrain', `territory ${t.id} has invalid terrain ${String(t.terrain)}`);
    }
    issues.push(...checkPolygon(t.polygon, `territory ${t.id}`));
    if (islandRing && polygonExterior(t.polygon)) {
      if (!allVerticesInside(polygonExterior(t.polygon)!, islandRing)) {
        push('territory.outside_island', `territory ${t.id} is not contained by the island`);
      }
    }
  }

  const regionIds = new Set<string>();
  const membership = new Map<string, string>();
  for (const r of def.regions ?? []) {
    if (!r.id) push('region.missing_id', 'region is missing id');
    else if (regionIds.has(r.id)) push('region.duplicate_id', `duplicate region id ${r.id}`);
    else regionIds.add(r.id);
    if (!r.name || typeof r.name !== 'string') {
      push('region.missing_name', `region ${r.id} must have a player-facing name`);
    }
    if (r.worldId && r.worldId !== def.worldId) {
      push('region.world_mismatch', `region ${r.id} worldId does not match the world`);
    }
    if (!Array.isArray(r.territoryIds) || r.territoryIds.length === 0) {
      push('region.empty_membership', `region ${r.id} has no territories`);
    }
    for (const tid of r.territoryIds ?? []) {
      if (!territoryIds.has(tid)) {
        push('region.unknown_territory', `region ${r.id} references missing territory ${tid}`);
      }
      const prev = membership.get(tid);
      if (prev) push('region.duplicate_membership', `territory ${tid} is in regions ${prev} and ${r.id}`);
      else membership.set(tid, r.id);
    }
  }
  for (const t of def.territories) {
    if (!regionIds.has(t.regionId)) {
      push('territory.unknown_region', `territory ${t.id} regionId ${t.regionId} does not exist`);
    }
    const listed = membership.get(t.id);
    if (listed && listed !== t.regionId) {
      push('territory.region_mismatch', `territory ${t.id} regionId ${t.regionId} does not match region list ${listed}`);
    }
    if (!listed && regionIds.has(t.regionId)) {
      push('territory.region_mismatch', `territory ${t.id} is not listed in region ${t.regionId}`);
    }
  }

  const factionIds = new Set<string>();
  const players: WorldFactionDefinition[] = [];
  const ais: WorldFactionDefinition[] = [];
  for (const f of def.factions ?? []) {
    if (!f.id) push('faction.missing_id', 'faction is missing id');
    else if (factionIds.has(f.id)) push('faction.duplicate_id', `duplicate faction id ${f.id}`);
    else factionIds.add(f.id);
    if (f.role === 'player') players.push(f);
    else if (f.role === 'ai') ais.push(f);
    else push('faction.role', `faction ${f.id} has invalid role`);
    if (!territoryIds.has(f.homeTerritoryId)) {
      push('faction.home', `faction ${f.id} homeTerritoryId ${f.homeTerritoryId} does not exist`);
    }
    if (!f.startingArmy || !territoryIds.has(f.startingArmy.locationTerritoryId)) {
      push('faction.army_location', `faction ${f.id} starting army location is invalid`);
    }
    if (f.role === 'ai') {
      if (!f.personality) push('personality.missing', `AI faction ${f.id} must have personality data`);
      else issues.push(...personalityIssues(f.personality, f.id));
    }
    if (f.role === 'player' && f.personality !== null && f.personality !== undefined) {
      push('personality.player', `player faction ${f.id} must have personality: null`);
    }
  }
  if (players.length !== 1) {
    push('faction.player_count', 'world must have exactly one player faction');
  }
  if (def.playerFactionId !== players[0]?.id) {
    push('faction.player_id', 'playerFactionId must match the unique player faction');
  }
  if (def.level === 1 && ais.length < 1) {
    push('faction.ai_required', 'Level 1 world must include at least one AI warlord');
  }

  const personalityIds = new Set<string>();
  for (const f of ais) {
    const pid = f.personality?.id;
    if (pid) {
      if (personalityIds.has(pid)) push('personality.duplicate_id', `duplicate personality id ${pid}`);
      personalityIds.add(pid);
    }
  }

  const ownerCount = new Map<string, number>();
  for (const t of def.territories) {
    if (!factionIds.has(t.startingOwnerFactionId)) {
      push('owner.unknown', `territory ${t.id} starting owner ${t.startingOwnerFactionId} does not exist`);
      continue;
    }
    ownerCount.set(t.startingOwnerFactionId, (ownerCount.get(t.startingOwnerFactionId) ?? 0) + 1);
  }
  const playerOwned = ownerCount.get(def.playerFactionId) ?? 0;
  if (def.level === 1 && playerOwned !== 1) {
    push('owner.player_count', `Level 1 player must own exactly 1 territory (has ${playerOwned})`);
  }
  const player = players[0];
  if (player && (ownerCount.get(player.id) ?? 0) > 0) {
    const home = def.territories.find((t) => t.id === player.homeTerritoryId);
    if (home && home.startingOwnerFactionId !== player.id) {
      push('owner.player_home', 'player homeTerritoryId must be the player-owned territory');
    }
  }
  for (const f of def.factions ?? []) {
    const home = def.territories.find((t) => t.id === f.homeTerritoryId);
    if (home && home.startingOwnerFactionId !== f.id) {
      push('owner.home', `faction ${f.id} homeTerritoryId is not owned by that faction`);
    }
    if (f.startingArmy && f.startingArmy.locationTerritoryId) {
      const loc = def.territories.find((t) => t.id === f.startingArmy.locationTerritoryId);
      if (loc && loc.startingOwnerFactionId !== f.id) {
        push('owner.army', `faction ${f.id} starting army is not on an owned territory`);
      }
    }
  }
  if (def.level === 1 && !def.allowUnevenAiSplit && ais.length > 0) {
    const counts = ais.map((f) => ownerCount.get(f.id) ?? 0);
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    if (max - min > 1) {
      push('owner.ai_split', 'AI starting territory counts differ by more than 1');
    }
    for (const f of ais) {
      if ((ownerCount.get(f.id) ?? 0) < 1) {
        push('owner.ai_empty', `AI faction ${f.id} owns no territories`);
      }
    }
  }

  const neighborView = def.territories.map((t) => ({ id: t.id, neighboring: t.neighborIds }));
  for (const gIssue of collectNeighborGraphIssues(neighborView)) {
    push(`adjacency.${gIssue.kind}`, `territory ${gIssue.territoryId} neighbor ${gIssue.neighborId}: ${gIssue.kind}`);
  }
  const byId = new Map(def.territories.map((t) => [t.id, t]));
  for (const t of def.territories) {
    for (const nid of t.neighborIds) {
      const n = byId.get(nid);
      if (!n) continue;
      if (sharedEdgeLength(t.polygon, n.polygon) <= WORLD_GEOM_EPS) {
        push('adjacency.no_shared_edge', `territories ${t.id} and ${nid} are listed as neighbors but do not share an edge`);
      }
    }
  }
  if (!graphConnected([...territoryIds], (id) => byId.get(id)?.neighborIds ?? [])) {
    push('adjacency.disconnected', 'playable territory graph is not connected');
  }

  for (const rel of def.startingDiplomacy ?? []) {
    if (rel.a === rel.b) push('diplomacy.self', 'diplomacy pair must name two factions');
    if (!factionIds.has(rel.a) || !factionIds.has(rel.b)) {
      push('diplomacy.unknown', `diplomacy references unknown faction ${rel.a}/${rel.b}`);
    }
  }

  const containedIds = new Set<string>();
  for (const c of def.containedWorlds ?? []) {
    if (!c.worldId) push('contained.missing_id', 'contained world is missing worldId');
    if (c.worldId === def.worldId) push('contained.self', 'contained world cannot reference this world');
    if (containedIds.has(c.worldId)) push('contained.duplicate', `duplicate contained world ${c.worldId}`);
    containedIds.add(c.worldId);
    if (!regionIds.has(c.regionId)) {
      push('contained.region', `contained world ${c.worldId} regionId ${c.regionId} is not in this file`);
    }
    if (!Number.isFinite(c.placement?.scale) || c.placement.scale <= 0) {
      push('contained.placement', `contained world ${c.worldId} placement.scale must be > 0`);
    }
  }
  for (const t of def.territories) {
    for (const nid of t.neighborIds) {
      if (containedIds.has(nid) || nid.startsWith('w_') && !territoryIds.has(nid)) {
        push('adjacency.cross_level', `territory ${t.id} neighbor ${nid} is not a tile in this world`);
      }
    }
  }

  if (def.completion?.type === 'control_fraction') {
    if (!Number.isFinite(def.completion.fraction) || def.completion.fraction <= 0 || def.completion.fraction > 1) {
      push('completion.fraction', 'control_fraction must be in (0, 1]');
    }
  } else if (def.completion && def.completion.type !== 'eliminate_ai' && def.completion.type !== 'manual') {
    push('completion.type', `unknown completion type ${(def.completion as { type: string }).type}`);
  }

  if (def.description !== undefined && typeof def.description !== 'string') {
    push('world.description', 'description must be a string when present');
  }

  if (def.theme !== undefined) {
    if (!def.theme || typeof def.theme !== 'object' || Array.isArray(def.theme)) {
      push('theme.invalid', 'theme must be an object with themeId');
    } else if (typeof def.theme.themeId !== 'string' || !def.theme.themeId.trim()) {
      push('theme.missing_id', 'theme.themeId must be a non-empty string');
    }
  }

  if (def.challenges !== undefined) {
    if (!Array.isArray(def.challenges)) {
      push('challenge.invalid', 'challenges must be an array when present');
    } else {
      const seenChallenge = new Set<string>();
      for (const ch of def.challenges) {
        if (!ch || typeof ch !== 'object' || Array.isArray(ch)) {
          push('challenge.invalid', 'each challenge must be an object');
          continue;
        }
        if (typeof ch.challengeId !== 'string' || !ch.challengeId.trim()) {
          push('challenge.missing_id', 'challenge.challengeId must be a non-empty string');
          continue;
        }
        if (seenChallenge.has(ch.challengeId)) {
          push('challenge.duplicate', `duplicate challengeId ${ch.challengeId}`);
        }
        seenChallenge.add(ch.challengeId);
        if (ch.config !== undefined) {
          if (!ch.config || typeof ch.config !== 'object' || Array.isArray(ch.config)) {
            push('challenge.config', `challenge ${ch.challengeId} config must be a plain object`);
          } else {
            for (const [k, v] of Object.entries(ch.config)) {
              const ok =
                v === null ||
                typeof v === 'string' ||
                typeof v === 'boolean' ||
                (typeof v === 'number' && Number.isFinite(v));
              if (!ok) {
                push('challenge.config', `challenge ${ch.challengeId} config.${k} must be a JSON scalar`);
              }
            }
          }
        }
      }
    }
  }

  if (def.presentation !== undefined) {
    if (!def.presentation || typeof def.presentation !== 'object' || Array.isArray(def.presentation)) {
      push('presentation.invalid', 'presentation must be an object when present');
    } else {
      const p = def.presentation;
      for (const key of ['scaleProfileId', 'cameraProfileId', 'lodProfileId'] as const) {
        const v = p[key];
        if (v !== undefined && (typeof v !== 'string' || !v.trim())) {
          push('presentation.profile', `presentation.${key} must be a non-empty string when present`);
        }
      }
      if (p.camera !== undefined) {
        if (!p.camera || typeof p.camera !== 'object' || Array.isArray(p.camera)) {
          push('presentation.camera', 'presentation.camera must be an object');
        } else {
          const { minZoom, maxZoom, initialZoom } = p.camera;
          const nums = [minZoom, maxZoom, initialZoom];
          if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n <= 0)) {
            push('presentation.camera', 'camera zoom values must be finite and positive');
          } else if (minZoom < 0.05 || maxZoom > 64 || minZoom > maxZoom) {
            push('presentation.camera', 'camera zoom bounds must satisfy 0.05 <= minZoom <= maxZoom <= 64');
          } else if (initialZoom < minZoom || initialZoom > maxZoom) {
            push('presentation.camera', 'initialZoom must be within [minZoom, maxZoom]');
          }
        }
      }
    }
  }

  const LOCATION_KINDS = new Set(['city', 'mine', 'farm', 'landmark', 'settlement']);
  if (def.locations !== undefined) {
    if (!Array.isArray(def.locations)) {
      push('location.invalid', 'locations must be an array when present');
    } else {
      const seenLoc = new Set<string>();
      for (const loc of def.locations) {
        if (!loc || typeof loc !== 'object' || Array.isArray(loc)) {
          push('location.invalid', 'each location must be an object');
          continue;
        }
        if (typeof loc.id !== 'string' || !loc.id.trim()) {
          push('location.missing_id', 'location id is required');
          continue;
        }
        if (seenLoc.has(loc.id)) push('location.duplicate_id', `duplicate location id ${loc.id}`);
        seenLoc.add(loc.id);
        if (!LOCATION_KINDS.has(loc.kind)) {
          push('location.kind', `location ${loc.id} has invalid kind ${String(loc.kind)}`);
        }
        if (!territoryIds.has(loc.territoryId)) {
          push('location.territory', `location ${loc.id} territoryId ${loc.territoryId} does not exist`);
        }
        if (
          !loc.position ||
          typeof loc.position.x !== 'number' ||
          typeof loc.position.y !== 'number' ||
          !Number.isFinite(loc.position.x) ||
          !Number.isFinite(loc.position.y)
        ) {
          push('location.position', `location ${loc.id} position must be finite {x,y}`);
        }
        if (loc.name !== undefined && typeof loc.name !== 'string') {
          push('location.name', `location ${loc.id} name must be a string when present`);
        }
        if (loc.visualAssetId !== undefined && typeof loc.visualAssetId !== 'string') {
          push('location.visual', `location ${loc.id} visualAssetId must be a string when present`);
        }
      }
    }
  }

  const IMPORTANCE = new Set(['background', 'normal', 'landmark']);
  if (def.composition !== undefined) {
    if (!def.composition || typeof def.composition !== 'object' || Array.isArray(def.composition)) {
      push('composition.invalid', 'composition must be an object when present');
    } else if (!Array.isArray(def.composition.instances)) {
      push('composition.instances', 'composition.instances must be an array');
    } else {
      const seenInst = new Set<string>();
      for (const inst of def.composition.instances) {
        if (!inst || typeof inst !== 'object' || Array.isArray(inst)) {
          push('composition.invalid', 'each composition instance must be an object');
          continue;
        }
        if (typeof inst.instanceId !== 'string' || !inst.instanceId.trim()) {
          push('composition.missing_id', 'composition instanceId is required');
          continue;
        }
        if (seenInst.has(inst.instanceId)) {
          push('composition.duplicate_id', `duplicate composition instanceId ${inst.instanceId}`);
        }
        seenInst.add(inst.instanceId);
        if (typeof inst.assetId !== 'string' || !inst.assetId.trim()) {
          push('composition.asset', `instance ${inst.instanceId} assetId is required`);
        }
        if (
          !inst.position ||
          typeof inst.position.x !== 'number' ||
          typeof inst.position.y !== 'number' ||
          !Number.isFinite(inst.position.x) ||
          !Number.isFinite(inst.position.y)
        ) {
          push('composition.position', `instance ${inst.instanceId} position must be finite {x,y}`);
        }
        if (typeof inst.rotationDegrees !== 'number' || !Number.isFinite(inst.rotationDegrees)) {
          push('composition.rotation', `instance ${inst.instanceId} rotationDegrees must be finite`);
        }
        if (
          inst.scale !== null &&
          inst.scale !== undefined &&
          (typeof inst.scale !== 'number' || !Number.isFinite(inst.scale) || inst.scale <= 0)
        ) {
          push('composition.scale', `instance ${inst.instanceId} scale must be null or a positive finite number`);
        }
        if (typeof inst.anchor !== 'string' || !inst.anchor.trim()) {
          push('composition.anchor', `instance ${inst.instanceId} anchor is required`);
        }
        if (typeof inst.depth !== 'number' || !Number.isFinite(inst.depth)) {
          push('composition.depth', `instance ${inst.instanceId} depth must be finite`);
        }
        if (inst.importance !== undefined && !IMPORTANCE.has(inst.importance)) {
          push('composition.importance', `instance ${inst.instanceId} has invalid importance`);
        }
        if (inst.lodProfileId !== undefined && (typeof inst.lodProfileId !== 'string' || !inst.lodProfileId.trim())) {
          push('composition.lod', `instance ${inst.instanceId} lodProfileId must be a non-empty string`);
        }
        if (
          inst.territoryId !== undefined &&
          inst.territoryId !== null &&
          !territoryIds.has(inst.territoryId)
        ) {
          push('composition.territory', `instance ${inst.instanceId} territoryId does not exist`);
        }
      }
    }
  }

  issues.sort((a, b) => a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
  return issues;
}

export function assertValidWorld(def: WorldDefinition): void {
  const issues = validateWorldDefinition(def);
  if (issues.length > 0) {
    const first = issues[0]!;
    throw new Error(`Invalid world: ${first.code}: ${first.message}`);
  }
}
