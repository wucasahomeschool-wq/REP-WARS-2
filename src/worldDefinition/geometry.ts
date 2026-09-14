import { WorldPolygon, WorldVec2 } from './types';

export const WORLD_GEOM_EPS = 1e-6;

export function almostEqual(a: number, b: number, eps = WORLD_GEOM_EPS): boolean {
  return Math.abs(a - b) <= eps;
}

export function isFinitePoint(p: WorldVec2): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** Repeat first vertex if the ring is open. */
export function closeRing(points: WorldVec2[]): WorldVec2[] {
  if (points.length === 0) return points;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (almostEqual(first.x, last.x) && almostEqual(first.y, last.y)) return points;
  return [...points, { x: first.x, y: first.y }];
}

export function uniqueRingVertices(points: WorldVec2[]): WorldVec2[] {
  const closed = closeRing(points);
  return closed.slice(0, Math.max(0, closed.length - 1));
}

export function ringArea(points: WorldVec2[]): number {
  const p = closeRing(points);
  let a = 0;
  for (let i = 0; i < p.length - 1; i++) {
    a += p[i]!.x * p[i + 1]!.y - p[i + 1]!.x * p[i]!.y;
  }
  return a / 2;
}

export function ringCentroid(points: WorldVec2[]): WorldVec2 {
  const verts = uniqueRingVertices(points);
  if (verts.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const v of verts) {
    x += v.x;
    y += v.y;
  }
  return { x: x / verts.length, y: y / verts.length };
}

export function pointOnSegment(p: WorldVec2, a: WorldVec2, b: WorldVec2, eps = WORLD_GEOM_EPS): boolean {
  const cross = (p.y - a.y) * (b.x - a.x) - (p.x - a.x) * (b.y - a.y);
  if (Math.abs(cross) > eps * Math.max(1, Math.abs(b.x - a.x) + Math.abs(b.y - a.y))) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  if (dot < -eps) return false;
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return dot <= len2 + eps;
}

/** Inclusive boundary. */
export function pointInRing(pt: WorldVec2, ring: WorldVec2[]): boolean {
  const p = closeRing(ring);
  const verts = uniqueRingVertices(p);
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]!;
    const b = verts[(i + 1) % verts.length]!;
    if (pointOnSegment(pt, a, b)) return true;
  }
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i]!.x;
    const yi = p[i]!.y;
    const xj = p[j]!.x;
    const yj = p[j]!.y;
    const intersect = (yi > pt.y) !== (yj > pt.y)
      && pt.x < ((xj - xi) * (pt.y - yi)) / ((yj - yi) || WORLD_GEOM_EPS) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function polygonExterior(poly: WorldPolygon): WorldVec2[] | null {
  const ring = poly.rings[0];
  if (!ring || ring.length < 3) return null;
  return ring;
}

export function allVerticesInside(inner: WorldVec2[], outer: WorldVec2[]): boolean {
  for (const v of uniqueRingVertices(inner)) {
    if (!pointInRing(v, outer)) return false;
  }
  return true;
}

function undirectedEdgeKey(a: WorldVec2, b: WorldVec2): string {
  const aFirst = a.x < b.x - WORLD_GEOM_EPS || (almostEqual(a.x, b.x) && a.y <= b.y);
  const p = aFirst ? a : b;
  const q = aFirst ? b : a;
  return `${p.x.toFixed(6)},${p.y.toFixed(6)}|${q.x.toFixed(6)},${q.y.toFixed(6)}`;
}

export function ringEdges(points: WorldVec2[]): Array<[WorldVec2, WorldVec2]> {
  const verts = uniqueRingVertices(points);
  const edges: Array<[WorldVec2, WorldVec2]> = [];
  for (let i = 0; i < verts.length; i++) {
    edges.push([verts[i]!, verts[(i + 1) % verts.length]!]);
  }
  return edges;
}

export function edgeLength(a: WorldVec2, b: WorldVec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Sum of lengths of edges that appear (within epsilon) in both exteriors. */
export function sharedEdgeLength(a: WorldPolygon, b: WorldPolygon): number {
  const ra = polygonExterior(a);
  const rb = polygonExterior(b);
  if (!ra || !rb) return 0;
  const map = new Map<string, number>();
  for (const [p, q] of ringEdges(ra)) {
    const len = edgeLength(p, q);
    if (len <= WORLD_GEOM_EPS) continue;
    map.set(undirectedEdgeKey(p, q), len);
  }
  let shared = 0;
  for (const [p, q] of ringEdges(rb)) {
    const len = edgeLength(p, q);
    if (len <= WORLD_GEOM_EPS) continue;
    const key = undirectedEdgeKey(p, q);
    const other = map.get(key);
    if (other !== undefined) shared += Math.min(len, other);
  }
  return shared;
}
