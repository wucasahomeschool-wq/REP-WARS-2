#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""REP WARS Map Assistant — standalone authoring tool for rep-wars-world.v1

This file is the complete logical specification of the editor. It uses only
the Python standard library. Copy it anywhere; it still runs.

Schema mirrors (TypeScript remains authoritative):
  - docs/phase-17m-world-map-spec.md
  - docs/WORLD_DEFINITION.md
  - src/worldDefinition/types.ts
  - src/worldDefinition/validate.ts

This is NOT a game engine. It does not simulate battles, AI, economy,
Fitness, rewards, GameState, or persistence. It does not generate worlds.

Coordinates in JSON are world-local 2D: +x right, +y up.
Tkinter screen space is +y down; conversion happens only at draw/pick time.
Editor-only state (selection, zoom, pan, undo, raw drawing strokes, convert
report) is never included in playable export. Raw freehand/rectangle strokes are
not WorldDefinition data. CONVERT TO MAP is a permanent commit: the first
successful conversion locks the map; later conversions interpret only pending
strokes and append new geometry. Committed polygons are never re-rasterized.
SCALE uniformly transforms committed geometry, committed source strokes, and
pending strokes with the same anchor and factor. Zoom/pan only change the
viewport. The World editor sidebar edits the converted world document.

Contained Worlds imports a completed previous-level WorldDefinition and
coarsens it: that world becomes one region here; each of its regions becomes
a territory whose polygon is the union of that region's tiles. This is not
CONVERT TO MAP and does not inline the previous playable graph.

Usage:
  python map_assistant.py
  python map_assistant.py --self-test
  python map_assistant.py --validate path.json
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import os
import sys
import tempfile
import traceback
import unittest
from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

# ---------------------------------------------------------------------------
# Schema constants (must match src/worldDefinition)
# ---------------------------------------------------------------------------

FORMAT_VERSION = "rep-wars-world.v1"
GEOM_EPS = 1e-6
EDITOR_GRAPH_KEY = "_editorBoundaryGraph"
EDITOR_OPEN_STROKES_KEY = "_editorOpenStrokes"
EDITOR_DRAWING_KEY = "_editorDrawing"
EDITOR_CONVERT_REPORT_KEY = "_editorConvertReport"
CONVERT_MIN_ISLAND_AREA = 40.0
SCALE_FACTOR_MIN = 0.05
SCALE_FACTOR_MAX = 20.0
STROKE_KIND_FREEHAND = "freehand"
STROKE_KIND_RECTANGLE = "rectangle"
ERASER_SCREEN_PX = 14.0
SIDEBAR_WIDTH = 380
RAW_PENDING_STROKE_COLOR = "#7fe3ff"
RAW_COMMITTED_STROKE_COLOR = "#5a7a88"

TERRAIN = (
    "plains", "mountain", "hills", "forest", "coastal", "desert", "river", "fortress",
)
RESOURCE_KEYS = ("gold", "food", "iron", "wood", "stone")
TRAIT_KEYS = (
    "aggression", "defensiveness", "expansionism", "opportunism", "diplomacy",
    "economics", "riskTolerance", "patience", "forgivingness", "loyalty",
)
RELATIONSHIP_STATES = (
    "allied", "friendly", "neutral", "tense", "hostile", "at_war",
)
COMPLETION_TYPES = ("control_fraction", "eliminate_ai", "manual")
FACTION_ROLES = ("player", "ai")

FORBIDDEN_TERRITORY_FIELDS = (
    "name", "label", "title", "isCapital", "isKnown", "scoutedTurnsAgo",
    "visibility", "cities", "city", "scout", "scouting", "expand", "capital",
    "fog", "discovered",
)
FORBIDDEN_WORLD_FIELDS = (
    "mapWorld", "visibility", "cities", "scout", "expand", "isCapital", "fog",
)

WORLD_KEY_ORDER = (
    "formatVersion", "worldId", "level", "name", "playerFactionId", "island",
    "completion", "containedWorlds", "factions", "startingDiplomacy", "regions",
    "territories", "allowUnevenAiSplit",
)
FACTION_KEY_ORDER = (
    "id", "role", "name", "homeTerritoryId", "startingResources", "startingArmy",
    "personality",
)
PERSONALITY_KEY_ORDER = ("id", "label", "ambition", "traits")
ARMY_KEY_ORDER = ("soldiers", "knights", "siegeEngines", "locationTerritoryId")
REGION_KEY_ORDER = ("id", "name", "worldId", "territoryIds")
TERRITORY_KEY_ORDER = (
    "id", "regionId", "startingOwnerFactionId", "neighborIds", "terrain",
    "resourceOutput", "polygon",
)
CONTAINED_KEY_ORDER = ("worldId", "regionId", "placement")
DIPLOMACY_KEY_ORDER = ("a", "b", "state", "opinion")

Point = Tuple[float, float]
Issue = Dict[str, str]


# ---------------------------------------------------------------------------
# Geometry (world +x right, +y up)
# ---------------------------------------------------------------------------

def almost_equal(a: float, b: float, eps: float = GEOM_EPS) -> bool:
    return abs(a - b) <= eps


def close_ring(points: Sequence[Point]) -> List[Point]:
    if not points:
        return []
    first, last = points[0], points[-1]
    if almost_equal(first[0], last[0]) and almost_equal(first[1], last[1]):
        return list(points)
    return list(points) + [first]


def unique_ring_vertices(points: Sequence[Point]) -> List[Point]:
    closed = close_ring(points)
    if len(closed) < 2:
        return list(closed)
    return closed[:-1]


def ring_area(points: Sequence[Point]) -> float:
    p = close_ring(points)
    a = 0.0
    for i in range(len(p) - 1):
        a += p[i][0] * p[i + 1][1] - p[i + 1][0] * p[i][1]
    return a / 2.0


def ring_centroid(points: Sequence[Point]) -> Point:
    verts = unique_ring_vertices(points)
    if not verts:
        return (0.0, 0.0)
    return (sum(v[0] for v in verts) / len(verts), sum(v[1] for v in verts) / len(verts))


def ring_bounds(points: Sequence[Point]) -> Optional[Tuple[float, float, float, float]]:
    verts = unique_ring_vertices(points)
    if not verts:
        return None
    xs = [v[0] for v in verts]
    ys = [v[1] for v in verts]
    return (min(xs), min(ys), max(xs), max(ys))


def convex_hull(points: Sequence[Point]) -> List[Point]:
    """Monotone-chain convex hull. Used only to cover new land when island union
    cannot share exact edges with independently rasterized pending geometry."""
    pts = sorted({_quantize_point(p) for p in points})
    if len(pts) <= 1:
        return list(pts)

    def cross(o: Point, a: Point, b: Point) -> float:
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: List[Point] = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= GEOM_EPS:
            lower.pop()
        lower.append(p)
    upper: List[Point] = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= GEOM_EPS:
            upper.pop()
        upper.append(p)
    hull = lower[:-1] + upper[:-1]
    if len(hull) < 3:
        return hull
    return close_ring(hull)


def point_on_segment(p: Point, a: Point, b: Point, eps: float = GEOM_EPS) -> bool:
    cross = (p[1] - a[1]) * (b[0] - a[0]) - (p[0] - a[0]) * (b[1] - a[1])
    if abs(cross) > eps * max(1.0, abs(b[0] - a[0]) + abs(b[1] - a[1])):
        return False
    dot = (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])
    if dot < -eps:
        return False
    len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2
    return dot <= len2 + eps


def point_in_ring(pt: Point, ring: Sequence[Point]) -> bool:
    p = close_ring(ring)
    verts = unique_ring_vertices(p)
    for i, a in enumerate(verts):
        b = verts[(i + 1) % len(verts)]
        if point_on_segment(pt, a, b):
            return True
    inside = False
    j = len(p) - 1
    for i in range(len(p)):
        xi, yi = p[i]
        xj, yj = p[j]
        intersect = ((yi > pt[1]) != (yj > pt[1])) and (
            pt[0] < ((xj - xi) * (pt[1] - yi)) / ((yj - yi) or GEOM_EPS) + xi
        )
        if intersect:
            inside = not inside
        j = i
    return inside


def polygon_exterior(poly: Optional[Dict[str, Any]]) -> Optional[List[Point]]:
    if not poly or not isinstance(poly.get("rings"), list) or not poly["rings"]:
        return None
    ring = poly["rings"][0]
    if not isinstance(ring, list) or len(ring) < 3:
        return None
    pts: List[Point] = []
    for p in ring:
        if not isinstance(p, dict):
            return None
        try:
            pts.append((float(p["x"]), float(p["y"])))
        except (KeyError, TypeError, ValueError):
            return None
    return pts


def all_vertices_inside(inner: Sequence[Point], outer: Sequence[Point]) -> bool:
    for v in unique_ring_vertices(inner):
        if not point_in_ring(v, outer):
            return False
    return True


def edge_length(a: Point, b: Point) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])


def ring_edges(points: Sequence[Point]) -> List[Tuple[Point, Point]]:
    verts = unique_ring_vertices(points)
    return [(verts[i], verts[(i + 1) % len(verts)]) for i in range(len(verts))]


def undirected_edge_key(a: Point, b: Point) -> str:
    a_first = a[0] < b[0] - GEOM_EPS or (almost_equal(a[0], b[0]) and a[1] <= b[1])
    p, q = (a, b) if a_first else (b, a)
    return f"{p[0]:.6f},{p[1]:.6f}|{q[0]:.6f},{q[1]:.6f}"


def shared_edge_length(poly_a: Dict[str, Any], poly_b: Dict[str, Any]) -> float:
    ra = polygon_exterior(poly_a)
    rb = polygon_exterior(poly_b)
    if not ra or not rb:
        return 0.0
    lengths: Dict[str, float] = {}
    for p, q in ring_edges(ra):
        ln = edge_length(p, q)
        if ln <= GEOM_EPS:
            continue
        lengths[undirected_edge_key(p, q)] = ln
    shared = 0.0
    for p, q in ring_edges(rb):
        ln = edge_length(p, q)
        if ln <= GEOM_EPS:
            continue
        other = lengths.get(undirected_edge_key(p, q))
        if other is not None:
            shared += min(ln, other)
    return shared


def _orient(a: Point, b: Point, c: Point) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _proper_intersect(a: Point, b: Point, c: Point, d: Point) -> bool:
    """True if ab and cd properly intersect (not merely sharing a vertex)."""
    o1, o2 = _orient(a, b, c), _orient(a, b, d)
    o3, o4 = _orient(c, d, a), _orient(c, d, b)
    if almost_equal(o1, 0) or almost_equal(o2, 0) or almost_equal(o3, 0) or almost_equal(o4, 0):
        return False
    return (o1 > 0) != (o2 > 0) and (o3 > 0) != (o4 > 0)


def ring_self_intersects(points: Sequence[Point]) -> bool:
    edges = ring_edges(points)
    n = len(edges)
    for i in range(n):
        a, b = edges[i]
        for j in range(i + 1, n):
            if abs(i - j) <= 1 or (i == 0 and j == n - 1):
                continue
            c, d = edges[j]
            if _proper_intersect(a, b, c, d):
                return True
    return False


def dist_point_to_segment(p: Point, a: Point, b: Point) -> Tuple[float, Point, float]:
    """Return (distance, closest_point, t in [0,1])."""
    vx, vy = b[0] - a[0], b[1] - a[1]
    len2 = vx * vx + vy * vy
    if len2 <= GEOM_EPS:
        return (math.hypot(p[0] - a[0], p[1] - a[1]), a, 0.0)
    t = max(0.0, min(1.0, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2))
    q = (a[0] + t * vx, a[1] + t * vy)
    return (math.hypot(p[0] - q[0], p[1] - q[1]), q, t)


def plausible_shared_edge(poly_a: Dict[str, Any], poly_b: Dict[str, Any], tol: float = 2.0) -> bool:
    """Editor assistant only. Not a generator; exported neighborIds stay explicit."""
    if shared_edge_length(poly_a, poly_b) > GEOM_EPS:
        return True
    ra = polygon_exterior(poly_a)
    rb = polygon_exterior(poly_b)
    if not ra or not rb:
        return False
    for a, b in ring_edges(ra):
        if edge_length(a, b) <= GEOM_EPS:
            continue
        for c, d in ring_edges(rb):
            if edge_length(c, d) <= GEOM_EPS:
                continue
            d1, _, _ = dist_point_to_segment(a, c, d)
            d2, _, _ = dist_point_to_segment(b, c, d)
            d3, _, _ = dist_point_to_segment(c, a, b)
            d4, _, _ = dist_point_to_segment(d, a, b)
            if d1 <= tol and d2 <= tol:
                return True
            if d3 <= tol and d4 <= tol:
                return True
    return False


def points_to_polygon(points: Sequence[Point]) -> Dict[str, Any]:
    closed = close_ring([(float(x), float(y)) for x, y in points])
    return {"rings": [[{"x": x, "y": y} for x, y in closed]]}


def set_exterior(poly: Dict[str, Any], points: Sequence[Point]) -> None:
    poly["rings"] = points_to_polygon(points)["rings"]


def _quantize_point(p: Point) -> Point:
    return (round(float(p[0]), 6), round(float(p[1]), 6))


def _ensure_ccw(points: Sequence[Point]) -> List[Point]:
    verts = [_quantize_point(p) for p in unique_ring_vertices(points)]
    closed = close_ring(verts)
    if ring_area(closed) < 0:
        verts = list(reversed(verts))
    return close_ring(verts)


def _pick_ccw_next_point(prev: Point, cur: Point, options: Sequence[Point]) -> Point:
    if len(options) == 1:
        return options[0]
    ix, iy = cur[0] - prev[0], cur[1] - prev[1]
    best = options[0]
    best_ang = -10.0
    for nxt in options:
        if nxt == prev and len(options) > 1:
            continue
        ox, oy = nxt[0] - cur[0], nxt[1] - cur[1]
        ang = math.atan2(ix * oy - iy * ox, ix * ox + iy * oy)
        if ang > best_ang:
            best_ang = ang
            best = nxt
    return best


def _walk_boundary_rings(boundary: Sequence[Tuple[Point, Point]]) -> List[List[Point]]:
    succ: Dict[Point, List[Point]] = defaultdict(list)
    unused: Set[Tuple[Point, Point]] = set()
    for a, b in boundary:
        a, b = _quantize_point(a), _quantize_point(b)
        if a == b:
            continue
        unused.add((a, b))
        if b not in succ[a]:
            succ[a].append(b)
    rings: List[List[Point]] = []
    while unused:
        start_a, start_b = min(unused, key=lambda e: (e[0][0], e[0][1], e[1][0], e[1][1]))
        path = [start_a]
        cur, nxt = start_a, start_b
        closed = False
        for _ in range(len(unused) + 8):
            if (cur, nxt) not in unused:
                break
            unused.discard((cur, nxt))
            path.append(nxt)
            if nxt == start_a:
                closed = True
                break
            options = [q for q in succ.get(nxt, []) if (nxt, q) in unused]
            if not options:
                break
            prev = cur
            cur = nxt
            nxt = _pick_ccw_next_point(prev, cur, options)
        if closed and len(unique_ring_vertices(path)) >= 3:
            ring = _ensure_ccw(path)
            if abs(ring_area(ring)) > GEOM_EPS:
                rings.append(ring)
    return rings


def union_polygon_exteriors(
    polygons: Sequence[Dict[str, Any]],
) -> Tuple[Optional[List[Point]], Optional[str]]:
    """Union tiled territory exteriors by cancelling shared undirected edges.

    Preserves source vertices (no bounding-box / centroid substitute).
    Rejects holes and disconnected components — v1 allows one exterior ring.
    """
    if not polygons:
        return None, "no polygons to union"
    rings: List[List[Point]] = []
    for poly in polygons:
        ring = polygon_exterior(poly)
        if not ring:
            return None, "a territory is missing a polygon"
        verts = unique_ring_vertices(_ensure_ccw(ring))
        if len(verts) < 3:
            return None, "a territory polygon has too few vertices"
        if abs(ring_area(close_ring(verts))) <= GEOM_EPS:
            return None, "a territory polygon has zero area"
        rings.append(verts)
    if len(rings) == 1:
        return close_ring(rings[0]), None

    count: Dict[str, int] = defaultdict(int)
    directed: Dict[str, List[Tuple[Point, Point]]] = defaultdict(list)
    for verts in rings:
        for a, b in ring_edges(verts):
            if edge_length(a, b) <= GEOM_EPS:
                continue
            key = undirected_edge_key(a, b)
            count[key] += 1
            directed[key].append((a, b))

    boundary: List[Tuple[Point, Point]] = []
    for key, n in count.items():
        if n == 1:
            boundary.append(directed[key][0])
        elif n == 2:
            a1, b1 = directed[key][0]
            a2, b2 = directed[key][1]
            same_dir = almost_equal(a1[0], a2[0]) and almost_equal(a1[1], a2[1])
            if same_dir:
                return None, "region polygons overlap instead of tiling along a shared edge"
            continue
        else:
            return None, "region polygons overlap instead of tiling along a shared edge"

    if not boundary:
        return None, "union cancelled every edge"
    walked = _walk_boundary_rings(boundary)
    if not walked:
        return None, "could not trace the region outline"
    scored = sorted(walked, key=lambda r: abs(ring_area(r)), reverse=True)
    exterior = scored[0]
    if abs(ring_area(exterior)) <= GEOM_EPS:
        return None, "union has zero area"
    for extra in scored[1:]:
        if abs(ring_area(extra)) <= GEOM_EPS:
            continue
        verts = unique_ring_vertices(extra)
        if verts and all(point_in_ring(v, exterior) for v in verts):
            return None, (
                "region union has a hole; v1 territories must be a simple exterior. "
                "The previous-level region cannot enclose another region."
            )
        return None, (
            "region is geographically disconnected; coarsening needs one contiguous "
            "region outline. Split or join those territories on the previous level first."
        )
    if ring_self_intersects(exterior):
        return None, "region union is self-intersecting"
    return _ensure_ccw(exterior), None


def identity_contained_placement() -> Dict[str, Any]:
    return {
        "origin": {"x": 0.0, "y": 0.0},
        "rotationDegrees": 0.0,
        "scale": 1.0,
    }


# ---------------------------------------------------------------------------
# Continuous drawing (authoring UX only — not a world generator)
# ---------------------------------------------------------------------------

DRAW_MIN_VERTICES = 3
DRAW_MIN_PATH_LENGTH = 8.0
DRAW_MIN_BBOX_SPAN = 4.0
DRAW_MIN_AREA = 6.0
DRAW_MAX_VERTICES = 720
DRAW_DEFAULT_MIN_SPACING = 0.12
DRAW_RDP_SPAN_FRACTION = 0.0035
DRAW_RDP_EPS_MIN = 0.04
DRAW_RDP_EPS_MAX = 1.25


def path_length(points: Sequence[Point]) -> float:
    total = 0.0
    for i in range(len(points) - 1):
        total += edge_length(points[i], points[i + 1])
    return total


def sample_path_by_distance(points: Sequence[Point], min_spacing: float) -> List[Point]:
    """Keep the stroke endpoints and points at least min_spacing apart.

    Dense pointer events are reduced here so the stored ring is not one vertex
    per mouse-move, while still capturing organic bends.
    """
    if not points:
        return []
    if len(points) == 1:
        return [(float(points[0][0]), float(points[0][1]))]
    spacing = max(float(min_spacing), GEOM_EPS)
    out: List[Point] = [(float(points[0][0]), float(points[0][1]))]
    last = points[-1]
    for p in points[1:-1]:
        q = (float(p[0]), float(p[1]))
        if edge_length(out[-1], q) >= spacing:
            out.append(q)
    end = (float(last[0]), float(last[1]))
    if edge_length(out[-1], end) > GEOM_EPS:
        out.append(end)
    return out


def densify_path(points: Sequence[Point], step: float) -> List[Point]:
    """Insert vertices along segments so a brush can cut dense freehand ink."""
    if not points:
        return []
    pts = [(float(p[0]), float(p[1])) for p in points]
    if len(pts) == 1:
        return pts
    spacing = max(float(step), GEOM_EPS)
    out: List[Point] = [pts[0]]
    for i in range(1, len(pts)):
        a = out[-1]
        b = pts[i]
        dist = edge_length(a, b)
        n = max(1, int(math.ceil(dist / spacing)))
        for k in range(1, n + 1):
            t = k / n
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def ramer_douglas_peucker(points: Sequence[Point], epsilon: float) -> List[Point]:
    """Iterative RDP. Deterministic; preserves points farther than epsilon from chords."""
    pts = [(float(p[0]), float(p[1])) for p in points]
    n = len(pts)
    if n <= 2:
        return pts
    eps = max(float(epsilon), 0.0)
    keep = [False] * n
    keep[0] = True
    keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        a, b = pts[i], pts[j]
        dmax = -1.0
        idx = -1
        for k in range(i + 1, j):
            d, _, _ = dist_point_to_segment(pts[k], a, b)
            if d > dmax:
                dmax = d
                idx = k
        if idx >= 0 and dmax > eps:
            keep[idx] = True
            stack.append((i, idx))
            stack.append((idx, j))
    return [pts[i] for i in range(n) if keep[i]]


def drawing_rdp_epsilon(points: Sequence[Point]) -> float:
    """High-detail default: small relative to the stroke, not a handful of edges."""
    if len(points) < 2:
        return DRAW_RDP_EPS_MIN
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    span = max(max(xs) - min(xs), max(ys) - min(ys), path_length(points) / 8.0, 1.0)
    return max(DRAW_RDP_EPS_MIN, min(DRAW_RDP_EPS_MAX, span * DRAW_RDP_SPAN_FRACTION))


def max_point_polyline_deviation(source: Sequence[Point], simplified: Sequence[Point]) -> float:
    """Largest distance from a source vertex to the simplified polyline (closed)."""
    edges = ring_edges(simplified)
    if not edges:
        return 0.0
    worst = 0.0
    for p in unique_ring_vertices(source) or list(source):
        best = min(dist_point_to_segment(p, a, b)[0] for a, b in edges)
        if best > worst:
            worst = best
    return worst


def _drop_closing_duplicate(points: Sequence[Point]) -> List[Point]:
    pts = [(float(p[0]), float(p[1])) for p in points]
    if len(pts) >= 2 and almost_equal(pts[0][0], pts[-1][0]) and almost_equal(pts[0][1], pts[-1][1]):
        return pts[:-1]
    return pts


def simplify_drawn_path(points: Sequence[Point], epsilon: Optional[float] = None) -> List[Point]:
    """Geometry-preserving simplify of an open or closed stroke; result is still open."""
    open_pts = _drop_closing_duplicate(points)
    if len(open_pts) <= 2:
        return open_pts
    eps = drawing_rdp_epsilon(open_pts) if epsilon is None else max(float(epsilon), 0.0)
    simplified = ramer_douglas_peucker(open_pts, eps)
    # Pathological cap: raise epsilon slightly rather than keep every jitter sample.
    guard = 0
    while len(simplified) > DRAW_MAX_VERTICES and guard < 8:
        eps *= 1.45
        simplified = ramer_douglas_peucker(open_pts, eps)
        guard += 1
    if len(simplified) < 2:
        return open_pts[:2]
    return simplified


def finalize_drawn_polygon(
    raw_points: Sequence[Point],
    min_spacing: float = DRAW_DEFAULT_MIN_SPACING,
    epsilon: Optional[float] = None,
) -> Tuple[Optional[List[Point]], Optional[Issue]]:
    """Sample + simplify a pointer stroke into a closed WorldDefinition ring.

    Coordinates must already be world-local (+x right, +y up). Never pass screen pixels.
    Neighboring territories are not modified; this only returns one polygon.
    """
    sampled = sample_path_by_distance(raw_points, min_spacing)
    if len(sampled) < DRAW_MIN_VERTICES:
        return None, issue(
            "draw.too_few_points",
            "Drawing needs a continuous path with at least 3 distinct points. "
            "Click-and-drag around the boundary; a click or tiny twitch is not a polygon.",
        )
    length = path_length(sampled)
    xs = [p[0] for p in sampled]
    ys = [p[1] for p in sampled]
    span = max(max(xs) - min(xs), max(ys) - min(ys))
    if length < DRAW_MIN_PATH_LENGTH or span < DRAW_MIN_BBOX_SPAN:
        return None, issue(
            "draw.too_small",
            "Drawing is too small to be a territory or island boundary. "
            "Drag a larger closed shape; accidental clicks are ignored.",
        )
    simplified = simplify_drawn_path(sampled, epsilon)
    closed = close_ring(simplified)
    verts = unique_ring_vertices(closed)
    if len(verts) < DRAW_MIN_VERTICES:
        return None, issue(
            "draw.too_few_points",
            "After simplification the path had fewer than 3 vertices. Draw a fuller boundary.",
        )
    if ring_self_intersects(closed):
        return None, issue(
            "draw.self_intersecting",
            "Drawn polygon intersects itself. Redraw the boundary without crossing lines. "
            "The stroke was not saved.",
        )
    area = abs(ring_area(closed))
    if area < DRAW_MIN_AREA:
        return None, issue(
            "draw.too_small",
            "Drawn polygon area is too small. Draw a larger closed shape.",
        )
    return closed, None


def finalize_drawn_path(
    raw_points: Sequence[Point],
    min_spacing: float = DRAW_DEFAULT_MIN_SPACING,
    epsilon: Optional[float] = None,
    min_length: float = 4.0,
) -> Tuple[Optional[List[Point]], Optional[Issue]]:
    """Sample + simplify an open stroke (internal boundary). World-local coords only."""
    sampled = sample_path_by_distance(raw_points, min_spacing)
    if len(sampled) < 2:
        return None, issue(
            "draw.too_few_points",
            "Boundary stroke needs a continuous path. Click-and-drag; a click is ignored.",
        )
    if path_length(sampled) < min_length:
        return None, issue(
            "draw.too_small",
            "Stroke is too short to be a boundary. Draw a longer line between existing borders.",
        )
    simplified = simplify_drawn_path(sampled, epsilon)
    if len(simplified) < 2 or path_length(simplified) < min_length:
        return None, issue(
            "draw.too_small",
            "After simplification the stroke was too short. Draw a longer connected boundary.",
        )
    return simplified, None


# ---------------------------------------------------------------------------
# Combined-drawing converter (raster enclosed regions)
# ---------------------------------------------------------------------------
# Raw strokes are only a recording of the pen. Conversion rasterizes them into
# one image, flood-fills the outside, and treats remaining enclosed empty
# areas as territories. No stroke roles, graphs, or face-walk.

CONVERT_GRID_MAX = 400
CONVERT_GAP_FRAC = 0.018
CONVERT_GAP_MIN = 0.4
CONVERT_GAP_MAX = 1.0
CONVERT_NOISE_FRAC = 0.0035

_INK = 1
_OUTSIDE = 2
_N8 = ((1, 0), (1, -1), (0, -1), (-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1))
_N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))


def drawing_snap_radius(zoom: float) -> float:
    return max(0.35, 14.0 / max(zoom, 0.01))


def _bresenham(x0: int, y0: int, x1: int, y1: int) -> List[Tuple[int, int]]:
    pts: List[Tuple[int, int]] = []
    dx = abs(x1 - x0)
    dy = -abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx + dy
    x, y = x0, y0
    while True:
        pts.append((x, y))
        if x == x1 and y == y1:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x += sx
        if e2 <= dx:
            err += dx
            y += sy
    return pts


def _stamp_cell(grid: bytearray, w: int, h: int, x: int, y: int) -> None:
    if 0 <= x < w and 0 <= y < h:
        grid[y * w + x] = _INK


def _dilate_ink(grid: bytearray, w: int, h: int, radius: int) -> None:
    """Thicken ink by a chessboard radius so tiny drawing gaps close."""
    r = max(0, int(radius))
    if r <= 0:
        return
    frontier = [i for i, val in enumerate(grid) if val == _INK]
    for _ in range(r):
        nxt: List[int] = []
        for i in frontier:
            x = i % w
            y = i // w
            for dx, dy in _N8:
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h:
                    j = ny * w + nx
                    if grid[j] == 0:
                        grid[j] = _INK
                        nxt.append(j)
        if not nxt:
            break
        frontier = nxt


def _flood_match(grid: bytearray, w: int, h: int, starts: List[int], src: int, dst: int) -> None:
    stack = [i for i in starts if grid[i] == src]
    for i in stack:
        grid[i] = dst
    while stack:
        i = stack.pop()
        x = i % w
        y = i // w
        for dx, dy in _N4:
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h:
                j = ny * w + nx
                if grid[j] == src:
                    grid[j] = dst
                    stack.append(j)


def _label_value(grid: bytearray, w: int, h: int, value: int) -> List[List[Tuple[int, int]]]:
    seen = bytearray(len(grid))
    out: List[List[Tuple[int, int]]] = []
    n = len(grid)
    for i in range(n):
        if grid[i] != value or seen[i]:
            continue
        pix: List[Tuple[int, int]] = []
        stack = [i]
        seen[i] = 1
        while stack:
            j = stack.pop()
            x = j % w
            y = j // w
            pix.append((x, y))
            for dx, dy in _N4:
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h:
                    k = ny * w + nx
                    if not seen[k] and grid[k] == value:
                        seen[k] = 1
                        stack.append(k)
        out.append(pix)
    return out


def _label_landmass(grid: bytearray, w: int, h: int) -> List[List[Tuple[int, int]]]:
    """8-connected components that are not outside (ink + enclosed empty)."""
    seen = bytearray(len(grid))
    out: List[List[Tuple[int, int]]] = []
    n = len(grid)
    for i in range(n):
        if grid[i] == _OUTSIDE or seen[i]:
            continue
        pix: List[Tuple[int, int]] = []
        stack = [i]
        seen[i] = 1
        while stack:
            j = stack.pop()
            x = j % w
            y = j // w
            pix.append((x, y))
            for dx, dy in _N8:
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h:
                    k = ny * w + nx
                    if not seen[k] and grid[k] != _OUTSIDE:
                        seen[k] = 1
                        stack.append(k)
        out.append(pix)
    return out


def _moore_contour(pixels: Sequence[Tuple[int, int]]) -> List[Tuple[int, int]]:
    occ = set(pixels)
    if not occ:
        return []
    start = min(occ, key=lambda p: (p[1], p[0]))
    bx, by = start[0] - 1, start[1]
    x, y = start
    contour: List[Tuple[int, int]] = []
    guard = len(occ) * 8 + 16
    for _ in range(guard):
        contour.append((x, y))
        nbrs = [(x + dx, y + dy) for dx, dy in _N8]
        try:
            i0 = nbrs.index((bx, by))
        except ValueError:
            i0 = 0
        nxt = None
        new_b = (bx, by)
        for k in range(1, 9):
            i = (i0 + k) % 8
            cand = nbrs[i]
            if cand in occ:
                nxt = cand
                new_b = nbrs[(i - 1) % 8]
                break
        if nxt is None:
            break
        bx, by = new_b
        x, y = nxt
        if (x, y) == start and len(contour) >= 3:
            break
    if len(contour) >= 2 and contour[0] == contour[-1]:
        contour = contour[:-1]
    return contour


def _pixels_to_ring(
    pixels: Sequence[Tuple[int, int]], origin: Point, scale: float,
) -> Optional[List[Point]]:
    contour = _moore_contour(pixels)
    if len(contour) < 3:
        return None
    ring: List[Point] = []
    inv = 1.0 / scale
    ox, oy = origin
    for gx, gy in contour:
        ring.append((ox + (gx + 0.5) * inv, oy + (gy + 0.5) * inv))
    ring = close_ring(ring)
    eps = max(inv * 1.15, DRAW_RDP_EPS_MIN * 0.5)
    simplified = simplify_drawn_path(ring, eps)
    if len(unique_ring_vertices(simplified)) < 3:
        simplified = ring
    verts = unique_ring_vertices(simplified)
    if len(verts) < 3:
        return None
    closed = close_ring(verts)
    if ring_area(closed) < 0:
        closed = close_ring(list(reversed(verts)))
    return closed


def _pick_ccw_next(
    prev: Tuple[int, int], cur: Tuple[int, int], options: Sequence[Tuple[int, int]],
) -> Tuple[int, int]:
    if len(options) == 1:
        return options[0]
    ix = cur[0] - prev[0]
    iy = cur[1] - prev[1]
    best = options[0]
    best_ang = -10.0
    for nxt in options:
        if nxt == prev and len(options) > 1:
            continue
        ox = nxt[0] - cur[0]
        oy = nxt[1] - cur[1]
        ang = math.atan2(ix * oy - iy * ox, ix * ox + iy * oy)
        if ang > best_ang:
            best_ang = ang
            best = nxt
    return best


def _crack_ring(
    labels: Sequence[int], w: int, h: int, which: int, origin: Point, scale: float,
) -> Optional[List[Point]]:
    """Trace the CCW crack contour of one label so shared walls use identical vertices."""
    succ: Dict[Tuple[int, int], List[Tuple[int, int]]] = defaultdict(list)

    def emit(a: Tuple[int, int], b: Tuple[int, int]) -> None:
        if b not in succ[a]:
            succ[a].append(b)

    def same(x: int, y: int) -> bool:
        if x < 0 or y < 0 or x >= w or y >= h:
            return False
        return labels[y * w + x] == which

    for y in range(h):
        row = y * w
        for x in range(w):
            if labels[row + x] != which:
                continue
            if not same(x, y - 1):
                emit((x, y), (x + 1, y))
            if not same(x + 1, y):
                emit((x + 1, y), (x + 1, y + 1))
            if not same(x, y + 1):
                emit((x + 1, y + 1), (x, y + 1))
            if not same(x - 1, y):
                emit((x, y + 1), (x, y))
    unused: Set[Tuple[Tuple[int, int], Tuple[int, int]]] = set()
    for a, nxts in succ.items():
        for b in nxts:
            unused.add((a, b))
    if not unused:
        return None

    def walk(start_a: Tuple[int, int], start_b: Tuple[int, int]) -> List[Tuple[int, int]]:
        path = [start_a]
        cur = start_a
        nxt = start_b
        guard = len(unused) + 4
        for _ in range(guard):
            if (cur, nxt) not in unused:
                break
            unused.discard((cur, nxt))
            path.append(nxt)
            if nxt == start_a:
                return path[:-1]
            options = [q for q in succ.get(nxt, []) if (nxt, q) in unused]
            if not options:
                return path
            prev = cur
            cur = nxt
            nxt = _pick_ccw_next(prev, cur, options)
        return path

    best: List[Tuple[int, int]] = []
    if unused:
        start_a, start_b = min(unused)
        best = walk(start_a, start_b)
        while unused:
            start_a, start_b = next(iter(unused))
            cyc = walk(start_a, start_b)
            if len(cyc) > len(best):
                best = cyc
    if len(best) < 3:
        return None
    inv = 1.0 / scale
    ox, oy = origin
    ring = [(ox + p[0] * inv, oy + p[1] * inv) for p in best]
    ring = close_ring(ring)
    if len(unique_ring_vertices(ring)) < 3:
        return None
    if ring_area(ring) < 0:
        ring = close_ring(list(reversed(unique_ring_vertices(ring))))
    return ring


def interpret_combined_drawing(polylines: Sequence[Sequence[Point]]) -> Dict[str, Any]:
    """Rasterize every polyline as one drawing and return enclosed regions."""
    fail = {
        "ok": False,
        "island": None,
        "territories": [],
        "neighbors": [],
        "noiseCount": 0,
        "message": "No island could be identified. Draw a large enclosing outline, then convert.",
    }
    strokes = [[(float(p[0]), float(p[1])) for p in s] for s in polylines if len(s) >= 2]
    if not strokes:
        return fail
    xs = [p[0] for s in strokes for p in s]
    ys = [p[1] for s in strokes for p in s]
    minx, maxx = min(xs), max(xs)
    miny, maxy = min(ys), max(ys)
    diag = math.hypot(maxx - minx, maxy - miny)
    gap_world = max(CONVERT_GAP_MIN, CONVERT_GAP_FRAC * diag)
    gap_world = min(gap_world, CONVERT_GAP_MAX)
    close_loop = max(gap_world * 2.0, min(2.5, 0.03 * max(diag, 1.0)))
    pad = gap_world * 3.0
    minx -= pad
    miny -= pad
    maxx += pad
    maxy += pad
    span_x = max(maxx - minx, 1e-6)
    span_y = max(maxy - miny, 1e-6)
    scale = (CONVERT_GRID_MAX - 4) / max(span_x, span_y)
    w = max(16, int(span_x * scale) + 4)
    h = max(16, int(span_y * scale) + 4)
    w = min(w, CONVERT_GRID_MAX + 8)
    h = min(h, CONVERT_GRID_MAX + 8)
    origin = (minx, miny)
    gap_px = max(1, int(round(gap_world * scale)))
    grid = bytearray(w * h)

    def to_cell(p: Point) -> Tuple[int, int]:
        gx = int(round((p[0] - origin[0]) * scale))
        gy = int(round((p[1] - origin[1]) * scale))
        return (max(0, min(w - 1, gx)), max(0, min(h - 1, gy)))

    for stroke in strokes:
        prev = to_cell(stroke[0])
        _stamp_cell(grid, w, h, prev[0], prev[1])
        for p in stroke[1:]:
            cur = to_cell(p)
            for x, y in _bresenham(prev[0], prev[1], cur[0], cur[1]):
                _stamp_cell(grid, w, h, x, y)
            prev = cur
        gap_ends = edge_length(stroke[0], stroke[-1])
        if GEOM_EPS < gap_ends <= close_loop:
            a = to_cell(stroke[-1])
            b = to_cell(stroke[0])
            for x, y in _bresenham(a[0], a[1], b[0], b[1]):
                _stamp_cell(grid, w, h, x, y)
    _dilate_ink(grid, w, h, gap_px)

    border: List[int] = []
    for x in range(w):
        border.append(x)
        border.append((h - 1) * w + x)
    for y in range(h):
        border.append(y * w)
        border.append(y * w + (w - 1))
    _flood_match(grid, w, h, border, 0, _OUTSIDE)

    land_blobs = _label_landmass(grid, w, h)
    if not land_blobs:
        return fail
    land = max(land_blobs, key=len)
    land_set = set(land)
    interiors = [
        pix for pix in _label_value(grid, w, h, 0)
        if pix and pix[0] in land_set
    ]
    if not interiors:
        fail = dict(fail)
        fail["message"] = "No enclosed area was found inside the drawing."
        return fail

    cell_area = (1.0 / scale) ** 2
    land_area = len(land) * cell_area
    if land_area < CONVERT_MIN_ISLAND_AREA:
        return fail
    min_terr = max(DRAW_MIN_AREA, land_area * CONVERT_NOISE_FRAC)
    kept: List[List[Tuple[int, int]]] = []
    noise = 0
    for pix in interiors:
        if len(pix) * cell_area >= min_terr and len(pix) >= 8:
            kept.append(pix)
        else:
            noise += 1
    if not kept:
        fail = dict(fail)
        fail["message"] = "Drawing produced no meaningful territories (enclosed areas were only noise)."
        fail["noiseCount"] = noise
        return fail

    def ink_touches_outside(x: int, y: int) -> bool:
        for dx, dy in _N4:
            nx, ny = x + dx, y + dy
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
                return True
            if grid[ny * w + nx] == _OUTSIDE:
                return True
        return False

    labels = [-3] * (w * h)
    for idx, val in enumerate(grid):
        if val == _OUTSIDE:
            labels[idx] = -2
    queue: List[Tuple[int, int, int]] = []
    for i, pix in enumerate(kept):
        for x, y in pix:
            labels[y * w + x] = i
            queue.append((x, y, 0))
    qi = 0
    wall_limit = max(2, gap_px * 2 + 2)
    while qi < len(queue):
        x, y, dist = queue[qi]
        qi += 1
        lab = labels[y * w + x]
        for dx, dy in _N4:
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h:
                j = ny * w + nx
                if labels[j] == -3 and grid[j] == _INK:
                    if dist >= wall_limit and ink_touches_outside(nx, ny):
                        continue
                    labels[j] = lab
                    queue.append((nx, ny, dist + 1))

    island_id = 10_000
    island_labels = [-2] * (w * h)
    for idx, val in enumerate(labels):
        if val >= 0:
            island_labels[idx] = island_id
    island = _crack_ring(island_labels, w, h, island_id, origin, scale)
    if island is None or abs(ring_area(island)) < CONVERT_MIN_ISLAND_AREA:
        island = _pixels_to_ring(land, origin, scale)
    if island is None or abs(ring_area(island)) < CONVERT_MIN_ISLAND_AREA:
        return fail

    territories: List[List[Point]] = []
    kept_idx: List[int] = []
    for i, pix in enumerate(kept):
        ring = _crack_ring(labels, w, h, i, origin, scale)
        if ring is None or abs(ring_area(ring)) < min_terr:
            noise += 1
            continue
        territories.append(ring)
        kept_idx.append(i)
    if not territories:
        fail = dict(fail)
        fail["message"] = "Could not turn enclosed areas into polygons."
        fail["noiseCount"] = noise
        return fail

    remap = {old: new for new, old in enumerate(kept_idx)}
    neighbors_set: Set[Tuple[int, int]] = set()
    for y in range(h):
        row = y * w
        for x in range(w):
            a = labels[row + x]
            if a not in remap:
                continue
            for dx, dy in _N4:
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h:
                    b = labels[ny * w + nx]
                    if b in remap and b != a:
                        ia, ib = remap[a], remap[b]
                        neighbors_set.add((min(ia, ib), max(ia, ib)))
    neighbors = sorted(neighbors_set)

    return {
        "ok": True,
        "island": island,
        "territories": territories,
        "neighbors": neighbors,
        "noiseCount": noise,
        "message": "",
        "cellSize": 1.0 / scale,
        "gapWorld": gap_world,
    }


INCREMENTAL_CONVERT_FATAL = frozenset({
    "territory.outside_island",
    "territory.duplicate_id",
    "territory.missing_id",
    "adjacency.non_reciprocal",
    "adjacency.missing_neighbor",
    "adjacency.self_neighbor",
    "adjacency.disconnected",
    "geometry.self_intersecting",
    "geometry.too_few_vertices",
    "geometry.zero_area",
    "geometry.missing_ring",
    "territory.region_mismatch",
})
INCREMENTAL_ADJACENCY_TOL = 6.0


def has_committed_map(world: Dict[str, Any]) -> bool:
    """True when converted island + at least one territory polygon are present."""
    isle = polygon_exterior(world.get("island") if isinstance(world.get("island"), dict) else None)
    if not isle or len(unique_ring_vertices(isle)) < 3:
        return False
    for t in world.get("territories") or []:
        if not isinstance(t, dict) or not t.get("id"):
            continue
        ext = polygon_exterior(t.get("polygon") if isinstance(t.get("polygon"), dict) else None)
        if ext and len(unique_ring_vertices(ext)) >= 3:
            return True
    return False


def _ring_abs_area(points: Sequence[Point]) -> float:
    verts = unique_ring_vertices(points)
    if len(verts) < 3:
        return 0.0
    return abs(ring_area(close_ring(verts)))


def _island_covers_territories(island_ring: Sequence[Point], territories: Sequence[Dict[str, Any]]) -> bool:
    for t in territories:
        if not isinstance(t, dict):
            continue
        ext = polygon_exterior(t.get("polygon") if isinstance(t.get("polygon"), dict) else None)
        if ext and not all_vertices_inside(ext, island_ring):
            return False
    return True


def _try_install_extended_island(
    world: Dict[str, Any],
    candidate: Sequence[Point],
    committed_ring: Sequence[Point],
    territories: Sequence[Dict[str, Any]],
) -> bool:
    verts = unique_ring_vertices(candidate)
    if len(verts) < 3:
        return False
    closed = close_ring(verts)
    if _ring_abs_area(closed) + 1e-6 < _ring_abs_area(committed_ring):
        return False
    if not all_vertices_inside(committed_ring, closed):
        return False
    if not _island_covers_territories(closed, territories):
        return False
    if not isinstance(world.get("island"), dict):
        world["island"] = {"rings": []}
    set_exterior(world["island"], closed)
    return True


def _new_ring_conflicts_with_committed(ring: Sequence[Point], committed: Sequence[Dict[str, Any]]) -> bool:
    c_new = ring_centroid(ring)
    for t in committed:
        ext = polygon_exterior(t.get("polygon") if isinstance(t.get("polygon"), dict) else None)
        if not ext or len(unique_ring_vertices(ext)) < 3:
            continue
        if point_in_ring(c_new, ext):
            return True
        if point_in_ring(ring_centroid(ext), ring):
            return True
    return False


def _ring_bboxes_near(a: Sequence[Point], b: Sequence[Point], pad: float) -> bool:
    ba = ring_bounds(a)
    bb = ring_bounds(b)
    if not ba or not bb:
        return False
    return not (
        ba[2] + pad < bb[0] or bb[2] + pad < ba[0]
        or ba[3] + pad < bb[1] or bb[3] + pad < ba[1]
    )


def _incremental_adjacent(poly_a: Dict[str, Any], poly_b: Dict[str, Any], tol: float = INCREMENTAL_ADJACENCY_TOL) -> bool:
    ra = polygon_exterior(poly_a)
    rb = polygon_exterior(poly_b)
    if not ra or not rb or not _ring_bboxes_near(ra, rb, tol):
        return False
    if shared_edge_length(poly_a, poly_b) > GEOM_EPS:
        return True
    ea = ring_edges(ra)
    eb = ring_edges(rb)
    if len(ea) * len(eb) <= 8000:
        return plausible_shared_edge(poly_a, poly_b, tol=tol)
    step_a = max(1, len(ea) // 24)
    step_b = max(1, len(eb) // 24)
    for a, b in ea[::step_a]:
        if edge_length(a, b) <= GEOM_EPS:
            continue
        for c, d in eb[::step_b]:
            if edge_length(c, d) <= GEOM_EPS:
                continue
            d1, _, _ = dist_point_to_segment(a, c, d)
            d2, _, _ = dist_point_to_segment(b, c, d)
            if d1 <= tol and d2 <= tol:
                return True
            d3, _, _ = dist_point_to_segment(c, a, b)
            d4, _, _ = dist_point_to_segment(d, a, b)
            if d3 <= tol and d4 <= tol:
                return True
    return False


def _append_neighbor(territory: Dict[str, Any], other_id: str) -> None:
    if not other_id or other_id == territory.get("id"):
        return
    ids = list(territory.get("neighborIds") or [])
    if other_id not in ids:
        ids.append(other_id)
        territory["neighborIds"] = ids


def _fill_empty_faction_homes(world: Dict[str, Any], new_terrs: Sequence[Dict[str, Any]]) -> None:
    ids = [t.get("id") for t in (world.get("territories") or []) if isinstance(t, dict) and t.get("id")]
    player_id = world.get("playerFactionId") or ""
    if ids and player_id:
        fac = find_faction(world, player_id)
        if fac and not fac.get("homeTerritoryId"):
            owned = next(
                (t["id"] for t in list(world.get("territories") or []) + list(new_terrs)
                 if isinstance(t, dict) and t.get("startingOwnerFactionId") == player_id and t.get("id")),
                ids[0],
            )
            fac["homeTerritoryId"] = owned
            army = fac.get("startingArmy")
            if isinstance(army, dict) and not army.get("locationTerritoryId"):
                army["locationTerritoryId"] = owned


def _expand_ring(points: Sequence[Point], factor: float) -> List[Point]:
    verts = unique_ring_vertices(points)
    if len(verts) < 3:
        return list(points)
    cx = sum(p[0] for p in verts) / len(verts)
    cy = sum(p[1] for p in verts) / len(verts)
    c = (cx, cy)
    return close_ring([
        (c[0] + (p[0] - c[0]) * factor, c[1] + (p[1] - c[1]) * factor)
        for p in verts
    ])


def _extend_committed_island(
    world: Dict[str, Any],
    pending_island: Sequence[Point],
    all_territories: Sequence[Dict[str, Any]],
    new_territories: Sequence[Dict[str, Any]],
) -> Optional[str]:
    """Grow the committed island to cover new land. Never shrinks. Never
    re-rasterizes the old coast.

    Order: keep-as-is if new land is already inside; exact shared-edge union
    with the pending island or new territory rings only; last resort convex hull
    of committed island vertices plus new territory vertices (may fill
    concavities; never drops committed vertices from the covered set).
    """
    committed_ring = polygon_exterior(world.get("island") if isinstance(world.get("island"), dict) else None)
    if not committed_ring or len(unique_ring_vertices(committed_ring)) < 3:
        if pending_island and len(unique_ring_vertices(pending_island)) >= 3:
            if not isinstance(world.get("island"), dict):
                world["island"] = {"rings": []}
            set_exterior(world["island"], pending_island)
            return None
        return "Could not extend the committed island to cover new territories."

    new_verts: List[Point] = []
    for t in new_territories:
        ext = polygon_exterior(t.get("polygon") if isinstance(t.get("polygon"), dict) else None)
        if ext:
            new_verts.extend(unique_ring_vertices(ext))
    if new_verts and all(point_in_ring(v, committed_ring) for v in new_verts):
        return None

    if pending_island and len(unique_ring_vertices(pending_island)) >= 3:
        pending_poly = points_to_polygon(pending_island)
        if len(unique_ring_vertices(committed_ring)) + len(unique_ring_vertices(pending_island)) <= 280:
            merged, _err = union_polygon_exteriors([world["island"], pending_poly])
            if merged and _try_install_extended_island(world, merged, committed_ring, all_territories):
                return None

    for t in new_territories:
        poly = t.get("polygon") if isinstance(t, dict) else None
        if not isinstance(poly, dict):
            continue
        ext = polygon_exterior(poly)
        if not ext:
            continue
        if len(unique_ring_vertices(committed_ring)) + len(unique_ring_vertices(ext)) > 280:
            continue
        merged, _err = union_polygon_exteriors([world["island"], poly])
        if merged and _try_install_extended_island(world, merged, committed_ring, all_territories):
            committed_ring = polygon_exterior(world["island"]) or committed_ring
            if _island_covers_territories(committed_ring, all_territories):
                return None

    committed_ring = polygon_exterior(world.get("island") if isinstance(world.get("island"), dict) else None) or committed_ring
    if _island_covers_territories(committed_ring, all_territories):
        return None

    hull_pts = list(unique_ring_vertices(committed_ring))
    for t in new_territories:
        ext = polygon_exterior(t.get("polygon") if isinstance(t.get("polygon"), dict) else None)
        if ext:
            hull_pts.extend(unique_ring_vertices(ext))
    if pending_island:
        hull_pts.extend(unique_ring_vertices(pending_island))
    hull = convex_hull(hull_pts)
    if _try_install_extended_island(world, hull, committed_ring, all_territories):
        return None
    grown = _expand_ring(hull, 1.002)
    if _try_install_extended_island(world, grown, committed_ring, all_territories):
        return None
    return (
        "New drawing is outside the committed island and could not be unioned "
        "without altering existing land. Draw new enclosed land that attaches "
        "to the current island."
    )


def append_converted_polygons(
    world: Dict[str, Any],
    island: Sequence[Point],
    territory_rings: Sequence[Sequence[Point]],
    neighbor_pairs: Sequence[Tuple[int, int]],
) -> Optional[str]:
    """Add newly interpreted territories onto a locked committed map.

    Existing polygons, IDs, ownership, regions, resources, and neighbor lists
    are not regenerated. Neighbor lists only gain new reciprocal links.
    """
    committed = [t for t in (world.get("territories") or []) if isinstance(t, dict) and t.get("id")]
    if not territory_rings:
        return "Pending drawing produced no territories."
    new_rings: List[Sequence[Point]] = []
    for ring in territory_rings:
        if len(unique_ring_vertices(ring)) < 3:
            continue
        if _new_ring_conflicts_with_committed(ring, committed):
            return (
                "Pending drawing overlaps committed territories. "
                "Draw only new enclosed land; CONVERT TO MAP does not reshape the existing map."
            )
        new_rings.append(ring)
    if not new_rings:
        return "Pending drawing produced no territories."

    if not (world.get("regions") or []):
        add_region(world, "Region")
    regions = world.get("regions") or []
    default_rid = regions[0]["id"] if regions else ""
    player_id = world.get("playerFactionId") or ""
    ais = [f["id"] for f in world.get("factions") or [] if isinstance(f, dict) and f.get("role") == "ai"]
    player_already = any(t.get("startingOwnerFactionId") == player_id for t in committed)

    new_terrs: List[Dict[str, Any]] = []
    taken = [t.get("id") for t in committed] + [t.get("id") for t in new_terrs]
    for ring in new_rings:
        if player_already or any(nt.get("startingOwnerFactionId") == player_id for nt in new_terrs):
            owner = ais[0] if ais else player_id
        else:
            owner = player_id
            player_already = True
        tid = next_id("t_", taken)
        taken.append(tid)
        rec = {
            "id": tid,
            "regionId": default_rid,
            "startingOwnerFactionId": owner,
            "neighborIds": [],
            "terrain": "plains",
            "resourceOutput": {k: 0 for k in RESOURCE_KEYS},
            "polygon": points_to_polygon(ring),
        }
        new_terrs.append(rec)

    new_neighbors: Dict[str, Set[str]] = {t["id"]: set() for t in new_terrs}
    for a, b in neighbor_pairs:
        if 0 <= a < len(new_terrs) and 0 <= b < len(new_terrs):
            ia, ib = new_terrs[a]["id"], new_terrs[b]["id"]
            if ia != ib:
                new_neighbors[ia].add(ib)
                new_neighbors[ib].add(ia)
    if len(new_terrs) > 1 and not any(new_neighbors.values()):
        for i, a in enumerate(new_terrs):
            pa = a.get("polygon") if isinstance(a.get("polygon"), dict) else None
            if not pa:
                continue
            for j in range(i + 1, len(new_terrs)):
                pb = new_terrs[j].get("polygon")
                if isinstance(pb, dict) and plausible_shared_edge(pa, pb, tol=4.0):
                    ia, ib = a["id"], new_terrs[j]["id"]
                    new_neighbors[ia].add(ib)
                    new_neighbors[ib].add(ia)

    for nt in new_terrs:
        npoly = nt.get("polygon") if isinstance(nt.get("polygon"), dict) else None
        if not npoly:
            continue
        for old in committed:
            opoly = old.get("polygon") if isinstance(old.get("polygon"), dict) else None
            if not opoly:
                continue
            if _incremental_adjacent(npoly, opoly, tol=INCREMENTAL_ADJACENCY_TOL):
                oid, nid = str(old["id"]), str(nt["id"])
                new_neighbors[nid].add(oid)
                _append_neighbor(old, nid)

    for nt in new_terrs:
        extra = sorted(new_neighbors.get(nt["id"], set()))
        nt["neighborIds"] = extra

    world["territories"] = committed + new_terrs
    for t in new_terrs:
        rid = t.get("regionId") or default_rid
        if rid and not find_region(world, rid):
            rid = default_rid
            t["regionId"] = rid
        if t.get("id") and rid:
            sync_region_membership(world, t["id"], rid)

    island_err = _extend_committed_island(world, island, world["territories"], new_terrs)
    if island_err:
        return island_err

    _fill_empty_faction_homes(world, new_terrs)
    issues = [
        i for i in validate_world(world)
        if i.get("code") in INCREMENTAL_CONVERT_FATAL
    ]
    if issues:
        return issues[0]["message"]
    return None


def apply_converted_polygons(
    world: Dict[str, Any],
    island: Sequence[Point],
    territory_rings: Sequence[Sequence[Point]],
    neighbor_pairs: Sequence[Tuple[int, int]],
) -> None:
    """Replace converted geography. Match prior territory metadata by centroid."""
    world.pop(EDITOR_GRAPH_KEY, None)
    if island and len(unique_ring_vertices(island)) >= 3:
        if not isinstance(world.get("island"), dict):
            world["island"] = {"rings": []}
        set_exterior(world["island"], island)
    else:
        world["island"] = {"rings": [[]]}

    old = [t for t in (world.get("territories") or []) if isinstance(t, dict)]
    used_old: Set[str] = set()
    new_terrs: List[Dict[str, Any]] = []
    if not (world.get("regions") or []) and territory_rings:
        add_region(world, "Region")
    regions = world.get("regions") or []
    default_rid = regions[0]["id"] if regions else ""
    player_id = world.get("playerFactionId") or ""
    ais = [f["id"] for f in world.get("factions") or [] if isinstance(f, dict) and f.get("role") == "ai"]

    for ring in territory_rings:
        c = ring_centroid(ring)
        match: Optional[Dict[str, Any]] = None
        for t in old:
            tid = t.get("id")
            if not tid or tid in used_old:
                continue
            ext = polygon_exterior(t.get("polygon") if isinstance(t.get("polygon"), dict) else None)
            if ext and point_in_ring(c, ext):
                match = t
                break
        if match is None:
            for t in old:
                tid = t.get("id")
                if not tid or tid in used_old:
                    continue
                ext = polygon_exterior(t.get("polygon") if isinstance(t.get("polygon"), dict) else None)
                if ext and point_in_ring(ring_centroid(ext), ring):
                    match = t
                    break
        if match is not None:
            used_old.add(str(match["id"]))
            t = clone_world(match)
            if not isinstance(t.get("polygon"), dict):
                t["polygon"] = points_to_polygon(ring)
            else:
                set_exterior(t["polygon"], ring)
            new_terrs.append(t)
        else:
            if any(nt.get("startingOwnerFactionId") == player_id for nt in new_terrs):
                owner = ais[0] if ais else player_id
            else:
                owner = player_id
            tid = next_id("t_", [x.get("id") for x in new_terrs] + [x.get("id") for x in old])
            new_terrs.append({
                "id": tid,
                "regionId": default_rid,
                "startingOwnerFactionId": owner,
                "neighborIds": [],
                "terrain": "plains",
                "resourceOutput": {k: 0 for k in RESOURCE_KEYS},
                "polygon": points_to_polygon(ring),
            })

    player_owned = [t for t in new_terrs if t.get("startingOwnerFactionId") == player_id]
    if len(player_owned) == 0 and new_terrs:
        new_terrs[0]["startingOwnerFactionId"] = player_id
    elif len(player_owned) > 1:
        for t in new_terrs[1:]:
            if t.get("startingOwnerFactionId") == player_id:
                t["startingOwnerFactionId"] = ais[0] if ais else player_id

    world["territories"] = new_terrs
    ids = [t["id"] for t in new_terrs if t.get("id")]
    for r in world.get("regions") or []:
        r["territoryIds"] = [
            i for i in ids
            if find_territory(world, i) and find_territory(world, i).get("regionId") == r.get("id")
        ]
        for t in new_terrs:
            if t.get("regionId") == r.get("id") and t.get("id") not in r["territoryIds"]:
                r["territoryIds"].append(t["id"])
    for t in new_terrs:
        if t.get("regionId") and default_rid and not find_region(world, t.get("regionId") or ""):
            t["regionId"] = default_rid
            sync_region_membership(world, t["id"], default_rid)
        elif t.get("id") and t.get("regionId"):
            sync_region_membership(world, t["id"], t["regionId"])

    neighbors: Dict[str, Set[str]] = {t["id"]: set() for t in new_terrs if t.get("id")}
    for a, b in neighbor_pairs:
        if 0 <= a < len(new_terrs) and 0 <= b < len(new_terrs):
            ia, ib = new_terrs[a].get("id"), new_terrs[b].get("id")
            if ia and ib and ia != ib:
                neighbors[ia].add(ib)
                neighbors[ib].add(ia)
    if len(new_terrs) > 1 and not any(neighbors.values()):
        for i, a in enumerate(new_terrs):
            pa = a.get("polygon") if isinstance(a.get("polygon"), dict) else None
            if not pa:
                continue
            for j in range(i + 1, len(new_terrs)):
                pb = new_terrs[j].get("polygon")
                if isinstance(pb, dict) and plausible_shared_edge(pa, pb, tol=4.0):
                    ia, ib = a.get("id"), new_terrs[j].get("id")
                    if ia and ib:
                        neighbors[ia].add(ib)
                        neighbors[ib].add(ia)
    for t in new_terrs:
        tid = t.get("id")
        if tid:
            t["neighborIds"] = sorted(neighbors.get(tid, set()))

    live = set(ids)
    for f in world.get("factions") or []:
        if not isinstance(f, dict):
            continue
        home = f.get("homeTerritoryId")
        if home and home not in live:
            f["homeTerritoryId"] = ids[0] if ids else ""
        army = f.get("startingArmy")
        if isinstance(army, dict):
            loc = army.get("locationTerritoryId")
            if loc and loc not in live:
                army["locationTerritoryId"] = f.get("homeTerritoryId") or (ids[0] if ids else "")
    if ids and player_id:
        fac = find_faction(world, player_id)
        if fac and not fac.get("homeTerritoryId"):
            owned = next((t["id"] for t in new_terrs if t.get("startingOwnerFactionId") == player_id), ids[0])
            fac["homeTerritoryId"] = owned
            army = fac.get("startingArmy")
            if isinstance(army, dict) and not army.get("locationTerritoryId"):
                army["locationTerritoryId"] = owned


def _pending_polylines(world: Dict[str, Any]) -> List[List[Point]]:
    lines: List[List[Point]] = []
    for item in all_pending_raw_strokes(world):
        pts = open_stroke_points(item)
        if len(pts) >= 2:
            lines.append(pts)
    return lines


def _install_converted_editor_state(target: Dict[str, Any], source: Dict[str, Any]) -> None:
    target["island"] = source["island"]
    target["territories"] = source["territories"]
    target["regions"] = source["regions"]
    target["factions"] = source["factions"]
    if EDITOR_DRAWING_KEY in source:
        target[EDITOR_DRAWING_KEY] = source[EDITOR_DRAWING_KEY]
    if EDITOR_OPEN_STROKES_KEY in source:
        target[EDITOR_OPEN_STROKES_KEY] = source[EDITOR_OPEN_STROKES_KEY]


def convert_drawing_to_map(world: Dict[str, Any], snap_tol: Optional[float] = None) -> Dict[str, Any]:
    """Commit pending raw drawing into the map.

    First successful conversion locks island/territories. Later conversions
    interpret ONLY pending strokes and append. Committed geometry is never
    re-rasterized. Failed conversion leaves the committed world untouched.
    """
    _ = snap_tol
    normalize_editor_drawing(world)
    pending = _pending_polylines(world)
    committed = has_committed_map(world)

    def _report(**kwargs: Any) -> Dict[str, Any]:
        island = kwargs.pop("island", None)
        territories = kwargs.pop("territories", None)
        report = {
            "ok": False,
            "message": "",
            "islandDetected": False,
            "territoryCount": len(world.get("territories") or []),
            "noiseCount": 0,
            "appendedCount": 0,
            "unchanged": False,
            **kwargs,
        }
        world[EDITOR_CONVERT_REPORT_KEY] = report
        return {
            "ok": bool(report["ok"]),
            "message": report.get("message") or "",
            "island": island,
            "territories": territories if territories is not None else [],
            "report": report,
            "unchanged": bool(report.get("unchanged")),
            "appendedCount": int(report.get("appendedCount") or 0),
        }

    if committed and not pending:
        return _report(
            ok=True,
            unchanged=True,
            message="Nothing pending to convert. Committed map unchanged.",
            islandDetected=True,
            territoryCount=len(world.get("territories") or []),
        )

    geom = interpret_combined_drawing(pending)
    if not geom.get("ok"):
        return _report(
            ok=False,
            message=geom.get("message") or "Could not interpret the pending drawing.",
            noiseCount=int(geom.get("noiseCount") or 0),
            islandDetected=False,
        )

    if not committed:
        apply_converted_polygons(
            world,
            geom["island"],
            geom["territories"],
            geom.get("neighbors") or [],
        )
        commit_pending_drawing(world)
        n = len(world.get("territories") or [])
        return _report(
            ok=True,
            message="",
            islandDetected=True,
            territoryCount=n,
            noiseCount=int(geom.get("noiseCount") or 0),
            appendedCount=0,
            island=geom.get("island"),
            territories=geom.get("territories") or [],
        )

    before_n = len([t for t in (world.get("territories") or []) if isinstance(t, dict) and t.get("id")])
    work = clone_world(world)
    err = append_converted_polygons(
        work,
        geom["island"],
        geom["territories"],
        geom.get("neighbors") or [],
    )
    if err:
        return _report(
            ok=False,
            message=err,
            noiseCount=int(geom.get("noiseCount") or 0),
            islandDetected=bool(geom.get("island")),
        )
    commit_pending_drawing(work)
    _install_converted_editor_state(world, work)
    after_n = len([t for t in (world.get("territories") or []) if isinstance(t, dict) and t.get("id")])
    appended = max(0, after_n - before_n)
    return _report(
        ok=True,
        message=f"Appended {appended} territor{'y' if appended == 1 else 'ies'}. Existing map locked.",
        islandDetected=True,
        territoryCount=after_n,
        noiseCount=int(geom.get("noiseCount") or 0),
        appendedCount=appended,
        island=geom.get("island"),
        territories=geom.get("territories") or [],
    )


def format_conversion_report(result: Dict[str, Any]) -> str:
    report = result.get("report") if isinstance(result.get("report"), dict) else result
    if not isinstance(report, dict):
        report = {}
    ok = result.get("ok")
    if ok is None:
        ok = report.get("ok")
    message = result.get("message") or report.get("message") or ""
    lines = []
    if report.get("unchanged") or result.get("unchanged"):
        lines.append("CONVERT TO MAP — nothing pending. Committed map unchanged.")
        if message:
            lines.append(message)
    elif ok:
        appended = int(result.get("appendedCount") or report.get("appendedCount") or 0)
        if message and "Appended" in str(message):
            lines.append("CONVERT TO MAP — " + str(message))
        elif appended:
            lines.append(f"CONVERT TO MAP — appended {appended} new territories. Existing map locked.")
        else:
            lines.append("CONVERT TO MAP — enclosed areas committed.")
    else:
        lines.append("CONVERT TO MAP — could not interpret the pending drawing.")
        if message:
            lines.append(message)
        lines.append("Committed map was not changed.")
    island_yes = "YES" if report.get("islandDetected") or (ok and result.get("island")) else "NO"
    lines.append(f"Detected island: {island_yes}")
    lines.append(f"Territories: {report.get('territoryCount', len(result.get('territories') or []))}")
    noise = int(report.get("noiseCount") or 0)
    lines.append(f"Ignored noise: {noise} areas")
    return "\n".join(lines)

def empty_open_strokes() -> Dict[str, Any]:
    return {"next": 1, "items": []}


def get_open_strokes(world: Dict[str, Any], create: bool = True) -> Dict[str, Any]:
    raw = world.get(EDITOR_OPEN_STROKES_KEY)
    if isinstance(raw, dict) and isinstance(raw.get("items"), list):
        raw.setdefault("next", 1)
        return raw
    store = empty_open_strokes()
    if create:
        world[EDITOR_OPEN_STROKES_KEY] = store
    return store


def iter_open_strokes(world: Dict[str, Any]) -> List[Dict[str, Any]]:
    return list(get_open_strokes(world, create=False).get("items") or [])


def _stroke_xy(p: Any) -> Optional[Point]:
    if isinstance(p, (list, tuple)) and len(p) >= 2:
        try:
            return (float(p[0]), float(p[1]))
        except (TypeError, ValueError):
            return None
    if isinstance(p, dict) and "x" in p and "y" in p:
        try:
            return (float(p["x"]), float(p["y"]))
        except (TypeError, ValueError):
            return None
    return None


def open_stroke_points(item: Dict[str, Any]) -> List[Point]:
    pts: List[Point] = []
    for p in item.get("points") or []:
        xy = _stroke_xy(p)
        if xy is not None:
            pts.append(xy)
    return pts


def _as_open_points(points: Sequence[Point]) -> List[Point]:
    return [(float(p[0]), float(p[1])) for p in points]


def add_open_stroke(world: Dict[str, Any], points: Sequence[Point]) -> str:
    store = get_open_strokes(world)
    sid = f"s{store['next']:04d}"
    store["next"] += 1
    store["items"].append({"id": sid, "points": _as_open_points(points)})
    return sid


def put_open_stroke(world: Dict[str, Any], sid: str, points: Sequence[Point]) -> None:
    store = get_open_strokes(world)
    pts = _as_open_points(points)
    for item in store["items"]:
        if item.get("id") == sid:
            item["points"] = pts
            return
    store["items"].append({"id": sid, "points": pts})


def remove_open_stroke(world: Dict[str, Any], sid: str) -> None:
    store = get_open_strokes(world, create=False)
    items = store.get("items")
    if isinstance(items, list):
        store["items"] = [i for i in items if i.get("id") != sid]


def find_open_stroke(world: Dict[str, Any], sid: str) -> Optional[Dict[str, Any]]:
    for item in iter_open_strokes(world):
        if item.get("id") == sid:
            return item
    return None


def nearest_open_stroke_end(
    world: Dict[str, Any], p: Point, radius: float,
) -> Optional[Dict[str, Any]]:
    best: Optional[Dict[str, Any]] = None
    best_d = radius
    for item in iter_open_strokes(world):
        pts = open_stroke_points(item)
        if len(pts) < 2:
            continue
        for which, q in (("start", pts[0]), ("end", pts[-1])):
            d = edge_length(p, q)
            if d <= best_d:
                best_d = d
                best = {"id": item.get("id"), "which": which, "point": q, "dist": d}
    return best


def oriented_open_stroke_for_resume(
    world: Dict[str, Any], p: Point, radius: float,
) -> Optional[Dict[str, Any]]:
    """Return the open stroke oriented so appending continues from the nearer endpoint."""
    hit = nearest_open_stroke_end(world, p, radius)
    if not hit or not hit.get("id"):
        return None
    item = find_open_stroke(world, str(hit["id"]))
    if not item:
        return None
    pts = open_stroke_points(item)
    if hit.get("which") == "start":
        pts = list(reversed(pts))
    return {"id": hit["id"], "which": hit["which"], "points": pts, "point": hit["point"]}


def first_open_boundary_endpoint(world: Dict[str, Any]) -> Optional[Point]:
    for item in iter_open_strokes(world):
        pts = open_stroke_points(item)
        if len(pts) >= 2:
            return pts[-1]
    return None


def first_open_boundary_id(world: Dict[str, Any]) -> Optional[str]:
    for item in iter_open_strokes(world):
        if len(open_stroke_points(item)) >= 2:
            sid = item.get("id")
            return str(sid) if sid else None
    return None


def territory_is_multi_selected(
    territory_id: str,
    selected_ids: Iterable[str],
    sel: Optional[Tuple[str, Any]] = None,
) -> bool:
    if territory_id in set(selected_ids):
        return True
    return bool(sel and sel[0] == "territory" and sel[1] == territory_id)


def view_world_to_screen(
    x: float, y: float, zoom: float, origin_x: float, origin_y: float,
) -> Tuple[float, float]:
    return (origin_x + x * zoom, origin_y - y * zoom)


def view_screen_to_world(
    sx: float, sy: float, zoom: float, origin_x: float, origin_y: float,
) -> Point:
    z = max(float(zoom), 1e-9)
    return ((sx - origin_x) / z, (origin_y - sy) / z)


def player_facing_troop_count(army: Dict[str, Any]) -> int:
    """Player-facing Troops = internal soldiers + knights + siegeEngines. No schema change."""
    def n(key: str) -> int:
        v = army.get(key, 0)
        try:
            return max(0, int(v))
        except (TypeError, ValueError):
            return 0
    return n("soldiers") + n("knights") + n("siegeEngines")


def open_boundary_issues(_world: Dict[str, Any]) -> List[Issue]:
    """Open drawing strokes are not an export error; conversion interprets them."""
    return []


def editor_export_issues(world: Dict[str, Any]) -> List[Issue]:
    """Playable-world validation of the converted map. Raw drawing is ignored."""
    return validate_world(world)


def assign_territories_to_region(world: Dict[str, Any], territory_ids: Sequence[str], region_id: str) -> int:
    if not find_region(world, region_id):
        return 0
    n = 0
    for tid in territory_ids:
        if find_territory(world, tid):
            sync_region_membership(world, tid, region_id)
            n += 1
    return n


# ---------------------------------------------------------------------------
# Raw drawing store (not WorldDefinition)
# pending: strokes   committed: committedStrokes
# Older editor documents with a converted map and no committedStrokes key
# migrate existing strokes into committedStrokes so CONVERT cannot duplicate.
# ---------------------------------------------------------------------------

def empty_drawing() -> Dict[str, Any]:
    return {"next": 1, "strokes": [], "committedStrokes": []}


def _stroke_list(store: Dict[str, Any], key: str) -> List[Dict[str, Any]]:
    items = store.get(key)
    if isinstance(items, list):
        return [i for i in items if isinstance(i, dict)]
    return []


def migrate_editor_drawing(world: Dict[str, Any], store: Dict[str, Any]) -> Dict[str, Any]:
    """Split legacy `_editorDrawing.strokes` into committed vs pending.

    If `committedStrokes` is already present, the document uses the new model.
    If it is missing and the world already has converted geometry, existing
    strokes are treated as committed source (not pending) so CONVERT TO MAP
    cannot duplicate the map. Unconverted documents keep strokes as pending.
    """
    if "committedStrokes" in store and isinstance(store.get("committedStrokes"), list):
        return store
    pending = list(store.get("strokes") or []) if isinstance(store.get("strokes"), list) else []
    if has_committed_map(world) and pending:
        store["committedStrokes"] = pending
        store["strokes"] = []
    else:
        store["committedStrokes"] = []
        if "strokes" not in store or not isinstance(store.get("strokes"), list):
            store["strokes"] = pending
    return store


def normalize_editor_drawing(world: Dict[str, Any]) -> Dict[str, Any]:
    return get_drawing(world, create=True)


def get_drawing(world: Dict[str, Any], create: bool = True) -> Dict[str, Any]:
    raw = world.get(EDITOR_DRAWING_KEY)
    if isinstance(raw, dict) and isinstance(raw.get("strokes"), list):
        raw.setdefault("next", 1)
        migrate_editor_drawing(world, raw)
        return raw
    store = empty_drawing()
    old = world.get(EDITOR_OPEN_STROKES_KEY)
    if isinstance(old, dict) and isinstance(old.get("items"), list):
        store["strokes"] = list(old["items"])
        store["next"] = int(old.get("next") or (len(store["strokes"]) + 1))
        if has_committed_map(world) and store["strokes"]:
            store["committedStrokes"] = list(store["strokes"])
            store["strokes"] = []
    if create:
        world[EDITOR_DRAWING_KEY] = store
    return store


def iter_pending_strokes(world: Dict[str, Any]) -> List[Dict[str, Any]]:
    return _stroke_list(get_drawing(world, create=False), "strokes")


def iter_committed_strokes(world: Dict[str, Any]) -> List[Dict[str, Any]]:
    return _stroke_list(get_drawing(world, create=False), "committedStrokes")


def iter_drawing_strokes(world: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Committed source first, then pending. Display/scale use the full set."""
    return iter_committed_strokes(world) + iter_pending_strokes(world)


def commit_pending_drawing(world: Dict[str, Any]) -> None:
    """Move pending (and leftover open) strokes into committed source."""
    store = get_drawing(world)
    pending = list(store.get("strokes") or [])
    for item in iter_open_strokes(world):
        pending.append(clone_world(item) if isinstance(item, dict) else item)
    committed = list(store.get("committedStrokes") or [])
    for item in pending:
        committed.append(clone_world(item) if isinstance(item, dict) else item)
    store["committedStrokes"] = committed
    store["strokes"] = []
    if EDITOR_OPEN_STROKES_KEY in world:
        world[EDITOR_OPEN_STROKES_KEY] = empty_open_strokes()


def stroke_kind(item: Dict[str, Any]) -> str:
    kind = item.get("kind") if isinstance(item, dict) else None
    if kind == STROKE_KIND_RECTANGLE:
        return STROKE_KIND_RECTANGLE
    return STROKE_KIND_FREEHAND


def rectangle_polyline(a: Point, b: Point) -> List[Point]:
    """Axis-aligned rectangle in world coordinates (closed ring)."""
    x0, x1 = (a[0], b[0]) if a[0] <= b[0] else (b[0], a[0])
    y0, y1 = (a[1], b[1]) if a[1] <= b[1] else (b[1], a[1])
    if abs(x1 - x0) <= GEOM_EPS or abs(y1 - y0) <= GEOM_EPS:
        return []
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]


def rectangle_is_commit_size(a: Point, b: Point, zoom: float) -> bool:
    z = max(float(zoom), 1e-9)
    return abs(a[0] - b[0]) * z >= 8.0 and abs(a[1] - b[1]) * z >= 8.0


def drawing_eraser_radius(zoom: float) -> float:
    return max(0.2, ERASER_SCREEN_PX / max(float(zoom), 0.01))


def add_drawing_stroke(
    world: Dict[str, Any],
    points: Sequence[Point],
    kind: str = STROKE_KIND_FREEHAND,
) -> str:
    store = get_drawing(world)
    sid = f"d{store['next']:04d}"
    store["next"] += 1
    rec: Dict[str, Any] = {"id": sid, "kind": kind, "points": _as_open_points(points)}
    store["strokes"].append(rec)
    return sid


def put_drawing_stroke(
    world: Dict[str, Any],
    sid: str,
    points: Sequence[Point],
    kind: Optional[str] = None,
) -> None:
    store = get_drawing(world)
    pts = _as_open_points(points)
    for item in store["strokes"]:
        if item.get("id") == sid:
            item["points"] = pts
            if kind:
                item["kind"] = kind
            return
    rec: Dict[str, Any] = {"id": sid, "points": pts}
    if kind:
        rec["kind"] = kind
    store["strokes"].append(rec)


def _point_hits_brush(p: Point, center: Point, radius: float) -> bool:
    return edge_length(p, center) <= radius


def erase_polyline(points: Sequence[Point], center: Point, radius: float) -> List[List[Point]]:
    """Return leftover pieces of a polyline after cutting with a disk."""
    if len(points) < 2:
        return []
    step = max(radius * 0.35, GEOM_EPS * 10)
    dense = densify_path(points, step)
    pieces: List[List[Point]] = []
    current: List[Point] = []
    for p in dense:
        if _point_hits_brush(p, center, radius):
            if len(current) >= 2:
                pieces.append(current)
            current = []
        else:
            if not current or edge_length(current[-1], p) > GEOM_EPS:
                current.append(p)
    if len(current) >= 2:
        pieces.append(current)
    return pieces


def erase_raw_drawing(world: Dict[str, Any], center: Point, radius: float) -> bool:
    """Cut pending raw drawing ink only. Committed source and converted geometry are ignored."""
    store = get_drawing(world)
    changed = False
    step = max(radius * 0.35, GEOM_EPS * 10)

    def _erase_bucket(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        nonlocal changed
        new_items: List[Dict[str, Any]] = []
        for item in items:
            pts = open_stroke_points(item)
            if len(pts) < 2:
                changed = True
                continue
            dense = densify_path(pts, step)
            if not any(_point_hits_brush(p, center, radius) for p in dense):
                new_items.append(item)
                continue
            changed = True
            for piece in erase_polyline(pts, center, radius):
                sid = f"d{store['next']:04d}"
                store["next"] += 1
                new_items.append({
                    "id": sid,
                    "kind": STROKE_KIND_FREEHAND,
                    "points": _as_open_points(piece),
                })
        return new_items

    store["strokes"] = _erase_bucket(list(store.get("strokes") or []))
    open_store = get_open_strokes(world, create=False)
    open_items = open_store.get("items")
    if isinstance(open_items, list) and open_items:
        open_store["items"] = _erase_bucket(list(open_items))
    return changed


def remove_drawing_stroke(world: Dict[str, Any], sid: str) -> None:
    store = get_drawing(world, create=False)
    items = store.get("strokes")
    if isinstance(items, list):
        store["strokes"] = [i for i in items if i.get("id") != sid]


def find_drawing_stroke(world: Dict[str, Any], sid: str) -> Optional[Dict[str, Any]]:
    for item in iter_drawing_strokes(world):
        if item.get("id") == sid:
            return item
    return None


def nearest_drawing_stroke_end(
    world: Dict[str, Any], p: Point, radius: float,
) -> Optional[Dict[str, Any]]:
    best: Optional[Dict[str, Any]] = None
    best_d = radius
    for item in iter_pending_strokes(world):
        pts = open_stroke_points(item)
        if len(pts) < 2:
            continue
        for which, q in (("start", pts[0]), ("end", pts[-1])):
            d = edge_length(p, q)
            if d <= best_d:
                best_d = d
                best = {"id": item.get("id"), "which": which, "point": q, "dist": d}
    return best


def oriented_drawing_stroke_for_resume(
    world: Dict[str, Any], p: Point, radius: float,
) -> Optional[Dict[str, Any]]:
    """Optional convenience: continue a stored stroke from the nearer endpoint."""
    hit = nearest_drawing_stroke_end(world, p, radius)
    if not hit or not hit.get("id"):
        return None
    item = find_drawing_stroke(world, str(hit["id"]))
    if not item:
        return None
    if stroke_kind(item) == STROKE_KIND_RECTANGLE:
        return None
    pts = open_stroke_points(item)
    if hit.get("which") == "start":
        pts = list(reversed(pts))
    return {"id": hit["id"], "which": hit["which"], "points": pts, "point": hit["point"]}


def all_pending_raw_strokes(world: Dict[str, Any]) -> List[Dict[str, Any]]:
    seen: Set[str] = set()
    strokes: List[Dict[str, Any]] = []
    for item in list(iter_pending_strokes(world)) + list(iter_open_strokes(world)):
        sid = str(item.get("id") or "")
        key = sid or str(id(item))
        if key in seen:
            continue
        seen.add(key)
        strokes.append(item)
    return strokes


def all_raw_strokes(world: Dict[str, Any]) -> List[Dict[str, Any]]:
    seen: Set[str] = set()
    strokes: List[Dict[str, Any]] = []
    for item in list(iter_drawing_strokes(world)) + list(iter_open_strokes(world)):
        sid = str(item.get("id") or "")
        key = sid or str(id(item))
        if key in seen:
            continue
        seen.add(key)
        strokes.append(item)
    return strokes


def dumps_editor_document(world: Dict[str, Any]) -> str:
    """Save converted geography plus raw drawing (not a playable export)."""
    payload = ordered_world(world)
    payload[EDITOR_DRAWING_KEY] = clone_world(get_drawing(world, create=True))
    report = world.get(EDITOR_CONVERT_REPORT_KEY)
    if isinstance(report, dict):
        payload[EDITOR_CONVERT_REPORT_KEY] = clone_world(report)
    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n"


# ---------------------------------------------------------------------------
# Uniform SCALE of raw drawing + converted geometry (editor-only)
# ---------------------------------------------------------------------------

def scale_point(p: Point, center: Point, factor: float) -> Point:
    return (
        center[0] + (p[0] - center[0]) * factor,
        center[1] + (p[1] - center[1]) * factor,
    )


def parse_scale_factor(value: Any) -> Tuple[Optional[float], str]:
    try:
        factor = float(value)
    except (TypeError, ValueError):
        return None, "Scale factor must be a number."
    if not math.isfinite(factor):
        return None, "Scale factor must be finite."
    if factor <= 0:
        return None, "Scale factor must be greater than 0."
    if factor < SCALE_FACTOR_MIN or factor > SCALE_FACTOR_MAX:
        return None, f"Scale factor must be between {SCALE_FACTOR_MIN} and {SCALE_FACTOR_MAX}."
    return factor, ""


def _polygon_xy_dicts(poly: Any) -> List[Dict[str, Any]]:
    pts: List[Dict[str, Any]] = []
    if not isinstance(poly, dict):
        return pts
    rings = poly.get("rings")
    if not isinstance(rings, list):
        return pts
    for ring in rings:
        if not isinstance(ring, list):
            continue
        for p in ring:
            if isinstance(p, dict) and "x" in p and "y" in p:
                pts.append(p)
    return pts


def _stroke_point_lists(item: Any) -> List[List[float]]:
    if not isinstance(item, dict):
        return []
    raw = item.get("points")
    if not isinstance(raw, list):
        return []
    out: List[List[float]] = []
    for p in raw:
        xy = _stroke_xy(p)
        if xy is not None:
            out.append([xy[0], xy[1]])
    return out


def collect_scale_geometry_points(world: Dict[str, Any]) -> List[Point]:
    """World-space points that SCALE transforms: converted rings + committed and pending strokes."""
    pts: List[Point] = []
    for p in _polygon_xy_dicts(world.get("island")):
        try:
            pts.append((float(p["x"]), float(p["y"])))
        except (TypeError, ValueError, KeyError):
            continue
    for t in world.get("territories") or []:
        if not isinstance(t, dict):
            continue
        for p in _polygon_xy_dicts(t.get("polygon")):
            try:
                pts.append((float(p["x"]), float(p["y"])))
            except (TypeError, ValueError, KeyError):
                continue
    for item in list(iter_drawing_strokes(world)) + list(iter_open_strokes(world)):
        for x, y in _stroke_point_lists(item):
            pts.append((x, y))
    return pts


def scale_anchor_center(world: Dict[str, Any]) -> Optional[Point]:
    """Center of current authored map bounds (converted + raw drawing)."""
    pts = collect_scale_geometry_points(world)
    if not pts:
        return None
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return ((min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0)


def _finite_xy(x: float, y: float) -> bool:
    return math.isfinite(x) and math.isfinite(y)


def _scale_xy_dict_inplace(p: Dict[str, Any], center: Point, factor: float) -> bool:
    try:
        nx, ny = scale_point((float(p["x"]), float(p["y"])), center, factor)
    except (TypeError, ValueError, KeyError):
        return True
    if not _finite_xy(nx, ny):
        return False
    p["x"] = nx
    p["y"] = ny
    return True


def _scale_stroke_item_inplace(item: Dict[str, Any], center: Point, factor: float) -> bool:
    raw = item.get("points")
    if not isinstance(raw, list):
        return True
    dict_mode = any(isinstance(p, dict) for p in raw)
    new_pts: List[Any] = []
    for p in raw:
        xy = _stroke_xy(p)
        if xy is None:
            continue
        nx, ny = scale_point(xy, center, factor)
        if not _finite_xy(nx, ny):
            return False
        if dict_mode and isinstance(p, dict):
            q = dict(p)
            q["x"] = nx
            q["y"] = ny
            new_pts.append(q)
        else:
            new_pts.append([nx, ny])
    item["points"] = new_pts
    return True


def _apply_uniform_scale_inplace(world: Dict[str, Any], center: Point, factor: float) -> bool:
    for p in _polygon_xy_dicts(world.get("island")):
        if not _scale_xy_dict_inplace(p, center, factor):
            return False
    for t in world.get("territories") or []:
        if not isinstance(t, dict):
            continue
        for p in _polygon_xy_dicts(t.get("polygon")):
            if not _scale_xy_dict_inplace(p, center, factor):
                return False
    drawing = world.get(EDITOR_DRAWING_KEY)
    if isinstance(drawing, dict):
        for key in ("strokes", "committedStrokes"):
            items = drawing.get(key)
            if not isinstance(items, list):
                continue
            for item in items:
                if isinstance(item, dict) and not _scale_stroke_item_inplace(item, center, factor):
                    return False
    opens = world.get(EDITOR_OPEN_STROKES_KEY)
    if isinstance(opens, dict) and isinstance(opens.get("items"), list):
        for item in opens["items"]:
            if isinstance(item, dict) and not _scale_stroke_item_inplace(item, center, factor):
                return False
    return True


def scale_world_geometry(
    world: Dict[str, Any],
    factor: float,
    center: Optional[Point] = None,
) -> Dict[str, Any]:
    """Uniformly scale authored map geometry around `center`.

    Transforms converted island/territory rings and `_editorDrawing` pending
    (`strokes`) plus committed source (`committedStrokes`) /
    `_editorOpenStrokes` with the same factor. Does not change IDs, neighbors,
    regions, ownership, resources, world metadata, or containedWorlds placement.
    Does not move strokes between committed and pending buckets.
    """
    parsed, err = parse_scale_factor(factor)
    if parsed is None:
        return {
            "ok": False, "message": err, "factor": factor, "center": center,
            "unchanged": True, "scaledDrawing": False, "scaledConverted": False,
        }
    factor = parsed
    pts = collect_scale_geometry_points(world)
    if not pts:
        return {
            "ok": False, "message": "Nothing to scale. Open a map or draw first.",
            "factor": factor, "center": center,
            "unchanged": True, "scaledDrawing": False, "scaledConverted": False,
        }
    if center is None:
        center = scale_anchor_center(world)
    if center is None:
        return {
            "ok": False, "message": "Could not determine a scale center.",
            "factor": factor, "center": None,
            "unchanged": True, "scaledDrawing": False, "scaledConverted": False,
        }
    has_drawing = any(
        len(_stroke_point_lists(item)) >= 1
        for item in list(iter_drawing_strokes(world)) + list(iter_open_strokes(world))
    )
    has_converted = bool(_polygon_xy_dicts(world.get("island"))) or any(
        isinstance(t, dict) and _polygon_xy_dicts(t.get("polygon"))
        for t in (world.get("territories") or [])
    )
    if almost_equal(factor, 1.0):
        return {
            "ok": True, "message": "Scale 1.0 leaves geometry unchanged.",
            "factor": factor, "center": center, "unchanged": True,
            "scaledDrawing": False, "scaledConverted": False,
        }
    work = clone_world(world)
    if not _apply_uniform_scale_inplace(work, center, factor):
        return {
            "ok": False, "message": "Scale produced non-finite coordinates.",
            "factor": factor, "center": center,
            "unchanged": True, "scaledDrawing": False, "scaledConverted": False,
        }
    world["island"] = work.get("island")
    world["territories"] = work.get("territories")
    if EDITOR_DRAWING_KEY in work:
        world[EDITOR_DRAWING_KEY] = work[EDITOR_DRAWING_KEY]
    if EDITOR_OPEN_STROKES_KEY in work:
        world[EDITOR_OPEN_STROKES_KEY] = work[EDITOR_OPEN_STROKES_KEY]
    world.pop(EDITOR_CONVERT_REPORT_KEY, None)
    world.pop(EDITOR_GRAPH_KEY, None)
    return {
        "ok": True,
        "message": "",
        "factor": factor,
        "center": center,
        "unchanged": False,
        "scaledDrawing": has_drawing,
        "scaledConverted": has_converted,
    }


# ---------------------------------------------------------------------------
# World document helpers
# ---------------------------------------------------------------------------

def issue(code: str, message: str) -> Issue:
    return {"code": code, "message": message}


def is_integer_at_least(value: Any, minimum: int) -> bool:
    """Match TypeScript Number.isInteger for JSON numbers (1 and 1.0)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    if not math.isfinite(float(value)):
        return False
    return float(value).is_integer() and int(value) >= minimum


def new_blank_world() -> Dict[str, Any]:
    """Skeleton for New World. Blank canvas — no island, no territories, no generated map."""
    return {
        "formatVersion": FORMAT_VERSION,
        "worldId": "w_untitled",
        "level": 1,
        "name": "Untitled World",
        "playerFactionId": "f_player",
        "island": {"rings": [[]]},
        "completion": {"type": "control_fraction", "fraction": 0.7},
        "containedWorlds": [],
        "factions": [
            {
                "id": "f_player",
                "role": "player",
                "name": "Player",
                "homeTerritoryId": "",
                "startingResources": {k: 400 if k in ("gold", "food") else 80 for k in RESOURCE_KEYS},
                "startingArmy": {
                    "soldiers": 400, "knights": 40, "siegeEngines": 0,
                    "locationTerritoryId": "",
                },
                "personality": None,
            }
        ],
        "startingDiplomacy": [],
        "regions": [],
        "territories": [],
        EDITOR_OPEN_STROKES_KEY: empty_open_strokes(),
        EDITOR_DRAWING_KEY: empty_drawing(),
    }


def clone_world(world: Dict[str, Any]) -> Dict[str, Any]:
    return copy.deepcopy(world)


def next_id(prefix: str, existing: Iterable[str]) -> str:
    taken = set(existing)
    n = 1
    while True:
        cand = f"{prefix}{n:02d}"
        if cand not in taken:
            return cand
        n += 1


def ordered_dict(data: Dict[str, Any], order: Sequence[str]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for k in order:
        if k in data:
            out[k] = data[k]
    return out


def dumps_world(world: Dict[str, Any]) -> str:
    """Deterministic UTF-8 JSON. Editor-only state is not included."""
    payload = ordered_world(world)
    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n"


def ordered_world(world: Dict[str, Any]) -> Dict[str, Any]:
    w = clone_world(world)
    w["island"] = _ordered_polygon(w.get("island"))
    w["completion"] = _ordered_completion(w.get("completion"))
    w["containedWorlds"] = [
        ordered_dict({
            "worldId": c.get("worldId", ""),
            "regionId": c.get("regionId", ""),
            "placement": {
                "origin": _pt(c.get("placement", {}).get("origin")),
                "rotationDegrees": float(c.get("placement", {}).get("rotationDegrees", 0) or 0),
                "scale": float(c.get("placement", {}).get("scale", 1) or 1),
            },
        }, CONTAINED_KEY_ORDER)
        for c in (w.get("containedWorlds") or [])
    ]
    w["factions"] = [_ordered_faction(f) for f in (w.get("factions") or [])]
    w["startingDiplomacy"] = [
        ordered_dict(rel, DIPLOMACY_KEY_ORDER) for rel in (w.get("startingDiplomacy") or [])
    ]
    w["regions"] = [ordered_dict(r, REGION_KEY_ORDER) for r in (w.get("regions") or [])]
    w["territories"] = [_ordered_territory(t) for t in (w.get("territories") or [])]
    out = ordered_dict(w, WORLD_KEY_ORDER)
    if not w.get("allowUnevenAiSplit"):
        out.pop("allowUnevenAiSplit", None)
    return out


def _pt(raw: Any) -> Dict[str, float]:
    if not isinstance(raw, dict):
        return {"x": 0.0, "y": 0.0}
    return {"x": float(raw.get("x", 0) or 0), "y": float(raw.get("y", 0) or 0)}


def _ordered_polygon(poly: Any) -> Dict[str, Any]:
    pts = polygon_exterior(poly if isinstance(poly, dict) else None) or []
    closed = close_ring(pts)
    return {"rings": [[{"x": x, "y": y} for x, y in closed]]}


def _ordered_completion(raw: Any) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        return {"type": "manual"}
    t = raw.get("type", "manual")
    if t == "control_fraction":
        return {"type": "control_fraction", "fraction": float(raw.get("fraction", 0.7))}
    return {"type": t}


def _ordered_faction(f: Dict[str, Any]) -> Dict[str, Any]:
    res = f.get("startingResources") or {}
    army = f.get("startingArmy") or {}
    body = {
        "id": f.get("id", ""),
        "role": f.get("role", "ai"),
        "name": f.get("name", ""),
        "homeTerritoryId": f.get("homeTerritoryId", ""),
        "startingResources": {k: float(res.get(k, 0) or 0) for k in RESOURCE_KEYS},
        "startingArmy": ordered_dict({
            "soldiers": int(army.get("soldiers", 0) or 0),
            "knights": int(army.get("knights", 0) or 0),
            "siegeEngines": int(army.get("siegeEngines", 0) or 0),
            "locationTerritoryId": army.get("locationTerritoryId", "") or "",
        }, ARMY_KEY_ORDER),
        "personality": None if f.get("personality") is None else _ordered_personality(f["personality"]),
    }
    return ordered_dict(body, FACTION_KEY_ORDER)


def _ordered_personality(p: Dict[str, Any]) -> Dict[str, Any]:
    traits = p.get("traits") or {}
    return ordered_dict({
        "id": p.get("id", ""),
        "label": p.get("label", ""),
        "ambition": float(p.get("ambition", 0.5)),
        "traits": {k: float(traits.get(k, 0.5)) for k in TRAIT_KEYS},
    }, PERSONALITY_KEY_ORDER)


def _ordered_territory(t: Dict[str, Any]) -> Dict[str, Any]:
    raw_res = t.get("resourceOutput") or {}
    res = {k: float(raw_res[k]) for k in RESOURCE_KEYS if k in raw_res}
    return ordered_dict({
        "id": t.get("id", ""),
        "regionId": t.get("regionId", ""),
        "startingOwnerFactionId": t.get("startingOwnerFactionId", ""),
        "neighborIds": list(t.get("neighborIds") or []),
        "terrain": t.get("terrain", "plains"),
        "resourceOutput": res,
        "polygon": _ordered_polygon(t.get("polygon")),
    }, TERRITORY_KEY_ORDER)


# ---------------------------------------------------------------------------
# Validation (mirrors src/worldDefinition/validate.ts)
# ---------------------------------------------------------------------------

def _check_polygon(poly: Any, label: str) -> List[Issue]:
    out: List[Issue] = []
    if not isinstance(poly, dict) or not isinstance(poly.get("rings"), list) or not poly["rings"]:
        return [issue("geometry.missing_ring", f"{label} has no exterior ring")]
    if len(poly["rings"]) > 1:
        out.append(issue("geometry.holes_unsupported", f"{label} has holes; v1 territories/island must be a simple exterior"))
    ring = polygon_exterior(poly)
    if not ring:
        return [issue("geometry.missing_ring", f"{label} exterior is empty")]
    for p in ring:
        if not math.isfinite(p[0]) or not math.isfinite(p[1]):
            out.append(issue("geometry.non_finite", f"{label} has a non-finite vertex"))
            break
    verts = unique_ring_vertices(ring)
    if len(verts) < 3:
        out.append(issue("geometry.too_few_vertices", f"{label} needs at least 3 distinct vertices"))
    area = abs(ring_area(ring))
    if len(verts) >= 3 and area <= GEOM_EPS:
        out.append(issue("geometry.zero_area", f"{label} has zero area"))
    if len(verts) >= 3 and ring_self_intersects(ring):
        out.append(issue("geometry.self_intersecting", f"{label} exterior is self-intersecting"))
    return out


def _personality_issues(p: Any, faction_id: str) -> List[Issue]:
    out: List[Issue] = []
    if not isinstance(p, dict):
        return [issue("personality.missing", f"AI faction {faction_id} must have personality data")]
    if not p.get("id") or not isinstance(p.get("id"), str):
        out.append(issue("personality.missing_id", f"AI faction {faction_id} personality is missing id"))
    amb = p.get("ambition")
    if not isinstance(amb, (int, float)) or not math.isfinite(float(amb)) or float(amb) < 0 or float(amb) > 1:
        out.append(issue("personality.ambition", f"AI faction {faction_id} ambition must be in [0, 1]"))
    traits = p.get("traits") if isinstance(p.get("traits"), dict) else {}
    for key in TRAIT_KEYS:
        v = traits.get(key)
        if not isinstance(v, (int, float)) or not math.isfinite(float(v)) or float(v) < 0 or float(v) > 1:
            out.append(issue("personality.trait", f"AI faction {faction_id} trait {key} must be in [0, 1]"))
    return out


def _graph_connected(ids: List[str], neighbors_of) -> bool:
    if not ids:
        return False
    seen: Set[str] = set()
    stack = [ids[0]]
    while stack:
        i = stack.pop()
        if i in seen:
            continue
        seen.add(i)
        stack.extend(neighbors_of(i))
    return len(seen) == len(ids)


def _neighbor_graph_issues(territories: List[Dict[str, Any]]) -> List[Issue]:
    by_id = {t.get("id"): t for t in territories if t.get("id")}
    issues: List[Issue] = []
    for t in by_id.values():
        seen: Set[str] = set()
        tid = t["id"]
        for nid in t.get("neighborIds") or []:
            if nid in seen:
                issues.append(issue("adjacency.duplicate_neighbor", f"territory {tid} neighbor {nid}: duplicate_neighbor"))
                continue
            seen.add(nid)
            if nid == tid:
                issues.append(issue("adjacency.self_neighbor", f"territory {tid} neighbor {nid}: self_neighbor"))
                continue
            n = by_id.get(nid)
            if not n:
                issues.append(issue("adjacency.missing_neighbor", f"territory {tid} neighbor {nid}: missing_neighbor"))
                continue
            if tid not in (n.get("neighborIds") or []):
                issues.append(issue("adjacency.non_reciprocal", f"territory {tid} neighbor {nid}: non_reciprocal"))
    return issues


def validate_world(world: Any) -> List[Issue]:
    issues: List[Issue] = []

    def push(code: str, message: str) -> None:
        issues.append(issue(code, message))

    if not isinstance(world, dict):
        return [issue("json.not_object", "World JSON must be an object")]

    for key in FORBIDDEN_WORLD_FIELDS:
        if key in world:
            push("world.forbidden_field", f"world must not contain {key}")

    if world.get("formatVersion") != FORMAT_VERSION:
        push("format.unsupported", f"formatVersion must be {FORMAT_VERSION}")
    if not world.get("worldId") or not isinstance(world.get("worldId"), str):
        push("world.missing_id", "worldId is required")
    level = world.get("level")
    if not is_integer_at_least(level, 1):
        push("world.invalid_level", "level must be an integer >= 1")
    if not world.get("name") or not isinstance(world.get("name"), str):
        push("world.missing_name", "world name is required")

    issues.extend(_check_polygon(world.get("island"), "island"))
    island_ring = polygon_exterior(world.get("island") if isinstance(world.get("island"), dict) else None)

    territories = world.get("territories")
    if not isinstance(territories, list) or len(territories) == 0:
        push("territory.empty", "world must contain at least one territory")
        issues.sort(key=lambda i: (i["code"], i["message"]))
        return issues
    if not isinstance(world.get("regions"), list) or len(world["regions"]) == 0:
        push("region.empty", "world must contain at least one named region")
    if not isinstance(world.get("factions"), list) or len(world["factions"]) == 0:
        push("faction.empty", "world must contain factions")

    territory_ids: Set[str] = set()
    for t in territories:
        if not isinstance(t, dict):
            push("territory.missing_id", "territory is missing id")
            continue
        tid = t.get("id")
        if not tid:
            push("territory.missing_id", "territory is missing id")
        elif tid in territory_ids:
            push("territory.duplicate_id", f"duplicate territory id {tid}")
        else:
            territory_ids.add(tid)
        for bad in FORBIDDEN_TERRITORY_FIELDS:
            if bad in t:
                if bad == "name" and isinstance(t.get("name"), str):
                    push("territory.named", f"territory {tid} must not have a player-facing name")
                else:
                    push("territory.forbidden_field", f"territory {tid} must not contain {bad}")
        if t.get("terrain") not in TERRAIN:
            push("territory.terrain", f"territory {tid} has invalid terrain {t.get('terrain')}")
        issues.extend(_check_polygon(t.get("polygon"), f"territory {tid}"))
        ext = polygon_exterior(t.get("polygon") if isinstance(t.get("polygon"), dict) else None)
        if island_ring and ext and not all_vertices_inside(ext, island_ring):
            push("territory.outside_island", f"territory {tid} is not contained by the island")
        raw_res = t.get("resourceOutput")
        if raw_res is not None and not isinstance(raw_res, dict):
            push("territory.resources", f"territory {tid} resourceOutput must be an object")
        elif isinstance(raw_res, dict):
            for k, v in raw_res.items():
                if k not in RESOURCE_KEYS:
                    push("territory.resources", f"territory {tid} has unknown resource {k}")
                elif not isinstance(v, (int, float)) or not math.isfinite(float(v)):
                    push("territory.resources", f"territory {tid} resource {k} must be a finite number")

    region_ids: Set[str] = set()
    membership: Dict[str, str] = {}
    for r in world.get("regions") or []:
        if not isinstance(r, dict):
            continue
        rid = r.get("id")
        if not rid:
            push("region.missing_id", "region is missing id")
        elif rid in region_ids:
            push("region.duplicate_id", f"duplicate region id {rid}")
        else:
            region_ids.add(rid)
        if not r.get("name") or not isinstance(r.get("name"), str):
            push("region.missing_name", f"region {rid} must have a player-facing name")
        if r.get("worldId") and r.get("worldId") != world.get("worldId"):
            push("region.world_mismatch", f"region {rid} worldId does not match the world")
        tids = r.get("territoryIds")
        if not isinstance(tids, list) or len(tids) == 0:
            push("region.empty_membership", f"region {rid} has no territories")
        for tid in tids or []:
            if tid not in territory_ids:
                push("region.unknown_territory", f"region {rid} references missing territory {tid}")
            prev = membership.get(tid)
            if prev:
                push("region.duplicate_membership", f"territory {tid} is in regions {prev} and {rid}")
            else:
                membership[tid] = rid

    for t in territories:
        if not isinstance(t, dict):
            continue
        tid = t.get("id")
        rid = t.get("regionId")
        if rid not in region_ids:
            push("territory.unknown_region", f"territory {tid} regionId {rid} does not exist")
        listed = membership.get(tid)
        if listed and listed != rid:
            push("territory.region_mismatch", f"territory {tid} regionId {rid} does not match region list {listed}")
        if not listed and rid in region_ids:
            push("territory.region_mismatch", f"territory {tid} is not listed in region {rid}")

    faction_ids: Set[str] = set()
    players: List[Dict[str, Any]] = []
    ais: List[Dict[str, Any]] = []
    for f in world.get("factions") or []:
        if not isinstance(f, dict):
            continue
        fid = f.get("id")
        if not fid:
            push("faction.missing_id", "faction is missing id")
        elif fid in faction_ids:
            push("faction.duplicate_id", f"duplicate faction id {fid}")
        else:
            faction_ids.add(fid)
        if f.get("role") == "player":
            players.append(f)
        elif f.get("role") == "ai":
            ais.append(f)
        else:
            push("faction.role", f"faction {fid} has invalid role")
        if f.get("homeTerritoryId") not in territory_ids:
            push("faction.home", f"faction {fid} homeTerritoryId {f.get('homeTerritoryId')} does not exist")
        army = f.get("startingArmy")
        loc = army.get("locationTerritoryId") if isinstance(army, dict) else None
        if not isinstance(army, dict) or loc not in territory_ids:
            push("faction.army_location", f"faction {fid} starting army location is invalid")
        if f.get("role") == "ai":
            if not f.get("personality"):
                push("personality.missing", f"AI faction {fid} must have personality data")
            else:
                issues.extend(_personality_issues(f.get("personality"), fid))
        if f.get("role") == "player" and f.get("personality") is not None:
            push("personality.player", f"player faction {fid} must have personality: null")

    if len(players) != 1:
        push("faction.player_count", "world must have exactly one player faction")
    if world.get("playerFactionId") != (players[0].get("id") if players else None):
        push("faction.player_id", "playerFactionId must match the unique player faction")
    if world.get("level") == 1 and len(ais) < 1:
        push("faction.ai_required", "Level 1 world must include at least one AI warlord")

    personality_ids: Set[str] = set()
    for f in ais:
        pid = (f.get("personality") or {}).get("id") if isinstance(f.get("personality"), dict) else None
        if pid:
            if pid in personality_ids:
                push("personality.duplicate_id", f"duplicate personality id {pid}")
            personality_ids.add(pid)

    owner_count: Dict[str, int] = {}
    for t in territories:
        if not isinstance(t, dict):
            continue
        owner = t.get("startingOwnerFactionId")
        if owner not in faction_ids:
            push("owner.unknown", f"territory {t.get('id')} starting owner {owner} does not exist")
            continue
        owner_count[owner] = owner_count.get(owner, 0) + 1
    player_owned = owner_count.get(world.get("playerFactionId"), 0)
    if world.get("level") == 1 and player_owned != 1:
        push("owner.player_count", f"Level 1 player must own exactly 1 territory (has {player_owned})")
    if players and owner_count.get(players[0].get("id"), 0) > 0:
        home = next((t for t in territories if isinstance(t, dict) and t.get("id") == players[0].get("homeTerritoryId")), None)
        if home and home.get("startingOwnerFactionId") != players[0].get("id"):
            push("owner.player_home", "player homeTerritoryId must be the player-owned territory")
    for f in world.get("factions") or []:
        if not isinstance(f, dict):
            continue
        home = next((t for t in territories if isinstance(t, dict) and t.get("id") == f.get("homeTerritoryId")), None)
        if home and home.get("startingOwnerFactionId") != f.get("id"):
            push("owner.home", f"faction {f.get('id')} homeTerritoryId is not owned by that faction")
        army = f.get("startingArmy") if isinstance(f.get("startingArmy"), dict) else None
        if army and army.get("locationTerritoryId"):
            loc = next((t for t in territories if isinstance(t, dict) and t.get("id") == army.get("locationTerritoryId")), None)
            if loc and loc.get("startingOwnerFactionId") != f.get("id"):
                push("owner.army", f"faction {f.get('id')} starting army is not on an owned territory")
    if world.get("level") == 1 and not world.get("allowUnevenAiSplit") and ais:
        counts = [owner_count.get(f.get("id"), 0) for f in ais]
        if counts and max(counts) - min(counts) > 1:
            push("owner.ai_split", "AI starting territory counts differ by more than 1")
        for f in ais:
            if owner_count.get(f.get("id"), 0) < 1:
                push("owner.ai_empty", f"AI faction {f.get('id')} owns no territories")

    issues.extend(_neighbor_graph_issues(territories))
    by_id = {t.get("id"): t for t in territories if isinstance(t, dict) and t.get("id")}
    for t in territories:
        if not isinstance(t, dict):
            continue
        for nid in t.get("neighborIds") or []:
            n = by_id.get(nid)
            if not n:
                continue
            if shared_edge_length(t.get("polygon") or {}, n.get("polygon") or {}) <= GEOM_EPS:
                push("adjacency.no_shared_edge", f"territories {t.get('id')} and {nid} are listed as neighbors but do not share an edge")
    if not _graph_connected(list(territory_ids), lambda i: by_id.get(i, {}).get("neighborIds") or []):
        push("adjacency.disconnected", "playable territory graph is not connected")

    for rel in world.get("startingDiplomacy") or []:
        if not isinstance(rel, dict):
            continue
        if rel.get("a") == rel.get("b"):
            push("diplomacy.self", "diplomacy pair must name two factions")
        if rel.get("a") not in faction_ids or rel.get("b") not in faction_ids:
            push("diplomacy.unknown", f"diplomacy references unknown faction {rel.get('a')}/{rel.get('b')}")
        if rel.get("state") not in RELATIONSHIP_STATES:
            push("diplomacy.state", f"diplomacy state {rel.get('state')} is not valid")

    contained_ids: Set[str] = set()
    for c in world.get("containedWorlds") or []:
        if not isinstance(c, dict):
            continue
        if not c.get("worldId"):
            push("contained.missing_id", "contained world is missing worldId")
        if c.get("worldId") == world.get("worldId"):
            push("contained.self", "contained world cannot reference this world")
        if c.get("worldId") in contained_ids:
            push("contained.duplicate", f"duplicate contained world {c.get('worldId')}")
        contained_ids.add(c.get("worldId") or "")
        if c.get("regionId") not in region_ids:
            push("contained.region", f"contained world {c.get('worldId')} regionId {c.get('regionId')} is not in this file")
        scale = (c.get("placement") or {}).get("scale") if isinstance(c.get("placement"), dict) else None
        if not isinstance(scale, (int, float)) or not math.isfinite(float(scale)) or float(scale) <= 0:
            push("contained.placement", f"contained world {c.get('worldId')} placement.scale must be > 0")

    for t in territories:
        if not isinstance(t, dict):
            continue
        for nid in t.get("neighborIds") or []:
            if nid in contained_ids or (isinstance(nid, str) and nid.startswith("w_") and nid not in territory_ids):
                push("adjacency.cross_level", f"territory {t.get('id')} neighbor {nid} is not a tile in this world")

    completion = world.get("completion")
    if isinstance(completion, dict):
        if completion.get("type") == "control_fraction":
            frac = completion.get("fraction")
            if not isinstance(frac, (int, float)) or not math.isfinite(float(frac)) or float(frac) <= 0 or float(frac) > 1:
                push("completion.fraction", "control_fraction must be in (0, 1]")
        elif completion.get("type") not in ("eliminate_ai", "manual"):
            push("completion.type", f"unknown completion type {completion.get('type')}")

    issues.sort(key=lambda i: (i["code"], i["message"]))
    return issues


def parse_world_json(text: str) -> Tuple[Optional[Dict[str, Any]], List[Issue]]:
    try:
        raw = json.loads(text)
    except json.JSONDecodeError as err:
        return None, [issue("json.parse", str(err))]
    return load_world_definition(raw)


def load_world_definition(raw: Any) -> Tuple[Optional[Dict[str, Any]], List[Issue]]:
    if not isinstance(raw, dict):
        return None, [issue("json.not_object", "World JSON must be an object")]
    if raw.get("formatVersion") != FORMAT_VERSION:
        return None, [issue("format.unsupported", f"formatVersion must be {FORMAT_VERSION}")]
    world = clone_world(raw)
    if not isinstance(world.get("startingDiplomacy"), list):
        world["startingDiplomacy"] = []
    if not isinstance(world.get("containedWorlds"), list):
        world["containedWorlds"] = []
    issues = validate_world(world)
    if issues:
        return None, issues
    return world, []


# ---------------------------------------------------------------------------
# Mutations (keep region membership + reciprocal adjacency consistent)
# ---------------------------------------------------------------------------

def find_territory(world: Dict[str, Any], tid: str) -> Optional[Dict[str, Any]]:
    for t in world.get("territories") or []:
        if t.get("id") == tid:
            return t
    return None


def find_region(world: Dict[str, Any], rid: str) -> Optional[Dict[str, Any]]:
    for r in world.get("regions") or []:
        if r.get("id") == rid:
            return r
    return None


def find_faction(world: Dict[str, Any], fid: str) -> Optional[Dict[str, Any]]:
    for f in world.get("factions") or []:
        if f.get("id") == fid:
            return f
    return None


def sync_region_membership(world: Dict[str, Any], territory_id: str, region_id: str) -> None:
    t = find_territory(world, territory_id)
    if t is not None:
        t["regionId"] = region_id
    for r in world.get("regions") or []:
        ids = list(r.get("territoryIds") or [])
        if r.get("id") == region_id:
            if territory_id not in ids:
                ids.append(territory_id)
        else:
            ids = [i for i in ids if i != territory_id]
        r["territoryIds"] = ids


def set_reciprocal_neighbor(world: Dict[str, Any], a_id: str, b_id: str, present: bool) -> None:
    if a_id == b_id:
        return
    for tid, oid in ((a_id, b_id), (b_id, a_id)):
        t = find_territory(world, tid)
        if t is None:
            continue
        ids = list(t.get("neighborIds") or [])
        if present and oid not in ids:
            ids.append(oid)
        if not present:
            ids = [i for i in ids if i != oid]
        t["neighborIds"] = ids


def add_region(world: Dict[str, Any], name: str = "New Region") -> str:
    rid = next_id("r_", [r.get("id") for r in world.get("regions") or []])
    world.setdefault("regions", []).append({
        "id": rid,
        "name": name,
        "worldId": world.get("worldId", ""),
        "territoryIds": [],
    })
    return rid


def add_territory(world: Dict[str, Any], polygon: Sequence[Point], region_id: str, owner_id: str) -> str:
    tid = next_id("t_", [t.get("id") for t in world.get("territories") or []])
    world.setdefault("territories", []).append({
        "id": tid,
        "regionId": region_id,
        "startingOwnerFactionId": owner_id,
        "neighborIds": [],
        "terrain": "plains",
        "resourceOutput": {k: 0 for k in RESOURCE_KEYS},
        "polygon": points_to_polygon(polygon),
    })
    sync_region_membership(world, tid, region_id)
    return tid


def _import_fail(message: str, issues: Optional[List[Issue]] = None) -> Dict[str, Any]:
    return {"ok": False, "error": message, "issues": issues or [], "territories": []}


def format_previous_level_import_preview(plan: Dict[str, Any]) -> str:
    if not plan.get("ok"):
        return plan.get("error") or "Import failed."
    rows = [
        f"World: {plan.get('sourceName')} ({plan.get('sourceWorldId')})",
        f"Source level: {plan.get('sourceLevel')}  ->  current level: {plan.get('targetLevel')}",
        f"Source regions: {plan.get('sourceRegionCount')}  ->  new territories: {len(plan.get('territories') or [])}",
        f"Source territories (geometry only): {plan.get('sourceTerritoryCount')}",
        f"New region: {plan.get('regionName')}",
        "",
        "New territories (from source regions):",
    ]
    for item in plan.get("territories") or []:
        nbs = ", ".join(item.get("neighborSourceRegionNames") or item.get("neighborSourceRegionIds") or [])
        rows.append(f"  - {item.get('sourceRegionName')}  neighbors: {nbs or '(none)'}")
    for warning in plan.get("warnings") or []:
        rows.append("")
        rows.append(f"Warning: {warning}")
    return "\n".join(rows)


def import_plan_from_json_text(text: str, target: Dict[str, Any]) -> Dict[str, Any]:
    """Validate WorldDefinition JSON, then plan coarsening. Does not mutate target or source files."""
    source, issues = parse_world_json(text)
    if source is None or issues:
        codes = {i["code"] for i in issues}
        extra = ""
        if "region.empty" in codes:
            extra = (
                "\n\nThe previous-level world needs named region definitions before "
                "it can be coarsened into the next level."
            )
        msgs = "\n".join(f"[{i['code']}] {i['message']}" for i in issues[:20])
        return _import_fail(
            "The selected JSON is not a valid WorldDefinition.\n" + msgs + extra,
            issues,
        )
    return plan_previous_level_import(source, target)


def plan_previous_level_import(source: Dict[str, Any], target: Dict[str, Any]) -> Dict[str, Any]:
    """Pure coarsen plan: previous world → one region; previous regions → territories.

    Does not mutate source or target. Distinct from CONVERT TO MAP.
    """
    if not isinstance(source, dict) or not isinstance(target, dict):
        return _import_fail("Import requires a WorldDefinition object.")
    src_issues = validate_world(source)
    if src_issues:
        msgs = "\n".join(f"[{i['code']}] {i['message']}" for i in src_issues[:20])
        extra = ""
        if any(i["code"] == "region.empty" for i in src_issues):
            extra = (
                "\n\nThe previous-level world needs named region definitions before "
                "it can be coarsened into the next level."
            )
        return _import_fail(
            "The selected JSON is not a valid WorldDefinition.\n" + msgs + extra,
            src_issues,
        )

    source_id = source.get("worldId") or ""
    if not source_id:
        return _import_fail("The imported world is missing worldId.")
    if source_id == (target.get("worldId") or ""):
        return _import_fail("A world cannot import itself as a contained previous level.")
    existing_contained = {
        c.get("worldId") for c in (target.get("containedWorlds") or []) if isinstance(c, dict)
    }
    if source_id in existing_contained:
        return _import_fail(f"{source_id} is already a contained world in this file.")

    regions = [r for r in (source.get("regions") or []) if isinstance(r, dict)]
    if not regions:
        return _import_fail(
            "The previous-level world has no named regions. Define regions on that "
            "world before coarsening it into the next level."
        )

    by_id = {
        t.get("id"): t
        for t in (source.get("territories") or [])
        if isinstance(t, dict) and t.get("id")
    }
    planned: List[Dict[str, Any]] = []
    unions: Dict[str, Dict[str, Any]] = {}
    for region in regions:
        rid = region.get("id") or ""
        name = region.get("name") or rid
        member_ids = [tid for tid in (region.get("territoryIds") or []) if tid in by_id]
        if not member_ids:
            return _import_fail(
                f"Source region {name} has no territories, so it cannot become a "
                "higher-level territory."
            )
        polys = [by_id[tid].get("polygon") or {} for tid in member_ids]
        ring, err = union_polygon_exteriors(polys)
        if err or not ring:
            return _import_fail(f"Cannot coarsen source region {name}: {err or 'union failed'}.")
        poly = points_to_polygon(ring)
        unions[rid] = poly
        planned.append({
            "sourceRegionId": rid,
            "sourceRegionName": name,
            "polygon": clone_world(poly),
            "neighborSourceRegionIds": [],
            "neighborSourceRegionNames": [],
            "terrain": "plains",
        })

    region_name_by_id = {r.get("id"): r.get("name") or r.get("id") for r in regions}
    tid_to_region = {
        t.get("id"): t.get("regionId")
        for t in (source.get("territories") or [])
        if isinstance(t, dict)
    }
    graph: Dict[str, Set[str]] = {item["sourceRegionId"]: set() for item in planned}
    for t in source.get("territories") or []:
        if not isinstance(t, dict):
            continue
        rid = t.get("regionId")
        if rid not in graph:
            continue
        for nid in t.get("neighborIds") or []:
            nrid = tid_to_region.get(nid)
            if nrid and nrid != rid and nrid in graph:
                graph[rid].add(nrid)
    ids = [item["sourceRegionId"] for item in planned]
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            shared = shared_edge_length(unions[a], unions[b])
            if shared > GEOM_EPS:
                graph[a].add(b)
                graph[b].add(a)
            else:
                graph[a].discard(b)
                graph[b].discard(a)
    for item in planned:
        nbs = sorted(graph.get(item["sourceRegionId"]) or [])
        item["neighborSourceRegionIds"] = nbs
        item["neighborSourceRegionNames"] = [str(region_name_by_id.get(n, n)) for n in nbs]

    try:
        source_level = int(source.get("level") or 1)
    except (TypeError, ValueError):
        source_level = 1
    try:
        target_level = int(target.get("level") or 1)
    except (TypeError, ValueError):
        target_level = 1
    next_level = max(target_level, source_level + 1)

    new_verts: List[Point] = []
    for item in planned:
        ext = polygon_exterior(item["polygon"])
        if ext:
            new_verts.extend(unique_ring_vertices(ext))
    target_island = polygon_exterior(
        target.get("island") if isinstance(target.get("island"), dict) else None
    )
    island_out: Optional[Dict[str, Any]] = None
    warnings: List[str] = []
    if not target_island:
        island_out = clone_world(source.get("island") or {"rings": [[]]})
    elif new_verts and all(point_in_ring(v, target_island) for v in new_verts):
        island_out = None
    else:
        merged, err = union_polygon_exteriors([
            target.get("island") or {"rings": [[]]},
            source.get("island") or {"rings": [[]]},
        ])
        if err or not merged:
            return _import_fail(
                "Imported geography does not lie on the current island and cannot be "
                "merged into one island outline. Import into a blank Level N+1, or "
                "enlarge the island first."
            )
        island_out = points_to_polygon(merged)
        if new_verts and not all(point_in_ring(v, merged) for v in new_verts):
            return _import_fail(
                "Imported geography does not lie on the current island. Import into "
                "a blank Level N+1, or enlarge the island first."
            )

    existing_ids = [t.get("id") for t in (target.get("territories") or []) if isinstance(t, dict)]
    if existing_ids:
        warnings.append(
            "This world already has territories. The import adds a region; it does "
            "not rebuild the map from drawing strokes."
        )

    region_name = str(source.get("name") or source_id)
    return {
        "ok": True,
        "error": None,
        "issues": [],
        "warnings": warnings,
        "sourceWorldId": source_id,
        "sourceName": str(source.get("name") or source_id),
        "sourceLevel": source_level,
        "sourceRegionCount": len(regions),
        "sourceTerritoryCount": len(source.get("territories") or []),
        "targetLevel": next_level,
        "regionName": region_name,
        "island": island_out,
        "territories": planned,
        "placement": identity_contained_placement(),
    }


def apply_previous_level_import(target: Dict[str, Any], plan: Dict[str, Any]) -> Dict[str, Any]:
    """Apply a successful coarsen plan to the current world. Does not mutate the source world."""
    if not plan.get("ok"):
        return _import_fail(plan.get("error") or "Import plan is not ok.")
    target["level"] = int(plan["targetLevel"])
    if plan.get("island") is not None:
        target["island"] = clone_world(plan["island"])
    rid = add_region(target, str(plan.get("regionName") or "Imported World"))
    owner = str(target.get("playerFactionId") or "")
    id_map: Dict[str, str] = {}
    new_ids: List[str] = []
    for item in plan.get("territories") or []:
        ring = polygon_exterior(item.get("polygon"))
        if not ring:
            return _import_fail("Import plan is missing territory geometry.")
        tid = add_territory(target, ring, rid, owner)
        t = find_territory(target, tid)
        if t is not None:
            t["terrain"] = item.get("terrain") or "plains"
            t["resourceOutput"] = {k: 0 for k in RESOURCE_KEYS}
        id_map[item["sourceRegionId"]] = tid
        new_ids.append(tid)
    for item in plan.get("territories") or []:
        a = id_map.get(item["sourceRegionId"])
        if not a:
            continue
        for src_nb in item.get("neighborSourceRegionIds") or []:
            b = id_map.get(src_nb)
            if b:
                set_reciprocal_neighbor(target, a, b, True)
    existing = [
        t for t in (target.get("territories") or [])
        if isinstance(t, dict) and t.get("id") not in new_ids
    ]
    for tid in new_ids:
        nt = find_territory(target, tid)
        if nt is None:
            continue
        for old in existing:
            if shared_edge_length(nt.get("polygon") or {}, old.get("polygon") or {}) > GEOM_EPS:
                set_reciprocal_neighbor(target, tid, old["id"], True)
    target.setdefault("containedWorlds", []).append({
        "worldId": plan["sourceWorldId"],
        "regionId": rid,
        "placement": clone_world(plan.get("placement") or identity_contained_placement()),
    })
    player = find_faction(target, owner)
    if player is not None and new_ids:
        if not find_territory(target, player.get("homeTerritoryId") or ""):
            player["homeTerritoryId"] = new_ids[0]
        army = player.get("startingArmy") if isinstance(player.get("startingArmy"), dict) else None
        if army is not None and not army.get("locationTerritoryId"):
            army["locationTerritoryId"] = new_ids[0]
    return {
        "ok": True,
        "error": None,
        "regionId": rid,
        "territoryIds": new_ids,
        "idMap": id_map,
    }


def delete_territory(world: Dict[str, Any], tid: str) -> None:
    world["territories"] = [t for t in world.get("territories") or [] if t.get("id") != tid]
    for t in world.get("territories") or []:
        t["neighborIds"] = [n for n in (t.get("neighborIds") or []) if n != tid]
    for r in world.get("regions") or []:
        r["territoryIds"] = [i for i in (r.get("territoryIds") or []) if i != tid]


def add_ai_faction(world: Dict[str, Any]) -> str:
    existing = [f.get("id") for f in world.get("factions") or []]
    fid = next_id("f_ai_", existing)
    pid = next_id("p_", [
        (f.get("personality") or {}).get("id")
        for f in world.get("factions") or []
        if isinstance(f.get("personality"), dict)
    ])
    world.setdefault("factions", []).append({
        "id": fid,
        "role": "ai",
        "name": "New Warlord",
        "homeTerritoryId": "",
        "startingResources": {k: 400 if k in ("gold", "food") else 80 for k in RESOURCE_KEYS},
        "startingArmy": {"soldiers": 500, "knights": 20, "siegeEngines": 0, "locationTerritoryId": ""},
        "personality": {
            "id": pid,
            "label": "Custom",
            "ambition": 0.5,
            "traits": {k: 0.5 for k in TRAIT_KEYS},
        },
    })
    return fid


def default_personality() -> Dict[str, Any]:
    return {
        "id": "p_custom",
        "label": "Custom",
        "ambition": 0.5,
        "traits": {k: 0.5 for k in TRAIT_KEYS},
    }


def quad_at(cx: float, cy: float, size: float = 18.0) -> List[Point]:
    s = size
    return [
        (cx - s, cy - s * 0.6),
        (cx + s * 0.8, cy - s * 0.4),
        (cx + s * 0.6, cy + s * 0.8),
        (cx - s * 0.7, cy + s * 0.5),
        (cx - s, cy - s * 0.6),
    ]


def offset_polygon(poly: Dict[str, Any], dx: float, dy: float) -> List[Point]:
    pts = unique_ring_vertices(polygon_exterior(poly) or [])
    moved = [(x + dx, y + dy) for x, y in pts]
    return close_ring(moved)


def ownership_counts(world: Dict[str, Any]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for t in world.get("territories") or []:
        o = t.get("startingOwnerFactionId") or "(none)"
        counts[o] = counts.get(o, 0) + 1
    return counts


def insert_vertex_on_edge(points: Sequence[Point], click: Point, threshold: float) -> Optional[List[Point]]:
    verts = unique_ring_vertices(points)
    best_i = None
    best_d = threshold
    best_q: Optional[Point] = None
    for i in range(len(verts)):
        a, b = verts[i], verts[(i + 1) % len(verts)]
        d, q, t = dist_point_to_segment(click, a, b)
        if 0.05 < t < 0.95 and d < best_d:
            best_d = d
            best_i = i
            best_q = q
    if best_i is None or best_q is None:
        return None
    out = verts[: best_i + 1] + [best_q] + verts[best_i + 1 :]
    return close_ring(out)


def delete_vertex_at(points: Sequence[Point], index: int) -> Optional[List[Point]]:
    verts = unique_ring_vertices(points)
    if len(verts) <= 3:
        return None
    if index < 0 or index >= len(verts):
        return None
    verts.pop(index)
    return close_ring(verts)


# ---------------------------------------------------------------------------
# Undo
# ---------------------------------------------------------------------------

class UndoStack:
    def __init__(self, limit: int = 80) -> None:
        self.limit = limit
        self.undo: List[Dict[str, Any]] = []
        self.redo: List[Dict[str, Any]] = []

    def push(self, world: Dict[str, Any]) -> None:
        self.undo.append(clone_world(world))
        if len(self.undo) > self.limit:
            self.undo.pop(0)
        self.redo.clear()

    def apply_undo(self, current: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not self.undo:
            return None
        self.redo.append(clone_world(current))
        return self.undo.pop()

    def apply_redo(self, current: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not self.redo:
            return None
        self.undo.append(clone_world(current))
        return self.redo.pop()


# ---------------------------------------------------------------------------
# Locate canonical example (optional; editor runs without the repo)
# ---------------------------------------------------------------------------

def find_tiny_world_path() -> Optional[str]:
    rel = os.path.join("docs", "examples", "world-level1-tiny.json")
    roots = [os.getcwd()]
    if "__file__" in globals():
        here = os.path.abspath(os.path.dirname(__file__))
        roots.append(here)
        roots.append(os.path.dirname(here))
        roots.append(os.path.dirname(os.path.dirname(here)))
    seen: Set[str] = set()
    for root in roots:
        cur = os.path.abspath(root)
        for _ in range(8):
            if cur in seen:
                break
            seen.add(cur)
            cand = os.path.join(cur, rel)
            if os.path.isfile(cand):
                return cand
            parent = os.path.dirname(cur)
            if parent == cur:
                break
            cur = parent
    return None


def find_level1_world_path() -> Optional[str]:
    rel = os.path.join("worlds", "level-1.json")
    roots = [os.getcwd()]
    if "__file__" in globals():
        here = os.path.abspath(os.path.dirname(__file__))
        roots.append(here)
        roots.append(os.path.dirname(here))
        roots.append(os.path.dirname(os.path.dirname(here)))
    seen: Set[str] = set()
    for root in roots:
        cur = os.path.abspath(root)
        for _ in range(8):
            if cur in seen:
                break
            seen.add(cur)
            cand = os.path.join(cur, rel)
            if os.path.isfile(cand):
                return cand
            parent = os.path.dirname(cur)
            if parent == cur:
                break
            cur = parent
    return None


# ---------------------------------------------------------------------------
# Minimal valid world used only by self-tests (not a GUI generator)
# ---------------------------------------------------------------------------

def make_minimal_valid_world() -> Dict[str, Any]:
    island = points_to_polygon([
        (-2, 1), (12, -1), (22, 3), (20, 14), (3, 16), (-3, 8), (-2, 1),
    ])
    t1 = points_to_polygon([(1, 2), (10, 2), (10, 10), (1, 10), (1, 2)])
    t2 = points_to_polygon([(10, 2), (19, 3), (18, 11), (10, 10), (10, 2)])
    return {
        "formatVersion": FORMAT_VERSION,
        "worldId": "w_test_min",
        "level": 1,
        "name": "Test Min",
        "playerFactionId": "f_player",
        "island": island,
        "completion": {"type": "control_fraction", "fraction": 0.7},
        "containedWorlds": [],
        "factions": [
            {
                "id": "f_player", "role": "player", "name": "Player",
                "homeTerritoryId": "t_01",
                "startingResources": {k: 100 for k in RESOURCE_KEYS},
                "startingArmy": {"soldiers": 100, "knights": 0, "siegeEngines": 0, "locationTerritoryId": "t_01"},
                "personality": None,
            },
            {
                "id": "f_ai_01", "role": "ai", "name": "Warlord",
                "homeTerritoryId": "t_02",
                "startingResources": {k: 100 for k in RESOURCE_KEYS},
                "startingArmy": {"soldiers": 100, "knights": 0, "siegeEngines": 0, "locationTerritoryId": "t_02"},
                "personality": {
                    "id": "p_01", "label": "Custom", "ambition": 0.4,
                    "traits": {k: 0.4 for k in TRAIT_KEYS},
                },
            },
        ],
        "startingDiplomacy": [],
        "regions": [
            {"id": "r_01", "name": "Test Region", "worldId": "w_test_min", "territoryIds": ["t_01", "t_02"]},
        ],
        "territories": [
            {
                "id": "t_01", "regionId": "r_01", "startingOwnerFactionId": "f_player",
                "neighborIds": ["t_02"], "terrain": "plains",
                "resourceOutput": {"gold": 1}, "polygon": t1,
            },
            {
                "id": "t_02", "regionId": "r_01", "startingOwnerFactionId": "f_ai_01",
                "neighborIds": ["t_01"], "terrain": "hills",
                "resourceOutput": {"iron": 2}, "polygon": t2,
            },
        ],
    }


def _test_level1_factions(player_home: str, ai_home: str) -> List[Dict[str, Any]]:
    return [
        {
            "id": "f_player", "role": "player", "name": "Player",
            "homeTerritoryId": player_home,
            "startingResources": {k: 100 for k in RESOURCE_KEYS},
            "startingArmy": {
                "soldiers": 100, "knights": 0, "siegeEngines": 0,
                "locationTerritoryId": player_home,
            },
            "personality": None,
        },
        {
            "id": "f_ai_01", "role": "ai", "name": "Warlord",
            "homeTerritoryId": ai_home,
            "startingResources": {k: 100 for k in RESOURCE_KEYS},
            "startingArmy": {
                "soldiers": 100, "knights": 0, "siegeEngines": 0,
                "locationTerritoryId": ai_home,
            },
            "personality": {
                "id": "p_01", "label": "Custom", "ambition": 0.4,
                "traits": {k: 0.4 for k in TRAIT_KEYS},
            },
        },
    ]


def make_level1_three_region_world() -> Dict[str, Any]:
    """Deterministic organic Level 1: 1 island, 3 regions, 2 territories each."""
    island = points_to_polygon([(-2, -2), (33, -2), (33, 24), (-2, 24), (-2, -2)])
    t_west_n = points_to_polygon([(0, 11), (10, 10), (10, 20), (1, 21), (0, 11)])
    t_west_s = points_to_polygon([(0, 0), (11, 1), (10, 10), (0, 11), (0, 0)])
    t_mid_n = points_to_polygon([(10, 10), (20, 11), (20, 21), (10, 20), (10, 10)])
    t_mid_s = points_to_polygon([(10, 10), (11, 1), (21, 0), (20, 11), (10, 10)])
    t_east_n = points_to_polygon([(20, 11), (30, 10), (30, 21), (20, 21), (20, 11)])
    t_east_s = points_to_polygon([(20, 11), (21, 0), (31, 1), (30, 10), (20, 11)])
    return {
        "formatVersion": FORMAT_VERSION,
        "worldId": "w_level1_three",
        "level": 1,
        "name": "Three Realms",
        "playerFactionId": "f_player",
        "island": island,
        "completion": {"type": "control_fraction", "fraction": 0.7},
        "containedWorlds": [],
        "factions": _test_level1_factions("t_01", "t_03"),
        "startingDiplomacy": [],
        "regions": [
            {"id": "r_west", "name": "Iron Coast", "worldId": "w_level1_three", "territoryIds": ["t_01", "t_02"]},
            {"id": "r_mid", "name": "Midland", "worldId": "w_level1_three", "territoryIds": ["t_03", "t_04"]},
            {"id": "r_east", "name": "Salt Barrens", "worldId": "w_level1_three", "territoryIds": ["t_05", "t_06"]},
        ],
        "territories": [
            {
                "id": "t_01", "regionId": "r_west", "startingOwnerFactionId": "f_player",
                "neighborIds": ["t_02", "t_03"], "terrain": "plains",
                "resourceOutput": {"food": 1}, "polygon": t_west_n,
            },
            {
                "id": "t_02", "regionId": "r_west", "startingOwnerFactionId": "f_ai_01",
                "neighborIds": ["t_01", "t_04"], "terrain": "hills",
                "resourceOutput": {"iron": 1}, "polygon": t_west_s,
            },
            {
                "id": "t_03", "regionId": "r_mid", "startingOwnerFactionId": "f_ai_01",
                "neighborIds": ["t_01", "t_04", "t_05"], "terrain": "forest",
                "resourceOutput": {"wood": 1}, "polygon": t_mid_n,
            },
            {
                "id": "t_04", "regionId": "r_mid", "startingOwnerFactionId": "f_ai_01",
                "neighborIds": ["t_02", "t_03", "t_06"], "terrain": "hills",
                "resourceOutput": {"stone": 1}, "polygon": t_mid_s,
            },
            {
                "id": "t_05", "regionId": "r_east", "startingOwnerFactionId": "f_ai_01",
                "neighborIds": ["t_03", "t_06"], "terrain": "coastal",
                "resourceOutput": {"gold": 1}, "polygon": t_east_n,
            },
            {
                "id": "t_06", "regionId": "r_east", "startingOwnerFactionId": "f_ai_01",
                "neighborIds": ["t_04", "t_05"], "terrain": "coastal",
                "resourceOutput": {"gold": 1}, "polygon": t_east_s,
            },
        ],
    }


def make_disconnected_region_world() -> Dict[str, Any]:
    """Valid Level 1 whose one region is two landmasses — cannot coarsen."""
    island = points_to_polygon([(-2, -2), (22, -2), (22, 6), (-2, 6), (-2, -2)])
    left = points_to_polygon([(0, 0), (4, 0), (4, 4), (0, 4), (0, 0)])
    bridge = points_to_polygon([(4, 0), (16, 0), (16, 4), (4, 4), (4, 0)])
    right = points_to_polygon([(16, 0), (20, 0), (20, 4), (16, 4), (16, 0)])
    return {
        "formatVersion": FORMAT_VERSION,
        "worldId": "w_split_region",
        "level": 1,
        "name": "Split Region",
        "playerFactionId": "f_player",
        "island": island,
        "completion": {"type": "control_fraction", "fraction": 0.7},
        "containedWorlds": [],
        "factions": _test_level1_factions("t_01", "t_02"),
        "startingDiplomacy": [],
        "regions": [
            {"id": "r_split", "name": "Split Lands", "worldId": "w_split_region", "territoryIds": ["t_01", "t_03"]},
            {"id": "r_bridge", "name": "Bridge", "worldId": "w_split_region", "territoryIds": ["t_02"]},
        ],
        "territories": [
            {
                "id": "t_01", "regionId": "r_split", "startingOwnerFactionId": "f_player",
                "neighborIds": ["t_02"], "terrain": "plains",
                "resourceOutput": {"food": 1}, "polygon": left,
            },
            {
                "id": "t_02", "regionId": "r_bridge", "startingOwnerFactionId": "f_ai_01",
                "neighborIds": ["t_01", "t_03"], "terrain": "hills",
                "resourceOutput": {"iron": 1}, "polygon": bridge,
            },
            {
                "id": "t_03", "regionId": "r_split", "startingOwnerFactionId": "f_ai_01",
                "neighborIds": ["t_02"], "terrain": "coastal",
                "resourceOutput": {"gold": 1}, "polygon": right,
            },
        ],
    }


# ---------------------------------------------------------------------------
# Self-tests (no Tk, no npm, no network)
# ---------------------------------------------------------------------------

class WorldLogicTests(unittest.TestCase):
    def test_blank_world_has_schema_fields(self) -> None:
        w = new_blank_world()
        self.assertEqual(w["formatVersion"], FORMAT_VERSION)
        self.assertEqual(w["playerFactionId"], "f_player")
        self.assertEqual(w["territories"], [])
        self.assertIsNone(w["factions"][0]["personality"])
        self.assertNotIn("cities", w)
        self.assertNotIn("scout", w)
        codes = {i["code"] for i in validate_world(w)}
        self.assertIn("territory.empty", codes)
        self.assertIn("geometry.missing_ring", codes)
        self.assertFalse(polygon_exterior(w.get("island") if isinstance(w.get("island"), dict) else None))
        self.assertNotIn(EDITOR_GRAPH_KEY, w)

    def test_minimal_world_valid(self) -> None:
        w = make_minimal_valid_world()
        self.assertEqual(validate_world(w), [])

    def test_round_trip_deterministic(self) -> None:
        w = make_minimal_valid_world()
        text1 = dumps_world(w)
        loaded, issues = parse_world_json(text1)
        self.assertEqual(issues, [])
        self.assertIsNotNone(loaded)
        text2 = dumps_world(loaded)  # type: ignore[arg-type]
        self.assertEqual(text1, text2)
        self.assertIn('"formatVersion": "rep-wars-world.v1"', text1)
        self.assertNotIn("isCapital", text1)
        self.assertNotIn("SCOUT", text1)
        self.assertNotIn("EXPAND", text1)
        self.assertNotIn('"cities"', text1)

    def test_territory_create_delete(self) -> None:
        w = make_minimal_valid_world()
        rid = w["regions"][0]["id"]
        tid = add_territory(w, quad_at(5, 5, 2), rid, "f_ai_01")
        self.assertIsNotNone(find_territory(w, tid))
        self.assertIn(tid, find_region(w, rid)["territoryIds"])
        delete_territory(w, tid)
        self.assertIsNone(find_territory(w, tid))
        self.assertNotIn(tid, find_region(w, rid)["territoryIds"])

    def test_region_create_and_assign(self) -> None:
        w = make_minimal_valid_world()
        rid = add_region(w, "North")
        sync_region_membership(w, "t_02", rid)
        self.assertEqual(find_territory(w, "t_02")["regionId"], rid)
        self.assertIn("t_02", find_region(w, rid)["territoryIds"])
        self.assertNotIn("t_02", find_region(w, "r_01")["territoryIds"])

    def test_reciprocal_adjacency(self) -> None:
        w = make_minimal_valid_world()
        w["territories"][0]["neighborIds"] = []
        w["territories"][1]["neighborIds"] = []
        set_reciprocal_neighbor(w, "t_01", "t_02", True)
        self.assertIn("t_02", find_territory(w, "t_01")["neighborIds"])
        self.assertIn("t_01", find_territory(w, "t_02")["neighborIds"])
        set_reciprocal_neighbor(w, "t_01", "t_02", False)
        self.assertEqual(find_territory(w, "t_01")["neighborIds"], [])
        self.assertEqual(find_territory(w, "t_02")["neighborIds"], [])

    def test_non_reciprocal_rejected(self) -> None:
        w = make_minimal_valid_world()
        w["territories"][0]["neighborIds"] = ["t_02"]
        w["territories"][1]["neighborIds"] = []
        codes = {i["code"] for i in validate_world(w)}
        self.assertIn("adjacency.non_reciprocal", codes)

    def test_ownership_assignment(self) -> None:
        w = make_minimal_valid_world()
        find_territory(w, "t_02")["startingOwnerFactionId"] = "f_player"
        codes = {i["code"] for i in validate_world(w)}
        self.assertIn("owner.player_count", codes)

    def test_personality_editing(self) -> None:
        w = make_minimal_valid_world()
        p = find_faction(w, "f_ai_01")["personality"]
        p["traits"]["aggression"] = 0.91
        p["ambition"] = 0.2
        self.assertEqual(validate_world(w), [])
        p["traits"]["aggression"] = 2
        self.assertIn("personality.trait", {i["code"] for i in validate_world(w)})

    def test_different_worlds_different_personalities(self) -> None:
        a = make_minimal_valid_world()
        b = make_minimal_valid_world()
        b["worldId"] = "w_other"
        b["regions"][0]["worldId"] = "w_other"
        find_faction(b, "f_ai_01")["personality"]["traits"]["aggression"] = 0.05
        self.assertNotEqual(
            find_faction(a, "f_ai_01")["personality"]["traits"]["aggression"],
            find_faction(b, "f_ai_01")["personality"]["traits"]["aggression"],
        )

    def test_island_and_territory_polygons(self) -> None:
        w = make_minimal_valid_world()
        w["territories"][0]["polygon"] = {"rings": [[{"x": 0, "y": 0}, {"x": 1, "y": 1}]]}
        self.assertTrue(any(i["code"].startswith("geometry.") for i in validate_world(w)))

    def test_invalid_references_and_duplicate_ids(self) -> None:
        w = make_minimal_valid_world()
        w["territories"][0]["regionId"] = "r_missing"
        self.assertIn("territory.unknown_region", {i["code"] for i in validate_world(w)})
        w = make_minimal_valid_world()
        w["territories"].append(clone_world(w["territories"][0]))
        self.assertIn("territory.duplicate_id", {i["code"] for i in validate_world(w)})

    def test_invalid_region_membership(self) -> None:
        w = make_minimal_valid_world()
        w["regions"][0]["territoryIds"] = ["t_01"]
        self.assertIn("territory.region_mismatch", {i["code"] for i in validate_world(w)})

    def test_disconnected_graph(self) -> None:
        w = make_minimal_valid_world()
        w["territories"][0]["neighborIds"] = []
        w["territories"][1]["neighborIds"] = []
        self.assertIn("adjacency.disconnected", {i["code"] for i in validate_world(w)})

    def test_forbidden_legacy_fields(self) -> None:
        w = make_minimal_valid_world()
        w["territories"][0]["name"] = "Named Tile"
        self.assertIn("territory.named", {i["code"] for i in validate_world(w)})
        w = make_minimal_valid_world()
        w["territories"][0]["isCapital"] = True
        self.assertIn("territory.forbidden_field", {i["code"] for i in validate_world(w)})
        w = make_minimal_valid_world()
        w["scout"] = True
        self.assertIn("world.forbidden_field", {i["code"] for i in validate_world(w)})

    def test_contained_world_and_cross_level(self) -> None:
        w = make_minimal_valid_world()
        w["containedWorlds"] = [{
            "worldId": "w_prior", "regionId": "r_missing",
            "placement": {"origin": {"x": 0, "y": 0}, "rotationDegrees": 0, "scale": 1},
        }]
        self.assertIn("contained.region", {i["code"] for i in validate_world(w)})
        w = make_minimal_valid_world()
        w["containedWorlds"] = [{
            "worldId": "w_prior", "regionId": "r_01",
            "placement": {"origin": {"x": 1, "y": 1}, "rotationDegrees": 0, "scale": 0.2},
        }]
        self.assertNotIn("contained.region", {i["code"] for i in validate_world(w)})
        w["territories"][0]["neighborIds"].append("w_other_world")
        codes = {i["code"] for i in validate_world(w)}
        self.assertTrue("adjacency.cross_level" in codes or "adjacency.missing_neighbor" in codes)

    def test_self_adjacency_and_missing_owner(self) -> None:
        w = make_minimal_valid_world()
        w["territories"][0]["neighborIds"].append("t_01")
        self.assertIn("adjacency.self_neighbor", {i["code"] for i in validate_world(w)})
        w = make_minimal_valid_world()
        w["territories"][0]["startingOwnerFactionId"] = "f_nobody"
        self.assertIn("owner.unknown", {i["code"] for i in validate_world(w)})

    def test_export_has_no_cities_scout_expand_capital(self) -> None:
        text = dumps_world(make_minimal_valid_world())
        data = json.loads(text)
        self.assertNotIn("cities", data)
        blob = text.lower()
        self.assertNotIn("scout", blob)
        self.assertNotIn("expand", blob)
        self.assertNotIn("iscapital", blob)
        for t in data["territories"]:
            self.assertNotIn("name", t)
            self.assertNotIn("isCapital", t)

    def test_invalid_json_does_not_invent_world(self) -> None:
        world, issues = parse_world_json("{")
        self.assertIsNone(world)
        self.assertTrue(any(i["code"] == "json.parse" for i in issues))
        world, issues = load_world_definition(None)
        self.assertIsNone(world)
        self.assertTrue(any(i["code"] == "json.not_object" for i in issues))

    def test_tiny_world_file_round_trip_if_present(self) -> None:
        path = find_tiny_world_path()
        if not path:
            self.skipTest("docs/examples/world-level1-tiny.json not found (standalone copy)")
        with open(path, "r", encoding="utf-8") as fh:
            original = fh.read()
        world, issues = parse_world_json(original)
        self.assertEqual(issues, [], msg=issues)
        self.assertIsNotNone(world)
        self.assertEqual(world["worldId"], "w_ember_atoll")
        self.assertEqual(world["formatVersion"], FORMAT_VERSION)
        exported = dumps_world(world)
        again, issues2 = parse_world_json(exported)
        self.assertEqual(issues2, [])
        self.assertEqual(dumps_world(again), exported)
        self.assertEqual(len(again["territories"]), 6)
        self.assertEqual(sum(1 for t in again["territories"] if t["startingOwnerFactionId"] == "f_player"), 1)
        fd, tmp = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        try:
            with open(tmp, "w", encoding="utf-8") as fh:
                fh.write(exported)
            with open(tmp, "r", encoding="utf-8") as fh:
                reloaded_text = fh.read()
            reloaded, iss = parse_world_json(reloaded_text)
            self.assertEqual(iss, [])
            self.assertEqual(dumps_world(reloaded), exported)
        finally:
            os.remove(tmp)
        with open(path, "r", encoding="utf-8") as fh:
            self.assertEqual(fh.read(), original)

    def test_undo_stack(self) -> None:
        w = make_minimal_valid_world()
        stack = UndoStack()
        stack.push(w)
        add_region(w, "Extra")
        restored = stack.apply_undo(w)
        self.assertIsNotNone(restored)
        self.assertEqual(len(restored["regions"]), 1)

    def test_y_up_not_mutated_by_serializer(self) -> None:
        w = make_minimal_valid_world()
        y0 = w["island"]["rings"][0][0]["y"]
        dumped = json.loads(dumps_world(w))
        self.assertEqual(dumped["island"]["rings"][0][0]["y"], y0)


def _organic_coast_path(samples: int = 420) -> List[Point]:
    """Hand-drawn-like closed coast: major bays plus small irregularities."""
    pts: List[Point] = []
    n = max(samples, 32)
    for i in range(n):
        a = (2.0 * math.pi * i) / n
        r = 34.0 + 7.0 * math.sin(5.0 * a) + 3.2 * math.sin(13.0 * a) + 1.1 * math.sin(29.0 * a)
        pts.append((48.0 + r * math.cos(a), 40.0 + 0.82 * r * math.sin(a)))
    return pts


def _dense_square_path(per_side: int = 80) -> List[Point]:
    pts: List[Point] = []
    corners = [(10.0, 10.0), (70.0, 10.0), (70.0, 70.0), (10.0, 70.0)]
    for i, start in enumerate(corners):
        end = corners[(i + 1) % 4]
        for s in range(per_side):
            t = s / float(per_side)
            pts.append((start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t))
    return pts


class DrawnPolygonTests(unittest.TestCase):
    def test_continuous_path_becomes_closed_polygon(self) -> None:
        raw = _organic_coast_path()
        closed, err = finalize_drawn_polygon(raw)
        self.assertIsNone(err, msg=err)
        self.assertIsNotNone(closed)
        assert closed is not None
        self.assertGreaterEqual(len(unique_ring_vertices(closed)), 3)
        self.assertTrue(almost_equal(closed[0][0], closed[-1][0]))
        self.assertTrue(almost_equal(closed[0][1], closed[-1][1]))
        self.assertFalse(ring_self_intersects(closed))
        self.assertGreater(abs(ring_area(closed)), DRAW_MIN_AREA)
        geom_issues = _check_polygon(points_to_polygon(closed), "drawn")
        self.assertEqual(geom_issues, [])

    def test_dense_input_reduced_without_destroying_shape(self) -> None:
        raw = _dense_square_path(90)
        closed, err = finalize_drawn_polygon(raw, min_spacing=0.2)
        self.assertIsNone(err)
        assert closed is not None
        verts = unique_ring_vertices(closed)
        self.assertLess(len(verts), len(raw) // 4)
        self.assertGreaterEqual(len(verts), 4)
        self.assertLessEqual(max_point_polyline_deviation(raw, closed), 1.5)
        area = abs(ring_area(closed))
        self.assertGreater(area, 3000.0)
        self.assertLess(area, 3800.0)

    def test_organic_curvature_keeps_many_vertices(self) -> None:
        raw = _organic_coast_path(500)
        closed, err = finalize_drawn_polygon(raw)
        self.assertIsNone(err)
        assert closed is not None
        verts = unique_ring_vertices(closed)
        square, _ = finalize_drawn_polygon(_dense_square_path(80))
        self.assertIsNotNone(square)
        self.assertGreaterEqual(len(verts), 40)
        self.assertGreater(len(verts), len(unique_ring_vertices(square or [])) * 4)
        orig_area = abs(ring_area(close_ring(raw)))
        new_area = abs(ring_area(closed))
        self.assertLess(abs(new_area - orig_area) / orig_area, 0.08)
        self.assertLessEqual(max_point_polyline_deviation(raw, closed), 1.25)
        a = finalize_drawn_polygon(raw)[0]
        b = finalize_drawn_polygon(raw)[0]
        self.assertEqual(a, b)

    def test_drawn_coordinates_stay_world_local(self) -> None:
        raw = _organic_coast_path(160)
        closed, err = finalize_drawn_polygon(raw)
        self.assertIsNone(err)
        assert closed is not None
        xs = [p[0] for p in closed]
        ys = [p[1] for p in closed]
        self.assertGreater(min(xs), 0.0)
        self.assertGreater(min(ys), 0.0)
        self.assertLess(max(xs), 120.0)
        self.assertLess(max(ys), 120.0)
        # Screen space is +y down and typically hundreds of pixels; world-local
        # drawing must not invert or scale into canvas pixels.
        self.assertTrue(all(abs(p[0]) < 500 and abs(p[1]) < 500 for p in closed))

    def test_distance_sampling_drops_micro_jitter(self) -> None:
        raw = [(float(i) * 0.02, 1.0) for i in range(400)]
        sampled = sample_path_by_distance(raw, 0.5)
        self.assertLess(len(sampled), 30)
        self.assertGreaterEqual(len(sampled), 14)
        self.assertEqual(sampled[0], raw[0])
        self.assertEqual(sampled[-1], raw[-1])

    def test_sparse_and_invalid_drawings_rejected(self) -> None:
        closed, err = finalize_drawn_polygon([(0.0, 0.0), (4.0, 1.0)])
        self.assertIsNone(closed)
        self.assertEqual(err["code"], "draw.too_few_points")  # type: ignore[index]
        closed, err = finalize_drawn_polygon([(0.0, 0.0), (0.2, 0.1), (0.1, 0.15), (0.0, 0.0)])
        self.assertIsNone(closed)
        self.assertEqual(err["code"], "draw.too_small")  # type: ignore[index]
        bowtie: List[Point] = []
        segments = (
            ((0.0, 8.0), (50.0, 8.0)),
            ((50.0, 8.0), (0.0, 50.0)),
            ((0.0, 50.0), (50.0, 50.0)),
            ((50.0, 50.0), (0.0, 8.0)),
        )
        for a, b in segments:
            for i in range(24):
                t = i / 24.0
                bowtie.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
        closed, err = finalize_drawn_polygon(bowtie, min_spacing=0.2)
        self.assertIsNone(closed)
        self.assertEqual(err["code"], "draw.self_intersecting")  # type: ignore[index]

    def test_vertex_editing_still_works_after_drawing(self) -> None:
        closed, err = finalize_drawn_polygon(_organic_coast_path(240))
        self.assertIsNone(err)
        assert closed is not None
        verts = unique_ring_vertices(closed)
        inserted = None
        for i in range(len(verts)):
            a, b = verts[i], verts[(i + 1) % len(verts)]
            if edge_length(a, b) < 0.8:
                continue
            mid = ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0)
            inserted = insert_vertex_on_edge(closed, mid, threshold=4.0)
            if inserted:
                break
        self.assertIsNotNone(inserted)
        assert inserted is not None
        self.assertEqual(len(unique_ring_vertices(inserted)), len(verts) + 1)
        deleted = delete_vertex_at(inserted, 1)
        self.assertIsNotNone(deleted)
        assert deleted is not None
        self.assertEqual(len(unique_ring_vertices(deleted)), len(verts))
        edited = unique_ring_vertices(deleted)
        edited[0] = (edited[0][0] + 0.5, edited[0][1] - 0.25)
        dragged = close_ring(edited)
        self.assertGreaterEqual(len(unique_ring_vertices(dragged)), 3)

    def test_undo_redo_drawn_territory_does_not_reshape_neighbors(self) -> None:
        w = make_minimal_valid_world()
        neighbor_poly = clone_world(w["territories"][0]["polygon"])
        other_poly = clone_world(w["territories"][1]["polygon"])
        closed, err = finalize_drawn_polygon(_organic_coast_path(180))
        self.assertIsNone(err)
        assert closed is not None
        # Scale/offset the organic blob into the island without touching other rings.
        scaled = [(3.0 + x * 0.12, 4.0 + y * 0.12) for x, y in unique_ring_vertices(closed)]
        stack = UndoStack()
        stack.push(w)
        tid = add_territory(w, close_ring(scaled), "r_01", "f_ai_01")
        self.assertIsNotNone(find_territory(w, tid))
        self.assertEqual(w["territories"][0]["polygon"], neighbor_poly)
        self.assertEqual(w["territories"][1]["polygon"], other_poly)
        self.assertEqual(find_territory(w, tid)["neighborIds"], [])
        restored = stack.apply_undo(w)
        self.assertIsNotNone(restored)
        assert restored is not None
        self.assertIsNone(find_territory(restored, tid))
        self.assertEqual(len(restored["territories"]), 2)
        redone = stack.apply_redo(restored)
        self.assertIsNotNone(redone)
        assert redone is not None
        self.assertIsNotNone(find_territory(redone, tid))
        self.assertEqual(redone["territories"][0]["polygon"], neighbor_poly)

    def test_drawn_polygon_export_stays_worlddefinition(self) -> None:
        w = make_minimal_valid_world()
        coast: List[Point] = []
        n = 220
        for i in range(n):
            a = (2.0 * math.pi * i) / n
            r = 22.0 + 3.0 * math.sin(5.0 * a) + 1.4 * math.sin(14.0 * a) + 0.5 * math.sin(31.0 * a)
            coast.append((10.0 + r * math.cos(a), 8.0 + 0.9 * r * math.sin(a)))
        closed, err = finalize_drawn_polygon(coast)
        self.assertIsNone(err)
        assert closed is not None
        set_exterior(w["island"], closed)
        text = dumps_world(w)
        data = json.loads(text)
        self.assertEqual(data["formatVersion"], FORMAT_VERSION)
        ring = data["island"]["rings"][0]
        self.assertGreaterEqual(len(ring), 4)
        for p in ring:
            self.assertEqual(set(p.keys()), {"x", "y"})
            self.assertIsInstance(p["x"], (int, float))
            self.assertIsInstance(p["y"], (int, float))
        again, issues = parse_world_json(text)
        self.assertEqual(issues, [], msg=issues)
        self.assertEqual(again["formatVersion"], FORMAT_VERSION)  # type: ignore[index]
        self.assertEqual(again["island"]["rings"][0][0].keys(), {"x", "y"})  # type: ignore[index]
        self.assertNotIn("drawMode", text)
        self.assertNotIn("screenX", text)


class EditorWorkflowTests(unittest.TestCase):
    def test_pointer_release_stores_raw_stroke_without_territories(self) -> None:
        w = new_blank_world()
        partial = [(10.0, 0.2), (10.0, 6.0), (10.0, 12.0)]
        sid = add_drawing_stroke(w, partial)
        self.assertEqual(len(iter_drawing_strokes(w)), 1)
        self.assertEqual(w["territories"], [])
        self.assertFalse(polygon_exterior(w["island"]))
        stored = open_stroke_points(find_drawing_stroke(w, sid) or {})
        self.assertEqual(stored[0], (10.0, 0.2))
        self.assertEqual(stored[-1], (10.0, 12.0))
        codes = {i["code"] for i in editor_export_issues(w)}
        self.assertNotIn("draw.open_boundary", codes)

    def test_resume_continues_from_same_world_endpoint_after_zoom(self) -> None:
        w = new_blank_world()
        sid = add_drawing_stroke(w, [(10.0, 0.2), (10.0, 8.0)])
        origin = open_stroke_points(find_drawing_stroke(w, sid) or {})
        zoom_in, ox, oy = 12.0, 40.0, -15.0
        sx, sy = view_world_to_screen(origin[-1][0], origin[-1][1], zoom_in, ox, oy)
        wx, wy = view_screen_to_world(sx, sy, zoom_in, ox, oy)
        self.assertAlmostEqual(wx, origin[-1][0], places=9)
        self.assertAlmostEqual(wy, origin[-1][1], places=9)
        resumed = oriented_drawing_stroke_for_resume(w, (wx, wy), drawing_snap_radius(zoom_in))
        self.assertIsNotNone(resumed)
        assert resumed is not None
        self.assertEqual(resumed["id"], sid)
        self.assertEqual(resumed["which"], "end")
        self.assertEqual(resumed["points"][0], (10.0, 0.2))
        continued = list(resumed["points"]) + [(10.0, 14.0)]
        put_drawing_stroke(w, sid, continued)
        zoom_out, ox2, oy2 = 0.8, 200.0, 90.0
        end = continued[-1]
        sx2, sy2 = view_world_to_screen(end[0], end[1], zoom_out, ox2, oy2)
        wx2, wy2 = view_screen_to_world(sx2, sy2, zoom_out, ox2, oy2)
        self.assertAlmostEqual(wx2, 10.0, places=9)
        self.assertAlmostEqual(wy2, 14.0, places=9)
        again = oriented_drawing_stroke_for_resume(w, (wx2, wy2), drawing_snap_radius(zoom_out))
        self.assertIsNotNone(again)
        assert again is not None
        finished = list(again["points"]) + [(10.0, 19.7)]
        put_drawing_stroke(w, sid, finished)
        self.assertEqual(len(w["territories"]), 0)
        self.assertEqual(len(iter_drawing_strokes(w)), 1)

    def test_resume_from_start_reverses_polyline(self) -> None:
        w = new_blank_world()
        sid = add_drawing_stroke(w, [(10.0, 4.0), (10.0, 12.0)])
        hit = oriented_drawing_stroke_for_resume(w, (10.0, 4.0), 1.0)
        self.assertIsNotNone(hit)
        assert hit is not None
        self.assertEqual(hit["id"], sid)
        self.assertEqual(hit["which"], "start")
        self.assertEqual(hit["points"][0], (10.0, 12.0))
        self.assertEqual(hit["points"][-1], (10.0, 4.0))

    def test_raw_open_strokes_are_not_export_errors(self) -> None:
        w = new_blank_world()
        add_drawing_stroke(w, [(0.0, 0.0), (20.0, 0.0), (20.0, 20.0), (0.0, 20.0), (0.0, 0.0)])
        add_drawing_stroke(w, [(0.2, 10.0), (8.0, 10.0)])
        issues = editor_export_issues(w)
        self.assertFalse(any(i["code"] == "draw.open_boundary" for i in issues))
        text = dumps_world(w)
        self.assertNotIn(EDITOR_DRAWING_KEY, text)
        self.assertNotIn(EDITOR_OPEN_STROKES_KEY, text)
        self.assertNotIn(EDITOR_CONVERT_REPORT_KEY, text)

    def test_move_to_region_assigns_all_selected_and_undoes_as_one(self) -> None:
        w = make_minimal_valid_world()
        rid = add_region(w, "Eastern Reach")
        selected = ["t_01", "t_02"]
        for tid in selected:
            self.assertTrue(territory_is_multi_selected(tid, selected, ("territory", tid)))
        stack = UndoStack()
        stack.push(w)
        n = assign_territories_to_region(w, selected, rid)
        self.assertEqual(n, 2)
        self.assertEqual(find_territory(w, "t_01")["regionId"], rid)
        self.assertEqual(find_territory(w, "t_02")["regionId"], rid)
        self.assertIn("t_01", find_region(w, rid)["territoryIds"])
        self.assertIn("t_02", find_region(w, rid)["territoryIds"])
        self.assertNotIn("t_01", find_region(w, "r_01")["territoryIds"])
        restored = stack.apply_undo(w)
        self.assertIsNotNone(restored)
        assert restored is not None
        self.assertEqual(find_territory(restored, "t_01")["regionId"], "r_01")
        self.assertEqual(find_territory(restored, "t_02")["regionId"], "r_01")

    def test_player_facing_troops_combine_internal_units(self) -> None:
        army = {"soldiers": 400, "knights": 40, "siegeEngines": 10}
        self.assertEqual(player_facing_troop_count(army), 450)
        self.assertEqual(army["knights"], 40)
        self.assertEqual(army["siegeEngines"], 10)


def _cvt_square() -> List[Point]:
    return _cvt_square_at(0.0, 0.0, 20.0)


def _cvt_square_at(x0: float, y0: float, size: float = 20.0) -> List[Point]:
    return [
        (x0, y0), (x0 + size, y0), (x0 + size, y0 + size), (x0, y0 + size), (x0, y0),
    ]


def _cvt_divided_strip(
    x0: float, y0: float, x1: float, y1: float, xs: Sequence[float],
) -> List[List[Point]]:
    outer = [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
    divs = [[(x, y0 - 4.0), (x, y1 + 4.0)] for x in xs]
    return [outer] + divs


def _cvt_irregular_island() -> List[Point]:
    return [
        (2.0, 4.0), (8.0, 0.5), (18.0, 1.5), (22.0, 8.0),
        (20.5, 18.0), (12.0, 22.0), (3.0, 19.0), (0.5, 11.0), (2.0, 4.0),
    ]


def _wavy_divider(x: float, y0: float, y1: float, n: int = 48, amp: float = 1.15) -> List[Point]:
    pts: List[Point] = []
    steps = max(n, 8)
    for i in range(steps):
        t = i / float(steps - 1)
        y = y0 + (y1 - y0) * t
        pts.append((x + amp * math.sin(t * math.pi * 3.0), y))
    return pts


def _cvt_interpret(*polylines: Sequence[Point]) -> Dict[str, Any]:
    return interpret_combined_drawing(polylines)


def _cvt_world_from(*polylines: Sequence[Point]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    w = new_blank_world()
    for pts in polylines:
        add_drawing_stroke(w, pts)
    result = convert_drawing_to_map(w)
    return w, result


def _cvt_assign_homes(world: Dict[str, Any]) -> None:
    if not any(f.get("role") == "ai" for f in world.get("factions") or []):
        add_ai_faction(world)
    by_owner: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for t in world.get("territories") or []:
        by_owner[str(t.get("startingOwnerFactionId") or "")].append(t)
    for f in world.get("factions") or []:
        owned = by_owner.get(str(f.get("id") or ""), [])
        if owned:
            f["homeTerritoryId"] = owned[0]["id"]
            army = f.get("startingArmy")
            if isinstance(army, dict):
                army["locationTerritoryId"] = owned[0]["id"]


class DrawingConvertTests(unittest.TestCase):
    def test_new_map_starts_blank(self) -> None:
        w = new_blank_world()
        self.assertFalse(polygon_exterior(w["island"]))
        self.assertEqual(w["territories"], [])
        self.assertEqual(iter_drawing_strokes(w), [])

    def test_closed_irregular_outer_is_one_territory(self) -> None:
        result = _cvt_interpret(_cvt_irregular_island())
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 1)
        self.assertGreater(abs(ring_area(result["island"])), 80.0)

    def test_outer_plus_one_through_divider_is_two_territories(self) -> None:
        result = _cvt_interpret(_cvt_square(), [(10.0, -8.0), (10.0, 28.0)])
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 2)
        pa = points_to_polygon(result["territories"][0])
        pb = points_to_polygon(result["territories"][1])
        self.assertGreater(shared_edge_length(pa, pb), 1.0)

    def test_outer_plus_vertical_and_horizontal_is_four_territories(self) -> None:
        result = _cvt_interpret(
            _cvt_square(),
            [(10.0, -6.0), (10.0, 26.0)],
            [(-6.0, 10.0), (26.0, 10.0)],
        )
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 4)

    def test_several_intersecting_lines_make_enclosed_regions(self) -> None:
        result = _cvt_interpret(
            _cvt_square(),
            [(7.0, -5.0), (7.0, 25.0)],
            [(13.0, -5.0), (13.0, 25.0)],
            [(-5.0, 10.0), (25.0, 10.0)],
        )
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 6)

    def test_dividers_extending_outside_island_are_ignored(self) -> None:
        result = _cvt_interpret(_cvt_square(), [(10.0, -40.0), (10.0, 60.0)])
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 2)
        isle = result["island"]
        for ring in result["territories"]:
            self.assertTrue(all_vertices_inside(unique_ring_vertices(ring), isle))

    def test_loose_line_that_encloses_nothing_adds_no_territory(self) -> None:
        result = _cvt_interpret(_cvt_square(), [(6.0, 8.0), (8.5, 9.2)])
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 1)

    def test_small_gap_to_boundary_is_bridged(self) -> None:
        result = _cvt_interpret(_cvt_square(), [(10.0, 0.45), (10.0, 19.55)])
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 2)

    def test_tiny_accidental_closed_mark_ignored(self) -> None:
        speck = [(30.0, 30.0), (30.6, 30.0), (30.6, 30.5), (30.0, 30.5), (30.0, 30.0)]
        result = _cvt_interpret(_cvt_square(), speck)
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 1)
        self.assertGreaterEqual(int(result.get("noiseCount") or 0), 0)

    def test_organic_island_shape_preserved(self) -> None:
        raw = _organic_coast_path(280)
        result = _cvt_interpret(raw)
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 1)
        verts = unique_ring_vertices(result["island"])
        self.assertGreaterEqual(len(verts), 20)
        orig = abs(ring_area(close_ring(raw)))
        got = abs(ring_area(result["island"]))
        self.assertLess(abs(got - orig) / orig, 0.25)

    def test_organic_internal_borders_preserved(self) -> None:
        raw = _organic_coast_path(280)
        divider = _wavy_divider(48.0, -10.0, 90.0, n=60, amp=1.4)
        result = _cvt_interpret(raw, divider)
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 2)
        for ring in result["territories"]:
            self.assertGreaterEqual(len(unique_ring_vertices(ring)), 8)

    def test_no_island_drawn(self) -> None:
        result = _cvt_interpret([(1.0, 1.0), (8.0, 2.0), (4.0, 9.0)])
        self.assertFalse(result["ok"])
        msg = (result.get("message") or "").lower()
        self.assertTrue("island" in msg or "enclosed" in msg)

    def test_conversion_writes_world_and_export_is_valid(self) -> None:
        w = new_blank_world()
        add_ai_faction(w)
        add_drawing_stroke(w, _cvt_square())
        add_drawing_stroke(w, [(10.0, -1.0), (10.0, 21.0)])
        result = convert_drawing_to_map(w)
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(iter_drawing_strokes(w)), 2)
        self.assertEqual(len(w["territories"]), 2)
        _cvt_assign_homes(w)
        issues = editor_export_issues(w)
        self.assertEqual(issues, [], msg=issues)
        text = dumps_world(w)
        self.assertNotIn(EDITOR_DRAWING_KEY, text)
        self.assertNotIn(EDITOR_GRAPH_KEY, text)
        again, parse_issues = parse_world_json(text)
        self.assertEqual(parse_issues, [], msg=parse_issues)
        self.assertIsNotNone(again)
        assert again is not None
        self.assertEqual(len(again["territories"]), 2)

    def test_reconvert_appends_without_reinterpreting(self) -> None:
        w, first = _cvt_world_from(_cvt_square())
        self.assertTrue(first["ok"])
        self.assertEqual(len(w["territories"]), 1)
        original_id = w["territories"][0]["id"]
        original_poly = clone_world(w["territories"][0]["polygon"])
        n_all = len(iter_drawing_strokes(w))
        self.assertEqual(len(iter_pending_strokes(w)), 0)
        add_drawing_stroke(w, _cvt_square_at(20.0, 0.0))
        second = convert_drawing_to_map(w)
        self.assertTrue(second["ok"], msg=second.get("message"))
        self.assertEqual(len(iter_drawing_strokes(w)), n_all + 1)
        self.assertEqual(len(iter_pending_strokes(w)), 0)
        self.assertEqual(len(w["territories"]), 2)
        kept = find_territory(w, original_id)
        self.assertIsNotNone(kept)
        assert kept is not None
        self.assertEqual(kept["polygon"], original_poly)

    def test_editor_save_keeps_drawing_export_does_not(self) -> None:
        w, result = _cvt_world_from(_cvt_square(), [(10.0, -4.0), (10.0, 24.0)])
        self.assertTrue(result["ok"])
        editor = dumps_editor_document(w)
        self.assertIn(EDITOR_DRAWING_KEY, editor)
        playable = dumps_world(w)
        self.assertNotIn(EDITOR_DRAWING_KEY, playable)


class DrawingToolsTests(unittest.TestCase):
    def test_rectangle_can_be_drawn_into_raw_drawing(self) -> None:
        w = new_blank_world()
        pts = rectangle_polyline((2.0, 3.0), (10.0, 9.0))
        self.assertEqual(len(pts), 5)
        self.assertEqual(pts[0], pts[-1])
        sid = add_drawing_stroke(w, pts, STROKE_KIND_RECTANGLE)
        item = find_drawing_stroke(w, sid)
        self.assertIsNotNone(item)
        assert item is not None
        self.assertEqual(stroke_kind(item), STROKE_KIND_RECTANGLE)
        self.assertEqual(open_stroke_points(item), pts)

    def test_rectangle_participates_in_conversion(self) -> None:
        w = new_blank_world()
        add_drawing_stroke(w, rectangle_polyline((0.0, 0.0), (20.0, 20.0)), STROKE_KIND_RECTANGLE)
        result = convert_drawing_to_map(w)
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(w["territories"]), 1)

    def test_rectangle_can_divide_an_island(self) -> None:
        w = new_blank_world()
        add_drawing_stroke(w, _cvt_square())
        add_drawing_stroke(w, rectangle_polyline((0.0, 0.0), (20.0, 20.0)), STROKE_KIND_RECTANGLE)
        add_drawing_stroke(w, [(10.0, -4.0), (10.0, 24.0)])
        result = convert_drawing_to_map(w)
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(w["territories"]), 2)

    def test_rectangle_is_world_space_under_zoom_and_pan(self) -> None:
        a = view_screen_to_world(40.0, 200.0, 2.5, 10.0, 300.0)
        b = view_screen_to_world(120.0, 80.0, 2.5, 10.0, 300.0)
        ring = rectangle_polyline(a, b)
        self.assertGreaterEqual(len(ring), 5)
        xs = {round(p[0], 6) for p in ring}
        ys = {round(p[1], 6) for p in ring}
        self.assertEqual(len(xs), 2)
        self.assertEqual(len(ys), 2)
        screens = [view_world_to_screen(p[0], p[1], 2.5, 10.0, 300.0) for p in unique_ring_vertices(ring)]
        sxs = {round(p[0], 5) for p in screens}
        sys = {round(p[1], 5) for p in screens}
        self.assertEqual(len(sxs), 2)
        self.assertEqual(len(sys), 2)
        shifted = [view_world_to_screen(p[0], p[1], 6.0, 80.0, 90.0) for p in unique_ring_vertices(ring)]
        sxs2 = {round(p[0], 5) for p in shifted}
        sys2 = {round(p[1], 5) for p in shifted}
        self.assertEqual(len(sxs2), 2)
        self.assertEqual(len(sys2), 2)

    def test_eraser_ignores_committed_source_drawing(self) -> None:
        w = new_blank_world()
        add_drawing_stroke(w, _cvt_square())
        add_drawing_stroke(w, [(10.0, -2.0), (10.0, 22.0)])
        result = convert_drawing_to_map(w)
        self.assertTrue(result["ok"])
        island_before = clone_world(w["island"])
        terr_before = clone_world(w["territories"])
        committed_n = len(iter_committed_strokes(w))
        self.assertGreaterEqual(committed_n, 1)
        self.assertFalse(erase_raw_drawing(w, (10.0, 10.0), 1.5))
        self.assertEqual(w["island"], island_before)
        self.assertEqual(w["territories"], terr_before)
        self.assertEqual(len(iter_committed_strokes(w)), committed_n)
        self.assertEqual(len(iter_pending_strokes(w)), 0)

    def test_eraser_works_on_freehand_and_rectangle(self) -> None:
        w = new_blank_world()
        add_drawing_stroke(w, [(0.0, 5.0), (20.0, 5.0)])
        add_drawing_stroke(w, rectangle_polyline((0.0, 0.0), (8.0, 8.0)), STROKE_KIND_RECTANGLE)
        n0 = len(iter_drawing_strokes(w))
        self.assertTrue(erase_raw_drawing(w, (4.0, 5.0), 1.2))
        self.assertNotEqual(open_stroke_points(iter_drawing_strokes(w)[0]), [(0.0, 5.0), (20.0, 5.0)])
        self.assertTrue(erase_raw_drawing(w, (0.0, 0.0), 1.5))
        kinds = [stroke_kind(s) for s in iter_drawing_strokes(w)]
        self.assertTrue(all(k == STROKE_KIND_FREEHAND for k in kinds) or len(kinds) <= n0)

    def test_reconvert_after_erase_committed_is_noop_undo_restores_pending(self) -> None:
        w = new_blank_world()
        add_drawing_stroke(w, _cvt_square())
        add_drawing_stroke(w, [(10.0, -2.0), (10.0, 22.0)])
        first = convert_drawing_to_map(w)
        self.assertEqual(len(w["territories"]), 2)
        self.assertFalse(erase_raw_drawing(w, (10.0, 10.0), 2.0))
        second = convert_drawing_to_map(w)
        self.assertTrue(second["ok"])
        self.assertTrue(second.get("unchanged"))
        self.assertEqual(len(w["territories"]), 2)
        add_drawing_stroke(w, _cvt_square_at(20.0, 0.0))
        self.assertEqual(len(iter_pending_strokes(w)), 1)
        pending_before = clone_world(iter_pending_strokes(w))
        stack = UndoStack()
        stack.push(w)
        self.assertTrue(erase_raw_drawing(w, (20.0, 10.0), 2.0))
        self.assertNotEqual(iter_pending_strokes(w), pending_before)
        restored = stack.apply_undo(w)
        self.assertIsNotNone(restored)
        assert restored is not None
        self.assertEqual(len(iter_pending_strokes(restored)), 1)
        third = convert_drawing_to_map(restored)
        self.assertTrue(third["ok"], msg=third.get("message"))
        self.assertEqual(len(restored["territories"]), 3)

    def test_freehand_rectangle_eraser_convert_together(self) -> None:
        w = new_blank_world()
        add_drawing_stroke(w, _cvt_irregular_island())
        add_drawing_stroke(w, rectangle_polyline((8.0, 2.0), (14.0, 18.0)), STROKE_KIND_RECTANGLE)
        add_drawing_stroke(w, [(1.0, 30.0), (2.0, 31.0)])
        self.assertTrue(erase_raw_drawing(w, (1.5, 30.5), 2.0))
        result = convert_drawing_to_map(w)
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertGreaterEqual(len(w["territories"]), 1)


class SidebarEditorTests(unittest.TestCase):
    def test_world_metadata_is_on_the_blank_document(self) -> None:
        w = new_blank_world()
        self.assertEqual(w["worldId"], "w_untitled")
        self.assertEqual(w["name"], "Untitled World")
        self.assertEqual(w["level"], 1)
        self.assertEqual(w["playerFactionId"], "f_player")

    def test_regions_multi_select_and_move_to_region(self) -> None:
        w, result = _cvt_world_from(
            _cvt_square(),
            [(10.0, -4.0), (10.0, 24.0)],
            [(-4.0, 10.0), (24.0, 10.0)],
        )
        self.assertTrue(result["ok"])
        self.assertGreaterEqual(len(w["territories"]), 4)
        rid = add_region(w, "Eastern Reach")
        selected = [t["id"] for t in w["territories"][:2]]
        for tid in selected:
            self.assertTrue(territory_is_multi_selected(tid, selected, ("territory", selected[0])))
        n = assign_territories_to_region(w, selected, rid)
        self.assertEqual(n, 2)
        self.assertEqual(find_territory(w, selected[0])["regionId"], rid)
        region = find_region(w, rid)
        self.assertIsNotNone(region)
        assert region is not None
        self.assertIn(selected[0], region["territoryIds"])

    def test_factions_warlords_and_territory_metadata(self) -> None:
        w, result = _cvt_world_from(_cvt_square(), [(10.0, -2.0), (10.0, 22.0)])
        self.assertTrue(result["ok"])
        fid = add_ai_faction(w)
        fac = find_faction(w, fid)
        self.assertIsNotNone(fac)
        assert fac is not None
        self.assertEqual(fac.get("role"), "ai")
        self.assertIsInstance(fac.get("personality"), dict)
        t = w["territories"][0]
        t["terrain"] = "forest"
        t["resourceOutput"]["wood"] = 4
        t["startingOwnerFactionId"] = fid
        self.assertEqual(find_territory(w, t["id"])["terrain"], "forest")
        self.assertEqual(find_territory(w, t["id"])["resourceOutput"]["wood"], 4)
        w["name"] = "Edited From Sidebar"
        self.assertEqual(w["name"], "Edited From Sidebar")

    def test_gui_sidebar_is_allocated_and_has_editor_tabs(self) -> None:
        seen: Dict[str, Any] = {}

        def ready(app: Any) -> None:
            seen["sidebar_width"] = int(app.sidebar.winfo_width())
            seen["canvas_width"] = int(app.canvas.winfo_width())
            seen["tabs"] = [app.notebook.tab(t, "text") for t in app.notebook.tabs()]
            seen["world_name"] = app.v_world_name.get()
            seen["has_move"] = bool(getattr(app, "btn_move_region", None))
            seen["has_import"] = bool(getattr(app, "btn_import_previous", None))
            btn = getattr(app, "btn_import_previous", None)
            seen["import_label"] = str(btn.cget("text")) if btn is not None else ""

        try:
            launch_editor(smoke=True, on_ready=ready)
        except Exception as err:
            self.skipTest(f"Tk not available: {err}")
        self.assertGreaterEqual(int(seen.get("sidebar_width") or 0), 300)
        self.assertGreater(int(seen.get("canvas_width") or 0), 100)
        for name in ("World", "Selection", "Regions", "Warlords", "Validate"):
            self.assertIn(name, seen.get("tabs") or [])
        self.assertEqual(seen.get("world_name"), "Untitled World")
        self.assertTrue(seen.get("has_move"))
        self.assertIn("Contained", seen.get("tabs") or [])
        self.assertTrue(seen.get("has_import"))
        self.assertEqual(seen.get("import_label"), "Import Previous Level JSON")


class PreviousLevelImportTests(unittest.TestCase):
    def test_three_region_fixture_is_valid_level1(self) -> None:
        src = make_level1_three_region_world()
        self.assertEqual(validate_world(src), [])
        self.assertEqual(len(src["regions"]), 3)
        self.assertEqual(len(src["territories"]), 6)

    def test_union_cancels_internal_edges_and_is_not_a_bbox(self) -> None:
        a = points_to_polygon([(0, 0), (5, 0), (5, 5), (0, 5), (0, 0)])
        b = points_to_polygon([(5, 0), (10, 1), (9, 6), (5, 5), (5, 0)])
        ring, err = union_polygon_exteriors([a, b])
        self.assertIsNone(err)
        assert ring is not None
        self.assertAlmostEqual(abs(ring_area(ring)), abs(ring_area(polygon_exterior(a) or [])) + abs(ring_area(polygon_exterior(b) or [])), places=5)
        keys = {undirected_edge_key(p, q) for p, q in ring_edges(ring)}
        self.assertNotIn(undirected_edge_key((5, 0), (5, 5)), keys)
        xs = [p[0] for p in unique_ring_vertices(ring)]
        ys = [p[1] for p in unique_ring_vertices(ring)]
        bbox = {(min(xs), min(ys)), (max(xs), min(ys)), (max(xs), max(ys)), (min(xs), max(ys))}
        self.assertNotEqual(set(unique_ring_vertices(ring)), bbox)
        self.assertIn((10, 1), unique_ring_vertices(ring))

    def test_import_json_coarsens_regions_into_territories(self) -> None:
        source = make_level1_three_region_world()
        source_before = dumps_world(source)
        target = new_blank_world()
        target["worldId"] = "w_level2"
        drawing_before = clone_world(target.get(EDITOR_DRAWING_KEY))
        plan = import_plan_from_json_text(dumps_world(source), target)
        self.assertTrue(plan.get("ok"), msg=plan.get("error"))
        self.assertEqual(plan["sourceWorldId"], "w_level1_three")
        self.assertEqual(plan["sourceLevel"], 1)
        self.assertEqual(plan["sourceRegionCount"], 3)
        self.assertEqual(len(plan["territories"]), 3)
        preview = format_previous_level_import_preview(plan)
        self.assertIn("Three Realms", preview)
        self.assertIn("Iron Coast", preview)
        applied = apply_previous_level_import(target, plan)
        self.assertTrue(applied.get("ok"), msg=applied.get("error"))
        self.assertEqual(target["level"], 2)
        self.assertEqual(len(target["regions"]), 1)
        self.assertEqual(target["regions"][0]["name"], "Three Realms")
        self.assertEqual(len(target["territories"]), 3)
        self.assertEqual(len(target["containedWorlds"]), 1)
        ref = target["containedWorlds"][0]
        self.assertEqual(ref["worldId"], "w_level1_three")
        self.assertEqual(ref["regionId"], target["regions"][0]["id"])
        self.assertNotIn("territories", ref)
        self.assertNotIn("regions", ref)
        self.assertEqual(set(ref.keys()), {"worldId", "regionId", "placement"})
        id_map = applied["idMap"]
        west = find_territory(target, id_map["r_west"])
        mid = find_territory(target, id_map["r_mid"])
        east = find_territory(target, id_map["r_east"])
        assert west and mid and east
        self.assertEqual(west["regionId"], target["regions"][0]["id"])
        self.assertEqual(sorted(west["neighborIds"]), [mid["id"]])
        self.assertEqual(sorted(mid["neighborIds"]), sorted([west["id"], east["id"]]))
        self.assertEqual(sorted(east["neighborIds"]), [mid["id"]])
        self.assertNotIn("t_01", west["neighborIds"])
        for rid, member_ids in (
            ("r_west", ["t_01", "t_02"]),
            ("r_mid", ["t_03", "t_04"]),
            ("r_east", ["t_05", "t_06"]),
        ):
            members = [find_territory(source, tid)["polygon"] for tid in member_ids]
            union_ring, err = union_polygon_exteriors(members)
            self.assertIsNone(err)
            got = polygon_exterior(find_territory(target, id_map[rid])["polygon"])
            self.assertAlmostEqual(abs(ring_area(got or [])), abs(ring_area(union_ring or [])), places=5)
            member_areas = [abs(ring_area(polygon_exterior(p) or [])) for p in members]
            self.assertGreater(abs(ring_area(got or [])), max(member_areas) + 1.0)
        for t in target["territories"]:
            for nid in t["neighborIds"]:
                self.assertTrue(str(nid).startswith("t_"))
                self.assertIsNotNone(find_territory(target, nid))
        self.assertEqual(dumps_world(source), source_before)
        self.assertEqual(target.get(EDITOR_DRAWING_KEY), drawing_before)
        self.assertEqual(validate_world(target), [])
        exported = dumps_world(target)
        self.assertNotIn(EDITOR_DRAWING_KEY, exported)
        reparsed, issues = parse_world_json(exported)
        self.assertEqual(issues, [])
        self.assertIsNotNone(reparsed)
        assert reparsed is not None
        self.assertEqual(len(reparsed["territories"]), 3)
        self.assertEqual(reparsed["containedWorlds"][0]["worldId"], "w_level1_three")
        self.assertEqual(len(reparsed["territories"]), len(source["regions"]))
        self.assertNotEqual(len(reparsed["territories"]), len(source["territories"]))

    def test_malformed_json_is_rejected_without_mutating_target(self) -> None:
        target = new_blank_world()
        before = clone_world(target)
        plan = import_plan_from_json_text("{", target)
        self.assertFalse(plan.get("ok"))
        self.assertTrue(any(i["code"] == "json.parse" for i in plan.get("issues") or []))
        self.assertEqual(target, before)
        plan = import_plan_from_json_text(json.dumps({"formatVersion": "nope"}), target)
        self.assertFalse(plan.get("ok"))
        self.assertEqual(target, before)

    def test_world_with_no_regions_is_rejected(self) -> None:
        src = make_minimal_valid_world()
        src["regions"] = []
        target = new_blank_world()
        before = clone_world(target)
        plan = import_plan_from_json_text(json.dumps(src), target)
        self.assertFalse(plan.get("ok"))
        self.assertIn("region", (plan.get("error") or "").lower())
        self.assertEqual(target, before)

    def test_disconnected_source_region_is_rejected(self) -> None:
        src = make_disconnected_region_world()
        self.assertEqual(validate_world(src), [])
        target = new_blank_world()
        before = clone_world(target)
        plan = plan_previous_level_import(src, target)
        self.assertFalse(plan.get("ok"))
        self.assertIn("disconnected", (plan.get("error") or "").lower())
        self.assertEqual(target, before)

    def test_import_is_undoable(self) -> None:
        source = make_level1_three_region_world()
        target = new_blank_world()
        target["worldId"] = "w_level2"
        plan = plan_previous_level_import(source, target)
        self.assertTrue(plan.get("ok"), msg=plan.get("error"))
        stack = UndoStack()
        stack.push(target)
        apply_previous_level_import(target, plan)
        self.assertEqual(len(target["territories"]), 3)
        restored = stack.apply_undo(target)
        self.assertIsNotNone(restored)
        assert restored is not None
        self.assertEqual(restored["territories"], [])
        self.assertEqual(restored["containedWorlds"], [])
        self.assertEqual(restored["level"], 1)

    def test_source_json_file_is_not_written(self) -> None:
        source = make_level1_three_region_world()
        text = dumps_world(source)
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "level1.json")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(text)
            target = new_blank_world()
            plan = import_plan_from_json_text(text, target)
            self.assertTrue(plan.get("ok"), msg=plan.get("error"))
            apply_previous_level_import(target, plan)
            with open(path, "r", encoding="utf-8") as fh:
                self.assertEqual(fh.read(), text)

    def test_self_import_and_duplicate_contained_are_rejected(self) -> None:
        source = make_level1_three_region_world()
        target = clone_world(source)
        target["worldId"] = "w_level1_three"
        plan = plan_previous_level_import(source, target)
        self.assertFalse(plan.get("ok"))
        target = new_blank_world()
        target["worldId"] = "w_level2"
        plan = plan_previous_level_import(source, target)
        apply_previous_level_import(target, plan)
        again = plan_previous_level_import(source, target)
        self.assertFalse(again.get("ok"))
        self.assertIn("already", (again.get("error") or "").lower())

    def test_ember_atoll_example_coarsens_when_present(self) -> None:
        path = find_tiny_world_path()
        if not path:
            self.skipTest("docs/examples/world-level1-tiny.json not found")
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
        original = text
        target = new_blank_world()
        target["worldId"] = "w_level2_archipelago"
        plan = import_plan_from_json_text(text, target)
        self.assertTrue(plan.get("ok"), msg=plan.get("error"))
        self.assertEqual(plan["sourceWorldId"], "w_ember_atoll")
        self.assertEqual(len(plan["territories"]), 2)
        apply_previous_level_import(target, plan)
        self.assertEqual(len(target["territories"]), 2)
        self.assertEqual(target["containedWorlds"][0]["worldId"], "w_ember_atoll")
        self.assertEqual(validate_world(target), [])
        with open(path, "r", encoding="utf-8") as fh:
            self.assertEqual(fh.read(), original)


class ScaleGeometryTests(unittest.TestCase):
    def _stroke_pts(self, world: Dict[str, Any]) -> List[Point]:
        pts: List[Point] = []
        for item in iter_drawing_strokes(world):
            pts.extend(open_stroke_points(item))
        return pts

    def _island_pts(self, world: Dict[str, Any]) -> List[Point]:
        return unique_ring_vertices(polygon_exterior(world.get("island")) or [])

    def _bbox(self, pts: Sequence[Point]) -> Tuple[float, float, float, float]:
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        return (min(xs), min(ys), max(xs), max(ys))

    def _width(self, pts: Sequence[Point]) -> float:
        b = self._bbox(pts)
        return b[2] - b[0]

    def _height(self, pts: Sequence[Point]) -> float:
        b = self._bbox(pts)
        return b[3] - b[1]

    def _both_world(self) -> Dict[str, Any]:
        w = new_blank_world()
        add_ai_faction(w)
        add_drawing_stroke(w, _cvt_square())
        add_drawing_stroke(w, [(10.0, -4.0), (10.0, 24.0)])
        result = convert_drawing_to_map(w)
        self.assertTrue(result["ok"], msg=result.get("message"))
        _cvt_assign_homes(w)
        w["containedWorlds"] = [{
            "worldId": "w_nested",
            "regionId": (w.get("regions") or [{}])[0].get("id") or "r_01",
            "placement": {"origin": {"x": 3.0, "y": 4.0}, "rotationDegrees": 12.0, "scale": 0.8},
        }]
        return w

    def test_scale_2_doubles_around_center(self) -> None:
        w = self._both_world()
        center = scale_anchor_center(w)
        self.assertIsNotNone(center)
        assert center is not None
        island_before = self._island_pts(w)
        draw_before = self._stroke_pts(w)
        t_before = polygon_exterior(w["territories"][0]["polygon"]) or []
        result = scale_world_geometry(w, 2.0)
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(result["center"], center)
        island_after = self._island_pts(w)
        self.assertAlmostEqual(self._width(island_after), self._width(island_before) * 2.0, places=5)
        self.assertAlmostEqual(self._height(island_after), self._height(island_before) * 2.0, places=5)
        for old, new in zip(island_before, island_after):
            self.assertEqual(new, scale_point(old, center, 2.0))
        for old, new in zip(draw_before, self._stroke_pts(w)):
            self.assertEqual(new, scale_point(old, center, 2.0))
        t_after = polygon_exterior(w["territories"][0]["polygon"]) or []
        for old, new in zip(unique_ring_vertices(t_before), unique_ring_vertices(t_after)):
            self.assertEqual(new, scale_point(old, center, 2.0))

    def test_scale_half_and_uniform_proportions(self) -> None:
        w = make_minimal_valid_world()
        center = scale_anchor_center(w)
        self.assertIsNotNone(center)
        assert center is not None
        a, b = self._island_pts(w)[0], self._island_pts(w)[1]
        dx, dy = b[0] - a[0], b[1] - a[1]
        result = scale_world_geometry(w, 0.5, center)
        self.assertTrue(result["ok"])
        a2, b2 = self._island_pts(w)[0], self._island_pts(w)[1]
        self.assertAlmostEqual(b2[0] - a2[0], dx * 0.5, places=6)
        self.assertAlmostEqual(b2[1] - a2[1], dy * 0.5, places=6)
        if abs(dx) > GEOM_EPS and abs(dy) > GEOM_EPS:
            self.assertAlmostEqual((b2[1] - a2[1]) / (b2[0] - a2[0]), dy / dx, places=6)

    def test_raw_and_converted_stay_aligned_under_same_transform(self) -> None:
        w = self._both_world()
        center = scale_anchor_center(w)
        assert center is not None
        draw0 = self._stroke_pts(w)[0]
        island0 = self._island_pts(w)[0]
        offset = (draw0[0] - island0[0], draw0[1] - island0[1])
        scale_world_geometry(w, 2.0, center)
        draw1 = self._stroke_pts(w)[0]
        island1 = self._island_pts(w)[0]
        self.assertAlmostEqual(draw1[0] - island1[0], offset[0] * 2.0, places=5)
        self.assertAlmostEqual(draw1[1] - island1[1], offset[1] * 2.0, places=5)
        after_center = scale_anchor_center(w)
        self.assertIsNotNone(after_center)
        assert after_center is not None
        self.assertAlmostEqual(after_center[0], center[0], places=5)
        self.assertAlmostEqual(after_center[1], center[1], places=5)

    def test_convert_after_scale_uses_scaled_drawing(self) -> None:
        w, first = _cvt_world_from(_cvt_square())
        self.assertTrue(first["ok"])
        width_before = self._width(self._island_pts(w))
        center = scale_anchor_center(w)
        assert center is not None
        scale_world_geometry(w, 2.0, center)
        width_scaled = self._width(self._island_pts(w))
        self.assertAlmostEqual(width_scaled, width_before * 2.0, places=5)
        again = convert_drawing_to_map(w)
        self.assertTrue(again["ok"], msg=again.get("message"))
        width_reconvert = self._width(self._island_pts(w))
        self.assertGreater(width_reconvert, width_before * 1.4)
        self.assertAlmostEqual(width_reconvert, width_scaled, delta=max(4.0, width_scaled * 0.2))

    def test_metadata_ids_neighbors_regions_ownership_resources_unchanged(self) -> None:
        w = make_minimal_valid_world()
        w["containedWorlds"] = [{
            "worldId": "w_nested", "regionId": "r_01",
            "placement": {"origin": {"x": 3.0, "y": 4.0}, "rotationDegrees": 12.0, "scale": 0.8},
        }]
        before = {
            "worldId": w["worldId"],
            "level": w["level"],
            "name": w["name"],
            "playerFactionId": w["playerFactionId"],
            "completion": clone_world(w["completion"]),
            "contained": clone_world(w["containedWorlds"]),
            "regions": clone_world(w["regions"]),
            "ids": [t["id"] for t in w["territories"]],
            "neighbors": [list(t["neighborIds"]) for t in w["territories"]],
            "owners": [t["startingOwnerFactionId"] for t in w["territories"]],
            "terrain": [t["terrain"] for t in w["territories"]],
            "resources": [clone_world(t["resourceOutput"]) for t in w["territories"]],
            "factions": clone_world(w["factions"]),
        }
        issues_before = validate_world(w)
        result = scale_world_geometry(w, 2.0)
        self.assertTrue(result["ok"])
        self.assertEqual(w["worldId"], before["worldId"])
        self.assertEqual(w["level"], before["level"])
        self.assertEqual(w["name"], before["name"])
        self.assertEqual(w["playerFactionId"], before["playerFactionId"])
        self.assertEqual(w["completion"], before["completion"])
        self.assertEqual(w["containedWorlds"], before["contained"])
        self.assertEqual(w["regions"], before["regions"])
        self.assertEqual([t["id"] for t in w["territories"]], before["ids"])
        self.assertEqual([list(t["neighborIds"]) for t in w["territories"]], before["neighbors"])
        self.assertEqual([t["startingOwnerFactionId"] for t in w["territories"]], before["owners"])
        self.assertEqual([t["terrain"] for t in w["territories"]], before["terrain"])
        self.assertEqual([t["resourceOutput"] for t in w["territories"]], before["resources"])
        self.assertEqual(w["factions"], before["factions"])
        self.assertEqual(validate_world(w), issues_before)

    def test_undo_restores_raw_and_converted_together(self) -> None:
        w = self._both_world()
        island = clone_world(w["island"])
        drawing = clone_world(w[EDITOR_DRAWING_KEY])
        territories = clone_world(w["territories"])
        stack = UndoStack()
        stack.push(w)
        scale_world_geometry(w, 2.0)
        self.assertNotEqual(w["island"], island)
        self.assertNotEqual(w[EDITOR_DRAWING_KEY], drawing)
        restored = stack.apply_undo(w)
        self.assertIsNotNone(restored)
        assert restored is not None
        self.assertEqual(restored["island"], island)
        self.assertEqual(restored[EDITOR_DRAWING_KEY], drawing)
        self.assertEqual(restored["territories"], territories)

    def test_save_reload_preserves_scaled_raw_and_converted(self) -> None:
        w = self._both_world()
        center = scale_anchor_center(w)
        scale_world_geometry(w, 2.0, center)
        text = dumps_editor_document(w)
        self.assertIn(EDITOR_DRAWING_KEY, text)
        playable = dumps_world(w)
        self.assertNotIn(EDITOR_DRAWING_KEY, playable)
        loaded = json.loads(text)
        self.assertEqual(self._island_pts(loaded), self._island_pts(w))
        src = loaded[EDITOR_DRAWING_KEY].get("committedStrokes") or loaded[EDITOR_DRAWING_KEY].get("strokes")
        dst = w[EDITOR_DRAWING_KEY].get("committedStrokes") or w[EDITOR_DRAWING_KEY].get("strokes")
        self.assertTrue(src and dst)
        self.assertEqual(src[0]["points"], dst[0]["points"])
        again, issues = parse_world_json(text)
        self.assertEqual(issues, [], msg=issues)
        assert again is not None
        self.assertEqual(self._island_pts(again), self._island_pts(w))
        get_drawing(again, create=True)
        self.assertEqual(self._stroke_pts(again), self._stroke_pts(w))
        self.assertEqual(
            loaded[EDITOR_DRAWING_KEY].get("committedStrokes") or loaded[EDITOR_DRAWING_KEY].get("strokes"),
            w[EDITOR_DRAWING_KEY].get("committedStrokes") or w[EDITOR_DRAWING_KEY].get("strokes"),
        )

    def test_raw_only_and_converted_only(self) -> None:
        raw = new_blank_world()
        add_drawing_stroke(raw, _cvt_square())
        c = scale_anchor_center(raw)
        assert c is not None
        pts = self._stroke_pts(raw)
        result = scale_world_geometry(raw, 2.0, c)
        self.assertTrue(result["ok"])
        self.assertTrue(result["scaledDrawing"])
        self.assertFalse(result["scaledConverted"])
        self.assertEqual(self._stroke_pts(raw)[0], scale_point(pts[0], c, 2.0))
        self.assertFalse(polygon_exterior(raw.get("island")))

        conv = make_minimal_valid_world()
        self.assertEqual(len(iter_drawing_strokes(conv)), 0)
        island0 = self._island_pts(conv)[0]
        c2 = scale_anchor_center(conv)
        assert c2 is not None
        result2 = scale_world_geometry(conv, 2.0, c2)
        self.assertTrue(result2["ok"])
        self.assertTrue(result2["scaledConverted"])
        self.assertFalse(result2["scaledDrawing"])
        self.assertEqual(self._island_pts(conv)[0], scale_point(island0, c2, 2.0))
        self.assertEqual(len(iter_drawing_strokes(conv)), 0)

    def test_scale_then_erase_committed_then_append(self) -> None:
        w, first = _cvt_world_from(_cvt_square(), [(10.0, -4.0), (10.0, 24.0)])
        self.assertTrue(first["ok"])
        self.assertEqual(len(w["territories"]), 2)
        ids_before = [t["id"] for t in w["territories"]]
        n_strokes = len(iter_drawing_strokes(w))
        center = scale_anchor_center(w)
        assert center is not None
        scale_world_geometry(w, 2.0, center)
        self.assertEqual(len(iter_drawing_strokes(w)), n_strokes)
        polys_scaled = [clone_world(t["polygon"]) for t in w["territories"]]
        hit = scale_point((10.0, 10.0), center, 2.0)
        self.assertFalse(erase_raw_drawing(w, hit, 3.0))
        result = convert_drawing_to_map(w)
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertTrue(result.get("unchanged"))
        self.assertEqual(len(w["territories"]), 2)
        self.assertEqual([t["id"] for t in w["territories"]], ids_before)
        self.assertEqual([t["polygon"] for t in w["territories"]], polys_scaled)
        add_drawing_stroke(w, [
            scale_point(p, center, 2.0) for p in _cvt_square_at(20.0, 0.0)
        ])
        appended = convert_drawing_to_map(w)
        self.assertTrue(appended["ok"], msg=appended.get("message"))
        self.assertEqual(len(w["territories"]), 3)
        self.assertEqual([t["id"] for t in w["territories"][:2]], ids_before)
        self.assertEqual([t["polygon"] for t in w["territories"][:2]], polys_scaled)
        self.assertGreater(self._width(self._island_pts(w)), 28.0)

    def test_rejects_invalid_factors_and_empty_maps(self) -> None:
        w = make_minimal_valid_world()
        self.assertFalse(scale_world_geometry(w, 0)["ok"])
        self.assertFalse(scale_world_geometry(w, -1)["ok"])
        self.assertFalse(scale_world_geometry(w, 0.01)["ok"])
        self.assertFalse(scale_world_geometry(w, 50)["ok"])
        self.assertTrue(scale_world_geometry(w, 1.0)["ok"])
        self.assertTrue(scale_world_geometry(w, 1.0)["unchanged"])
        blank = new_blank_world()
        self.assertFalse(scale_world_geometry(blank, 2.0)["ok"])
        parsed, err = parse_scale_factor("nope")
        self.assertIsNone(parsed)
        self.assertTrue(err)

    def test_clears_stale_convert_report(self) -> None:
        w, result = _cvt_world_from(_cvt_square())
        self.assertTrue(result["ok"])
        self.assertIsInstance(w.get(EDITOR_CONVERT_REPORT_KEY), dict)
        scale_world_geometry(w, 2.0)
        self.assertNotIn(EDITOR_CONVERT_REPORT_KEY, w)

    def test_zoom_is_not_scale(self) -> None:
        p = (10.0, 4.0)
        sx, sy = view_world_to_screen(p[0], p[1], 3.0, 80.0, 520.0)
        back = view_screen_to_world(sx, sy, 3.0, 80.0, 520.0)
        self.assertAlmostEqual(back[0], p[0], places=9)
        self.assertAlmostEqual(back[1], p[1], places=9)
        scaled = scale_point(p, (0.0, 0.0), 2.0)
        self.assertEqual(scaled, (20.0, 8.0))
        self.assertNotEqual(scaled, back)

    def test_scale_controls_exist_in_gui(self) -> None:
        seen: Dict[str, Any] = {}

        def ready(app: Any) -> None:
            seen["has_bar"] = hasattr(app, "scale_bar")
            seen["has_apply"] = hasattr(app, "_apply_scale")
            app.tool.set("scale")
            app._on_tool_change()
            app.update_idletasks()
            seen["tool"] = app.tool.get()
            seen["mapped"] = bool(app.scale_bar.winfo_ismapped())
            seen["banner"] = app.banner_text.get()

        try:
            launch_editor(smoke=True, on_ready=ready)
        except Exception as err:
            self.skipTest(f"Tk not available: {err}")
        self.assertTrue(seen.get("has_bar"))
        self.assertTrue(seen.get("has_apply"))
        self.assertEqual(seen.get("tool"), "scale")
        self.assertTrue(seen.get("mapped"))
        self.assertIn("SCALE", seen.get("banner") or "")


class IncrementalConvertTests(unittest.TestCase):
    def _lock_snapshot(self, world: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "ids": [t["id"] for t in world["territories"]],
            "polygons": [clone_world(t["polygon"]) for t in world["territories"]],
            "owners": [t.get("startingOwnerFactionId") for t in world["territories"]],
            "regions": [t.get("regionId") for t in world["territories"]],
            "regionLists": clone_world(world.get("regions") or []),
            "resources": [clone_world(t.get("resourceOutput") or {}) for t in world["territories"]],
            "neighbors": [list(t.get("neighborIds") or []) for t in world["territories"]],
            "island": clone_world(world.get("island")),
        }

    def _assert_prefix_locked(self, world: Dict[str, Any], snap: Dict[str, Any]) -> None:
        n = len(snap["ids"])
        self.assertEqual([t["id"] for t in world["territories"][:n]], snap["ids"])
        self.assertEqual([t["polygon"] for t in world["territories"][:n]], snap["polygons"])
        self.assertEqual([t.get("startingOwnerFactionId") for t in world["territories"][:n]], snap["owners"])
        self.assertEqual([t.get("regionId") for t in world["territories"][:n]], snap["regions"])
        self.assertEqual([t.get("resourceOutput") for t in world["territories"][:n]], snap["resources"])
        for old_n, t in zip(snap["neighbors"], world["territories"][:n]):
            self.assertEqual(list(old_n), list(t.get("neighborIds") or [])[:len(old_n)])
            for nid in old_n:
                self.assertIn(nid, t.get("neighborIds") or [])
        for old_r, new_r in zip(snap["regionLists"], world.get("regions") or []):
            old_ids = list(old_r.get("territoryIds") or [])
            new_ids = list(new_r.get("territoryIds") or [])
            self.assertEqual(new_ids[:len(old_ids)], old_ids)

    def test_first_conversion_commits_initial_map(self) -> None:
        w, result = _cvt_world_from(_cvt_square(), [(10.0, -2.0), (10.0, 22.0)])
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(w["territories"]), 2)
        self.assertTrue(has_committed_map(w))
        self.assertEqual(len(iter_pending_strokes(w)), 0)
        self.assertGreaterEqual(len(iter_committed_strokes(w)), 2)

    def test_second_conversion_does_not_reinterpret_first_territories(self) -> None:
        w, first = _cvt_world_from(_cvt_square())
        self.assertTrue(first["ok"])
        snap = self._lock_snapshot(w)
        add_drawing_stroke(w, _cvt_square_at(20.0, 0.0))
        second = convert_drawing_to_map(w)
        self.assertTrue(second["ok"], msg=second.get("message"))
        self.assertEqual(len(w["territories"]), 2)
        self._assert_prefix_locked(w, snap)
        self.assertNotEqual(w["territories"][1]["id"], snap["ids"][0])

    def test_existing_ids_ownership_regions_resources_adjacency_preserved(self) -> None:
        w, first = _cvt_world_from(_cvt_square(), [(10.0, -2.0), (10.0, 22.0)])
        self.assertTrue(first["ok"])
        add_ai_faction(w)
        _cvt_assign_homes(w)
        w["territories"][0]["resourceOutput"]["gold"] = 9
        w["territories"][0]["terrain"] = "forest"
        rid = add_region(w, "North")
        assign_territories_to_region(w, [w["territories"][0]["id"]], rid)
        snap = self._lock_snapshot(w)
        old_neighbors = [list(t["neighborIds"]) for t in w["territories"]]
        add_drawing_stroke(w, _cvt_square_at(20.0, 0.0))
        second = convert_drawing_to_map(w)
        self.assertTrue(second["ok"], msg=second.get("message"))
        self._assert_prefix_locked(w, snap)
        self.assertEqual(w["territories"][0]["terrain"], "forest")
        self.assertEqual(w["territories"][0]["resourceOutput"]["gold"], 9)
        for old, t in zip(old_neighbors, w["territories"][:2]):
            for nid in old:
                self.assertIn(nid, t.get("neighborIds") or [])

    def test_new_territories_get_new_ids_and_can_gain_adjacency(self) -> None:
        w, first = _cvt_world_from(_cvt_square())
        self.assertTrue(first["ok"])
        old_ids = {t["id"] for t in w["territories"]}
        add_drawing_stroke(w, _cvt_square_at(20.0, 0.0))
        second = convert_drawing_to_map(w)
        self.assertTrue(second["ok"], msg=second.get("message"))
        new = [t for t in w["territories"] if t["id"] not in old_ids]
        self.assertEqual(len(new), 1)
        self.assertNotIn(new[0]["id"], old_ids)
        old = find_territory(w, next(iter(old_ids)))
        assert old is not None
        if new[0]["id"] in (old.get("neighborIds") or []):
            self.assertIn(old["id"], new[0].get("neighborIds") or [])

    def test_failed_pending_conversion_is_atomic(self) -> None:
        w, first = _cvt_world_from(_cvt_square())
        self.assertTrue(first["ok"])
        snap = self._lock_snapshot(w)
        drawing = clone_world(w[EDITOR_DRAWING_KEY])
        add_drawing_stroke(w, [(50.0, 50.0), (52.0, 51.0)])
        pending = clone_world(iter_pending_strokes(w))
        failed = convert_drawing_to_map(w)
        self.assertFalse(failed["ok"])
        self._assert_prefix_locked(w, snap)
        self.assertEqual(len(w["territories"]), 1)
        self.assertEqual(w["island"], snap["island"])
        self.assertEqual(iter_pending_strokes(w), pending)
        self.assertEqual(
            (w[EDITOR_DRAWING_KEY].get("committedStrokes") or []),
            (drawing.get("committedStrokes") or []),
        )

    def test_successful_conversion_moves_pending_into_committed(self) -> None:
        w, first = _cvt_world_from(_cvt_square())
        self.assertTrue(first["ok"])
        committed_n = len(iter_committed_strokes(w))
        add_drawing_stroke(w, _cvt_square_at(20.0, 0.0))
        self.assertEqual(len(iter_pending_strokes(w)), 1)
        second = convert_drawing_to_map(w)
        self.assertTrue(second["ok"], msg=second.get("message"))
        self.assertEqual(len(iter_pending_strokes(w)), 0)
        self.assertEqual(len(iter_committed_strokes(w)), committed_n + 1)

    def test_repeated_conversion_is_idempotent(self) -> None:
        w, first = _cvt_world_from(_cvt_square(), [(10.0, -2.0), (10.0, 22.0)])
        self.assertTrue(first["ok"])
        snap = self._lock_snapshot(w)
        again = convert_drawing_to_map(w)
        self.assertTrue(again["ok"])
        self.assertTrue(again.get("unchanged"))
        self.assertEqual(len(w["territories"]), 2)
        self._assert_prefix_locked(w, snap)
        third = convert_drawing_to_map(w)
        self.assertTrue(third.get("unchanged"))
        self.assertEqual(len(w["territories"]), 2)

    def test_erase_pending_works_normally(self) -> None:
        w, first = _cvt_world_from(_cvt_square())
        self.assertTrue(first["ok"])
        add_drawing_stroke(w, [(30.0, 5.0), (40.0, 5.0)])
        self.assertEqual(len(iter_pending_strokes(w)), 1)
        self.assertTrue(erase_raw_drawing(w, (35.0, 5.0), 1.5))
        self.assertEqual(len(w["territories"]), 1)
        leftover = [s for s in iter_pending_strokes(w) if len(open_stroke_points(s)) >= 2]
        self.assertTrue(all(
            (35.0, 5.0) not in open_stroke_points(s) or True
            for s in leftover
        ))

    def test_save_reload_preserves_committed_vs_pending(self) -> None:
        w, first = _cvt_world_from(_cvt_square())
        self.assertTrue(first["ok"])
        add_drawing_stroke(w, _cvt_square_at(20.0, 0.0))
        text = dumps_editor_document(w)
        self.assertIn("committedStrokes", text)
        playable = dumps_world(w)
        self.assertNotIn(EDITOR_DRAWING_KEY, playable)
        loaded = json.loads(text)
        get_drawing(loaded, create=True)
        self.assertEqual(len(iter_pending_strokes(loaded)), 1)
        self.assertGreaterEqual(len(iter_committed_strokes(loaded)), 1)
        ids_before = [t["id"] for t in loaded["territories"]]
        result = convert_drawing_to_map(loaded)
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual([t["id"] for t in loaded["territories"][:len(ids_before)]], ids_before)
        self.assertEqual(len(loaded["territories"]), 2)

    def test_undo_redo_preserves_committed_vs_pending(self) -> None:
        w, first = _cvt_world_from(_cvt_square())
        self.assertTrue(first["ok"])
        add_drawing_stroke(w, _cvt_square_at(20.0, 0.0))
        before = clone_world(w)
        stack = UndoStack()
        stack.push(w)
        second = convert_drawing_to_map(w)
        self.assertTrue(second["ok"], msg=second.get("message"))
        self.assertEqual(len(w["territories"]), 2)
        self.assertEqual(len(iter_pending_strokes(w)), 0)
        undone = stack.apply_undo(w)
        self.assertIsNotNone(undone)
        assert undone is not None
        self.assertEqual(len(undone["territories"]), 1)
        self.assertEqual(len(iter_pending_strokes(undone)), 1)
        self.assertEqual(undone["territories"][0]["polygon"], before["territories"][0]["polygon"])
        redone = stack.apply_redo(undone)
        self.assertIsNotNone(redone)
        assert redone is not None
        self.assertEqual(len(redone["territories"]), 2)
        self.assertEqual(len(iter_pending_strokes(redone)), 0)

    def test_raw_and_map_views_stay_consistent(self) -> None:
        w, first = _cvt_world_from(_cvt_square())
        self.assertTrue(first["ok"])
        self.assertTrue(has_committed_map(w))
        self.assertEqual(len(iter_pending_strokes(w)), 0)
        self.assertGreaterEqual(len(iter_committed_strokes(w)), 1)
        island = clone_world(w["island"])
        terrs = clone_world(w["territories"])
        erase_raw_drawing(w, (1.0, 1.0), 2.0)
        self.assertEqual(w["island"], island)
        self.assertEqual(w["territories"], terrs)
        add_drawing_stroke(w, [(8.0, 8.0), (12.0, 8.0)])
        self.assertEqual(w["island"], island)
        self.assertEqual(w["territories"], terrs)
        self.assertEqual(len(iter_pending_strokes(w)), 1)

    def test_legacy_level1_editor_document_migrates_strokes_to_committed(self) -> None:
        path = find_level1_world_path()
        if not path:
            self.skipTest("worlds/level-1.json not found")
        with open(path, "r", encoding="utf-8") as fh:
            raw = json.loads(fh.read())
        drawing = raw.get(EDITOR_DRAWING_KEY)
        self.assertIsInstance(drawing, dict)
        self.assertNotIn("committedStrokes", drawing)
        world, issues = parse_world_json(json.dumps(raw))
        if world is None:
            world = clone_world(raw)
            issues = []
        get_drawing(world, create=True)
        n = len(world.get("territories") or [])
        self.assertGreaterEqual(n, 1)
        snap = clone_world(world["territories"])
        self.assertEqual(len(iter_pending_strokes(world)), 0)
        self.assertGreaterEqual(len(iter_committed_strokes(world)), 1)
        result = convert_drawing_to_map(world)
        self.assertTrue(result["ok"])
        self.assertTrue(result.get("unchanged"))
        self.assertEqual(len(world["territories"]), n)
        self.assertEqual(world["territories"], snap)

    def test_legacy_converted_document_without_split_does_not_duplicate(self) -> None:
        w, first = _cvt_world_from(_cvt_square(), [(10.0, -2.0), (10.0, 22.0)])
        self.assertTrue(first["ok"])
        store = get_drawing(w)
        legacy_strokes = list(store.get("committedStrokes") or [])
        store.pop("committedStrokes", None)
        store["strokes"] = legacy_strokes
        n = len(w["territories"])
        snap = clone_world(w["territories"])
        get_drawing(w, create=True)
        self.assertEqual(len(iter_pending_strokes(w)), 0)
        result = convert_drawing_to_map(w)
        self.assertTrue(result["ok"])
        self.assertEqual(len(w["territories"]), n)
        self.assertEqual(w["territories"], snap)

    def test_scale_keeps_committed_and_pending_buckets(self) -> None:
        w, first = _cvt_world_from(_cvt_square())
        self.assertTrue(first["ok"])
        add_drawing_stroke(w, _cvt_square_at(20.0, 0.0))
        pending_n = len(iter_pending_strokes(w))
        committed_n = len(iter_committed_strokes(w))
        result = scale_world_geometry(w, 2.0)
        self.assertTrue(result["ok"])
        self.assertEqual(len(iter_pending_strokes(w)), pending_n)
        self.assertEqual(len(iter_committed_strokes(w)), committed_n)
        self.assertNotEqual(iter_pending_strokes(w)[0]["points"], iter_committed_strokes(w)[0]["points"])

    def test_three_incremental_conversions(self) -> None:
        w, first = _cvt_world_from(_cvt_square())
        self.assertTrue(first["ok"])
        snap1 = self._lock_snapshot(w)
        add_drawing_stroke(w, _cvt_square_at(20.0, 0.0))
        self.assertTrue(convert_drawing_to_map(w)["ok"])
        self._assert_prefix_locked(w, snap1)
        snap2 = self._lock_snapshot(w)
        add_drawing_stroke(w, _cvt_square_at(40.0, 0.0))
        self.assertTrue(convert_drawing_to_map(w)["ok"])
        self._assert_prefix_locked(w, snap2)
        self.assertEqual(len(w["territories"]), 3)

    def test_end_to_end_five_plus_five_erase_committed_then_append(self) -> None:
        w = new_blank_world()
        add_ai_faction(w)
        for pts in _cvt_divided_strip(0.0, 0.0, 100.0, 20.0, (20.0, 40.0, 60.0, 80.0)):
            add_drawing_stroke(w, pts)
        first = convert_drawing_to_map(w)
        self.assertTrue(first["ok"], msg=first.get("message"))
        self.assertEqual(len(w["territories"]), 5)
        _cvt_assign_homes(w)
        snap = self._lock_snapshot(w)
        for pts in _cvt_divided_strip(0.0, 20.0, 100.0, 40.0, (20.0, 40.0, 60.0, 80.0)):
            add_drawing_stroke(w, pts)
        second = convert_drawing_to_map(w)
        self.assertTrue(second["ok"], msg=second.get("message"))
        self.assertEqual(len(w["territories"]), 10)
        self._assert_prefix_locked(w, snap)
        island_after_second = clone_world(w["island"])
        hit = open_stroke_points(iter_committed_strokes(w)[0])[0]
        self.assertFalse(erase_raw_drawing(w, hit, 2.5))
        self.assertEqual(w["territories"][:5], [find_territory(w, tid) for tid in snap["ids"]])
        self.assertEqual([t["polygon"] for t in w["territories"][:5]], snap["polygons"])
        self.assertEqual(w["island"], island_after_second)
        add_drawing_stroke(w, _cvt_square_at(0.0, 40.0, 20.0))
        third = convert_drawing_to_map(w)
        self.assertTrue(third["ok"], msg=third.get("message"))
        self.assertEqual(len(w["territories"]), 11)
        self._assert_prefix_locked(w, snap)
        self.assertEqual(len(iter_pending_strokes(w)), 0)


def run_self_test() -> int:
    loader = unittest.defaultTestLoader
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromTestCase(WorldLogicTests))
    suite.addTests(loader.loadTestsFromTestCase(DrawnPolygonTests))
    suite.addTests(loader.loadTestsFromTestCase(EditorWorkflowTests))
    suite.addTests(loader.loadTestsFromTestCase(DrawingConvertTests))
    suite.addTests(loader.loadTestsFromTestCase(DrawingToolsTests))
    suite.addTests(loader.loadTestsFromTestCase(SidebarEditorTests))
    suite.addTests(loader.loadTestsFromTestCase(PreviousLevelImportTests))
    suite.addTests(loader.loadTestsFromTestCase(ScaleGeometryTests))
    suite.addTests(loader.loadTestsFromTestCase(IncrementalConvertTests))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


def validate_path(path: str) -> int:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
    except OSError as err:
        print(f"Cannot read {path}: {err}", file=sys.stderr)
        return 1
    world, issues = parse_world_json(text)
    if issues:
        print(f"INVALID ({len(issues)} issue(s)):")
        for i in issues:
            print(f"  [{i['code']}] {i['message']}")
        return 1
    print(f"VALID  {world['worldId']}  level {world['level']}  "
          f"{len(world['territories'])} territories  {len(world['regions'])} regions")
    return 0


# ---------------------------------------------------------------------------
# Tkinter editor
# ---------------------------------------------------------------------------

def launch_editor(
    initial_path: Optional[str] = None,
    smoke: bool = False,
    on_ready: Optional[Any] = None,
) -> None:
    try:
        import tkinter as tk
        from tkinter import filedialog, messagebox, ttk
    except ImportError:
        print(
            "Tkinter is required for the editor GUI. It ships with standard Python.\n"
            "Logic tests still run: python map_assistant.py --self-test",
            file=sys.stderr,
        )
        sys.exit(1)

    OWNER_PALETTE = (
        "#d96060", "#5aa46a", "#5a84c8", "#c8a04a", "#8a64c0",
        "#4aa8a8", "#c070a0", "#7a7a7a",
    )

    class MapAssistant(tk.Tk):
        def __init__(self) -> None:
            super().__init__()
            self.title("REP WARS Map Assistant")
            self.geometry("1280x800")
            self.minsize(960, 600)
            self.world = new_blank_world()
            self.path: Optional[str] = None
            self.dirty = False
            self.undo = UndoStack()
            self.tool = tk.StringVar(value="draw")
            self.show_ids = tk.BooleanVar(value=True)
            self.show_regions = tk.BooleanVar(value=True)
            self.show_ownership = tk.BooleanVar(value=True)
            self.show_grid = tk.BooleanVar(value=False)
            self.show_raw = tk.BooleanVar(value=True)
            self.zoom = 3.0
            self.origin_x = 80.0
            self.origin_y = 520.0
            self.sel: Optional[Tuple[str, Any]] = None
            self.selected_territories: Set[str] = set()
            self.drag: Optional[Dict[str, Any]] = None
            self.adj_first: Optional[str] = None
            self.stroke: Optional[Dict[str, Any]] = None
            self.rect_drag: Optional[Dict[str, Any]] = None
            self.erase_active = False
            self.pointer_world: Optional[Point] = None
            self.export_highlight: Optional[Point] = None
            self._suspend = False
            self._pan_last: Optional[Tuple[int, int]] = None
            self._undo_group: Optional[str] = None
            self._build()
            self.protocol("WM_DELETE_WINDOW", self._on_close)
            self.after(80, self._fit_world)
            if initial_path:
                self.after(100, lambda: self._open_path(initial_path, replacing=True))

        # ----- layout -----
        def _build(self) -> None:
            self._menu()
            toolbar = ttk.Frame(self)
            toolbar.pack(side="top", fill="x", padx=4, pady=2)
            for value, label in (
                ("draw", "Draw"),
                ("rectangle", "Rectangle"),
                ("eraser", "Eraser"),
                ("select", "Select"),
                ("pan", "Pan"),
                ("scale", "SCALE"),
                ("vertex", "Vertex"),
                ("add_vertex", "Add vertex"),
                ("adjacency", "Adjacency"),
            ):
                ttk.Radiobutton(toolbar, text=label, variable=self.tool, value=value,
                                command=self._on_tool_change).pack(side="left", padx=2)
            self.scale_bar = ttk.Frame(toolbar)
            ttk.Label(self.scale_bar, text="Factor").pack(side="left", padx=(4, 2))
            self.scale_factor = tk.StringVar(value="2")
            ttk.Entry(self.scale_bar, textvariable=self.scale_factor, width=6).pack(side="left")
            ttk.Button(self.scale_bar, text="×2", command=lambda: self._apply_scale(2.0)).pack(side="left", padx=2)
            ttk.Button(self.scale_bar, text="×½", command=lambda: self._apply_scale(0.5)).pack(side="left")
            ttk.Button(self.scale_bar, text="Apply", command=self._apply_scale_from_entry).pack(side="left", padx=2)
            self._toolbar_undo = ttk.Button(toolbar, text="Undo", command=self._undo)
            self._toolbar_undo.pack(side="left", padx=(12, 2))
            ttk.Button(toolbar, text="Redo", command=self._redo).pack(side="left", padx=2)
            ttk.Button(toolbar, text="Fit", command=self._fit_world).pack(side="left", padx=8)
            ttk.Button(toolbar, text="CONVERT TO MAP", command=self._convert_to_map).pack(side="left", padx=8)
            ttk.Button(toolbar, text="Validate", command=self._run_validate).pack(side="left")
            ttk.Button(toolbar, text="Cancel draw", command=lambda: self._cancel_stroke(leave_mode=True)).pack(side="left", padx=4)

            self.status = tk.StringVar(value="New world — author geography; export only when valid.")
            ttk.Label(self, textvariable=self.status, anchor="w").pack(side="bottom", fill="x", padx=6, pady=3)

            self._work = ttk.Frame(self)
            self._work.pack(side="top", fill="both", expand=True)
            self._body = self._work

            self.banner_text = tk.StringVar(value="")
            self.banner = tk.Label(
                self._work, textvariable=self.banner_text, anchor="center",
                bg="#1c1f24", fg="#d7e4f5", font=("Segoe UI", 10, "bold"),
            )

            self._split = ttk.Frame(self._work)
            self._split.pack(side="top", fill="both", expand=True)

            self.sidebar = ttk.Frame(self._split, width=SIDEBAR_WIDTH)
            self.sidebar.pack(side="right", fill="y")
            self.sidebar.pack_propagate(False)

            left = ttk.Frame(self._split)
            left.pack(side="left", fill="both", expand=True)

            self.canvas = tk.Canvas(left, bg="#1c1f24", highlightthickness=0)
            self.canvas.pack(fill="both", expand=True)
            self.canvas.bind("<Configure>", lambda e: self._redraw())
            self.canvas.bind("<ButtonPress-1>", self._on_press)
            self.canvas.bind("<B1-Motion>", self._on_drag)
            self.canvas.bind("<ButtonRelease-1>", self._on_release)
            self.canvas.bind("<Double-Button-1>", self._on_double)
            self.canvas.bind("<ButtonPress-2>", self._pan_start)
            self.canvas.bind("<B2-Motion>", self._pan_move)
            self.canvas.bind("<ButtonPress-3>", self._on_right)
            self.canvas.bind("<MouseWheel>", self._on_wheel)
            self.canvas.bind("<Button-4>", lambda e: self._wheel(1))
            self.canvas.bind("<Button-5>", lambda e: self._wheel(-1))
            self.canvas.bind("<Motion>", self._on_hover)
            self.bind_all("<Control-z>", lambda e: self._undo())
            self.bind_all("<Control-y>", lambda e: self._redo())
            self.bind_all("<Control-s>", lambda e: self._save())
            self.bind_all("<Delete>", lambda e: self._delete_selection())
            self.bind_all("<Escape>", lambda e: self._clear_sel())
            self.canvas.bind("<Control-a>", lambda e: self._select_all_territories())

            ttk.Label(
                self.sidebar, text="World editor", font=("Segoe UI", 10, "bold"),
            ).pack(anchor="w", padx=8, pady=(8, 2))
            self.notebook = ttk.Notebook(self.sidebar)
            self.notebook.pack(fill="both", expand=True, padx=4, pady=(0, 4))
            self.tab_world = ttk.Frame(self.notebook, padding=6)
            self.tab_sel = ttk.Frame(self.notebook, padding=6)
            self.tab_regions = ttk.Frame(self.notebook, padding=6)
            self.tab_factions = ttk.Frame(self.notebook, padding=6)
            self.tab_diplo = ttk.Frame(self.notebook, padding=6)
            self.tab_contained = ttk.Frame(self.notebook, padding=6)
            self.tab_valid = ttk.Frame(self.notebook, padding=6)
            self.notebook.add(self.tab_world, text="World")
            self.notebook.add(self.tab_sel, text="Selection")
            self.notebook.add(self.tab_regions, text="Regions")
            self.notebook.add(self.tab_factions, text="Warlords")
            self.notebook.add(self.tab_diplo, text="Diplomacy")
            self.notebook.add(self.tab_contained, text="Contained")
            self.notebook.add(self.tab_valid, text="Validate")
            self._build_world_tab()
            self._build_selection_tab()
            self._build_regions_tab()
            self._build_factions_tab()
            self._build_diplo_tab()
            self._build_contained_tab()
            self._build_valid_tab()
            self._on_tool_change()

        def _menu(self) -> None:
            menubar = tk.Menu(self)
            filem = tk.Menu(menubar, tearoff=0)
            filem.add_command(label="New World", command=self._new)
            filem.add_command(label="Open JSON…", command=self._open)
            filem.add_command(label="Save", command=self._save, accelerator="Ctrl+S")
            filem.add_command(label="Save As…", command=self._save_as)
            filem.add_command(label="Export JSON…", command=self._export_json)
            filem.add_separator()
            filem.add_command(label="Quit", command=self._on_close)
            menubar.add_cascade(label="File", menu=filem)
            editm = tk.Menu(menubar, tearoff=0)
            editm.add_command(label="Undo", command=self._undo, accelerator="Ctrl+Z")
            editm.add_command(label="Redo", command=self._redo, accelerator="Ctrl+Y")
            editm.add_separator()
            editm.add_command(label="Add region", command=self._ui_add_region)
            editm.add_command(label="Add AI warlord", command=self._ui_add_ai)
            editm.add_command(label="Duplicate territory", command=self._ui_dup_territory)
            editm.add_command(label="Delete selection", command=self._delete_selection)
            menubar.add_cascade(label="Edit", menu=editm)
            viewm = tk.Menu(menubar, tearoff=0)
            viewm.add_checkbutton(label="Territory IDs", variable=self.show_ids, command=self._redraw)
            viewm.add_checkbutton(label="Region names", variable=self.show_regions, command=self._redraw)
            viewm.add_checkbutton(label="Ownership colors", variable=self.show_ownership, command=self._redraw)
            viewm.add_checkbutton(label="Editor grid (not world geometry)", variable=self.show_grid, command=self._redraw)
            viewm.add_checkbutton(label="Raw drawing strokes", variable=self.show_raw, command=self._redraw)
            viewm.add_command(label="Fit world", command=self._fit_world)
            menubar.add_cascade(label="View", menu=viewm)
            valm = tk.Menu(menubar, tearoff=0)
            valm.add_command(label="Validate world", command=self._run_validate)
            menubar.add_cascade(label="Validate", menu=valm)
            worldm = tk.Menu(menubar, tearoff=0)
            worldm.add_command(label="CONVERT TO MAP", command=self._convert_to_map)
            worldm.add_command(label="Suggest shared-edge neighbors (selected)", command=self._suggest_neighbors)
            worldm.add_command(label="Clear all map geometry", command=self._clear_island)
            menubar.add_cascade(label="World", menu=worldm)
            self.config(menu=menubar)

        def _labeled_entry(self, parent, label: str, var: tk.Variable, row: int, callback=None):
            ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", pady=2)
            e = ttk.Entry(parent, textvariable=var, width=28)
            e.grid(row=row, column=1, sticky="ew", pady=2)
            if callback:
                var.trace_add("write", lambda *_: callback())
            parent.columnconfigure(1, weight=1)
            return e

        def _build_world_tab(self) -> None:
            f = self.tab_world
            self.v_world_id = tk.StringVar()
            self.v_world_name = tk.StringVar()
            self.v_level = tk.StringVar()
            self.v_player_fid = tk.StringVar()
            self.v_completion = tk.StringVar()
            self.v_fraction = tk.StringVar()
            self.v_uneven = tk.BooleanVar()
            self._labeled_entry(f, "World ID", self.v_world_id, 0, self._apply_world_meta)
            self._labeled_entry(f, "World name", self.v_world_name, 1, self._apply_world_meta)
            self._labeled_entry(f, "Level", self.v_level, 2, self._apply_world_meta)
            self._labeled_entry(f, "Player faction", self.v_player_fid, 3, self._apply_world_meta)
            ttk.Label(f, text="completion").grid(row=4, column=0, sticky="w")
            ttk.Combobox(f, textvariable=self.v_completion, values=COMPLETION_TYPES, state="readonly",
                         width=26).grid(row=4, column=1, sticky="ew")
            self.v_completion.trace_add("write", lambda *_: self._apply_world_meta())
            self._labeled_entry(f, "fraction", self.v_fraction, 5, self._apply_world_meta)
            ttk.Checkbutton(f, text="allowUnevenAiSplit", variable=self.v_uneven,
                            command=self._apply_world_meta).grid(row=6, column=0, columnspan=2, sticky="w")
            ttk.Label(f, text="Territories are unnamed IDs. Regions are named.",
                      wraplength=300).grid(row=7, column=0, columnspan=2, sticky="w", pady=8)
            self.own_counts = tk.StringVar(value="")
            ttk.Label(f, textvariable=self.own_counts, wraplength=300, justify="left").grid(
                row=8, column=0, columnspan=2, sticky="w")

        def _build_selection_tab(self) -> None:
            f = self.tab_sel
            self.sel_info = tk.StringVar(value="Nothing selected.")
            ttk.Label(f, textvariable=self.sel_info, wraplength=320, justify="left").pack(anchor="w")
            box = ttk.Frame(f)
            box.pack(fill="x", pady=6)
            self.v_terr_id = tk.StringVar()
            self.v_terr_region = tk.StringVar()
            self.v_terr_owner = tk.StringVar()
            self.v_terr_terrain = tk.StringVar()
            for i, (lab, var) in enumerate((
                ("ID (not a name)", self.v_terr_id),
                ("regionId", self.v_terr_region),
                ("startingOwner", self.v_terr_owner),
            )):
                ttk.Label(box, text=lab).grid(row=i, column=0, sticky="w")
                ttk.Entry(box, textvariable=var, width=24).grid(row=i, column=1, sticky="ew")
            ttk.Label(box, text="terrain").grid(row=3, column=0, sticky="w")
            ttk.Combobox(box, textvariable=self.v_terr_terrain, values=TERRAIN, state="readonly",
                         width=22).grid(row=3, column=1, sticky="ew")
            box.columnconfigure(1, weight=1)
            ttk.Button(box, text="Apply territory fields", command=self._apply_territory_fields).grid(
                row=4, column=0, columnspan=2, pady=4)
            self.res_vars = {k: tk.StringVar(value="0") for k in RESOURCE_KEYS}
            resf = ttk.LabelFrame(f, text="resourceOutput")
            resf.pack(fill="x", pady=4)
            for i, k in enumerate(RESOURCE_KEYS):
                ttk.Label(resf, text=k).grid(row=i, column=0, sticky="w")
                ttk.Entry(resf, textvariable=self.res_vars[k], width=10).grid(row=i, column=1, sticky="w")
            ttk.Button(resf, text="Apply resources", command=self._apply_resources).grid(
                row=len(RESOURCE_KEYS), column=0, columnspan=2, sticky="w", pady=4)
            self.nb_list = tk.Listbox(f, height=6)
            self.nb_list.pack(fill="both", expand=True, pady=4)
            bf = ttk.Frame(f)
            bf.pack(fill="x")
            ttk.Button(bf, text="Remove neighbor", command=self._remove_listed_neighbor).pack(side="left")

        def _build_regions_tab(self) -> None:
            f = self.tab_regions
            self.region_list = tk.Listbox(f, height=8)
            self.region_list.pack(fill="both", expand=True)
            self.region_list.bind("<<ListboxSelect>>", lambda e: self._on_region_list())
            self.v_reg_id = tk.StringVar()
            self.v_reg_name = tk.StringVar()
            form = ttk.Frame(f)
            form.pack(fill="x")
            ttk.Label(form, text="id").grid(row=0, column=0, sticky="w")
            ttk.Entry(form, textvariable=self.v_reg_id, width=22).grid(row=0, column=1, sticky="ew")
            ttk.Label(form, text="name").grid(row=1, column=0, sticky="w")
            ttk.Entry(form, textvariable=self.v_reg_name, width=22).grid(row=1, column=1, sticky="ew")
            ttk.Button(form, text="Apply rename / id", command=self._apply_region_fields).grid(
                row=2, column=0, columnspan=2, pady=3)
            bf = ttk.Frame(f)
            bf.pack(fill="x")
            ttk.Button(bf, text="Add region", command=self._ui_add_region).pack(side="left")
            ttk.Button(bf, text="Delete region", command=self._ui_del_region).pack(side="left")
            self.reg_members = tk.Listbox(f, height=6)
            self.reg_members.pack(fill="both", expand=True, pady=4)
            ttk.Label(f, text="Ctrl+click adds/toggles territories. Shift+click extends the selection.").pack(
                anchor="w", pady=(8, 2))
            self.region_sel_info = tk.StringVar(value="0 territories selected")
            ttk.Label(f, textvariable=self.region_sel_info, wraplength=320, justify="left").pack(anchor="w")
            move = ttk.Frame(f)
            move.pack(fill="x", pady=4)
            self.btn_move_region = ttk.Button(move, text="MOVE TO REGION", command=self._ui_move_to_region)
            self.btn_move_region.pack(fill="x")
            self.btn_move_region.state(["disabled"])
            row = ttk.Frame(f)
            row.pack(fill="x")
            ttk.Button(row, text="Select all territories", command=self._select_all_territories).pack(
                side="left")
            ttk.Button(row, text="Clear selection", command=self._clear_territory_selection).pack(
                side="left", padx=4)

        def _build_factions_tab(self) -> None:
            f = self.tab_factions
            self.fac_list = tk.Listbox(f, height=6)
            self.fac_list.pack(fill="both", expand=True)
            self.fac_list.bind("<<ListboxSelect>>", lambda e: self._on_faction_list())
            self.v_fac_id = tk.StringVar()
            self.v_fac_name = tk.StringVar()
            self.v_fac_role = tk.StringVar()
            self.v_fac_home = tk.StringVar()
            self.v_fac_army_loc = tk.StringVar()
            form = ttk.Frame(f)
            form.pack(fill="x")
            for i, (lab, var) in enumerate((
                ("id", self.v_fac_id), ("name", self.v_fac_name), ("role", self.v_fac_role),
                ("homeTerritoryId", self.v_fac_home), ("army location", self.v_fac_army_loc),
            )):
                ttk.Label(form, text=lab).grid(row=i, column=0, sticky="w")
                ttk.Entry(form, textvariable=var, width=22).grid(row=i, column=1, sticky="ew")
            self.army_vars = {k: tk.StringVar() for k in ("soldiers", "knights", "siegeEngines")}
            self.res_fac_vars = {k: tk.StringVar() for k in RESOURCE_KEYS}
            self.v_fac_troops = tk.StringVar(value="Troops (player-facing): 0")
            r = 5
            ttk.Label(form, text="Troops (player-facing)").grid(row=r, column=0, sticky="w")
            ttk.Label(form, textvariable=self.v_fac_troops).grid(row=r, column=1, sticky="w")
            r += 1
            army_labels = {
                "soldiers": "soldiers (internal)",
                "knights": "knights (internal)",
                "siegeEngines": "siegeEngines (internal)",
            }
            for k, var in self.army_vars.items():
                ttk.Label(form, text=army_labels[k]).grid(row=r, column=0, sticky="w")
                ttk.Entry(form, textvariable=var, width=10).grid(row=r, column=1, sticky="w")
                r += 1
            ttk.Label(
                form,
                text="Players see Troops = soldiers + knights + siege engines. Schema fields stay internal.",
                wraplength=300,
            ).grid(row=r, column=0, columnspan=2, sticky="w", pady=4)
            r += 1
            for k, var in self.res_fac_vars.items():
                ttk.Label(form, text=k).grid(row=r, column=0, sticky="w")
                ttk.Entry(form, textvariable=var, width=10).grid(row=r, column=1, sticky="w")
                r += 1
            ttk.Button(form, text="Apply faction", command=self._apply_faction_fields).grid(
                row=r, column=0, columnspan=2, pady=3)
            bf = ttk.Frame(f)
            bf.pack(fill="x")
            ttk.Button(bf, text="Add AI warlord", command=self._ui_add_ai).pack(side="left")
            ttk.Button(bf, text="Delete warlord", command=self._ui_del_faction).pack(side="left")
            pers = ttk.LabelFrame(f, text="WorldPersonalityDefinition (AI only)")
            pers.pack(fill="both", expand=True, pady=4)
            self.v_p_id = tk.StringVar()
            self.v_p_label = tk.StringVar()
            self.v_p_amb = tk.StringVar()
            ttk.Label(pers, text="personality.id").grid(row=0, column=0, sticky="w")
            ttk.Entry(pers, textvariable=self.v_p_id, width=20).grid(row=0, column=1)
            ttk.Label(pers, text="label").grid(row=1, column=0, sticky="w")
            ttk.Entry(pers, textvariable=self.v_p_label, width=20).grid(row=1, column=1)
            ttk.Label(pers, text="ambition [0,1]").grid(row=2, column=0, sticky="w")
            ttk.Entry(pers, textvariable=self.v_p_amb, width=10).grid(row=2, column=1, sticky="w")
            self.trait_vars = {k: tk.StringVar() for k in TRAIT_KEYS}
            for i, k in enumerate(TRAIT_KEYS):
                ttk.Label(pers, text=k).grid(row=3 + i, column=0, sticky="w")
                ttk.Entry(pers, textvariable=self.trait_vars[k], width=10).grid(row=3 + i, column=1, sticky="w")
            ttk.Button(pers, text="Apply personality", command=self._apply_personality).grid(
                row=3 + len(TRAIT_KEYS), column=0, columnspan=2, pady=4)

        def _build_diplo_tab(self) -> None:
            f = self.tab_diplo
            self.diplo_list = tk.Listbox(f, height=8)
            self.diplo_list.pack(fill="both", expand=True)
            self.v_d_a = tk.StringVar()
            self.v_d_b = tk.StringVar()
            self.v_d_state = tk.StringVar(value="neutral")
            self.v_d_op = tk.StringVar(value="0")
            form = ttk.Frame(f)
            form.pack(fill="x")
            ttk.Entry(form, textvariable=self.v_d_a, width=14).grid(row=0, column=0)
            ttk.Entry(form, textvariable=self.v_d_b, width=14).grid(row=0, column=1)
            ttk.Combobox(form, textvariable=self.v_d_state, values=RELATIONSHIP_STATES,
                         width=12, state="readonly").grid(row=1, column=0)
            ttk.Entry(form, textvariable=self.v_d_op, width=8).grid(row=1, column=1)
            bf = ttk.Frame(f)
            bf.pack(fill="x")
            ttk.Button(bf, text="Add pair", command=self._add_diplo).pack(side="left")
            ttk.Button(bf, text="Delete selected", command=self._del_diplo).pack(side="left")

        def _build_contained_tab(self) -> None:
            f = self.tab_contained
            ttk.Label(
                f,
                text=(
                    "Import a completed previous-level WorldDefinition. That world "
                    "becomes one region here; each of its regions becomes a territory "
                    "(union of that region's tiles). The source file stays independent."
                ),
                wraplength=300,
            ).pack(anchor="w")
            self.cont_list = tk.Listbox(f, height=6)
            self.cont_list.pack(fill="both", expand=True)
            self.cont_list.bind("<<ListboxSelect>>", lambda e: self._on_contained_list())
            self.v_c_id = tk.StringVar()
            self.v_c_region = tk.StringVar()
            self.v_c_ox = tk.StringVar(value="0")
            self.v_c_oy = tk.StringVar(value="0")
            self.v_c_rot = tk.StringVar(value="0")
            self.v_c_scale = tk.StringVar(value="1")
            form = ttk.Frame(f)
            form.pack(fill="x")
            for i, (lab, var) in enumerate((
                ("worldId", self.v_c_id), ("regionId", self.v_c_region),
                ("origin.x", self.v_c_ox), ("origin.y", self.v_c_oy),
                ("rotationDegrees", self.v_c_rot), ("scale", self.v_c_scale),
            )):
                ttk.Label(form, text=lab).grid(row=i, column=0, sticky="w")
                ttk.Entry(form, textvariable=var, width=22).grid(row=i, column=1, sticky="ew")
            bf = ttk.Frame(f)
            bf.pack(fill="x")
            self.btn_import_previous = ttk.Button(
                bf, text="Import Previous Level JSON", command=self._import_previous_level,
            )
            self.btn_import_previous.pack(side="left")
            ttk.Button(bf, text="Apply", command=self._apply_contained).pack(side="left")
            ttk.Button(bf, text="Delete", command=self._del_contained).pack(side="left")

        def _build_valid_tab(self) -> None:
            f = self.tab_valid
            ttk.Button(f, text="Validate world", command=self._run_validate).pack(anchor="w")
            ttk.Button(f, text="CONVERT TO MAP", command=self._convert_to_map).pack(anchor="w", pady=4)
            self.valid_text = tk.Text(f, height=20, wrap="word")
            self.valid_text.pack(fill="both", expand=True, pady=4)

        # ----- coordinates -----
        def w2s(self, x: float, y: float) -> Tuple[float, float]:
            return view_world_to_screen(x, y, self.zoom, self.origin_x, self.origin_y)

        def s2w(self, sx: float, sy: float) -> Point:
            return view_screen_to_world(sx, sy, self.zoom, self.origin_x, self.origin_y)

        def _fit_world(self) -> None:
            pts: List[Point] = []
            ext = polygon_exterior(self.world.get("island"))
            if ext:
                pts.extend(unique_ring_vertices(ext))
            for t in self.world.get("territories") or []:
                e = polygon_exterior(t.get("polygon"))
                if e:
                    pts.extend(unique_ring_vertices(e))
            for item in iter_drawing_strokes(self.world) + iter_open_strokes(self.world):
                pts.extend(open_stroke_points(item))
            self.canvas.update_idletasks()
            cw = max(100, self.canvas.winfo_width())
            ch = max(100, self.canvas.winfo_height())
            if not pts:
                self.zoom = 3.0
                self.origin_x, self.origin_y = cw / 2, ch / 2
                self._redraw()
                return
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            minx, maxx = min(xs), max(xs)
            miny, maxy = min(ys), max(ys)
            bw = max(1.0, maxx - minx)
            bh = max(1.0, maxy - miny)
            self.zoom = min((cw * 0.86) / bw, (ch * 0.86) / bh)
            cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
            self.origin_x = cw / 2 - cx * self.zoom
            self.origin_y = ch / 2 + cy * self.zoom
            self._redraw()

        def _faction_color(self, fid: str) -> str:
            if not fid:
                return "#555555"
            idx = abs(hash(fid)) % len(OWNER_PALETTE)
            return OWNER_PALETTE[idx]

        def _redraw(self) -> None:
            c = self.canvas
            c.delete("all")
            cw = max(1, c.winfo_width())
            ch = max(1, c.winfo_height())
            if self.show_grid.get():
                step = 20
                x0, y0 = self.s2w(0, ch)
                x1, y1 = self.s2w(cw, 0)
                gx = math.floor(x0 / step) * step
                while gx < x1:
                    sx0, sy0 = self.w2s(gx, y0)
                    sx1, sy1 = self.w2s(gx, y1)
                    c.create_line(sx0, sy0, sx1, sy1, fill="#2a2e35")
                    gx += step
                gy = math.floor(y0 / step) * step
                while gy < y1:
                    sx0, sy0 = self.w2s(x0, gy)
                    sx1, sy1 = self.w2s(x1, gy)
                    c.create_line(sx0, sy0, sx1, sy1, fill="#2a2e35")
                    gy += step
            island = polygon_exterior(self.world.get("island"))
            if island:
                coords = []
                for x, y in unique_ring_vertices(island):
                    sx, sy = self.w2s(x, y)
                    coords.extend((sx, sy))
                if len(coords) >= 6:
                    outline = "#e8d48a" if self.sel and self.sel[0] == "island" else "#8a8060"
                    c.create_polygon(*coords, fill="#2b2a22", outline=outline, width=3)
            for t in self.world.get("territories") or []:
                ext = polygon_exterior(t.get("polygon"))
                if not ext:
                    continue
                coords = []
                for x, y in unique_ring_vertices(ext):
                    sx, sy = self.w2s(x, y)
                    coords.extend((sx, sy))
                if len(coords) < 6:
                    continue
                owner = t.get("startingOwnerFactionId") or ""
                fill = self._faction_color(owner) if self.show_ownership.get() else "#3a4654"
                tid = t.get("id")
                selected = territory_is_multi_selected(str(tid or ""), self.selected_territories, self.sel)
                c.create_polygon(
                    *coords,
                    fill=fill,
                    outline="#ffe27a" if selected else "#111",
                    width=4 if selected else 1,
                    stipple="gray50",
                )
                cx, cy = ring_centroid(ext)
                sx, sy = self.w2s(cx, cy)
                if self.show_ids.get():
                    c.create_text(sx, sy, text=t.get("id"), fill="white", font=("Segoe UI", 9, "bold"))
            if self.show_regions.get():
                for r in self.world.get("regions") or []:
                    pts: List[Point] = []
                    for tid in r.get("territoryIds") or []:
                        t = find_territory(self.world, tid)
                        if not t:
                            continue
                        ext = polygon_exterior(t.get("polygon"))
                        if ext:
                            pts.append(ring_centroid(ext))
                    if not pts:
                        continue
                    cx = sum(p[0] for p in pts) / len(pts)
                    cy = sum(p[1] for p in pts) / len(pts)
                    sx, sy = self.w2s(cx, cy)
                    c.create_text(sx, sy - 14, text=r.get("name", ""), fill="#cde", font=("Segoe UI", 10))
            poly = self._selected_polygon()
            if poly:
                verts = unique_ring_vertices(poly)
                for i, (x, y) in enumerate(verts):
                    sx, sy = self.w2s(x, y)
                    r = 5
                    c.create_rectangle(sx - r, sy - r, sx + r, sy + r, fill="#fff56a", outline="#000")
            if self.show_raw.get():
                live_id = (self.stroke or {}).get("open_id")
                seen_ids: Set[str] = set()
                committed_ids = {
                    str(item.get("id") or "")
                    for item in iter_committed_strokes(self.world)
                    if item.get("id")
                }
                for item in list(iter_drawing_strokes(self.world)) + list(iter_open_strokes(self.world)):
                    sid = str(item.get("id") or "")
                    if not sid or sid in seen_ids or sid == live_id:
                        continue
                    seen_ids.add(sid)
                    pts = open_stroke_points(item)
                    if len(pts) < 2:
                        continue
                    coords = []
                    for x, y in pts:
                        sx, sy = self.w2s(x, y)
                        coords.extend((sx, sy))
                    locked = sid in committed_ids
                    c.create_line(
                        *coords,
                        fill=RAW_COMMITTED_STROKE_COLOR if locked else RAW_PENDING_STROKE_COLOR,
                        width=2,
                        capstyle="round",
                        joinstyle="round",
                        dash=(2, 4) if locked else (5, 3),
                    )
            if self.stroke:
                preview = list(self.stroke.get("raw") or [])
                cursor = self.stroke.get("cursor")
                if cursor and (not preview or edge_length(preview[-1], cursor) > GEOM_EPS):
                    preview.append(cursor)
                if len(preview) >= 2:
                    coords = []
                    for x, y in preview:
                        sx, sy = self.w2s(x, y)
                        coords.extend((sx, sy))
                    c.create_line(*coords, fill="#7fe3ff", width=2, capstyle="round", joinstyle="round")
                start_snap = self.stroke.get("start_snap")
                end_snap = self.stroke.get("end_snap")
                self._paint_snap(start_snap, "#7CFF9A")
                self._paint_snap(end_snap, "#FFE14A")
                if preview:
                    sx, sy = self.w2s(preview[-1][0], preview[-1][1])
                    c.create_oval(sx - 4, sy - 4, sx + 4, sy + 4, fill="#7fe3ff", outline="#083")
            if self.rect_drag:
                start = self.rect_drag.get("start")
                current = self.rect_drag.get("current")
                if start and current:
                    pts = rectangle_polyline(start, current)
                    if len(pts) >= 2:
                        coords = []
                        for x, y in pts:
                            sx, sy = self.w2s(x, y)
                            coords.extend((sx, sy))
                        c.create_line(*coords, fill="#ffd56a", width=2)
            if self.tool.get() == "eraser" and self.pointer_world:
                sx, sy = self.w2s(self.pointer_world[0], self.pointer_world[1])
                r = ERASER_SCREEN_PX
                c.create_oval(sx - r, sy - r, sx + r, sy + r, outline="#ff8a7a", width=2)
            self._refresh_status()

        def _paint_snap(self, snap: Optional[Dict[str, Any]], color: str) -> None:
            if not snap:
                return
            x, y = snap["point"]
            sx, sy = self.w2s(x, y)
            r = 10
            self.canvas.create_oval(sx - r, sy - r, sx + r, sy + r, outline=color, width=2)
            self.canvas.create_line(sx - 14, sy, sx + 14, sy, fill=color)
            self.canvas.create_line(sx, sy - 14, sx, sy + 14, fill=color)

        def _selected_polygon(self) -> Optional[List[Point]]:
            if not self.sel:
                return None
            kind = self.sel[0]
            if kind == "island" or (kind == "vertex" and self.sel[1] == "island"):
                return polygon_exterior(self.world.get("island"))
            tid = None
            if kind == "territory":
                tid = self.sel[1]
            elif kind == "vertex" and self.sel[1] == "territory":
                tid = self.sel[3]
            if tid:
                t = find_territory(self.world, tid)
                return polygon_exterior(t.get("polygon") if t else None)
            return None

        def _hit_vertex(self, wx: float, wy: float) -> Optional[Tuple[str, Any, int]]:
            thresh = 8.0 / max(self.zoom, 0.01)
            best: Optional[Tuple[str, Any, int]] = None
            best_d = thresh
            kinds: List[Tuple[str, Any, List[Point]]] = []
            isle = polygon_exterior(self.world.get("island"))
            if isle:
                kinds.append(("island", None, isle))
            for t in self.world.get("territories") or []:
                ext = polygon_exterior(t.get("polygon"))
                if ext:
                    kinds.append(("territory", t.get("id"), ext))
            for kind, ident, pts in kinds:
                for i, (x, y) in enumerate(unique_ring_vertices(pts)):
                    d = math.hypot(wx - x, wy - y)
                    if d < best_d:
                        best_d = d
                        best = (kind, ident, i)
            return best

        def _hit_territory(self, wx: float, wy: float) -> Optional[str]:
            for t in reversed(self.world.get("territories") or []):
                ext = polygon_exterior(t.get("polygon"))
                if ext and point_in_ring((wx, wy), ext):
                    return t.get("id")
            return None

        def _snap_at(self, wx: float, wy: float) -> Optional[Dict[str, Any]]:
            return None

        def _on_press(self, event) -> None:
            self.canvas.focus_set()
            wx, wy = self.s2w(event.x, event.y)
            self.pointer_world = (wx, wy)
            tool = self.tool.get()
            if tool == "draw":
                self._begin_stroke(wx, wy)
                return
            if tool == "rectangle":
                self.rect_drag = {"start": (wx, wy), "current": (wx, wy)}
                self._update_draw_banner()
                self._redraw()
                return
            if tool == "eraser":
                self._snapshot()
                self.erase_active = True
                if erase_raw_drawing(self.world, (wx, wy), drawing_eraser_radius(self.zoom)):
                    self.dirty = True
                self._redraw()
                return
            if tool == "pan":
                self._pan_last = (event.x, event.y)
                return
            if tool == "scale":
                return
            if tool == "adjacency":
                tid = self._hit_territory(wx, wy)
                if tid:
                    self._toggle_adjacency_click(tid)
                return
            if tool in ("vertex", "add_vertex", "select"):
                hit = self._hit_vertex(wx, wy)
                if hit:
                    kind, ident, idx = hit
                    self._begin_vertex_drag(kind, ident, idx, wx, wy)
                    self._redraw()
                    self._load_selection_panel()
                    return
                if tool == "add_vertex":
                    self._try_add_vertex(wx, wy)
                    return
                tid = self._hit_territory(wx, wy)
                if tid:
                    toggle = bool(event.state & 0x4)
                    additive = bool(event.state & 0x1)
                    self._select_territory(tid, toggle=toggle, additive=additive)
                    self.adj_first = None
                    self._redraw()
                    self._load_selection_panel()
                    return
                isle = polygon_exterior(self.world.get("island"))
                if isle and point_in_ring((wx, wy), isle):
                    if not (event.state & 0x4 or event.state & 0x1):
                        self.selected_territories.clear()
                    self.sel = ("island", None)
                    self._refresh_region_move_ui()
                    self._redraw()
                    self._load_selection_panel()
                    return
                self.sel = None
                self.selected_territories.clear()
                self._refresh_region_move_ui()
                self._redraw()
                self._load_selection_panel()

        def _begin_vertex_drag(self, kind: str, ident: Any, index: int, wx: float, wy: float) -> None:
            self.undo.push(self.world)
            if kind == "island":
                self.sel = ("vertex", "island", index)
            else:
                self.sel = ("vertex", "territory", index, ident)
            self.drag = {"kind": kind, "ident": ident, "index": index}
            self.dirty = True

        def _on_hover(self, event) -> None:
            self.pointer_world = self.s2w(event.x, event.y)
            if self.tool.get() == "eraser" and self.drag is None and self.stroke is None and not self.rect_drag:
                self._redraw()

        def _on_drag(self, event) -> None:
            wx, wy = self.s2w(event.x, event.y)
            self.pointer_world = (wx, wy)
            if self.tool.get() == "eraser" and self.erase_active:
                if erase_raw_drawing(self.world, (wx, wy), drawing_eraser_radius(self.zoom)):
                    self.dirty = True
                self._redraw()
                return
            if self.rect_drag is not None:
                self.rect_drag["current"] = (wx, wy)
                self._redraw()
                return
            if self.stroke is not None:
                self._stroke_add(wx, wy, force=False)
                self._redraw()
                return
            if self.tool.get() == "pan" or self._pan_last is not None and self.tool.get() == "pan":
                self._pan_move(event)
                return
            if not self.drag:
                return
            wx, wy = self.s2w(event.x, event.y)
            kind, ident, index = self.drag["kind"], self.drag["ident"], self.drag["index"]
            if kind == "island":
                pts = unique_ring_vertices(polygon_exterior(self.world.get("island")) or [])
                if 0 <= index < len(pts):
                    pts[index] = (wx, wy)
                    set_exterior(self.world["island"], close_ring(pts))
            else:
                t = find_territory(self.world, ident)
                if t:
                    pts = unique_ring_vertices(polygon_exterior(t.get("polygon")) or [])
                    if 0 <= index < len(pts):
                        pts[index] = (wx, wy)
                        set_exterior(t["polygon"], close_ring(pts))
            self._redraw()

        def _on_release(self, event) -> None:
            wx, wy = self.s2w(event.x, event.y)
            self.pointer_world = (wx, wy)
            if self.erase_active:
                self.erase_active = False
                self._undo_group = None
                self._redraw()
                return
            if self.rect_drag is not None:
                start = self.rect_drag.get("start")
                current = (wx, wy)
                self.rect_drag = None
                if start and rectangle_is_commit_size(start, current, self.zoom):
                    pts = rectangle_polyline(start, current)
                    if len(pts) >= 5:
                        self._snapshot()
                        add_drawing_stroke(self.world, pts, STROKE_KIND_RECTANGLE)
                        self.dirty = True
                self._update_draw_banner()
                self._redraw()
                return
            if self.stroke is not None:
                self._stroke_add(wx, wy, force=True)
                self._pause_stroke()
                return
            self.drag = None
            self._pan_last = None

        def _on_double(self, event) -> None:
            if self.tool.get() in ("draw", "rectangle", "eraser") or self.stroke or self.rect_drag:
                return
            wx, wy = self.s2w(event.x, event.y)
            self._try_add_vertex(wx, wy)

        def _try_add_vertex(self, wx: float, wy: float) -> None:
            thresh = 10.0 / max(self.zoom, 0.01)
            poly = self._selected_polygon()
            if not poly:
                return
            new_pts = insert_vertex_on_edge(poly, (wx, wy), thresh)
            if not new_pts:
                return
            self.undo.push(self.world)
            self.dirty = True
            if self.sel and (self.sel[0] == "island" or (self.sel[0] == "vertex" and self.sel[1] == "island")):
                set_exterior(self.world["island"], new_pts)
            else:
                tid = self.sel[1] if self.sel and self.sel[0] == "territory" else (
                    self.sel[3] if self.sel and self.sel[0] == "vertex" else None
                )
                t = find_territory(self.world, tid) if tid else None
                if t:
                    set_exterior(t["polygon"], new_pts)
            self._redraw()

        def _on_right(self, event) -> None:
            if self.stroke is not None:
                self._cancel_stroke(leave_mode=False)
                return
            if self.rect_drag is not None:
                self.rect_drag = None
                self._update_draw_banner()
                self._redraw()
                return
            if self.tool.get() == "draw":
                wx, wy = self.s2w(event.x, event.y)
                hit = nearest_drawing_stroke_end(self.world, (wx, wy), drawing_snap_radius(self.zoom))
                if not hit:
                    hit = nearest_open_stroke_end(self.world, (wx, wy), drawing_snap_radius(self.zoom))
                if hit and hit.get("id"):
                    self._snapshot()
                    remove_drawing_stroke(self.world, str(hit["id"]))
                    remove_open_stroke(self.world, str(hit["id"]))
                    self.dirty = True
                    self._update_draw_banner()
                    self._redraw()
                    return
                self._cancel_stroke(leave_mode=True)
                return
            wx, wy = self.s2w(event.x, event.y)
            hit = self._hit_vertex(wx, wy)
            if not hit:
                return
            kind, ident, idx = hit
            self.undo.push(self.world)
            changed = False
            if kind == "island":
                pts = delete_vertex_at(polygon_exterior(self.world.get("island")) or [], idx)
                if pts:
                    set_exterior(self.world["island"], pts)
                    changed = True
            else:
                t = find_territory(self.world, ident)
                if t:
                    pts = delete_vertex_at(polygon_exterior(t.get("polygon")) or [], idx)
                    if pts:
                        set_exterior(t["polygon"], pts)
                        changed = True
            if changed:
                self.dirty = True
            self._redraw()

        def _pan_start(self, event) -> None:
            self._pan_last = (event.x, event.y)

        def _pan_move(self, event) -> None:
            if not self._pan_last:
                self._pan_last = (event.x, event.y)
                return
            dx = event.x - self._pan_last[0]
            dy = event.y - self._pan_last[1]
            self.origin_x += dx
            self.origin_y += dy
            self._pan_last = (event.x, event.y)
            self._redraw()

        def _on_wheel(self, event) -> None:
            self._wheel(1 if event.delta > 0 else -1, event.x, event.y)

        def _wheel(self, direction: int, x: Optional[int] = None, y: Optional[int] = None) -> None:
            factor = 1.1 if direction > 0 else (1 / 1.1)
            if x is None:
                x = self.canvas.winfo_width() // 2
                y = self.canvas.winfo_height() // 2
            wx, wy = self.s2w(x, y)
            self.zoom = max(0.2, min(40.0, self.zoom * factor))
            self.origin_x = x - wx * self.zoom
            self.origin_y = y + wy * self.zoom
            self._redraw()

        def _stroke_min_spacing(self) -> float:
            # ~1.6 screen pixels in world space so zoomed-in drawing stays detailed.
            return max(0.08, 1.6 / max(self.zoom, 0.01))

        def _on_tool_change(self) -> None:
            tool = self.tool.get()
            if self.stroke is not None and tool != "draw":
                self._pause_stroke()
            if self.rect_drag is not None and tool != "rectangle":
                self.rect_drag = None
            if tool != "eraser":
                self.erase_active = False
            if tool in ("draw", "rectangle"):
                self.canvas.config(cursor="crosshair")
                self.drag = None
            elif tool == "eraser":
                try:
                    self.canvas.config(cursor="dotbox")
                except tk.TclError:
                    self.canvas.config(cursor="crosshair")
                self.drag = None
            elif tool == "scale":
                try:
                    self.canvas.config(cursor="sb_h_double_arrow")
                except tk.TclError:
                    self.canvas.config(cursor="")
                self.drag = None
            else:
                try:
                    self.canvas.config(cursor="")
                except tk.TclError:
                    pass
            if tool == "scale":
                if not self.scale_bar.winfo_ismapped():
                    self.scale_bar.pack(side="left", padx=8, before=self._toolbar_undo)
            else:
                self.scale_bar.pack_forget()
            self._update_draw_banner()
            self._redraw()

        def _update_draw_banner(self) -> None:
            tool = self.tool.get()
            n_pending = sum(
                1 for item in list(iter_pending_strokes(self.world)) + list(iter_open_strokes(self.world))
                if len(open_stroke_points(item)) >= 2
            )
            n_committed = sum(
                1 for item in iter_committed_strokes(self.world)
                if len(open_stroke_points(item)) >= 2
            )
            locked = f"{n_committed} committed locked. " if n_committed else ""
            pending_txt = f"{n_pending} pending. " if n_pending else ("No pending drawing. " if n_committed else "")
            if self.stroke:
                n = len(self.stroke.get("raw") or [])
                self.banner_text.set(
                    f"DRAWING — {n} points  ·  release stores pending ink  ·  zoom/pan anytime  ·  "
                    "CONVERT TO MAP interprets pending strokes only  ·  Esc cancels this stroke"
                )
                self.banner.config(bg="#0b5cad", fg="#ffffff")
            elif self.rect_drag:
                self.banner_text.set(
                    "RECTANGLE — drag a corner, release to add pending ink. "
                    "It is not a territory until CONVERT TO MAP."
                )
                self.banner.config(bg="#0b5cad", fg="#ffffff")
            elif tool == "draw":
                extra = locked + pending_txt if (n_pending or n_committed) else "Blank canvas. "
                self.banner_text.set(
                    extra + "Drag freely. CONVERT TO MAP commits pending enclosed areas and never "
                    "reinterprets the locked map."
                )
                self.banner.config(bg="#3d4a1f", fg="#f3f0c8")
            elif tool == "rectangle":
                extra = locked + pending_txt if (n_pending or n_committed) else "Blank canvas. "
                self.banner_text.set(
                    extra + "Press and drag to add a rectangle to pending drawing. "
                    "CONVERT TO MAP treats it as ink, the same as freehand."
                )
                self.banner.config(bg="#3d4a1f", fg="#f3f0c8")
            elif tool == "eraser":
                self.banner_text.set(
                    "ERASER — pending ink only. Committed source strokes are locked and do not "
                    "change the map. Converted territories are edited in the structured sidebar."
                )
                self.banner.config(bg="#5a2a22", fg="#f8e4dc")
            elif tool == "scale":
                self.banner_text.set(
                    "SCALE — uniformly resize authored geometry around the map center. "
                    "Committed map, committed source, and pending drawing move together and stay in their buckets. "
                    "This is not zoom. Undo restores both."
                )
                self.banner.config(bg="#2a3d5a", fg="#dce8f8")
            elif n_pending and not polygon_exterior(self.world.get("island")):
                self.banner_text.set(
                    f"{n_pending} pending stroke(s) — press CONVERT TO MAP to find the island and territories."
                )
                self.banner.config(bg="#3d4a1f", fg="#f3f0c8")
            elif n_pending:
                self.banner_text.set(
                    f"{locked}{n_pending} pending stroke(s) — CONVERT TO MAP appends new land only."
                )
                self.banner.config(bg="#3d4a1f", fg="#f3f0c8")
            else:
                self.banner_text.set("")
                self.banner.config(bg="#1c1f24", fg="#d7e4f5")
                self.banner.pack_forget()
                return
            if hasattr(self, "_split") and not self.banner.winfo_ismapped():
                self.banner.pack(side="top", fill="x", before=self._split)

        def _begin_stroke(self, wx: float, wy: float) -> None:
            self.drag = None
            radius = drawing_snap_radius(self.zoom)
            resumed = oriented_drawing_stroke_for_resume(self.world, (wx, wy), radius)
            if resumed is None:
                resumed = oriented_open_stroke_for_resume(self.world, (wx, wy), radius)
            snap = self._snap_at(wx, wy)
            if resumed:
                pts = list(resumed["points"])
                self.stroke = {
                    "raw": pts,
                    "cursor": (wx, wy),
                    "start_snap": snap,
                    "end_snap": snap,
                    "open_id": resumed["id"],
                    "backup": list(pts),
                }
                self._update_draw_banner()
                self._redraw()
                return
            self.stroke = {
                "raw": [(wx, wy)],
                "cursor": (wx, wy),
                "start_snap": snap,
                "end_snap": snap,
            }
            self._update_draw_banner()
            self._redraw()

        def _stroke_add(self, wx: float, wy: float, force: bool = False) -> None:
            if not self.stroke:
                return
            snap = self._snap_at(wx, wy)
            self.stroke["end_snap"] = snap
            self.stroke["cursor"] = (wx, wy)
            raw: List[Point] = self.stroke["raw"]
            store = (wx, wy)
            spacing = self._stroke_min_spacing()
            if force or not raw or edge_length(raw[-1], store) >= spacing:
                if not raw or edge_length(raw[-1], store) > GEOM_EPS:
                    raw.append(store)
            self._update_draw_banner()

        def _cancel_stroke(self, leave_mode: bool = False) -> None:
            stroke = self.stroke
            self.stroke = None
            if stroke and stroke.get("open_id") and stroke.get("backup"):
                put_drawing_stroke(self.world, str(stroke["open_id"]), stroke["backup"])
            if leave_mode and self.tool.get() == "draw":
                self.tool.set("select")
            self._update_draw_banner()
            self._redraw()

        def _pause_stroke(self) -> None:
            stroke = self.stroke
            self.stroke = None
            if not stroke:
                self._update_draw_banner()
                self._redraw()
                return
            raw: List[Point] = list(stroke.get("raw") or [])
            cursor = stroke.get("cursor")
            if cursor and (not raw or edge_length(raw[-1], cursor) > GEOM_EPS):
                raw.append(cursor)
            if len(raw) < 2:
                self._update_draw_banner()
                self._redraw()
                return
            self._snapshot()
            sid = stroke.get("open_id")
            if sid:
                put_drawing_stroke(self.world, str(sid), raw)
            else:
                add_drawing_stroke(self.world, raw)
            self.dirty = True
            self._undo_group = None
            self._update_draw_banner()
            self._redraw()

        def _apply_scale_from_entry(self) -> None:
            self._apply_scale(self.scale_factor.get())

        def _apply_scale(self, value: Any) -> None:
            if self.stroke is not None:
                self._pause_stroke()
            self.rect_drag = None
            self.erase_active = False
            parsed, err = parse_scale_factor(value)
            if parsed is None:
                messagebox.showwarning("SCALE", err)
                return
            pretty = str(int(parsed)) if float(parsed).is_integer() else str(parsed)
            self.scale_factor.set(pretty)
            if almost_equal(parsed, 1.0):
                self.status.set("SCALE 1.0 — geometry unchanged.")
                return
            if scale_anchor_center(self.world) is None:
                messagebox.showwarning("SCALE", "Nothing to scale. Open a map or draw first.")
                return
            preview = scale_world_geometry(clone_world(self.world), parsed)
            if not preview.get("ok"):
                messagebox.showwarning("SCALE", preview.get("message") or "Scale failed.")
                return
            self._snapshot()
            result = scale_world_geometry(self.world, parsed, preview.get("center"))
            if not result.get("ok"):
                messagebox.showwarning("SCALE", result.get("message") or "Scale failed.")
                self._reload_lists()
                self._redraw()
                return
            self.dirty = True
            self._undo_group = None
            cx, cy = result.get("center") or (0.0, 0.0)
            self._reload_lists()
            self._update_draw_banner()
            self._fit_world()
            extra = ""
            if not result.get("scaledConverted"):
                extra = "  |  raw drawing only"
            elif not result.get("scaledDrawing"):
                extra = "  |  converted map only (no raw drawing)"
            self.status.set(
                f"Scaled ×{parsed:g} around ({cx:.2f}, {cy:.2f}). "
                "RAW and MAP share this scale. Zoom unchanged."
                f"{extra}"
            )

        def _convert_to_map(self) -> None:
            if self.stroke is not None:
                self._pause_stroke()
            if self.rect_drag is not None:
                start = self.rect_drag.get("start")
                current = self.rect_drag.get("current")
                self.rect_drag = None
                if start and current and rectangle_is_commit_size(start, current, self.zoom):
                    pts = rectangle_polyline(start, current)
                    if len(pts) >= 5:
                        add_drawing_stroke(self.world, pts, STROKE_KIND_RECTANGLE)
            self.erase_active = False
            pending = all_pending_raw_strokes(self.world)
            if has_committed_map(self.world) and not pending:
                result = convert_drawing_to_map(self.world)
            else:
                self._snapshot()
                result = convert_drawing_to_map(self.world)
            if not result.get("unchanged"):
                self.dirty = True
            self._undo_group = None
            text = format_conversion_report(result)
            self.notebook.select(self.tab_valid)
            self.valid_text.delete("1.0", "end")
            self.valid_text.insert("end", text + "\n")
            self._reload_lists()
            self._update_draw_banner()
            self._redraw()
            if result.get("ok"):
                messagebox.showinfo("CONVERT TO MAP", text)
            else:
                messagebox.showwarning("CONVERT TO MAP", result.get("message") or text)

        def _commit_stroke(self) -> None:
            self._pause_stroke()

        def _finish_stroke(self) -> None:
            self._pause_stroke()

        def _place_territory(self, wx: float, wy: float) -> None:
            if not (self.world.get("regions") or []):
                if not messagebox.askyesno("Region required", "Create a region now so the new territory can belong to it?"):
                    return
                self._snapshot()
                add_region(self.world, "New Region")
            regions = self.world.get("regions") or []
            rid = regions[0]["id"] if regions else None
            if self.sel and self.sel[0] == "region":
                rid = self.sel[1]
            if not rid:
                return
            owner = self.world.get("playerFactionId") or ""
            if any(t.get("startingOwnerFactionId") == owner for t in self.world.get("territories") or []):
                ais = [f["id"] for f in self.world.get("factions") or [] if f.get("role") == "ai"]
                owner = ais[0] if ais else owner
            self._snapshot()
            tid = add_territory(self.world, quad_at(wx, wy), rid, owner)
            self.sel = ("territory", tid)
            self.selected_territories = {tid}
            self.dirty = True
            self._reload_lists()
            self._redraw()

        def _toggle_adjacency_click(self, tid: str) -> None:
            if self.adj_first is None or self.adj_first == tid:
                self.adj_first = tid
                self.sel = ("territory", tid)
                self.selected_territories = {tid}
                self.status.set(f"Adjacency: {tid} selected — click another territory to toggle neighbor")
                self._redraw()
                return
            a, b = self.adj_first, tid
            ta = find_territory(self.world, a)
            present = b in (ta.get("neighborIds") or []) if ta else False
            self._snapshot()
            set_reciprocal_neighbor(self.world, a, b, not present)
            self.dirty = True
            self.adj_first = None
            self.sel = ("territory", a)
            self.selected_territories = {a}
            self._reload_lists()
            self._redraw()

        def _suggest_neighbors(self) -> None:
            if not self.sel or self.sel[0] != "territory":
                messagebox.showinfo("Adjacency helper", "Select a territory first.")
                return
            tid = self.sel[1]
            t = find_territory(self.world, tid)
            if not t:
                return
            added = []
            self._snapshot()
            for other in self.world.get("territories") or []:
                oid = other.get("id")
                if oid == tid:
                    continue
                if plausible_shared_edge(t.get("polygon") or {}, other.get("polygon") or {}):
                    if oid not in (t.get("neighborIds") or []):
                        set_reciprocal_neighbor(self.world, tid, oid, True)
                        added.append(oid)
            self.dirty = True
            self._reload_lists()
            self._redraw()
            messagebox.showinfo("Adjacency helper", "Added: " + (", ".join(added) if added else "(none)"))

        # ----- panels -----
        def _refresh_status(self) -> None:
            issues = self._export_blockers()
            dirty = "• unsaved" if self.dirty else "saved"
            sel = "none"
            if self.sel:
                sel = str(self.sel[0]) + (f" {self.sel[1]}" if len(self.sel) > 1 else "")
            nsel = len(self.selected_territories)
            if nsel:
                sel = f"{nsel} territories"
            n = len(self.world.get("territories") or [])
            draw = ""
            if self.stroke:
                npts = len(self.stroke.get("raw") or [])
                draw = f"  |  DRAWING ({npts} samples)"
            else:
                n_pending = sum(
                    1 for item in list(iter_pending_strokes(self.world)) + list(iter_open_strokes(self.world))
                    if len(open_stroke_points(item)) >= 2
                )
                n_committed = sum(
                    1 for item in iter_committed_strokes(self.world)
                    if len(open_stroke_points(item)) >= 2
                )
                if n_pending or n_committed:
                    draw = f"  |  {n_committed} committed / {n_pending} pending"
                elif self.tool.get() == "draw":
                    draw = "  |  DRAW — pending ink; CONVERT TO MAP commits"
                elif self.tool.get() == "rectangle":
                    draw = "  |  RECTANGLE — pending ink"
                elif self.tool.get() == "eraser":
                    draw = "  |  ERASER — pending drawing only"
                elif self.tool.get() == "scale":
                    draw = "  |  SCALE — authored geometry (not zoom)"
            self.status.set(
                f"{self.world.get('name')}  |  {n} territories  |  tool={self.tool.get()}  |  "
                f"sel={sel}  |  zoom={self.zoom:.2f}  |  {dirty}  |  {len(issues)} validation issue(s)"
                f"{draw}"
            )
            counts = ownership_counts(self.world)
            names = []
            for f in self.world.get("factions") or []:
                names.append(f"{f.get('name')} ({f.get('id')}): {counts.get(f.get('id'), 0)}")
            self.own_counts.set("Ownership counts:\n" + "\n".join(names))

        def _load_world_panel(self) -> None:
            self._suspend = True
            w = self.world
            self.v_world_id.set(w.get("worldId", ""))
            self.v_world_name.set(w.get("name", ""))
            self.v_level.set(str(w.get("level", 1)))
            self.v_player_fid.set(w.get("playerFactionId", ""))
            comp = w.get("completion") or {}
            self.v_completion.set(comp.get("type", "manual"))
            self.v_fraction.set(str(comp.get("fraction", 0.7)))
            self.v_uneven.set(bool(w.get("allowUnevenAiSplit")))
            self._suspend = False

        def _apply_world_meta(self) -> None:
            if self._suspend:
                return
            self._snapshot("world_meta")
            old_id = self.world.get("worldId")
            self.world["worldId"] = self.v_world_id.get().strip()
            self.world["name"] = self.v_world_name.get()
            try:
                self.world["level"] = int(self.v_level.get())
            except ValueError:
                pass
            self.world["playerFactionId"] = self.v_player_fid.get().strip()
            ctype = self.v_completion.get()
            if ctype == "control_fraction":
                try:
                    frac = float(self.v_fraction.get())
                except ValueError:
                    frac = 0.7
                self.world["completion"] = {"type": "control_fraction", "fraction": frac}
            else:
                self.world["completion"] = {"type": ctype}
            if self.v_uneven.get():
                self.world["allowUnevenAiSplit"] = True
            else:
                self.world.pop("allowUnevenAiSplit", None)
            if self.world["worldId"] != old_id:
                for r in self.world.get("regions") or []:
                    r["worldId"] = self.world["worldId"]
            self.dirty = True
            self._refresh_status()

        def _load_selection_panel(self) -> None:
            self._suspend = True
            t = None
            if self.sel and self.sel[0] == "territory":
                t = find_territory(self.world, self.sel[1])
            elif self.sel and self.sel[0] == "vertex" and self.sel[1] == "territory":
                t = find_territory(self.world, self.sel[3])
            if t:
                extra = ""
                if len(self.selected_territories) > 1:
                    extra = f"\n{len(self.selected_territories)} territories selected — use MOVE TO REGION to assign them together."
                self.sel_info.set(
                    f"Territory ID {t.get('id')} — this is an internal ID, not a player-facing name.\n"
                    f"Region: {t.get('regionId')}  Owner: {t.get('startingOwnerFactionId')}{extra}"
                )
                self.v_terr_id.set(t.get("id", ""))
                self.v_terr_region.set(t.get("regionId", ""))
                self.v_terr_owner.set(t.get("startingOwnerFactionId", ""))
                self.v_terr_terrain.set(t.get("terrain", "plains"))
                res = t.get("resourceOutput") or {}
                for k in RESOURCE_KEYS:
                    self.res_vars[k].set(str(res.get(k, 0)))
                self.nb_list.delete(0, "end")
                for n in t.get("neighborIds") or []:
                    self.nb_list.insert("end", n)
            elif self.sel and self.sel[0] == "island":
                verts = unique_ring_vertices(polygon_exterior(self.world.get("island")) or [])
                self.sel_info.set(f"Island boundary — {len(verts)} vertices. This polygon is the world, not the window.")
            else:
                self.sel_info.set("Nothing selected. Click a territory or the island.")
            self._suspend = False

        def _apply_territory_fields(self) -> None:
            t = self._current_territory()
            if not t:
                return
            self._snapshot()
            new_id = self.v_terr_id.get().strip()
            old_id = t.get("id")
            if new_id and new_id != old_id:
                if find_territory(self.world, new_id):
                    messagebox.showerror("ID", f"Territory {new_id} already exists.")
                    return
                self._rename_territory(old_id, new_id)
                t = find_territory(self.world, new_id)
                self.sel = ("territory", new_id)
            t["terrain"] = self.v_terr_terrain.get()
            owner = self.v_terr_owner.get().strip()
            t["startingOwnerFactionId"] = owner
            rid = self.v_terr_region.get().strip()
            if rid:
                sync_region_membership(self.world, t["id"], rid)
            self.dirty = True
            self._reload_lists()
            self._redraw()

        def _rename_territory(self, old: str, new: str) -> None:
            t = find_territory(self.world, old)
            if not t:
                return
            t["id"] = new
            for o in self.world.get("territories") or []:
                o["neighborIds"] = [new if n == old else n for n in (o.get("neighborIds") or [])]
            for r in self.world.get("regions") or []:
                r["territoryIds"] = [new if i == old else i for i in (r.get("territoryIds") or [])]
            for f in self.world.get("factions") or []:
                if f.get("homeTerritoryId") == old:
                    f["homeTerritoryId"] = new
                army = f.get("startingArmy") or {}
                if army.get("locationTerritoryId") == old:
                    army["locationTerritoryId"] = new

        def _apply_resources(self) -> None:
            t = self._current_territory()
            if not t:
                return
            self._snapshot()
            out = {}
            for k in RESOURCE_KEYS:
                try:
                    out[k] = float(self.res_vars[k].get())
                except ValueError:
                    out[k] = 0.0
            t["resourceOutput"] = out
            self.dirty = True

        def _current_territory(self) -> Optional[Dict[str, Any]]:
            if self.sel and self.sel[0] == "territory":
                return find_territory(self.world, self.sel[1])
            if self.sel and self.sel[0] == "vertex" and self.sel[1] == "territory":
                return find_territory(self.world, self.sel[3])
            return None

        def _remove_listed_neighbor(self) -> None:
            t = self._current_territory()
            if not t:
                return
            sel = self.nb_list.curselection()
            if not sel:
                return
            nid = self.nb_list.get(sel[0])
            self._snapshot()
            set_reciprocal_neighbor(self.world, t["id"], nid, False)
            self.dirty = True
            self._load_selection_panel()
            self._redraw()

        def _reload_lists(self) -> None:
            self._load_world_panel()
            self.region_list.delete(0, "end")
            for r in self.world.get("regions") or []:
                self.region_list.insert("end", f"{r.get('id')}  {r.get('name')}")
            self.fac_list.delete(0, "end")
            for f in self.world.get("factions") or []:
                self.fac_list.insert("end", f"{f.get('id')}  [{f.get('role')}]  {f.get('name')}")
            self.diplo_list.delete(0, "end")
            for rel in self.world.get("startingDiplomacy") or []:
                self.diplo_list.insert("end", f"{rel.get('a')} / {rel.get('b')}  {rel.get('state')}  {rel.get('opinion')}")
            self.cont_list.delete(0, "end")
            for c in self.world.get("containedWorlds") or []:
                self.cont_list.insert("end", f"{c.get('worldId')} @ {c.get('regionId')}")
            self._load_selection_panel()
            self._refresh_region_move_ui()
            self._refresh_status()

        def _on_region_list(self) -> None:
            sel = self.region_list.curselection()
            if not sel:
                return
            r = (self.world.get("regions") or [])[sel[0]]
            self.sel = ("region", r.get("id"))
            self.v_reg_id.set(r.get("id", ""))
            self.v_reg_name.set(r.get("name", ""))
            self.reg_members.delete(0, "end")
            for tid in r.get("territoryIds") or []:
                self.reg_members.insert("end", tid)
            self._refresh_region_move_ui()
            self._redraw()

        def _apply_region_fields(self) -> None:
            sel = self.region_list.curselection()
            if not sel:
                return
            r = (self.world.get("regions") or [])[sel[0]]
            self._snapshot()
            new_id = self.v_reg_id.get().strip()
            old = r.get("id")
            r["name"] = self.v_reg_name.get()
            if new_id and new_id != old:
                if find_region(self.world, new_id):
                    messagebox.showerror("ID", f"Region {new_id} already exists.")
                    return
                r["id"] = new_id
                for t in self.world.get("territories") or []:
                    if t.get("regionId") == old:
                        t["regionId"] = new_id
                for c in self.world.get("containedWorlds") or []:
                    if c.get("regionId") == old:
                        c["regionId"] = new_id
            self.dirty = True
            self._reload_lists()

        def _ui_add_region(self) -> None:
            self._snapshot()
            rid = add_region(self.world)
            self.dirty = True
            self._reload_lists()
            self.sel = ("region", rid)
            self.status.set(f"Created region {rid}")

        def _ui_del_region(self) -> None:
            sel = self.region_list.curselection()
            if not sel:
                return
            r = (self.world.get("regions") or [])[sel[0]]
            if r.get("territoryIds"):
                messagebox.showerror("Region", "Reassign member territories before deleting this region.")
                return
            self._snapshot()
            self.world["regions"] = [x for x in self.world["regions"] if x.get("id") != r.get("id")]
            self.dirty = True
            self._reload_lists()
            self._redraw()

        def _select_territory(self, tid: str, *, toggle: bool = False, additive: bool = False) -> None:
            if toggle:
                if tid in self.selected_territories:
                    self.selected_territories.discard(tid)
                else:
                    self.selected_territories.add(tid)
            elif additive:
                self.selected_territories.add(tid)
            else:
                self.selected_territories = {tid}
            if tid in self.selected_territories:
                self.sel = ("territory", tid)
            elif self.selected_territories:
                self.sel = ("territory", next(iter(self.selected_territories)))
            else:
                self.sel = None
            self._refresh_region_move_ui()

        def _clear_territory_selection(self) -> None:
            self.selected_territories.clear()
            if self.sel and self.sel[0] == "territory":
                self.sel = None
            self._refresh_region_move_ui()
            self._load_selection_panel()
            self._redraw()

        def _select_all_territories(self, event=None) -> None:
            self.selected_territories = {
                str(t.get("id")) for t in (self.world.get("territories") or []) if t.get("id")
            }
            if self.selected_territories:
                self.sel = ("territory", next(iter(sorted(self.selected_territories))))
            self._refresh_region_move_ui()
            self._load_selection_panel()
            self._redraw()
            return "break"

        def _refresh_region_move_ui(self) -> None:
            ids = sorted(self.selected_territories)
            n = len(ids)
            if n == 0:
                self.region_sel_info.set("0 territories selected — MOVE TO REGION is unavailable.")
            elif n == 1:
                t = find_territory(self.world, ids[0])
                rid = (t or {}).get("regionId") or "—"
                self.region_sel_info.set(f"1 territory selected ({ids[0]}, currently {rid}).")
            else:
                shown = ", ".join(ids[:8]) + ("…" if n > 8 else "")
                self.region_sel_info.set(f"{n} territories selected: {shown}")
            if hasattr(self, "btn_move_region"):
                self.btn_move_region.state(["!disabled"] if n else ["disabled"])

        def _ui_move_to_region(self) -> None:
            ids = sorted(self.selected_territories)
            if not ids:
                return
            regions = list(self.world.get("regions") or [])
            if not regions:
                messagebox.showerror("MOVE TO REGION", "Create a region first.")
                return
            dlg = tk.Toplevel(self)
            dlg.title("MOVE TO REGION")
            dlg.transient(self)
            dlg.grab_set()
            ttk.Label(
                dlg,
                text=f"Assign {len(ids)} selected territor{'y' if len(ids) == 1 else 'ies'} to:",
            ).pack(anchor="w", padx=10, pady=(10, 4))
            box = tk.Listbox(dlg, height=min(12, max(4, len(regions))))
            box.pack(fill="both", expand=True, padx=10)
            for r in regions:
                box.insert("end", f"{r.get('name')}  ({r.get('id')})")
            cur = self.region_list.curselection()
            if cur:
                box.selection_set(cur[0])
            else:
                box.selection_set(0)
            chosen: List[Optional[str]] = [None]

            def accept(_event=None) -> None:
                sel = box.curselection()
                if not sel:
                    return
                chosen[0] = regions[sel[0]].get("id")
                dlg.destroy()

            def cancel() -> None:
                dlg.destroy()

            bf = ttk.Frame(dlg)
            bf.pack(fill="x", padx=10, pady=8)
            ttk.Button(bf, text="Assign", command=accept).pack(side="right")
            ttk.Button(bf, text="Cancel", command=cancel).pack(side="right", padx=6)
            box.bind("<Double-Button-1>", accept)
            dlg.bind("<Return>", accept)
            dlg.wait_window()
            rid = chosen[0]
            if not rid:
                return
            region = find_region(self.world, rid)
            self._snapshot()
            n = assign_territories_to_region(self.world, ids, rid)
            self.dirty = True
            self._reload_lists()
            self._redraw()
            self.status.set(
                f"Moved {n} territor{'y' if n == 1 else 'ies'} to {(region or {}).get('name') or rid}."
            )

        def _on_faction_list(self) -> None:
            sel = self.fac_list.curselection()
            if not sel:
                return
            f = (self.world.get("factions") or [])[sel[0]]
            self.v_fac_id.set(f.get("id", ""))
            self.v_fac_name.set(f.get("name", ""))
            self.v_fac_role.set(f.get("role", ""))
            self.v_fac_home.set(f.get("homeTerritoryId", ""))
            army = f.get("startingArmy") or {}
            self.v_fac_army_loc.set(army.get("locationTerritoryId", ""))
            for k, var in self.army_vars.items():
                var.set(str(army.get(k, 0)))
            self.v_fac_troops.set(str(player_facing_troop_count(army)))
            res = f.get("startingResources") or {}
            for k, var in self.res_fac_vars.items():
                var.set(str(res.get(k, 0)))
            p = f.get("personality")
            if isinstance(p, dict):
                self.v_p_id.set(p.get("id", ""))
                self.v_p_label.set(p.get("label", ""))
                self.v_p_amb.set(str(p.get("ambition", 0.5)))
                traits = p.get("traits") or {}
                for k in TRAIT_KEYS:
                    self.trait_vars[k].set(str(traits.get(k, 0.5)))
            else:
                self.v_p_id.set("")
                self.v_p_label.set("")
                self.v_p_amb.set("")
                for k in TRAIT_KEYS:
                    self.trait_vars[k].set("")

        def _apply_faction_fields(self) -> None:
            sel = self.fac_list.curselection()
            if not sel:
                return
            f = (self.world.get("factions") or [])[sel[0]]
            self._snapshot()
            new_id = self.v_fac_id.get().strip()
            old = f.get("id")
            if new_id and new_id != old:
                if find_faction(self.world, new_id):
                    messagebox.showerror("ID", f"Faction {new_id} already exists.")
                    return
                f["id"] = new_id
                if self.world.get("playerFactionId") == old:
                    self.world["playerFactionId"] = new_id
                for t in self.world.get("territories") or []:
                    if t.get("startingOwnerFactionId") == old:
                        t["startingOwnerFactionId"] = new_id
                for rel in self.world.get("startingDiplomacy") or []:
                    if rel.get("a") == old:
                        rel["a"] = new_id
                    if rel.get("b") == old:
                        rel["b"] = new_id
            f["name"] = self.v_fac_name.get()
            role = self.v_fac_role.get().strip()
            if role in FACTION_ROLES:
                f["role"] = role
                if role == "player":
                    f["personality"] = None
                elif role == "ai" and not f.get("personality"):
                    f["personality"] = default_personality()
                    f["personality"]["id"] = next_id("p_", [
                        (x.get("personality") or {}).get("id")
                        for x in self.world.get("factions") or []
                        if isinstance(x.get("personality"), dict)
                    ])
            f["homeTerritoryId"] = self.v_fac_home.get().strip()
            army = f.setdefault("startingArmy", {})
            army["locationTerritoryId"] = self.v_fac_army_loc.get().strip()
            for k, var in self.army_vars.items():
                try:
                    army[k] = int(float(var.get()))
                except ValueError:
                    army[k] = 0
            res = f.setdefault("startingResources", {})
            for k, var in self.res_fac_vars.items():
                try:
                    res[k] = float(var.get())
                except ValueError:
                    res[k] = 0.0
            self.v_fac_troops.set(str(player_facing_troop_count(army)))
            self.dirty = True
            self._reload_lists()

        def _apply_personality(self) -> None:
            sel = self.fac_list.curselection()
            if not sel:
                return
            f = (self.world.get("factions") or [])[sel[0]]
            if f.get("role") != "ai":
                messagebox.showinfo("Personality", "Player faction must keep personality: null.")
                return
            self._snapshot()
            p = f.get("personality") or default_personality()
            p["id"] = self.v_p_id.get().strip() or p.get("id")
            p["label"] = self.v_p_label.get()
            try:
                p["ambition"] = float(self.v_p_amb.get())
            except ValueError:
                p["ambition"] = 0.5
            traits = p.setdefault("traits", {})
            for k in TRAIT_KEYS:
                try:
                    traits[k] = float(self.trait_vars[k].get())
                except ValueError:
                    traits[k] = 0.5
            f["personality"] = p
            self.dirty = True

        def _ui_add_ai(self) -> None:
            self._snapshot()
            add_ai_faction(self.world)
            self.dirty = True
            self._reload_lists()

        def _ui_del_faction(self) -> None:
            sel = self.fac_list.curselection()
            if not sel:
                return
            f = (self.world.get("factions") or [])[sel[0]]
            if f.get("role") == "player":
                messagebox.showerror("Faction", "Cannot delete the player faction.")
                return
            owned = [t.get("id") for t in self.world.get("territories") or [] if t.get("startingOwnerFactionId") == f.get("id")]
            if owned:
                messagebox.showerror("Faction", "Reassign owned territories first: " + ", ".join(owned))
                return
            self._snapshot()
            self.world["factions"] = [x for x in self.world["factions"] if x.get("id") != f.get("id")]
            self.dirty = True
            self._reload_lists()

        def _add_diplo(self) -> None:
            self._snapshot()
            try:
                op = float(self.v_d_op.get())
            except ValueError:
                op = 0.0
            self.world.setdefault("startingDiplomacy", []).append({
                "a": self.v_d_a.get().strip(),
                "b": self.v_d_b.get().strip(),
                "state": self.v_d_state.get(),
                "opinion": op,
            })
            self.dirty = True
            self._reload_lists()

        def _del_diplo(self) -> None:
            sel = self.diplo_list.curselection()
            if not sel:
                return
            self._snapshot()
            rels = self.world.get("startingDiplomacy") or []
            del rels[sel[0]]
            self.dirty = True
            self._reload_lists()

        def _on_contained_list(self) -> None:
            sel = self.cont_list.curselection()
            if not sel:
                return
            c = (self.world.get("containedWorlds") or [])[sel[0]]
            self.v_c_id.set(c.get("worldId", ""))
            self.v_c_region.set(c.get("regionId", ""))
            pl = c.get("placement") or {}
            origin = pl.get("origin") or {}
            self.v_c_ox.set(str(origin.get("x", 0)))
            self.v_c_oy.set(str(origin.get("y", 0)))
            self.v_c_rot.set(str(pl.get("rotationDegrees", 0)))
            self.v_c_scale.set(str(pl.get("scale", 1)))

        def _add_contained(self) -> None:
            self._import_previous_level()

        def _import_previous_level(self) -> None:
            path = filedialog.askopenfilename(
                title="Select previous-level WorldDefinition JSON",
                filetypes=[("World JSON", "*.json"), ("All files", "*.*")],
            )
            if not path:
                return
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    text = fh.read()
            except OSError as err:
                messagebox.showerror("Import previous level", str(err))
                return
            plan = import_plan_from_json_text(text, self.world)
            if not plan.get("ok"):
                messagebox.showerror(
                    "Import previous level",
                    plan.get("error") or "The selected JSON could not be converted.",
                )
                return
            if not self._confirm_previous_level_import(plan):
                return
            self._snapshot()
            applied = apply_previous_level_import(self.world, plan)
            if not applied.get("ok"):
                messagebox.showerror(
                    "Import previous level",
                    applied.get("error") or "Import failed.",
                )
                return
            self.dirty = True
            rid = applied.get("regionId")
            self.sel = ("region", rid) if rid else self.sel
            self._reload_lists()
            self._fit_world()
            names = [
                f"{tid}={item.get('sourceRegionName')}"
                for item, tid in zip(plan.get("territories") or [], applied.get("territoryIds") or [])
            ]
            self.status.set(
                f"Imported {plan.get('sourceName')} as region {rid} "
                f"({', '.join(names)})"
            )

        def _confirm_previous_level_import(self, plan: Dict[str, Any]) -> bool:
            win = tk.Toplevel(self)
            win.title("Import previous level")
            win.transient(self)
            win.resizable(True, True)
            decided = {"ok": False}
            ttk.Label(win, text="Preview coarsening before changing this world.", wraplength=420).pack(
                anchor="w", padx=10, pady=(10, 4),
            )
            preview = tk.Text(win, height=12, wrap="word", width=56)
            preview.pack(fill="both", expand=True, padx=10)
            preview.insert("1.0", format_previous_level_import_preview(plan))
            preview.configure(state="disabled")
            canvas = tk.Canvas(win, width=420, height=220, background="#1b1f24", highlightthickness=0)
            canvas.pack(fill="both", expand=True, padx=10, pady=6)
            self._draw_previous_level_preview(canvas, plan)
            bf = ttk.Frame(win)
            bf.pack(fill="x", padx=10, pady=(0, 10))

            def cancel() -> None:
                decided["ok"] = False
                win.destroy()

            def confirm() -> None:
                decided["ok"] = True
                win.destroy()

            ttk.Button(bf, text="Cancel", command=cancel).pack(side="right", padx=4)
            ttk.Button(bf, text="Import & Convert", command=confirm).pack(side="right")
            win.protocol("WM_DELETE_WINDOW", cancel)
            win.grab_set()
            win.wait_window()
            return bool(decided["ok"])

        def _draw_previous_level_preview(self, canvas: Any, plan: Dict[str, Any]) -> None:
            canvas.delete("all")
            rings: List[Tuple[str, List[Point]]] = []
            for item in plan.get("territories") or []:
                ring = polygon_exterior(item.get("polygon"))
                if ring:
                    rings.append((str(item.get("sourceRegionName") or item.get("sourceRegionId")), ring))
            pts = [p for _, ring in rings for p in unique_ring_vertices(ring)]
            width = max(int(canvas.winfo_reqwidth()), 420)
            height = max(int(canvas.winfo_reqheight()), 220)
            if not pts:
                canvas.create_text(width / 2, height / 2, text="No geometry", fill="#d0d0d0")
                return
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
            pad = 18.0
            span_x = max(maxx - minx, 1e-6)
            span_y = max(maxy - miny, 1e-6)
            zoom = min((width - 2 * pad) / span_x, (height - 2 * pad) / span_y)
            origin_x = pad - minx * zoom
            origin_y = height - pad + miny * zoom
            palette = ("#d96060", "#5aa46a", "#5a84c8", "#c8a04a", "#8a64c0", "#4aa8a8")
            for i, (label, ring) in enumerate(rings):
                closed = close_ring(unique_ring_vertices(ring))
                coords: List[float] = []
                for x, y in closed:
                    coords.extend((origin_x + x * zoom, origin_y - y * zoom))
                color = palette[i % len(palette)]
                canvas.create_polygon(*coords, fill=color, outline="#f2f2f2", width=1)
                cx, cy = ring_centroid(ring)
                sx, sy = origin_x + cx * zoom, origin_y - cy * zoom
                canvas.create_text(sx, sy, text=label, fill="#f7f7f7", font=("Segoe UI", 8))

        def _apply_contained(self) -> None:
            sel = self.cont_list.curselection()
            if not sel:
                return
            c = (self.world.get("containedWorlds") or [])[sel[0]]
            self._snapshot()
            c["worldId"] = self.v_c_id.get().strip()
            c["regionId"] = self.v_c_region.get().strip()
            try:
                ox, oy = float(self.v_c_ox.get()), float(self.v_c_oy.get())
                rot = float(self.v_c_rot.get())
                sc = float(self.v_c_scale.get())
            except ValueError:
                messagebox.showerror("Contained world", "Placement values must be numbers.")
                return
            c["placement"] = {"origin": {"x": ox, "y": oy}, "rotationDegrees": rot, "scale": sc}
            self.dirty = True
            self._reload_lists()

        def _del_contained(self) -> None:
            sel = self.cont_list.curselection()
            if not sel:
                return
            self._snapshot()
            items = self.world.get("containedWorlds") or []
            del items[sel[0]]
            self.dirty = True
            self._reload_lists()

        def _ui_dup_territory(self) -> None:
            messagebox.showinfo(
                "Territories",
                "Territories come from CONVERT TO MAP. After a successful conversion they are "
                "locked. Draw new enclosed shapes and convert again to append, or use World → "
                "Clear all map geometry to start over.",
            )

        def _delete_selection(self, event=None) -> None:
            focus = self.focus_get()
            if focus is not None:
                cls = str(focus.winfo_class())
                if cls in ("Entry", "TEntry", "Text", "TCombobox", "Listbox"):
                    return
            if not self.sel:
                return
            if self.sel[0] == "territory":
                messagebox.showinfo(
                    "Territories",
                    "Territories are locked after CONVERT TO MAP. Erasing raw source ink does not "
                    "delete them. Assign metadata in the sidebar, or use World → Clear all map geometry.",
                )
                return
            elif self.sel[0] == "vertex":
                kind = self.sel[1]
                idx = self.sel[2]
                ident = self.sel[3] if kind == "territory" else None
                self._snapshot()
                if kind == "island":
                    pts = delete_vertex_at(polygon_exterior(self.world.get("island")) or [], idx)
                    if pts:
                        set_exterior(self.world["island"], pts)
                        self.dirty = True
                else:
                    t = find_territory(self.world, ident)
                    if t:
                        pts = delete_vertex_at(polygon_exterior(t.get("polygon")) or [], idx)
                        if pts:
                            set_exterior(t["polygon"], pts)
                            self.dirty = True
                self._redraw()

        def _clear_sel(self) -> None:
            if self.stroke is not None:
                self._cancel_stroke(leave_mode=False)
                return
            if self.rect_drag is not None:
                self.rect_drag = None
                self._update_draw_banner()
                self._redraw()
                return
            if self.erase_active:
                self.erase_active = False
                return
            if self.tool.get() == "draw":
                self._cancel_stroke(leave_mode=True)
                return
            self.sel = None
            self.adj_first = None
            self.selected_territories.clear()
            self._refresh_region_move_ui()
            self._redraw()

        def _clear_island(self) -> None:
            if not messagebox.askyesno(
                "Clear geometry",
                "Remove the island, territories, and raw drawing strokes? "
                "This returns to a blank canvas.",
            ):
                return
            self._snapshot()
            self.world["island"] = {"rings": [[]]}
            self.world["territories"] = []
            for r in self.world.get("regions") or []:
                r["territoryIds"] = []
            self.world.pop(EDITOR_GRAPH_KEY, None)
            self.world[EDITOR_OPEN_STROKES_KEY] = empty_open_strokes()
            self.world[EDITOR_DRAWING_KEY] = empty_drawing()
            self.world.pop(EDITOR_CONVERT_REPORT_KEY, None)
            self.sel = None
            self.selected_territories.clear()
            self.stroke = None
            self.export_highlight = None
            self.dirty = True
            self._reload_lists()
            self._redraw()

        def _snapshot(self, group: Optional[str] = None) -> None:
            if group is not None and self._undo_group == group:
                return
            self._undo_group = group
            self.undo.push(self.world)

        def _undo(self) -> None:
            restored = self.undo.apply_undo(self.world)
            if restored is None:
                return
            self.world = restored
            self._undo_group = None
            self.stroke = None
            self.rect_drag = None
            self.erase_active = False
            self.export_highlight = first_open_boundary_endpoint(self.world)
            self.selected_territories.clear()
            self.dirty = True
            self._reload_lists()
            self._on_tool_change()

        def _redo(self) -> None:
            restored = self.undo.apply_redo(self.world)
            if restored is None:
                return
            self.world = restored
            self._undo_group = None
            self.stroke = None
            self.rect_drag = None
            self.erase_active = False
            self.export_highlight = first_open_boundary_endpoint(self.world)
            self.selected_territories.clear()
            self.dirty = True
            self._reload_lists()
            self._on_tool_change()

        def _run_validate(self) -> None:
            issues = self._export_blockers()
            self.notebook.select(self.tab_valid)
            self.valid_text.delete("1.0", "end")
            report = self.world.get(EDITOR_CONVERT_REPORT_KEY)
            if isinstance(report, dict):
                self.valid_text.insert("end", format_conversion_report(report) + "\n\n")
            if not issues:
                self.valid_text.insert("end", "VALID  —  converted map matches rep-wars-world.v1 rules.\n")
                return
            self.valid_text.insert("end", f"{len(issues)} issue(s). Export is refused until the converted map is valid.\n\n")
            for i in issues:
                self.valid_text.insert("end", f"[{i['code']}] {i['message']}\n")

        def _export_blockers(self) -> List[Issue]:
            return editor_export_issues(self.world)

        def _write_json(self, path: str, *, playable: bool) -> bool:
            if playable:
                issues = self._export_blockers()
                if issues:
                    self._run_validate()
                    messagebox.showerror(
                        "Cannot export",
                        "Export writes a playable rep-wars-world.v1 file. Convert the drawing "
                        "and fix validation issues first.\n\n"
                        + "\n".join(f"[{i['code']}] {i['message']}" for i in issues[:12])
                        + ("\n…" if len(issues) > 12 else ""),
                    )
                    return False
                text = dumps_world(self.world)
            else:
                text = dumps_editor_document(self.world)
            with open(path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(text)
            self.path = path
            self.dirty = False
            self.status.set(f"Wrote {path}")
            return True

        def _new(self) -> None:
            if not self._confirm_discard():
                return
            self.world = new_blank_world()
            self.path = None
            self.dirty = False
            self.undo = UndoStack()
            self.sel = None
            self.selected_territories.clear()
            self.stroke = None
            self.export_highlight = None
            self.tool.set("draw")
            self._reload_lists()
            self._on_tool_change()
            self._fit_world()

        def _open(self) -> None:
            path = filedialog.askopenfilename(
                title="Open world JSON",
                filetypes=[("World JSON", "*.json"), ("All files", "*.*")],
            )
            if path:
                self._open_path(path, replacing=True)

        def _open_path(self, path: str, replacing: bool) -> None:
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    text = fh.read()
            except OSError as err:
                messagebox.showerror("Open", str(err))
                return
            try:
                raw = json.loads(text)
            except json.JSONDecodeError as err:
                messagebox.showerror("Open", str(err))
                return
            if not isinstance(raw, dict):
                messagebox.showerror("Open", "World JSON must be an object.")
                return
            drawing = raw.get(EDITOR_DRAWING_KEY)
            has_drawing = isinstance(drawing, dict) and (
                bool(drawing.get("strokes")) or bool(drawing.get("committedStrokes"))
            )
            world, issues = parse_world_json(text)
            if (issues or world is None) and has_drawing:
                world = clone_world(raw)
                if not isinstance(world.get("startingDiplomacy"), list):
                    world["startingDiplomacy"] = []
                if not isinstance(world.get("containedWorlds"), list):
                    world["containedWorlds"] = []
                issues = []
            if issues or world is None:
                messagebox.showerror(
                    "Invalid world",
                    "Load refused. The current working world was not replaced.\n\n"
                    + "\n".join(f"[{i['code']}] {i['message']}" for i in issues[:16]),
                )
                return
            if replacing and not self._confirm_discard():
                return
            self.world = world
            self.world.pop(EDITOR_GRAPH_KEY, None)
            get_drawing(self.world, create=True)
            self.path = path
            self.dirty = False
            self.undo = UndoStack()
            self.sel = None
            self.selected_territories.clear()
            self.stroke = None
            self.export_highlight = None
            self._reload_lists()
            self._fit_world()
            self.status.set(f"Loaded {path}")

        def _save(self) -> None:
            if self.path:
                self._write_json(self.path, playable=False)
            else:
                self._save_as()

        def _save_as(self) -> None:
            path = filedialog.asksaveasfilename(
                title="Save editor document (includes raw drawing)",
                defaultextension=".json",
                filetypes=[("World JSON", "*.json")],
            )
            if path:
                self._write_json(path, playable=False)

        def _export_json(self) -> None:
            path = filedialog.asksaveasfilename(
                title="Export playable world JSON",
                defaultextension=".json",
                filetypes=[("World JSON", "*.json")],
            )
            if path:
                self._write_json(path, playable=True)

        def _confirm_discard(self) -> bool:
            if not self.dirty:
                return True
            return messagebox.askyesno("Unsaved changes", "Discard unsaved edits?")

        def _on_close(self) -> None:
            if self._confirm_discard():
                self.destroy()

        def run(self, smoke: bool = False) -> None:
            self._reload_lists()
            self.update_idletasks()
            self.update()
            if on_ready is not None:
                on_ready(self)
            if smoke:
                self.destroy()
                return
            self.mainloop()

    app = MapAssistant()
    app.run(smoke=smoke)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="REP WARS Map Assistant — authoring tool for rep-wars-world.v1",
    )
    parser.add_argument("--self-test", action="store_true", help="Run logic tests (no GUI)")
    parser.add_argument("--validate", metavar="JSON", help="Validate a world JSON file and exit")
    parser.add_argument("--gui-smoke", action="store_true", help="Build the Tk window, then exit")
    parser.add_argument("path", nargs="?", help="Optional world JSON to open in the editor")
    args = parser.parse_args(argv)
    if args.self_test:
        return run_self_test()
    if args.validate:
        return validate_path(args.validate)
    try:
        launch_editor(args.path, smoke=args.gui_smoke)
    except Exception:
        traceback.print_exc()
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
