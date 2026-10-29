import { createHash } from 'node:crypto';
import { WorldDefinition, WorldVec2 } from './types';

export const WORLD_CONTENT_ALGORITHM = 'rep-wars-world-content.v1' as const;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function byId<T extends { id: string }>(rows: readonly T[]): T[] { return [...rows].sort((a,b) => compare(a.id,b.id)); }
/** Key order is incidental. Array order is canonicalized explicitly for known sets. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => compare(a,b)).map(([k,v]) => [k,stable(v)]));
  return value;
}
function digest(value: unknown): string { return 'sha256:' + createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function ring(points: readonly WorldVec2[]): WorldVec2[] {
  const vertices = points.map(p => ({x: p.x, y: p.y}));
  if (vertices.length > 1 && vertices[0]!.x === vertices[vertices.length-1]!.x && vertices[0]!.y === vertices[vertices.length-1]!.y) vertices.pop();
  // Rotation and winding do not change an exterior polygon. No coordinate rounding.
  const variants: WorldVec2[][] = [];
  for (const order of [vertices, [...vertices].reverse()]) {
    let start = 0;
    for (let i=1; i<order.length; i++) if (order[i]!.x < order[start]!.x || order[i]!.x === order[start]!.x && order[i]!.y < order[start]!.y) start=i;
    variants.push([...order.slice(start),...order.slice(0,start)]);
  }
  return variants.sort((a,b) => compare(JSON.stringify(a), JSON.stringify(b)))[0]!;
}
function geometry(def: WorldDefinition) {
  return { worldId: def.worldId, formatVersion: def.formatVersion, level: def.level,
    island: def.island.rings.map(ring),
    territories: byId(def.territories).map(t => ({ id:t.id, regionId:t.regionId, neighborIds:[...t.neighborIds].sort(compare), polygon:t.polygon.rings.map(ring) })) };
}
/** Immutable map/gameplay content only. Workout pricing is separately versioned and
 * start-locked; cosmetic props/camera metadata are not simulation save authority. */
export function worldContentFingerprint(def: WorldDefinition): string {
  return digest({ algorithm: WORLD_CONTENT_ALGORITHM, geometry: geometry(def), name:def.name, playerFactionId:def.playerFactionId,
    ...(def.empireFoodBaselinePerCycle!==undefined?{empireFoodBaselinePerCycle:def.empireFoodBaselinePerCycle}:{}),
    completion:def.completion, factions:byId(def.factions),
    regions:byId(def.regions).map(r => ({...r,territoryIds:[...r.territoryIds].sort(compare)})),
    territories:byId(def.territories).map(t => ({id:t.id, terrain:t.terrain, startingOwnerFactionId:t.startingOwnerFactionId, resourceOutput:t.resourceOutput,...(t.foodUpkeep!==undefined?{foodUpkeep:t.foodUpkeep}:{})})),
    startingDiplomacy:[...def.startingDiplomacy].sort((a,b)=>compare(JSON.stringify([a.a,a.b]),JSON.stringify([b.a,b.b]))),
    containedWorlds:[...def.containedWorlds].sort((a,b)=>compare(a.worldId,b.worldId)),
  });
}
export function worldContentIdentity(def: WorldDefinition) {
  return { algorithm: WORLD_CONTENT_ALGORITHM, fingerprint:worldContentFingerprint(def), geometryFingerprint:digest(geometry(def)) };
}
export function isContentFingerprint(value: unknown): value is string { return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value); }
