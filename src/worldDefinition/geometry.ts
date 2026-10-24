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
  if (Math.hypot(b.x - a.x, b.y - a.y) <= eps) return Math.hypot(p.x - a.x, p.y - a.y) <= eps;
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

type Edge = [WorldVec2, WorldVec2];
const cross = (x: number, y: number, u: number, v: number) => x * v - y * u;

/** Length shared by collinear segments, independent of winding/subdivision. */
function sharedSegmentLength([a, b]: Edge, [c, d]: Edge): number {
  const x = b.x - a.x, y = b.y - a.y, length = Math.hypot(x, y);
  if (length <= WORLD_GEOM_EPS || edgeLength(c, d) <= WORLD_GEOM_EPS) return 0;
  if (Math.abs(cross(x, y, c.x - a.x, c.y - a.y)) > WORLD_GEOM_EPS * length
    || Math.abs(cross(x, y, d.x - a.x, d.y - a.y)) > WORLD_GEOM_EPS * length) return 0;
  const first = ((c.x - a.x) * x + (c.y - a.y) * y) / (length * length);
  const last = ((d.x - a.x) * x + (d.y - a.y) * y) / (length * length);
  return Math.max(0, Math.min(1, Math.max(first, last)) - Math.max(0, Math.min(first, last))) * length;
}

/** Sum of shared boundary lengths for valid simple exteriors. */
export function sharedEdgeLength(a: WorldPolygon, b: WorldPolygon): number {
  const ra = polygonExterior(a);
  const rb = polygonExterior(b);
  if (!ra || !rb) return 0;
  let shared = 0;
  const second = ringEdges(rb);
  for (const edge of ringEdges(ra)) for (const other of second) shared += sharedSegmentLength(edge, other);
  return shared;
}

/** -1 outside, 0 boundary, 1 interior. Inputs are finite simple rings. */
function location(point: WorldVec2, edges: Edge[]): number {
  let inside = false;
  for (const [a, b] of edges) {
    if (pointOnSegment(point, a, b)) return 0;
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < a.x + (point.y - a.y) * (b.x - a.x) / (b.y - a.y)) inside = !inside;
  }
  return inside ? 1 : -1;
}

/** Split an edge at every boundary crossing/contact, including collinear
 * endpoints. Interior/boundary classification is constant between these cuts;
 * sampling only the original midpoint would miss narrow concave excursions. */
function intervalMidpoints([a, b]: Edge, boundary: Edge[]): WorldVec2[] {
  const x = b.x - a.x, y = b.y - a.y, length = Math.hypot(x, y), cuts = [0, 1];
  if (length <= WORLD_GEOM_EPS) return [];
  for (const [c, d] of boundary) {
    for (const p of [c, d]) if (pointOnSegment(p, a, b)) {
      cuts.push(Math.max(0, Math.min(1, ((p.x - a.x) * x + (p.y - a.y) * y) / (length * length))));
    }
    const u = d.x - c.x, v = d.y - c.y, denominator = cross(x, y, u, v);
    if (denominator === 0) continue;
    const t = cross(c.x - a.x, c.y - a.y, u, v) / denominator;
    const s = cross(c.x - a.x, c.y - a.y, x, y) / denominator;
    if (t > 0 && t < 1 && s >= 0 && s <= 1) cuts.push(t);
  }
  cuts.sort((a, b) => a - b);
  const points: WorldVec2[] = [];
  for (let i = 1; i < cuts.length; i++) {
    if ((cuts[i] - cuts[i - 1]) * length <= WORLD_GEOM_EPS) continue;
    const t = (cuts[i] + cuts[i - 1]) / 2;
    points.push({ x: a.x + x * t, y: a.y + y * t });
  }
  return points;
}

/** Inclusive containment of an entire simple ring, not just its vertices. */
export function ringContainedBy(inner: WorldVec2[], outer: WorldVec2[]): boolean {
  const boundary = ringEdges(outer);
  if (boundary.length < 3) return false;
  return ringEdges(inner).every(edge => location(edge[0], boundary) >= 0
    && intervalMidpoints(edge, boundary).every(point => location(point, boundary) >= 0));
}

/** Positive interior intersection, excluding mere shared edges/points. No
 * polygon repair, clipping, coverage inference or geometry mutation occurs. */
export function ringsOverlap(a: WorldVec2[], b: WorldVec2[]): boolean {
  const bounds = (ring: WorldVec2[]) => {
    const result = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const point of ring) {
      result.minX = Math.min(result.minX, point.x); result.maxX = Math.max(result.maxX, point.x);
      result.minY = Math.min(result.minY, point.y); result.maxY = Math.max(result.maxY, point.y);
    }
    return result;
  };
  const first = bounds(a), second = bounds(b);
  if (Math.min(first.maxX, second.maxX) - Math.max(first.minX, second.minX) <= WORLD_GEOM_EPS
    || Math.min(first.maxY, second.maxY) - Math.max(first.minY, second.minY) <= WORLD_GEOM_EPS) return false;
  const firstEdges = ringEdges(a), secondEdges = ringEdges(b), sameWinding = Math.sign(ringArea(a)) === Math.sign(ringArea(b));
  const enters = (edges: Edge[], boundary: Edge[]) => edges.some(edge => intervalMidpoints(edge, boundary).some(point => {
    const where = location(point, boundary);
    if (where === 1) return true;
    if (where !== 0) return false;
    // Coincident boundaries overlap only when both filled interiors lie on the
    // same side. This also handles identical rings and reversed winding.
    const [p, q] = edge;
    return boundary.some(other => pointOnSegment(point, ...other) && sharedSegmentLength(edge, other) > WORLD_GEOM_EPS
      && (((q.x - p.x) * (other[1].x - other[0].x) + (q.y - p.y) * (other[1].y - other[0].y) > 0) === sameWinding));
  }));
  return enters(firstEdges, secondEdges) || enters(secondEdges, firstEdges);
}

/** Non-adjacent boundary contacts (including overlap) invalidate a simple ring. */
export function ringIsSimple(points: WorldVec2[]): boolean {
  const edges = ringEdges(points);
  const side = (a: WorldVec2, b: WorldVec2, c: WorldVec2) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  for (let i=0; i<edges.length; i++) {
    const [a,b]=edges[i]!;
    if (edgeLength(a,b) <= WORLD_GEOM_EPS) return false;
    for (let j=i+1; j<edges.length; j++) {
      if (j===i+1 || i===0 && j===edges.length-1) continue;
      const [c,d]=edges[j]!;
      if (pointOnSegment(a,c,d) || pointOnSegment(b,c,d) || pointOnSegment(c,a,b) || pointOnSegment(d,a,b)) return false;
      if ((side(a,b,c)>0)!==(side(a,b,d)>0) && (side(c,d,a)>0)!==(side(c,d,b)>0)) return false;
    }
  }
  return true;
}
