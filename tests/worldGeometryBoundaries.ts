import assert from 'node:assert/strict';
import { loadTinyWorldDefinition, loadProductionLevel1Definition, loadProductionLevel2Definition } from '../src/worldDefinition/catalog';
import { validateWorldDefinition } from '../src/worldDefinition/validate';
import { sharedEdgeLength, ringsOverlap, ringContainedBy, ringArea } from '../src/worldDefinition/geometry';
import { WorldPolygon } from '../src/worldDefinition/types';

const polygon = (...points: number[][]): WorldPolygon => ({ rings: [points.map(([x, y]) => ({ x, y }))] });
function world() { const loaded = loadTinyWorldDefinition(); assert.ok(loaded.ok); return structuredClone(loaded.definition); }
export function registerWorldGeometryBoundaryTests({ test }: { test: (name: string, fn: () => void) => void }) {
  test('geometry boundary: identical territory interiors are rejected even with reversed winding', () => {
    const value = world(); value.territories[1].polygon = structuredClone(value.territories[0].polygon);
    value.territories[1].polygon.rings[0].reverse();
    assert.ok(validateWorldDefinition(value).some(issue => issue.code === 'territory.overlap'));
  });
  test('geometry boundary: a territory edge cannot leave a concave island between contained vertices', () => {
    const value = world();
    value.island = polygon([0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6]);
    value.territories[0].polygon = polygon([1, 5], [5, 5], [3, 1]);
    assert.ok(validateWorldDefinition(value).some(issue => issue.code === 'territory.outside_island' && issue.message.includes('t_01')));
  });
  test('geometry boundary: shared borders remain adjacent when one ring subdivides its edge', () => {
    const left = polygon([0, 0], [2, 0], [2, 2], [0, 2]);
    const right = polygon([2, 0], [4, 0], [4, 2], [2, 2], [2, 1]);
    assert.equal(sharedEdgeLength(left, right), 2);
  });
  test('geometry boundary: crossing, contained and boundary-vertex interiors overlap', () => {
    const square = polygon([0,0],[4,0],[4,4],[0,4]).rings[0];
    for (const other of [polygon([-1,1],[5,1],[5,3],[-1,3]), polygon([1,1],[2,1],[2,2],[1,2]),
      polygon([2,0],[4,2],[2,4],[0,2])]) {
      assert.equal(ringsOverlap(square, other.rings[0]), true);
      assert.equal(ringsOverlap(other.rings[0], square), true);
    }
  });
  test('geometry boundary: shared edges and point contact do not overlap', () => {
    const square = polygon([0,0],[2,0],[2,2],[0,2]);
    for (const other of [polygon([2,0],[4,0],[4,2],[2,2]), polygon([2,2],[4,2],[4,4],[2,4]),
      polygon([3,0],[5,0],[5,2],[3,2])]) {
      for (const ring of [other.rings[0], [...other.rings[0]].reverse()]) {
        assert.equal(ringsOverlap(square.rings[0], ring), false);
        assert.equal(ringsOverlap(ring, square.rings[0]), false);
      }
    }
  });
  test('geometry boundary: a concave empty notch is not filled by a bounding box', () => {
    const shape = polygon([0,0],[4,0],[4,1],[1,1],[1,4],[0,4]).rings[0];
    const notch = polygon([1,1],[3,1],[3,3],[1,3]).rings[0];
    assert.equal(ringsOverlap(shape, notch), false);
    assert.equal(ringContainedBy(notch, shape), false);
    assert.equal(ringsOverlap(shape, polygon([0.5,0.5],[2,0.5],[2,2],[0.5,2]).rings[0]), true);
  });
  test('geometry boundary: narrow excursions away from the edge midpoint are rejected', () => {
    const island = polygon([0,0],[10,0],[10,10],[3,10],[3,2],[2,2],[2,10],[0,10]).rings[0];
    assert.equal(ringContainedBy(polygon([1,9],[9,9],[9,1],[1,1]).rings[0], island), false);
    assert.equal(ringContainedBy(polygon([4,4],[9,4],[9,9],[4,9]).rings[0], island), true);
  });
  test('geometry boundary: identical rings are contained and subdivision does not hide overlap', () => {
    const base = polygon([0,0],[4,0],[4,4],[0,4]).rings[0];
    const subdivided = polygon([0,0],[2,0],[4,0],[4,2],[4,4],[0,4],[0,0]).rings[0];
    for (const ring of [subdivided, [...subdivided].reverse()]) {
      assert.equal(ringContainedBy(ring, base), true);
      assert.equal(ringsOverlap(base, ring), true);
    }
  });
  test('geometry boundary: partial borders retain their actual shared length', () => {
    const left = polygon([0,0],[4,0],[4,4],[0,4]);
    const right = polygon([4,1],[6,1],[6,3],[4,3],[4,2]);
    assert.equal(sharedEdgeLength(left, right), 2);
    assert.equal(sharedEdgeLength(right, left), 2);
    right.rings[0].reverse();
    assert.equal(sharedEdgeLength(left, right), 2);
    assert.equal(ringsOverlap(left.rings[0], right.rings[0]), false);
  });
  test('geometry boundary: seeded rectangles agree with independent interval arithmetic', () => {
    let seed = 20261024;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % 21 - 10; };
    const rect = () => { const x = random(), y = random(); return { x, y, w: Math.abs(random()) + 1, h: Math.abs(random()) + 1 }; };
    const ring = (r: ReturnType<typeof rect>) => polygon([r.x,r.y],[r.x+r.w,r.y],[r.x+r.w,r.y+r.h],[r.x,r.y+r.h]).rings[0];
    for (let i = 0; i < 2500; i++) {
      const a = rect(), b = rect();
      const expected = Math.min(a.x+a.w,b.x+b.w) > Math.max(a.x,b.x) && Math.min(a.y+a.h,b.y+b.h) > Math.max(a.y,b.y);
      const ar = ring(a), br = ring(b); if (i % 2) br.reverse();
      assert.equal(ringsOverlap(ar, br), expected, JSON.stringify({a,b}));
      assert.equal(ringContainedBy(ar, br), a.x >= b.x && a.y >= b.y && a.x+a.w <= b.x+b.w && a.y+a.h <= b.y+b.h);
    }
  });
  test('geometry boundary: concave overlap agrees with a two-rectangle union oracle', () => {
    const shape = polygon([0,0],[4,0],[4,1],[1,1],[1,4],[0,4]).rings[0];
    let checked = 0;
    for (let x = -1; x < 5; x += 0.5) for (let y = -1; y < 5; y += 0.5) for (const w of [0.5,1,2]) for (const h of [0.5,1,2]) {
      const intersects = (rw: number, rh: number) => Math.min(x+w,rw) > Math.max(x,0) && Math.min(y+h,rh) > Math.max(y,0);
      const rect = polygon([x,y],[x+w,y],[x+w,y+h],[x,y+h]).rings[0];
      assert.equal(ringsOverlap(shape, rect), intersects(4,1) || intersects(1,4), JSON.stringify({x,y,w,h}));
      checked++;
    }
    assert.equal(checked, 1296);
  });
  test('geometry boundary: rotation, reversed winding and closed rings preserve results without mutation', () => {
    const a = polygon([0,0],[4,0],[4,4],[0,4]).rings[0];
    const b = polygon([2,1],[6,1],[6,3],[2,3]).rings[0];
    const rotate = (ring: typeof a) => ring.map(p => ({x: 0.6*p.x-0.8*p.y+13, y: 0.8*p.x+0.6*p.y-7}));
    for (const first of [a, rotate(a)]) for (const reverse of [false,true]) {
      const second = first === a ? [...b] : rotate(b); if (reverse) second.reverse();
      second.push({...second[0]});
      const before = JSON.stringify([first,second]);
      assert.equal(ringsOverlap(first,second), true);
      assert.equal(ringContainedBy(first,second), false);
      sharedEdgeLength({rings:[first]}, {rings:[second]});
      assert.equal(JSON.stringify([first,second]), before);
    }
  });
  test('geometry boundary: validation rejects non-finite geometry arithmetic', () => {
    const value = world(); value.territories[0].polygon = polygon([0,0],[1e200,0],[1e200,1e200],[0,1e200]);
    assert.ok(validateWorldDefinition(value).some(issue => issue.code === 'geometry.non_finite_area'));
    value.territories[0].polygon.rings[0][0].x = NaN;
    assert.ok(validateWorldDefinition(value).some(issue => issue.code === 'geometry.non_finite'));
  });
  test('geometry boundary: overlap diagnostics are stable under territory reordering', () => {
    const value = world(); value.territories[1].polygon = structuredClone(value.territories[0].polygon);
    const issues = validateWorldDefinition(value); value.territories.reverse();
    assert.deepEqual(validateWorldDefinition(value), issues);
  });
  test('geometry boundary: existing registered worlds remain valid and unmodified', () => {
    for (const load of [loadProductionLevel1Definition, loadProductionLevel2Definition, loadTinyWorldDefinition]) {
      const result = load(); assert.ok(result.ok);
      const before = JSON.stringify(result.definition);
      assert.deepEqual(validateWorldDefinition(result.definition), []);
      assert.equal(JSON.stringify(result.definition), before);
    }
  });
  test('geometry boundary: decorative island area need not be tiled by territories', () => {
    const value = world();
    assert.ok(Math.abs(ringArea(value.island.rings[0])) > value.territories.reduce((sum,t) => sum + Math.abs(ringArea(t.polygon.rings[0])), 0));
    assert.deepEqual(validateWorldDefinition(value), []);
  });
}
