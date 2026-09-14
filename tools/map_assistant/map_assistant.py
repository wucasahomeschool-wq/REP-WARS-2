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
report, boundary graph) is never included in playable export. Raw freehand
strokes are not WorldDefinition data; CONVERT TO MAP interprets them.

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
NODE_MERGE_EPS = 1e-4
CONVERT_SNAP_TOL_MIN = 1.5
CONVERT_SNAP_FRAC = 0.045
CONVERT_EXTEND_FRAC = 0.22
CONVERT_ISLAND_CLOSE_FRAC = 0.35
CONVERT_ISLAND_CLOSE_ABS = 10.0
CONVERT_MIN_ISLAND_AREA = 40.0
CONVERT_SLIVER_FRAC = 0.006
CONVERT_MIN_EDGE = 0.08
CONVERT_DUP_TOL = 0.7

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
# Planar boundary graph (editor-only; stripped on export)
# ---------------------------------------------------------------------------

def empty_boundary_graph() -> Dict[str, Any]:
    return {"nodes": {}, "edges": {}, "next_n": 1, "next_e": 1}


def _node_key(p: Point) -> Tuple[float, float]:
    return (round(float(p[0]), 6), round(float(p[1]), 6))


def graph_node_point(graph: Dict[str, Any], nid: str) -> Point:
    p = graph["nodes"][nid]
    return (float(p[0]), float(p[1]))


def _poly_list(raw: Sequence[Any]) -> List[Point]:
    out: List[Point] = []
    for p in raw:
        out.append((float(p[0]), float(p[1])))
    return out


def _sync_edge_poly(graph: Dict[str, Any], eid: str) -> List[Point]:
    e = graph["edges"][eid]
    a = graph_node_point(graph, e["a"])
    b = graph_node_point(graph, e["b"])
    poly = _poly_list(e.get("poly") or [])
    if len(poly) < 2:
        poly = [a, b]
    else:
        poly[0] = a
        poly[-1] = b
    e["poly"] = poly
    return poly


def add_graph_node(graph: Dict[str, Any], p: Point, merge_eps: float = NODE_MERGE_EPS) -> str:
    eps = max(float(merge_eps), NODE_MERGE_EPS)
    for nid, q in graph["nodes"].items():
        if edge_length(p, (float(q[0]), float(q[1]))) <= eps:
            return nid
    nid = f"n{graph['next_n']:04d}"
    graph["next_n"] += 1
    graph["nodes"][nid] = (float(p[0]), float(p[1]))
    return nid


def add_graph_edge(graph: Dict[str, Any], a: str, b: str, poly: Sequence[Point]) -> Optional[str]:
    if a == b:
        return None
    pts = _poly_list(poly)
    if len(pts) < 2:
        pts = [graph_node_point(graph, a), graph_node_point(graph, b)]
    pts[0] = graph_node_point(graph, a)
    pts[-1] = graph_node_point(graph, b)
    for eid, e in graph["edges"].items():
        if {e["a"], e["b"]} == {a, b}:
            return eid
    eid = f"e{graph['next_e']:04d}"
    graph["next_e"] += 1
    graph["edges"][eid] = {"a": a, "b": b, "poly": pts}
    return eid


def existing_graph_edge(graph: Dict[str, Any], a: str, b: str) -> Optional[str]:
    want = {a, b}
    for eid, e in graph["edges"].items():
        if {e["a"], e["b"]} == want:
            return eid
    return None


def dist_point_to_polyline(p: Point, poly: Sequence[Point]) -> Tuple[float, Point, int, float]:
    if len(poly) < 2:
        q = poly[0] if poly else p
        return (edge_length(p, q), q, 0, 0.0)
    best_d = float("inf")
    best: Tuple[float, Point, int, float] = (0.0, poly[0], 0, 0.0)
    for i in range(len(poly) - 1):
        d, q, t = dist_point_to_segment(p, poly[i], poly[i + 1])
        if d < best_d:
            best_d = d
            best = (d, q, i, t)
    return best


def polyline_along(poly: Sequence[Point], seg_index: int, t: float) -> float:
    total = 0.0
    for i in range(seg_index):
        if i + 1 < len(poly):
            total += edge_length(poly[i], poly[i + 1])
    if seg_index + 1 < len(poly):
        total += max(0.0, min(1.0, t)) * edge_length(poly[seg_index], poly[seg_index + 1])
    return total


def slice_polyline_by_distance(poly: Sequence[Point], d0: float, d1: float) -> List[Point]:
    if d1 < d0:
        d0, d1 = d1, d0
    acc = 0.0
    out: List[Point] = []

    def point_at(dist: float) -> Point:
        if dist <= GEOM_EPS:
            return (float(poly[0][0]), float(poly[0][1]))
        walked = 0.0
        for i in range(len(poly) - 1):
            seg = edge_length(poly[i], poly[i + 1])
            if walked + seg >= dist - GEOM_EPS or i == len(poly) - 2:
                t = 0.0 if seg <= GEOM_EPS else max(0.0, min(1.0, (dist - walked) / seg))
                return (poly[i][0] + (poly[i + 1][0] - poly[i][0]) * t,
                        poly[i][1] + (poly[i + 1][1] - poly[i][1]) * t)
            walked += seg
        return (float(poly[-1][0]), float(poly[-1][1]))

    out.append(point_at(d0))
    walked = 0.0
    for i in range(len(poly) - 1):
        a, b = poly[i], poly[i + 1]
        seg = edge_length(a, b)
        next_w = walked + seg
        if next_w > d0 + GEOM_EPS and walked < d1 - GEOM_EPS:
            if walked > d0 + GEOM_EPS:
                q = (float(a[0]), float(a[1]))
                if edge_length(out[-1], q) > NODE_MERGE_EPS:
                    out.append(q)
        walked = next_w
    end = point_at(d1)
    if edge_length(out[-1], end) > NODE_MERGE_EPS:
        out.append(end)
    else:
        out[-1] = end
    if len(out) < 2:
        out.append(end)
    return out


def split_graph_edge(graph: Dict[str, Any], eid: str, p: Point) -> str:
    e = graph["edges"].get(eid)
    if not e:
        return add_graph_node(graph, p)
    a, b = e["a"], e["b"]
    pa, pb = graph_node_point(graph, a), graph_node_point(graph, b)
    if edge_length(p, pa) <= NODE_MERGE_EPS:
        return a
    if edge_length(p, pb) <= NODE_MERGE_EPS:
        return b
    for nid, q in list(graph["nodes"].items()):
        qp = (float(q[0]), float(q[1]))
        if edge_length(p, qp) <= NODE_MERGE_EPS and nid not in (a, b):
            d, _, _, _ = dist_point_to_polyline(qp, _sync_edge_poly(graph, eid))
            if d <= NODE_MERGE_EPS * 5:
                p = qp
                break
    poly = _sync_edge_poly(graph, eid)
    _d, q, si, t = dist_point_to_polyline(p, poly)
    p = q
    if t <= 1e-6:
        if si == 0:
            return a
        p = poly[si]
        insert_at = si
    elif t >= 1.0 - 1e-6:
        if si >= len(poly) - 2:
            return b
        p = poly[si + 1]
        insert_at = si + 1
    else:
        insert_at = si + 1
        poly = poly[:insert_at] + [p] + poly[insert_at:]
    nid = add_graph_node(graph, p)
    if nid in (a, b):
        return nid
    left = poly[: insert_at + 1]
    right = poly[insert_at:]
    del graph["edges"][eid]
    add_graph_edge(graph, a, nid, left)
    add_graph_edge(graph, nid, b, right)
    return nid


def move_graph_node(graph: Dict[str, Any], nid: str, p: Point) -> None:
    graph["nodes"][nid] = (float(p[0]), float(p[1]))
    for eid in list(graph["edges"]):
        e = graph["edges"][eid]
        if e["a"] == nid or e["b"] == nid:
            _sync_edge_poly(graph, eid)


def move_graph_edge_vertex(graph: Dict[str, Any], eid: str, index: int, p: Point) -> None:
    e = graph["edges"].get(eid)
    if not e:
        return
    poly = _sync_edge_poly(graph, eid)
    if index <= 0:
        move_graph_node(graph, e["a"], p)
        return
    if index >= len(poly) - 1:
        move_graph_node(graph, e["b"], p)
        return
    poly[index] = (float(p[0]), float(p[1]))
    e["poly"] = poly


def insert_graph_edge_vertex(graph: Dict[str, Any], eid: str, p: Point, threshold: float) -> bool:
    e = graph["edges"].get(eid)
    if not e:
        return False
    poly = _sync_edge_poly(graph, eid)
    d, q, si, t = dist_point_to_polyline(p, poly)
    if d > threshold or t <= 0.05 or t >= 0.95:
        return False
    poly = poly[: si + 1] + [q] + poly[si + 1 :]
    e["poly"] = poly
    return True


def delete_graph_vertex(graph: Dict[str, Any], nid: Optional[str] = None,
                        eid: Optional[str] = None, index: Optional[int] = None) -> bool:
    if eid is not None and index is not None:
        e = graph["edges"].get(eid)
        if not e:
            return False
        poly = _sync_edge_poly(graph, eid)
        if index <= 0 or index >= len(poly) - 1 or len(poly) <= 2:
            if index <= 0:
                return delete_graph_vertex(graph, nid=e["a"])
            if index >= len(poly) - 1:
                return delete_graph_vertex(graph, nid=e["b"])
            return False
        del poly[index]
        e["poly"] = poly
        return True
    if not nid or nid not in graph["nodes"]:
        return False
    incident = [eid for eid, e in graph["edges"].items() if e["a"] == nid or e["b"] == nid]
    if len(incident) >= 3:
        return False
    if len(incident) == 0:
        del graph["nodes"][nid]
        return True
    if len(incident) == 1:
        del graph["edges"][incident[0]]
        del graph["nodes"][nid]
        return True
    e1 = graph["edges"][incident[0]]
    e2 = graph["edges"][incident[1]]
    a = e1["b"] if e1["a"] == nid else e1["a"]
    b = e2["b"] if e2["a"] == nid else e2["a"]
    p1 = _sync_edge_poly(graph, incident[0])
    p2 = _sync_edge_poly(graph, incident[1])
    if e1["a"] == nid:
        p1 = list(reversed(p1))
    if e2["b"] == nid:
        p2 = list(reversed(p2))
    merged = p1[:-1] + p2
    del graph["edges"][incident[0]]
    del graph["edges"][incident[1]]
    del graph["nodes"][nid]
    add_graph_edge(graph, a, b, merged)
    return True


def drawing_snap_radius(zoom: float) -> float:
    return max(0.35, 14.0 / max(zoom, 0.01))


def nearest_graph_snap(
    graph: Dict[str, Any], p: Point, radius: float,
) -> Optional[Dict[str, Any]]:
    if not graph["nodes"]:
        return None
    best_node: Optional[Tuple[float, str, Point]] = None
    for nid, q in graph["nodes"].items():
        qp = (float(q[0]), float(q[1]))
        d = edge_length(p, qp)
        if d <= radius and (best_node is None or d < best_node[0]):
            best_node = (d, nid, qp)
    best_edge: Optional[Tuple[float, str, Point]] = None
    for eid in graph["edges"]:
        poly = _sync_edge_poly(graph, eid)
        d, q, _si, _t = dist_point_to_polyline(p, poly)
        if d <= radius and (best_edge is None or d < best_edge[0]):
            best_edge = (d, eid, q)
    if best_node:
        return {"kind": "node", "node": best_node[1], "edge": None, "point": best_node[2], "dist": best_node[0]}
    if best_edge:
        return {"kind": "edge", "node": None, "edge": best_edge[1], "point": best_edge[2], "dist": best_edge[0]}
    return None


def realize_snap(graph: Dict[str, Any], snap: Dict[str, Any]) -> str:
    if snap.get("kind") == "node" and snap.get("node"):
        return snap["node"]
    eid = snap.get("edge")
    pt = snap["point"]
    if eid:
        return split_graph_edge(graph, eid, pt)
    return add_graph_node(graph, pt)


def _segment_intersection(a: Point, b: Point, c: Point, d: Point) -> Optional[Point]:
    den = (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0])
    if abs(den) <= GEOM_EPS:
        return None
    t = ((a[0] - c[0]) * (c[1] - d[1]) - (a[1] - c[1]) * (c[0] - d[0])) / den
    u = -((a[0] - b[0]) * (a[1] - c[1]) - (a[1] - b[1]) * (a[0] - c[0])) / den
    if t < -1e-7 or t > 1.0 + 1e-7 or u < -1e-7 or u > 1.0 + 1e-7:
        return None
    t = max(0.0, min(1.0, t))
    return (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))


def _outgoing_angle(graph: Dict[str, Any], nid: str, eid: str, from_a: bool) -> float:
    poly = _sync_edge_poly(graph, eid)
    pts = poly if from_a else list(reversed(poly))
    origin = graph_node_point(graph, nid)
    for q in pts[1:]:
        dx, dy = q[0] - origin[0], q[1] - origin[1]
        if dx * dx + dy * dy > NODE_MERGE_EPS * NODE_MERGE_EPS:
            return math.atan2(dy, dx)
    return 0.0


def _incident_half_edges(graph: Dict[str, Any]) -> Dict[str, List[Tuple[str, bool]]]:
    inc: Dict[str, List[Tuple[str, bool]]] = {nid: [] for nid in graph["nodes"]}
    for eid, e in graph["edges"].items():
        inc.setdefault(e["a"], []).append((eid, True))
        inc.setdefault(e["b"], []).append((eid, False))
    for nid, hedges in inc.items():
        hedges.sort(key=lambda h: _outgoing_angle(graph, nid, h[0], h[1]))
    return inc


def _next_ccw_hedge(
    inc: Dict[str, List[Tuple[str, bool]]], graph: Dict[str, Any], eid: str, from_a: bool,
) -> Optional[Tuple[str, bool]]:
    e = graph["edges"][eid]
    dest = e["b"] if from_a else e["a"]
    hedges = inc.get(dest) or []
    if not hedges:
        return None
    rev = (eid, not from_a)
    try:
        idx = hedges.index(rev)
    except ValueError:
        return hedges[0]
    return hedges[(idx + 1) % len(hedges)]


def _hedge_polyline(graph: Dict[str, Any], eid: str, from_a: bool) -> List[Point]:
    poly = _sync_edge_poly(graph, eid)
    return poly if from_a else list(reversed(poly))


def classify_boundary_faces(graph: Dict[str, Any]) -> Dict[str, Any]:
    """Walk the planar embedding. Outer face is the most-clockwise cycle."""
    inc = _incident_half_edges(graph)
    used: Set[Tuple[str, bool]] = set()
    faces: List[Dict[str, Any]] = []
    for eid, e in graph["edges"].items():
        for from_a in (True, False):
            start = (eid, from_a)
            if start in used:
                continue
            walk: List[Tuple[str, bool]] = []
            cur: Optional[Tuple[str, bool]] = start
            guard = 0
            while cur is not None and cur not in used and guard < 20000:
                used.add(cur)
                walk.append(cur)
                cur = _next_ccw_hedge(inc, graph, cur[0], cur[1])
                guard += 1
                if cur == start:
                    break
            if not walk or cur != start:
                continue
            ring: List[Point] = []
            edge_ids: Set[str] = set()
            counts: Dict[str, int] = defaultdict(int)
            for he_eid, he_from in walk:
                edge_ids.add(he_eid)
                counts[he_eid] += 1
                poly = _hedge_polyline(graph, he_eid, he_from)
                if not ring:
                    ring.extend(poly)
                else:
                    ring.extend(poly[1:])
            ring = close_ring(ring)
            area = ring_area(ring)
            simple = all(c == 1 for c in counts.values())
            faces.append({
                "ring": ring, "edges": edge_ids, "area": area, "simple": simple, "walk": walk,
            })
    if not faces:
        return {"outer": None, "territories": []}
    max_abs = max(abs(f["area"]) for f in faces)
    candidates = [f for f in faces if abs(abs(f["area"]) - max_abs) <= max(GEOM_EPS, max_abs * 1e-9)]
    neg = [f for f in candidates if f["area"] < 0]
    outer = min(neg, key=lambda f: f["area"]) if neg else max(candidates, key=lambda f: abs(f["area"]))
    territories = []
    for f in faces:
        if f is outer:
            continue
        if not f["simple"]:
            continue
        if abs(f["area"]) < DRAW_MIN_AREA:
            continue
        ring = f["ring"]
        if f["area"] < 0:
            ring = close_ring(list(reversed(unique_ring_vertices(ring))))
        territories.append({"ring": ring, "edges": set(f["edges"])})
    outer_ring = outer["ring"]
    if outer["area"] > 0:
        outer_ring = close_ring(list(reversed(unique_ring_vertices(outer_ring))))
    outer_edges = set(outer.get("edges") or [])
    has_internal = any(eid not in outer_edges for eid in graph["edges"])
    if not has_internal:
        territories = []
    return {"outer": outer_ring, "territories": territories}


def graph_has_island(graph: Dict[str, Any]) -> bool:
    if len(graph.get("nodes") or {}) < 3:
        return False
    faces = classify_boundary_faces(graph)
    return faces["outer"] is not None and len(unique_ring_vertices(faces["outer"] or [])) >= 3


def seed_island_from_ring(graph: Dict[str, Any], ring: Sequence[Point]) -> None:
    graph.clear()
    graph.update(empty_boundary_graph())
    verts = unique_ring_vertices(ring)
    if len(verts) < 3:
        return
    nids = [add_graph_node(graph, v) for v in verts]
    for i, a in enumerate(nids):
        b = nids[(i + 1) % len(nids)]
        add_graph_edge(graph, a, b, [graph_node_point(graph, a), graph_node_point(graph, b)])


def graph_from_world(world: Dict[str, Any]) -> Dict[str, Any]:
    graph = empty_boundary_graph()
    key_to_nid: Dict[Tuple[float, float], str] = {}

    def node_at(p: Point) -> str:
        k = _node_key(p)
        nid = key_to_nid.get(k)
        if nid:
            return nid
        nid = add_graph_node(graph, p)
        key_to_nid[_node_key(graph_node_point(graph, nid))] = nid
        return nid

    def add_ring(ring: Optional[Sequence[Point]]) -> None:
        if not ring:
            return
        verts = unique_ring_vertices(ring)
        if len(verts) < 3:
            return
        ids = [node_at(v) for v in verts]
        for i, a in enumerate(ids):
            b = ids[(i + 1) % len(ids)]
            add_graph_edge(graph, a, b, [graph_node_point(graph, a), graph_node_point(graph, b)])

    add_ring(polygon_exterior(world.get("island") if isinstance(world.get("island"), dict) else None))
    for t in world.get("territories") or []:
        if isinstance(t, dict):
            add_ring(polygon_exterior(t.get("polygon") if isinstance(t.get("polygon"), dict) else None))
    return graph


def ensure_boundary_graph(world: Dict[str, Any]) -> Dict[str, Any]:
    g = world.get(EDITOR_GRAPH_KEY)
    if isinstance(g, dict) and isinstance(g.get("nodes"), dict) and isinstance(g.get("edges"), dict):
        return g
    g = graph_from_world(world)
    world[EDITOR_GRAPH_KEY] = g
    return g


def insert_boundary_stroke(
    graph: Dict[str, Any], points: Sequence[Point], radius: float,
) -> Tuple[bool, str]:
    """Snap a simplified open stroke onto the graph. Both ends must connect."""
    pts = _poly_list(points)
    if len(pts) < 2:
        return False, "Stroke needs at least two points."
    start = nearest_graph_snap(graph, pts[0], radius)
    end = nearest_graph_snap(graph, pts[-1], radius)
    if not start:
        return False, (
            "Start of the line must snap to an existing boundary or junction. "
            "Begin drawing on the island edge or another border."
        )
    if not end:
        return False, (
            "End of the line must snap to an existing boundary or junction. "
            "There would be a gap, so the stroke was not saved."
        )
    n_start = realize_snap(graph, start)
    end = nearest_graph_snap(graph, pts[-1], radius) or end
    n_end = realize_snap(graph, end)
    pts[0] = graph_node_point(graph, n_start)
    pts[-1] = graph_node_point(graph, n_end)
    if n_start == n_end:
        return False, "A territory divider must connect two different places on the boundary network."
    if existing_graph_edge(graph, n_start, n_end) and len(pts) <= 3:
        return False, "That boundary already exists."
    island = classify_boundary_faces(graph).get("outer")
    if island:
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        if not point_in_ring((cx, cy), island):
            return False, "Internal boundaries must stay inside the island. The stroke was not saved."
    if _open_path_self_intersects(pts):
        return False, "Stroke intersects itself. Redraw the boundary without crossing."

    stroke_len = path_length(pts)
    if stroke_len <= GEOM_EPS:
        return False, "Stroke collapsed after snapping."

    cuts: List[Tuple[float, Point, Optional[str]]] = [
        (0.0, pts[0], None),
        (stroke_len, pts[-1], None),
    ]
    edge_hits: Dict[str, List[Point]] = defaultdict(list)
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        for eid in list(graph["edges"]):
            poly = _sync_edge_poly(graph, eid)
            for j in range(len(poly) - 1):
                ip = _segment_intersection(a, b, poly[j], poly[j + 1])
                if ip is None:
                    continue
                if edge_length(ip, pts[0]) <= NODE_MERGE_EPS or edge_length(ip, pts[-1]) <= NODE_MERGE_EPS:
                    continue
                along = polyline_along(pts, i, 0.0)
                seg = edge_length(a, b)
                t = 0.0 if seg <= GEOM_EPS else edge_length(a, ip) / seg
                along = polyline_along(pts, i, t)
                cuts.append((along, ip, eid))
                edge_hits[eid].append(ip)

    for eid, ips in list(edge_hits.items()):
        if eid not in graph["edges"]:
            continue
        uniq: List[Point] = []
        for ip in ips:
            if not any(edge_length(ip, u) <= NODE_MERGE_EPS for u in uniq):
                uniq.append(ip)
        for ip in uniq:
            if eid not in graph["edges"]:
                # previous split replaced eid; snap to whatever edge now contains ip
                hit = nearest_graph_snap(graph, ip, max(radius, 1.0))
                if hit and hit.get("kind") == "edge" and hit.get("edge"):
                    split_graph_edge(graph, hit["edge"], ip)
                elif hit and hit.get("kind") == "node":
                    continue
            else:
                split_graph_edge(graph, eid, ip)

    # Unique cuts along the stroke.
    cuts.sort(key=lambda c: c[0])
    merged_cuts: List[Tuple[float, Point]] = []
    for along, ip, _eid in cuts:
        if merged_cuts and abs(along - merged_cuts[-1][0]) <= NODE_MERGE_EPS:
            continue
        if merged_cuts and edge_length(ip, merged_cuts[-1][1]) <= NODE_MERGE_EPS:
            continue
        merged_cuts.append((along, ip))
    if len(merged_cuts) < 2:
        merged_cuts = [(0.0, pts[0]), (stroke_len, pts[-1])]

    node_chain: List[str] = []
    for along, ip in merged_cuts:
        snap = nearest_graph_snap(graph, ip, max(radius, NODE_MERGE_EPS * 20))
        if snap:
            node_chain.append(realize_snap(graph, snap))
        else:
            node_chain.append(add_graph_node(graph, ip))
    node_chain[0] = n_start
    node_chain[-1] = n_end

    added = 0
    for i in range(len(node_chain) - 1):
        a, b = node_chain[i], node_chain[i + 1]
        if a == b:
            continue
        if existing_graph_edge(graph, a, b):
            continue
        sub = slice_polyline_by_distance(pts, merged_cuts[i][0], merged_cuts[i + 1][0])
        sub[0] = graph_node_point(graph, a)
        sub[-1] = graph_node_point(graph, b)
        if add_graph_edge(graph, a, b, sub):
            added += 1
    if added == 0:
        return False, "That stroke did not add a new connected boundary (it may already exist)."
    return True, ""


def _open_path_self_intersects(pts: Sequence[Point]) -> bool:
    edges = [(pts[i], pts[i + 1]) for i in range(len(pts) - 1) if edge_length(pts[i], pts[i + 1]) > GEOM_EPS]
    n = len(edges)
    for i in range(n):
        a, b = edges[i]
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue
            c, d = edges[j]
            if _proper_intersect(a, b, c, d):
                return True
    return False


def apply_boundary_graph_to_world(world: Dict[str, Any]) -> None:
    """Rebuild island + territory polygons + geometric adjacency from the graph."""
    graph = ensure_boundary_graph(world)
    world[EDITOR_GRAPH_KEY] = graph
    faces = classify_boundary_faces(graph)
    outer = faces.get("outer")
    if outer and len(unique_ring_vertices(outer)) >= 3:
        if not isinstance(world.get("island"), dict):
            world["island"] = {"rings": []}
        set_exterior(world["island"], outer)
    else:
        world["island"] = {"rings": [[]]}

    terr_faces: List[Dict[str, Any]] = list(faces.get("territories") or [])
    old = [t for t in (world.get("territories") or []) if isinstance(t, dict)]
    used_old: Set[str] = set()
    new_terrs: List[Dict[str, Any]] = []
    face_index_for: List[int] = []

    if not (world.get("regions") or []) and terr_faces:
        add_region(world, "Region")
    regions = world.get("regions") or []
    default_rid = regions[0]["id"] if regions else ""

    for fi, face in enumerate(terr_faces):
        ring = face["ring"]
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
            used_old.add(match["id"])
            t = clone_world(match)
            if not isinstance(t.get("polygon"), dict):
                t["polygon"] = points_to_polygon(ring)
            else:
                set_exterior(t["polygon"], ring)
            new_terrs.append(t)
        else:
            player_id = world.get("playerFactionId") or ""
            ais = [f["id"] for f in world.get("factions") or [] if isinstance(f, dict) and f.get("role") == "ai"]
            if any(nt.get("startingOwnerFactionId") == player_id for nt in new_terrs):
                owner = ais[0] if ais else player_id
            else:
                owner = player_id
            tid = next_id("t_", [x.get("id") for x in new_terrs] + [x.get("id") for x in old])
            t = {
                "id": tid,
                "regionId": default_rid,
                "startingOwnerFactionId": owner,
                "neighborIds": [],
                "terrain": "plains",
                "resourceOutput": {k: 0 for k in RESOURCE_KEYS},
                "polygon": points_to_polygon(ring),
            }
            new_terrs.append(t)
        face_index_for.append(fi)

    # Fix owner assignment for brand-new maps: first tile player, rest first AI.
    player = world.get("playerFactionId") or ""
    ais = [f["id"] for f in world.get("factions") or [] if isinstance(f, dict) and f.get("role") == "ai"]
    player_owned = [t for t in new_terrs if t.get("startingOwnerFactionId") == player]
    if len(player_owned) == 0 and new_terrs:
        new_terrs[0]["startingOwnerFactionId"] = player
    elif len(player_owned) > 1:
        for t in new_terrs[1:]:
            if t.get("startingOwnerFactionId") == player:
                t["startingOwnerFactionId"] = ais[0] if ais else player

    world["territories"] = new_terrs
    ids = [t["id"] for t in new_terrs if t.get("id")]
    for r in world.get("regions") or []:
        r["territoryIds"] = [i for i in ids if find_territory(world, i) and find_territory(world, i).get("regionId") == r.get("id")]
        for t in new_terrs:
            if t.get("regionId") == r.get("id") and t.get("id") not in r["territoryIds"]:
                r["territoryIds"].append(t["id"])
    for t in new_terrs:
        if t.get("regionId") and default_rid and not find_region(world, t.get("regionId") or ""):
            t["regionId"] = default_rid
            sync_region_membership(world, t["id"], default_rid)
        elif t.get("id") and t.get("regionId"):
            sync_region_membership(world, t["id"], t["regionId"])

    # Geometric adjacency from shared boundary edges.
    edge_faces: Dict[str, List[int]] = defaultdict(list)
    for i, face in enumerate(terr_faces):
        for eid in face["edges"]:
            edge_faces[eid].append(i)
    neighbors: Dict[str, Set[str]] = {t["id"]: set() for t in new_terrs if t.get("id")}
    for _eid, idxs in edge_faces.items():
        uniq = []
        for i in idxs:
            if i not in uniq:
                uniq.append(i)
        if len(uniq) == 2:
            a = new_terrs[uniq[0]].get("id")
            b = new_terrs[uniq[1]].get("id")
            if a and b and a != b:
                neighbors[a].add(b)
                neighbors[b].add(a)
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
    if ids and player:
        fac = find_faction(world, player)
        if fac and not fac.get("homeTerritoryId"):
            owned = next((t["id"] for t in new_terrs if t.get("startingOwnerFactionId") == player), ids[0])
            fac["homeTerritoryId"] = owned
            army = fac.get("startingArmy")
            if isinstance(army, dict) and not army.get("locationTerritoryId"):
                army["locationTerritoryId"] = owned


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


def open_stroke_points(item: Dict[str, Any]) -> List[Point]:
    pts: List[Point] = []
    for p in item.get("points") or []:
        if isinstance(p, (list, tuple)) and len(p) >= 2:
            pts.append((float(p[0]), float(p[1])))
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


def commit_drawn_polyline(
    world: Dict[str, Any], points: Sequence[Point], snap_radius: float,
    min_spacing: Optional[float] = None,
) -> Tuple[bool, str]:
    """Commit a paused or finished stroke into island/territory topology."""
    raw = [(float(p[0]), float(p[1])) for p in points]
    spacing = DRAW_DEFAULT_MIN_SPACING if min_spacing is None else min_spacing
    g = ensure_boundary_graph(world)
    if not graph_has_island(g):
        pts, err = finalize_drawn_polygon(raw, min_spacing=spacing)
        if err or not pts:
            return False, (err or {}).get("message") or "Island stroke could not be closed."
        seed_island_from_ring(g, pts)
        apply_boundary_graph_to_world(world)
        return True, ""
    pts, err = finalize_drawn_path(raw, min_spacing=spacing)
    if err or not pts:
        return False, (err or {}).get("message") or "Boundary stroke is too short."
    ok, msg = insert_boundary_stroke(g, pts, snap_radius)
    if not ok:
        return False, msg
    apply_boundary_graph_to_world(world)
    return True, ""


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
# ---------------------------------------------------------------------------

def empty_drawing() -> Dict[str, Any]:
    return {"next": 1, "strokes": []}


def get_drawing(world: Dict[str, Any], create: bool = True) -> Dict[str, Any]:
    raw = world.get(EDITOR_DRAWING_KEY)
    if isinstance(raw, dict) and isinstance(raw.get("strokes"), list):
        raw.setdefault("next", 1)
        return raw
    store = empty_drawing()
    old = world.get(EDITOR_OPEN_STROKES_KEY)
    if isinstance(old, dict) and isinstance(old.get("items"), list):
        store["strokes"] = list(old["items"])
        store["next"] = int(old.get("next") or (len(store["strokes"]) + 1))
    if create:
        world[EDITOR_DRAWING_KEY] = store
    return store


def iter_drawing_strokes(world: Dict[str, Any]) -> List[Dict[str, Any]]:
    return list(get_drawing(world, create=False).get("strokes") or [])


def add_drawing_stroke(world: Dict[str, Any], points: Sequence[Point]) -> str:
    store = get_drawing(world)
    sid = f"d{store['next']:04d}"
    store["next"] += 1
    store["strokes"].append({"id": sid, "points": _as_open_points(points)})
    return sid


def put_drawing_stroke(world: Dict[str, Any], sid: str, points: Sequence[Point]) -> None:
    store = get_drawing(world)
    pts = _as_open_points(points)
    for item in store["strokes"]:
        if item.get("id") == sid:
            item["points"] = pts
            return
    store["strokes"].append({"id": sid, "points": pts})


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
    for item in iter_drawing_strokes(world):
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
    pts = open_stroke_points(item)
    if hit.get("which") == "start":
        pts = list(reversed(pts))
    return {"id": hit["id"], "which": hit["which"], "points": pts, "point": hit["point"]}


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


def conversion_snap_tol(points_groups: Sequence[Sequence[Point]], explicit: Optional[float] = None) -> float:
    if explicit is not None:
        return max(0.2, float(explicit))
    xs: List[float] = []
    ys: List[float] = []
    for pts in points_groups:
        for x, y in pts:
            xs.append(x)
            ys.append(y)
    if not xs:
        return CONVERT_SNAP_TOL_MIN
    diag = math.hypot(max(xs) - min(xs), max(ys) - min(ys))
    return max(CONVERT_SNAP_TOL_MIN, CONVERT_SNAP_FRAC * diag)


def _normalize_stroke(points: Sequence[Point]) -> List[Point]:
    sampled = sample_path_by_distance(points, DRAW_DEFAULT_MIN_SPACING)
    if len(sampled) < 2:
        return sampled
    return simplify_drawn_path(sampled)


def _polyline_hausdorff(a: Sequence[Point], b: Sequence[Point]) -> float:
    if not a or not b:
        return float("inf")
    ab = max(dist_point_to_polyline(p, b)[0] for p in a)
    ba = max(dist_point_to_polyline(p, a)[0] for p in b)
    return max(ab, ba)


def _ring_contains_ring(outer: Sequence[Point], inner: Sequence[Point]) -> bool:
    verts = unique_ring_vertices(inner)
    if len(verts) < 3:
        return False
    return all(point_in_ring(p, outer) for p in verts)


def clip_polyline_to_ring(pts: Sequence[Point], ring: Sequence[Point]) -> Tuple[List[List[Point]], bool]:
    """Keep sub-polylines whose midpoints lie inside (or on) the island."""
    if len(pts) < 2:
        return [], False
    chain: List[Point] = [(float(pts[0][0]), float(pts[0][1]))]
    verts = unique_ring_vertices(ring)
    for i in range(len(pts) - 1):
        a = (float(pts[i][0]), float(pts[i][1]))
        b = (float(pts[i + 1][0]), float(pts[i + 1][1]))
        hits: List[Point] = []
        for j, c in enumerate(verts):
            d = verts[(j + 1) % len(verts)]
            ip = _segment_intersection(a, b, c, d)
            if ip is None:
                continue
            if edge_length(ip, a) <= NODE_MERGE_EPS or edge_length(ip, b) <= NODE_MERGE_EPS:
                continue
            hits.append(ip)
        hits.sort(key=lambda p: edge_length(a, p))
        for h in hits:
            if edge_length(chain[-1], h) > NODE_MERGE_EPS:
                chain.append(h)
        if edge_length(chain[-1], b) > NODE_MERGE_EPS:
            chain.append(b)
    pieces: List[List[Point]] = []
    current: List[Point] = []
    clipped = False
    for i in range(len(chain) - 1):
        a, b = chain[i], chain[i + 1]
        mid = ((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5)
        if point_in_ring(mid, ring):
            if not current:
                current = [a]
            elif edge_length(current[-1], a) > NODE_MERGE_EPS:
                pieces.append(current)
                current = [a]
            if edge_length(current[-1], b) > GEOM_EPS:
                current.append(b)
        else:
            clipped = True
            if current:
                pieces.append(current)
                current = []
    if current:
        pieces.append(current)
    return [p for p in pieces if len(p) >= 2 and path_length(p) >= CONVERT_MIN_EDGE], clipped


def _nearest_on_polylines(
    p: Point, polylines: Sequence[Sequence[Point]], skip: Optional[int] = None,
) -> Optional[Tuple[float, Point, int]]:
    best: Optional[Tuple[float, Point, int]] = None
    for i, poly in enumerate(polylines):
        if i == skip or len(poly) < 2:
            continue
        d, q, _si, _t = dist_point_to_polyline(p, poly)
        if best is None or d < best[0]:
            best = (d, q, i)
    return best


def _ray_hit_segment(origin: Point, direction: Point, a: Point, b: Point) -> Optional[Tuple[float, Point]]:
    dx, dy = direction
    mag = math.hypot(dx, dy)
    if mag <= GEOM_EPS:
        return None
    rx, ry = dx / mag, dy / mag
    sx, sy = b[0] - a[0], b[1] - a[1]
    den = rx * sy - ry * sx
    if abs(den) <= GEOM_EPS:
        return None
    qx, qy = a[0] - origin[0], a[1] - origin[1]
    t = (qx * sy - qy * sx) / den
    u = (qx * ry - qy * rx) / den
    if t < -1e-9 or u < -1e-7 or u > 1.0 + 1e-7:
        return None
    t = max(0.0, t)
    return (t, (origin[0] + rx * t, origin[1] + ry * t))


def _ray_hit_polylines(
    origin: Point,
    direction: Point,
    polylines: Sequence[Sequence[Point]],
    skip: Optional[int],
    max_dist: float,
) -> Optional[Tuple[float, Point, int]]:
    best: Optional[Tuple[float, Point, int]] = None
    for i, poly in enumerate(polylines):
        if i == skip or len(poly) < 2:
            continue
        for j in range(len(poly) - 1):
            hit = _ray_hit_segment(origin, direction, poly[j], poly[j + 1])
            if hit is None:
                continue
            t, p = hit
            if t <= NODE_MERGE_EPS or t > max_dist:
                continue
            if best is None or t < best[0]:
                best = (t, p, i)
    return best


def conversion_extend_max(points_groups: Sequence[Sequence[Point]], snap_tol: float) -> float:
    xs: List[float] = []
    ys: List[float] = []
    for pts in points_groups:
        for x, y in pts:
            xs.append(x)
            ys.append(y)
    if not xs:
        return max(snap_tol * 2.0, 4.0)
    diag = math.hypot(max(xs) - min(xs), max(ys) - min(ys))
    return max(snap_tol * 2.0, CONVERT_EXTEND_FRAC * diag)


def _extend_polyline_ends(
    poly: List[Point],
    others: Sequence[Sequence[Point]],
    skip: int,
    snap_tol: float,
    extend_max: float,
) -> Tuple[List[Point], bool]:
    """Connect loose ends: near-snap first, then ray-extend along the stroke."""
    out = list(poly)
    if len(out) < 2:
        return out, False
    plen = path_length(out)
    max_gap = max(snap_tol, min(extend_max, 0.5 * max(plen, snap_tol)))
    changed = False
    ends = ((0, 1), (-1, -2))
    for end_idx, inward_idx in ends:
        p = out[end_idx]
        inward = out[inward_idx]
        direction = (p[0] - inward[0], p[1] - inward[1])
        near = _nearest_on_polylines(p, others, skip=skip)
        chosen: Optional[Point] = None
        if near and near[0] <= snap_tol:
            if near[0] > NODE_MERGE_EPS:
                chosen = near[1]
        else:
            ray = _ray_hit_polylines(p, direction, others, skip, max_gap)
            if ray is not None:
                chosen = ray[1]
            elif near is not None and near[0] <= max_gap:
                vx, vy = near[1][0] - p[0], near[1][1] - p[1]
                mag_dir = math.hypot(direction[0], direction[1]) or 1.0
                if vx * direction[0] + vy * direction[1] >= 0.05 * near[0] * mag_dir:
                    chosen = near[1]
        if chosen is None:
            continue
        if end_idx == 0:
            if edge_length(out[0], chosen) > NODE_MERGE_EPS:
                out.insert(0, chosen)
                changed = True
        else:
            if edge_length(out[-1], chosen) > NODE_MERGE_EPS:
                out.append(chosen)
                changed = True
    return out, changed


def _insert_point_on_polyline(poly: List[Point], q: Point) -> List[Point]:
    _d, snap, si, _t = dist_point_to_polyline(q, poly)
    if si + 1 >= len(poly):
        return poly
    if edge_length(poly[si], snap) <= NODE_MERGE_EPS or edge_length(poly[si + 1], snap) <= NODE_MERGE_EPS:
        return poly
    out = list(poly)
    out.insert(si + 1, snap)
    return out


def _split_polyline_by_on_edge_points(poly: Sequence[Point], extras: Sequence[Point]) -> List[Point]:
    """Keep original vertices and splice intersection points onto the segments they hit."""
    if len(poly) < 2:
        return list(poly)
    out: List[Point] = [(float(poly[0][0]), float(poly[0][1]))]
    for i in range(len(poly) - 1):
        a = (float(poly[i][0]), float(poly[i][1]))
        b = (float(poly[i + 1][0]), float(poly[i + 1][1]))
        mids: List[Tuple[float, Point]] = []
        for raw in extras:
            p = (float(raw[0]), float(raw[1]))
            d, q, t = dist_point_to_segment(p, a, b)
            if d > max(NODE_MERGE_EPS * 80.0, 1e-4):
                continue
            if t <= 1e-4 or t >= 1.0 - 1e-4:
                continue
            mids.append((t, q))
        mids.sort(key=lambda item: item[0])
        for _t, q in mids:
            if edge_length(out[-1], q) > NODE_MERGE_EPS:
                out.append(q)
        if edge_length(out[-1], b) > NODE_MERGE_EPS:
            out.append(b)
    return out


def _split_polylines_at_intersections(polylines: List[List[Point]], closed_flags: List[bool]) -> List[List[Point]]:
    extras: List[List[Point]] = [[] for _ in polylines]
    for i, poly in enumerate(polylines):
        nseg = max(0, len(poly) - 1)
        for sa in range(nseg):
            a0, a1 = poly[sa], poly[sa + 1]
            for j in range(i, len(polylines)):
                other = polylines[j]
                mseg = max(0, len(other) - 1)
                start_sb = sa + 2 if i == j else 0
                for sb in range(start_sb, mseg):
                    if i == j and closed_flags[i] and sa == 0 and sb == mseg - 1:
                        continue
                    ip = _segment_intersection(a0, a1, other[sb], other[sb + 1])
                    if ip is None:
                        continue
                    extras[i].append(ip)
                    extras[j].append(ip)
    return [_split_polyline_by_on_edge_points(poly, extras[i]) for i, poly in enumerate(polylines)]


def _arrangement_graph(
    island: Sequence[Point], internals: Sequence[Sequence[Point]], snap_tol: float,
) -> Dict[str, Any]:
    island_poly = unique_ring_vertices(island)
    if len(island_poly) < 3:
        return empty_boundary_graph()
    island_closed = island_poly + [island_poly[0]]
    paths: List[List[Point]] = [list(island_closed)]
    closed_flags = [True]
    for internal in internals:
        if len(internal) >= 2:
            paths.append(list(internal))
            closed_flags.append(False)
    # T-junctions: snap loose ends onto other paths.
    for i in range(1, len(paths)):
        for end_idx in (0, -1):
            hit = _nearest_on_polylines(paths[i][end_idx], paths, skip=i)
            if hit and hit[0] <= snap_tol:
                q = hit[1]
                j = hit[2]
                paths[j] = _insert_point_on_polyline(paths[j], q)
                if end_idx == 0:
                    paths[i][0] = q
                else:
                    paths[i][-1] = q
    paths = _split_polylines_at_intersections(paths, closed_flags)
    merge_eps = max(NODE_MERGE_EPS, min(0.12, snap_tol * 0.12))
    graph = empty_boundary_graph()
    for pi, poly in enumerate(paths):
        pts = unique_ring_vertices(poly) if closed_flags[pi] else list(poly)
        nids: List[str] = []
        for p in pts:
            nids.append(add_graph_node(graph, p, merge_eps=merge_eps))
        count = len(nids)
        for k in range(count if closed_flags[pi] else count - 1):
            a = nids[k]
            b = nids[(k + 1) % count] if closed_flags[pi] else nids[k + 1]
            if a == b:
                continue
            pa, pb = graph_node_point(graph, a), graph_node_point(graph, b)
            add_graph_edge(graph, a, b, [pa, pb])
    _trim_dangling_edges(graph)
    return graph


def _trim_dangling_edges(graph: Dict[str, Any]) -> None:
    guard = 0
    while guard < 10000:
        guard += 1
        inc: Dict[str, List[str]] = defaultdict(list)
        for eid, e in graph["edges"].items():
            inc[e["a"]].append(eid)
            inc[e["b"]].append(eid)
        dangling = [nid for nid, eids in inc.items() if len(eids) == 1]
        if not dangling:
            break
        for nid in dangling:
            for eid in list(inc.get(nid) or []):
                graph["edges"].pop(eid, None)
        used: Set[str] = set()
        for e in graph["edges"].values():
            used.add(e["a"])
            used.add(e["b"])
        graph["nodes"] = {nid: pt for nid, pt in graph["nodes"].items() if nid in used}


def _choose_island(
    strokes: Sequence[Dict[str, Any]], existing: Optional[Sequence[Point]],
) -> Tuple[Optional[List[Point]], Optional[str], List[str], List[str]]:
    """Return island ring, winning stroke id, warnings, errors."""
    warnings: List[str] = []
    errors: List[str] = []
    candidates: List[Dict[str, Any]] = []
    for item in strokes:
        pts = _normalize_stroke(open_stroke_points(item))
        if len(pts) < 3:
            continue
        closed = close_ring(pts)
        gap = edge_length(pts[0], pts[-1])
        peri = path_length(closed)
        area = abs(ring_area(closed))
        if area < CONVERT_MIN_ISLAND_AREA or peri < DRAW_MIN_PATH_LENGTH:
            continue
        if ring_self_intersects(closed):
            continue
        if gap > max(CONVERT_ISLAND_CLOSE_ABS, CONVERT_ISLAND_CLOSE_FRAC * peri):
            continue
        candidates.append({"id": item.get("id"), "ring": closed, "area": area})
    candidates.sort(key=lambda c: c["area"], reverse=True)
    if existing and len(unique_ring_vertices(existing)) >= 3:
        exist_area = abs(ring_area(existing))
        if exist_area >= CONVERT_MIN_ISLAND_AREA and not candidates:
            return list(close_ring(unique_ring_vertices(existing))), None, warnings, errors
    if not candidates:
        errors.append(
            "No island could be identified. Draw a large enclosing outline that nearly closes, then convert."
        )
        return None, None, warnings, errors
    best = candidates[0]
    for other in candidates[1:]:
        if other["area"] < 0.65 * best["area"]:
            continue
        if _ring_contains_ring(best["ring"], other["ring"]):
            warnings.append("Ignored a smaller closed loop inside the island (holes are not territories).")
            continue
        if _ring_contains_ring(other["ring"], best["ring"]):
            best = other
            continue
        errors.append(
            "Ambiguous island: two large closed shapes were found. "
            "Keep one main enclosing outline and convert again."
        )
        return None, None, warnings, errors
    return list(best["ring"]), str(best["id"]) if best.get("id") else None, warnings, errors


def interpret_drawing_strokes(
    strokes: Sequence[Dict[str, Any]],
    *,
    existing_island: Optional[Sequence[Point]] = None,
    snap_tol: Optional[float] = None,
) -> Dict[str, Any]:
    """Interpret raw freehand strokes into island + territory rings. Does not require perfect topology."""
    report: Dict[str, Any] = {
        "ok": False,
        "islandStrokeId": None,
        "territoryCount": 0,
        "usedInternalIds": [],
        "ignored": [],
        "clipped": [],
        "extended": [],
        "warnings": [],
        "ambiguous": False,
    }
    normalized: List[Dict[str, Any]] = []
    for item in strokes:
        pts = _normalize_stroke(open_stroke_points(item))
        sid = str(item.get("id") or "")
        if len(pts) < 2 or path_length(pts) < CONVERT_MIN_EDGE:
            report["ignored"].append({"id": sid, "reason": "tiny mark"})
            continue
        normalized.append({"id": sid, "points": pts})
    # Drop near-duplicate strokes (keep the longer).
    prov_tol = conversion_snap_tol([k["points"] for k in normalized], snap_tol)
    dup_tol = max(CONVERT_DUP_TOL, 0.45 * prov_tol)
    kept: List[Dict[str, Any]] = []
    for item in sorted(normalized, key=lambda s: path_length(s["points"]), reverse=True):
        dup = False
        for prev in kept:
            if _polyline_hausdorff(item["points"], prev["points"]) <= dup_tol:
                report["ignored"].append({"id": item["id"], "reason": "duplicate stroke"})
                dup = True
                break
        if not dup:
            kept.append(item)
    island, island_id, warnings, errors = _choose_island(kept, existing_island)
    report["warnings"].extend(warnings)
    if errors:
        report["ambiguous"] = any("Ambiguous" in e for e in errors)
        report["ok"] = False
        report["message"] = errors[0]
        return {"ok": False, "message": errors[0], "island": None, "territories": [], "graph": None, "report": report}
    assert island is not None
    report["islandStrokeId"] = island_id
    tol = conversion_snap_tol([island] + [k["points"] for k in kept], snap_tol)
    extend_max = conversion_extend_max([island] + [k["points"] for k in kept], tol)
    island_closed = unique_ring_vertices(island) + [unique_ring_vertices(island)[0]]
    min_loop = max(DRAW_MIN_AREA, abs(ring_area(island)) * CONVERT_SLIVER_FRAC)
    internals: List[Dict[str, Any]] = []
    for item in kept:
        if item["id"] and item["id"] == island_id:
            continue
        if _polyline_hausdorff(item["points"], island_closed) <= dup_tol:
            report["ignored"].append({"id": item["id"], "reason": "duplicate of island outline"})
            continue
        gap = edge_length(item["points"][0], item["points"][-1])
        closed_loop = gap <= max(tol, 0.12 * path_length(item["points"]))
        if closed_loop:
            loop_area = abs(ring_area(close_ring(item["points"])))
            if loop_area < min_loop:
                report["ignored"].append({"id": item["id"], "reason": "tiny accidental loop"})
                continue
            if loop_area < 0.65 * abs(ring_area(island)) and _ring_contains_ring(island, close_ring(item["points"])):
                report["ignored"].append({"id": item["id"], "reason": "interior closed loop (holes are not territories)"})
                continue
        pieces, clipped = clip_polyline_to_ring(item["points"], island)
        if clipped:
            report["clipped"].append({"id": item["id"], "reason": "outside island clipped"})
        if not pieces:
            report["ignored"].append({"id": item["id"], "reason": "outside island or too short after clip"})
            continue
        for piece in pieces:
            internals.append({"id": item["id"], "points": piece})
    # Extend loose ends toward the island and other internals.
    for _pass in range(4):
        changed = False
        paths = [list(island_closed)]
        paths.extend(p["points"] for p in internals)
        for i, item in enumerate(internals):
            extended, did = _extend_polyline_ends(
                item["points"], paths, skip=i + 1, snap_tol=tol, extend_max=extend_max,
            )
            if did:
                internals[i]["points"] = extended
                if item["id"] not in report["extended"]:
                    report["extended"].append(item["id"])
                changed = True
        if not changed:
            break
    internals = [p for p in internals if path_length(p["points"]) >= CONVERT_MIN_EDGE]
    graph = _arrangement_graph(island, [p["points"] for p in internals], tol)
    faces = classify_boundary_faces(graph)
    outer = faces.get("outer") or island
    min_t = max(DRAW_MIN_AREA, abs(ring_area(outer)) * CONVERT_SLIVER_FRAC)
    terrs: List[List[Point]] = []
    for face in faces.get("territories") or []:
        ring = face.get("ring") or []
        if abs(ring_area(ring)) >= min_t and len(unique_ring_vertices(ring)) >= 3:
            terrs.append(ring)
    if not terrs and not internals:
        terrs = [close_ring(unique_ring_vertices(outer))]
    elif not terrs and internals:
        report["warnings"].append(
            "Internal lines did not form closed territories. They may not meet the island; try drawing across it."
        )
    report["ok"] = bool(terrs)
    report["territoryCount"] = len(terrs)
    report["usedInternalIds"] = sorted({p["id"] for p in internals if p.get("id")})
    if not terrs:
        msg = "Could not derive any territory from the drawing."
        report["message"] = msg
        return {
            "ok": False,
            "message": msg,
            "island": outer,
            "territories": [],
            "graph": graph,
            "report": report,
        }
    report["message"] = ""
    return {
        "ok": True,
        "message": "",
        "island": outer,
        "territories": terrs,
        "graph": graph,
        "report": report,
    }


def convert_drawing_to_map(world: Dict[str, Any], snap_tol: Optional[float] = None) -> Dict[str, Any]:
    """Rebuild island/territories from raw drawing. Raw strokes are preserved."""
    strokes = all_raw_strokes(world)
    existing = polygon_exterior(world.get("island") if isinstance(world.get("island"), dict) else None)
    result = interpret_drawing_strokes(strokes, existing_island=existing, snap_tol=snap_tol)
    report = dict(result.get("report") or {})
    report["ok"] = bool(result.get("ok"))
    report["message"] = result.get("message") or report.get("message") or ""
    world[EDITOR_CONVERT_REPORT_KEY] = report
    result["report"] = report
    if not result.get("ok"):
        return result
    graph = result.get("graph")
    if not isinstance(graph, dict):
        msg = "Conversion produced no boundary network."
        report["ok"] = False
        report["message"] = msg
        world[EDITOR_CONVERT_REPORT_KEY] = report
        return {**result, "ok": False, "message": msg, "report": report}
    world[EDITOR_GRAPH_KEY] = graph
    apply_boundary_graph_to_world(world)
    if not world.get("territories") and result.get("territories"):
        if not (world.get("regions") or []):
            add_region(world, "Region")
        rid = (world.get("regions") or [{}])[0].get("id") or ""
        owner = world.get("playerFactionId") or ""
        add_territory(world, result["territories"][0], rid, owner)
    return result


def format_conversion_report(result: Dict[str, Any]) -> str:
    report = result.get("report") if isinstance(result.get("report"), dict) else result
    if not isinstance(report, dict):
        report = {}
    ok = result.get("ok")
    if ok is None:
        ok = report.get("ok")
    message = result.get("message") or report.get("message") or ""
    lines = []
    if ok:
        lines.append("CONVERT TO MAP — interpreted drawing into structured geography.")
    else:
        lines.append("CONVERT TO MAP — could not interpret the drawing.")
        if message:
            lines.append(message)
    lines.append(f"Territories detected: {report.get('territoryCount', 0)}")
    if report.get("islandStrokeId"):
        lines.append(f"Island stroke: {report.get('islandStrokeId')}")
    used = report.get("usedInternalIds") or []
    if used:
        lines.append("Internal strokes used: " + ", ".join(used))
    for item in report.get("clipped") or []:
        lines.append(f"Clipped {item.get('id')}: {item.get('reason')}")
    for item in report.get("ignored") or []:
        lines.append(f"Ignored {item.get('id')}: {item.get('reason')}")
    if report.get("extended"):
        lines.append("Loose ends extended: " + ", ".join(str(x) for x in report["extended"]))
    for w in report.get("warnings") or []:
        lines.append("Warning: " + w)
    return "\n".join(lines)


def dumps_editor_document(world: Dict[str, Any]) -> str:
    """Save converted geography plus raw drawing (not a playable export)."""
    payload = ordered_world(world)
    payload[EDITOR_DRAWING_KEY] = clone_world(get_drawing(world, create=False))
    report = world.get(EDITOR_CONVERT_REPORT_KEY)
    if isinstance(report, dict):
        payload[EDITOR_CONVERT_REPORT_KEY] = clone_world(report)
    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n"


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
        EDITOR_GRAPH_KEY: empty_boundary_graph(),
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
        g = ensure_boundary_graph(w)
        self.assertEqual(g["nodes"], {})
        self.assertEqual(g["edges"], {})

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


def _square_ring() -> List[Point]:
    return [(0.0, 0.0), (20.0, 0.0), (20.0, 20.0), (0.0, 20.0), (0.0, 0.0)]


def _world_with_square_island() -> Dict[str, Any]:
    w = new_blank_world()
    seed_island_from_ring(ensure_boundary_graph(w), _square_ring())
    apply_boundary_graph_to_world(w)
    return w


class BoundaryGraphTests(unittest.TestCase):
    def test_new_map_starts_with_no_island(self) -> None:
        w = new_blank_world()
        self.assertFalse(polygon_exterior(w["island"]))
        self.assertEqual(w["territories"], [])
        self.assertFalse(graph_has_island(ensure_boundary_graph(w)))

    def test_continuous_draw_creates_organic_island(self) -> None:
        w = new_blank_world()
        closed, err = finalize_drawn_polygon(_organic_coast_path(360))
        self.assertIsNone(err)
        assert closed is not None
        seed_island_from_ring(ensure_boundary_graph(w), closed)
        apply_boundary_graph_to_world(w)
        isle = polygon_exterior(w["island"])
        self.assertIsNotNone(isle)
        verts = unique_ring_vertices(isle or [])
        self.assertGreaterEqual(len(verts), 24)
        self.assertEqual(w["territories"], [])
        self.assertFalse(ring_self_intersects(isle or []))
        self.assertGreater(abs(ring_area(isle or [])), DRAW_MIN_AREA)

    def test_chord_snaps_and_creates_two_territories(self) -> None:
        w = _world_with_square_island()
        g = ensure_boundary_graph(w)
        start = nearest_graph_snap(g, (10.0, 0.2), 1.0)
        end = nearest_graph_snap(g, (10.0, 19.8), 1.0)
        self.assertIsNotNone(start)
        self.assertIsNotNone(end)
        assert start is not None and end is not None
        self.assertEqual(start["kind"], "edge")
        self.assertEqual(end["kind"], "edge")
        ok, msg = insert_boundary_stroke(g, [(10.0, 0.2), (10.0, 10.0), (10.0, 19.8)], 1.0)
        self.assertTrue(ok, msg=msg)
        apply_boundary_graph_to_world(w)
        self.assertEqual(len(w["territories"]), 2)
        for t in w["territories"]:
            self.assertEqual(_check_polygon(t["polygon"], t["id"]), [])
        a, b = w["territories"]
        self.assertIn(b["id"], a["neighborIds"])
        self.assertIn(a["id"], b["neighborIds"])
        n_start = realize_snap(g, nearest_graph_snap(g, (10.0, 0.0), 1.0) or start)
        n_end = realize_snap(g, nearest_graph_snap(g, (10.0, 20.0), 1.0) or end)
        self.assertNotEqual(n_start, n_end)
        self.assertEqual(graph_node_point(g, n_start), nearest_graph_snap(g, (10.0, 0.0), 1.0)["point"])  # type: ignore[index]

    def test_start_and_end_snap_share_exact_nodes(self) -> None:
        w = _world_with_square_island()
        g = ensure_boundary_graph(w)
        raw = [(0.15, 10.0), (10.0, 10.0), (19.85, 10.0)]
        ok, msg = insert_boundary_stroke(g, raw, 1.0)
        self.assertTrue(ok, msg=msg)
        s = nearest_graph_snap(g, (0.0, 10.0), 0.6)
        e = nearest_graph_snap(g, (20.0, 10.0), 0.6)
        self.assertIsNotNone(s)
        self.assertIsNotNone(e)
        assert s and e
        self.assertEqual(s["kind"], "node")
        self.assertEqual(e["kind"], "node")
        self.assertLess(edge_length(s["point"], (0.0, 10.0)), NODE_MERGE_EPS * 20)
        self.assertLess(edge_length(e["point"], (20.0, 10.0)), NODE_MERGE_EPS * 20)

    def test_vertex_snap_beats_edge_snap(self) -> None:
        w = _world_with_square_island()
        g = ensure_boundary_graph(w)
        snap = nearest_graph_snap(g, (0.3, 0.2), 1.5)
        self.assertIsNotNone(snap)
        assert snap is not None
        self.assertEqual(snap["kind"], "node")
        self.assertEqual(snap["point"], (0.0, 0.0))

    def test_branch_from_mid_edge_creates_shared_node(self) -> None:
        w = _world_with_square_island()
        g = ensure_boundary_graph(w)
        self.assertTrue(insert_boundary_stroke(g, [(10.0, 0.2), (10.0, 19.8)], 1.0)[0])
        apply_boundary_graph_to_world(w)
        self.assertEqual(len(w["territories"]), 2)
        mid = nearest_graph_snap(g, (10.0, 10.0), 1.0)
        self.assertIsNotNone(mid)
        assert mid is not None
        nid = realize_snap(g, mid)
        # Branch to the right island wall.
        g2 = ensure_boundary_graph(w)
        ok, msg = insert_boundary_stroke(g2, [(10.05, 10.0), (15.0, 10.0), (19.8, 10.0)], 1.0)
        self.assertTrue(ok, msg=msg)
        apply_boundary_graph_to_world(w)
        self.assertEqual(len(w["territories"]), 3)
        junction = nearest_graph_snap(ensure_boundary_graph(w), (10.0, 10.0), 0.6)
        self.assertIsNotNone(junction)
        assert junction is not None
        self.assertEqual(junction["kind"], "node")
        inc = sum(
            1
            for e in ensure_boundary_graph(w)["edges"].values()
            if e["a"] == junction["node"] or e["b"] == junction["node"]
        )
        self.assertGreaterEqual(inc, 3)

    def test_open_unsnapped_stroke_is_not_a_territory(self) -> None:
        w = _world_with_square_island()
        g = ensure_boundary_graph(w)
        before = len(w["territories"])
        ok, msg = insert_boundary_stroke(g, [(5.0, 5.0), (8.0, 8.0), (6.0, 12.0)], 0.8)
        self.assertFalse(ok)
        self.assertIn("snap", msg.lower())
        apply_boundary_graph_to_world(w)
        self.assertEqual(len(w["territories"]), before)

    def test_tiny_gap_is_not_left_after_snap(self) -> None:
        w = _world_with_square_island()
        g = ensure_boundary_graph(w)
        ok, msg = insert_boundary_stroke(g, [(10.4, 0.3), (10.2, 10.0), (9.7, 19.6)], 1.2)
        self.assertTrue(ok, msg=msg)
        apply_boundary_graph_to_world(w)
        g = ensure_boundary_graph(w)
        top = nearest_graph_snap(g, (10.0, 20.0), 1.2)
        bot = nearest_graph_snap(g, (10.0, 0.0), 1.2)
        self.assertIsNotNone(top)
        self.assertIsNotNone(bot)
        assert top and bot
        self.assertEqual(top["kind"], "node")
        self.assertEqual(bot["kind"], "node")
        self.assertEqual(graph_node_point(g, top["node"]), top["point"])
        self.assertEqual(graph_node_point(g, bot["node"]), bot["point"])

    def test_shared_node_move_updates_both_territories(self) -> None:
        w = _world_with_square_island()
        g = ensure_boundary_graph(w)
        self.assertTrue(insert_boundary_stroke(g, [(10.0, 0.2), (10.0, 19.8)], 1.0)[0])
        apply_boundary_graph_to_world(w)
        g = ensure_boundary_graph(w)
        snap = nearest_graph_snap(g, (10.0, 0.0), 0.8)
        self.assertIsNotNone(snap)
        assert snap and snap.get("node")
        move_graph_node(g, snap["node"], (12.0, 0.0))
        apply_boundary_graph_to_world(w)
        p = (12.0, 0.0)
        hits = 0
        for t in w["territories"]:
            ext = polygon_exterior(t["polygon"])
            if ext and any(almost_equal(v[0], p[0]) and almost_equal(v[1], p[1]) for v in unique_ring_vertices(ext)):
                hits += 1
        self.assertGreaterEqual(hits, 2)

    def test_undo_redo_topology_stroke(self) -> None:
        w = _world_with_square_island()
        stack = UndoStack()
        stack.push(w)
        g = ensure_boundary_graph(w)
        self.assertTrue(insert_boundary_stroke(g, [(10.0, 0.2), (10.0, 19.8)], 1.0)[0])
        apply_boundary_graph_to_world(w)
        self.assertEqual(len(w["territories"]), 2)
        restored = stack.apply_undo(w)
        self.assertIsNotNone(restored)
        assert restored is not None
        self.assertEqual(len(restored["territories"]), 0)
        redone = stack.apply_redo(restored)
        self.assertIsNotNone(redone)
        assert redone is not None
        self.assertEqual(len(redone["territories"]), 2)

    def test_export_strips_editor_graph_and_keeps_schema(self) -> None:
        w = _world_with_square_island()
        add_ai_faction(w)
        g = ensure_boundary_graph(w)
        self.assertTrue(insert_boundary_stroke(g, [(10.0, 0.2), (10.0, 19.8)], 1.0)[0])
        apply_boundary_graph_to_world(w)
        owned = [t for t in w["territories"] if t.get("startingOwnerFactionId") == "f_player"]
        if owned:
            fac = find_faction(w, "f_player")
            fac["homeTerritoryId"] = owned[0]["id"]
            fac["startingArmy"]["locationTerritoryId"] = owned[0]["id"]
        ai = find_faction(w, "f_ai_01")
        ai_t = next(t for t in w["territories"] if t.get("startingOwnerFactionId") != "f_player")
        ai["homeTerritoryId"] = ai_t["id"]
        ai["startingArmy"]["locationTerritoryId"] = ai_t["id"]
        text = dumps_world(w)
        self.assertNotIn(EDITOR_GRAPH_KEY, text)
        data = json.loads(text)
        self.assertEqual(data["formatVersion"], FORMAT_VERSION)
        self.assertEqual(len(data["territories"]), 2)
        self.assertIn("neighborIds", data["territories"][0])
        for t in data["territories"]:
            for p in t["polygon"]["rings"][0]:
                self.assertEqual(set(p.keys()), {"x", "y"})
        again, issues = parse_world_json(text)
        self.assertEqual(issues, [], msg=issues)
        self.assertIsNotNone(again)


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


def _cvt_stroke(sid: str, pts: Sequence[Point]) -> Dict[str, Any]:
    return {"id": sid, "points": [(float(p[0]), float(p[1])) for p in pts]}


def _cvt_square() -> List[Point]:
    return [(0.0, 0.0), (20.0, 0.0), (20.0, 20.0), (0.0, 20.0), (0.0, 0.0)]


def _cvt_interpret(*polylines: Sequence[Point]) -> Dict[str, Any]:
    strokes = [_cvt_stroke(f"s{i}", pts) for i, pts in enumerate(polylines)]
    return interpret_drawing_strokes(strokes)


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


def _wavy_divider(x: float, y0: float, y1: float, n: int = 48, amp: float = 1.15) -> List[Point]:
    pts: List[Point] = []
    steps = max(n, 8)
    for i in range(steps):
        t = i / float(steps - 1)
        y = y0 + (y1 - y0) * t
        pts.append((x + amp * math.sin(t * math.pi * 3.0), y))
    return pts


class DrawingConvertTests(unittest.TestCase):
    def test_simple_island_no_internal_lines(self) -> None:
        result = _cvt_interpret(_cvt_square())
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 1)
        self.assertGreater(abs(ring_area(result["island"])), 300.0)

    def test_island_divided_by_one_line(self) -> None:
        result = _cvt_interpret(_cvt_square(), [(10.0, -0.2), (10.0, 20.2)])
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 2)

    def test_two_crossing_lines_make_four_territories(self) -> None:
        result = _cvt_interpret(
            _cvt_square(),
            [(10.0, -1.0), (10.0, 21.0)],
            [(-1.0, 10.0), (21.0, 10.0)],
        )
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 4)

    def test_many_territories_from_grid_dividers(self) -> None:
        result = _cvt_interpret(
            _cvt_square(),
            [(6.5, -1.0), (6.5, 21.0)],
            [(13.5, -1.0), (13.5, 21.0)],
            [(-1.0, 10.0), (21.0, 10.0)],
        )
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 6)

    def test_internal_line_ending_slightly_short_of_boundary(self) -> None:
        result = _cvt_interpret(_cvt_square(), [(10.0, 1.6), (10.0, 18.4)])
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 2)
        self.assertTrue(result["report"].get("extended"))

    def test_internal_line_slightly_crossing_outside_is_clipped(self) -> None:
        result = _cvt_interpret(_cvt_square(), [(10.0, -4.0), (10.0, 24.0)])
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 2)
        self.assertTrue(result["report"].get("clipped"))
        isle = result["island"]
        for ring in result["territories"]:
            self.assertTrue(all_vertices_inside(unique_ring_vertices(ring), isle))

    def test_loose_ended_internal_line(self) -> None:
        result = _cvt_interpret(_cvt_square(), [(10.0, 0.4), (10.0, 17.2)])
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 2)

    def test_multiple_loose_ended_lines(self) -> None:
        result = _cvt_interpret(
            _cvt_square(),
            [(7.0, 1.4), (7.0, 18.5)],
            [(13.0, 1.7), (13.0, 18.2)],
        )
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 3)

    def test_lines_intersecting(self) -> None:
        result = _cvt_interpret(
            _cvt_square(),
            [(2.0, 2.0), (18.0, 18.0)],
            [(18.0, 2.0), (2.0, 18.0)],
        )
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 4)

    def test_nearly_touching_lines(self) -> None:
        result = _cvt_interpret(
            _cvt_square(),
            [(10.0, 0.2), (10.0, 19.8)],
            [(10.4, 10.0), (19.7, 10.0)],
        )
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 3)

    def test_tiny_accidental_loops_ignored(self) -> None:
        speck = [(4.0, 4.0), (4.4, 4.0), (4.4, 4.35), (4.0, 4.35), (4.0, 4.0)]
        result = _cvt_interpret(_cvt_square(), speck)
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 1)
        ignored = [i.get("reason", "") for i in result["report"].get("ignored") or []]
        self.assertTrue(any("tiny" in r or "loop" in r for r in ignored))

    def test_stray_strokes_outside_island_ignored(self) -> None:
        result = _cvt_interpret(
            _cvt_square(),
            [(30.0, 5.0), (40.0, 8.0), (38.0, 12.0)],
        )
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 1)
        ignored = [i.get("reason", "") for i in result["report"].get("ignored") or []]
        self.assertTrue(any("outside" in r for r in ignored))

    def test_organic_island_outline_preserved(self) -> None:
        raw = _organic_coast_path(360)
        result = _cvt_interpret(raw)
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 1)
        verts = unique_ring_vertices(result["island"])
        self.assertGreaterEqual(len(verts), 24)
        orig = abs(ring_area(close_ring(raw)))
        got = abs(ring_area(result["island"]))
        self.assertLess(abs(got - orig) / orig, 0.12)

    def test_organic_territory_boundaries_preserved(self) -> None:
        raw = _organic_coast_path(280)
        divider = _wavy_divider(48.0, 8.0, 72.0, n=60, amp=1.4)
        result = _cvt_interpret(raw, divider)
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 2)
        for ring in result["territories"]:
            self.assertGreaterEqual(len(unique_ring_vertices(ring)), 8)

    def test_dense_freehand_point_data(self) -> None:
        dense = _dense_square_path(70)
        divider: List[Point] = []
        for i in range(90):
            t = i / 89.0
            divider.append((40.0, 10.0 + 60.0 * t))
        result = _cvt_interpret(dense, divider)
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 2)

    def test_duplicate_strokes_do_not_multiply_territories(self) -> None:
        line = [(10.0, -0.5), (10.0, 20.5)]
        jittered = [(10.05, -0.4), (10.08, 10.0), (9.96, 20.4)]
        result = _cvt_interpret(_cvt_square(), line, jittered)
        self.assertTrue(result["ok"], msg=result.get("message"))
        self.assertEqual(len(result["territories"]), 2)
        ignored = [i.get("reason", "") for i in result["report"].get("ignored") or []]
        self.assertTrue(any("duplicate" in r for r in ignored))

    def test_ambiguous_two_islands_reports_error(self) -> None:
        a = _cvt_square()
        b = [(40.0, 0.0), (60.0, 0.0), (60.0, 20.0), (40.0, 20.0), (40.0, 0.0)]
        result = _cvt_interpret(a, b)
        self.assertFalse(result["ok"])
        self.assertTrue(result["report"].get("ambiguous"))
        self.assertIn("Ambiguous", result.get("message") or "")

    def test_no_island_drawn(self) -> None:
        result = _cvt_interpret([(1.0, 1.0), (8.0, 2.0), (4.0, 9.0)])
        self.assertFalse(result["ok"])
        self.assertIn("island", (result.get("message") or "").lower())

    def test_self_intersecting_island_is_invalid(self) -> None:
        bowtie = [(0.0, 0.0), (20.0, 20.0), (20.0, 0.0), (0.0, 20.0), (0.0, 0.0)]
        result = _cvt_interpret(bowtie)
        self.assertFalse(result["ok"])

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
        again, parse_issues = parse_world_json(text)
        self.assertEqual(parse_issues, [], msg=parse_issues)
        self.assertIsNotNone(again)
        assert again is not None
        self.assertEqual(len(again["territories"]), 2)

    def test_reconvert_keeps_raw_drawing(self) -> None:
        w, first = _cvt_world_from(_cvt_square())
        self.assertTrue(first["ok"])
        n = len(iter_drawing_strokes(w))
        add_drawing_stroke(w, [(10.0, -1.0), (10.0, 21.0)])
        second = convert_drawing_to_map(w)
        self.assertTrue(second["ok"], msg=second.get("message"))
        self.assertEqual(len(iter_drawing_strokes(w)), n + 1)
        self.assertEqual(len(w["territories"]), 2)

    def test_editor_save_keeps_drawing_export_does_not(self) -> None:
        w, result = _cvt_world_from(_cvt_square(), [(10.0, 0.0), (10.0, 20.0)])
        self.assertTrue(result["ok"])
        editor = dumps_editor_document(w)
        self.assertIn(EDITOR_DRAWING_KEY, editor)
        playable = dumps_world(w)
        self.assertNotIn(EDITOR_DRAWING_KEY, playable)


def run_self_test() -> int:
    loader = unittest.defaultTestLoader
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromTestCase(WorldLogicTests))
    suite.addTests(loader.loadTestsFromTestCase(DrawnPolygonTests))
    suite.addTests(loader.loadTestsFromTestCase(BoundaryGraphTests))
    suite.addTests(loader.loadTestsFromTestCase(EditorWorkflowTests))
    suite.addTests(loader.loadTestsFromTestCase(DrawingConvertTests))
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

def launch_editor(initial_path: Optional[str] = None, smoke: bool = False) -> None:
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
            toolbar.pack(fill="x", padx=4, pady=2)
            for value, label in (
                ("select", "Select"),
                ("pan", "Pan"),
                ("vertex", "Vertex"),
                ("add_vertex", "Add vertex"),
                ("draw", "Draw"),
                ("adjacency", "Adjacency"),
            ):
                ttk.Radiobutton(toolbar, text=label, variable=self.tool, value=value,
                                command=self._on_tool_change).pack(side="left", padx=2)
            ttk.Button(toolbar, text="Fit", command=self._fit_world).pack(side="left", padx=8)
            ttk.Button(toolbar, text="CONVERT TO MAP", command=self._convert_to_map).pack(side="left", padx=8)
            ttk.Button(toolbar, text="Validate", command=self._run_validate).pack(side="left")
            ttk.Button(toolbar, text="Cancel draw", command=lambda: self._cancel_stroke(leave_mode=True)).pack(side="left", padx=4)

            self.banner_text = tk.StringVar(value="")
            self.banner = tk.Label(
                self, textvariable=self.banner_text, anchor="center",
                bg="#1c1f24", fg="#d7e4f5", font=("Segoe UI", 10, "bold"),
            )

            body = ttk.Panedwindow(self, orient="horizontal")
            self._body = body
            body.pack(fill="both", expand=True)
            left = ttk.Frame(body)
            right = ttk.Frame(body, width=360)
            body.add(left, weight=4)
            body.add(right, weight=1)

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
            self.bind_all("<Control-z>", lambda e: self._undo())
            self.bind_all("<Control-y>", lambda e: self._redo())
            self.bind_all("<Control-s>", lambda e: self._save())
            self.bind_all("<Delete>", lambda e: self._delete_selection())
            self.bind_all("<Escape>", lambda e: self._clear_sel())
            self.canvas.bind("<Control-a>", lambda e: self._select_all_territories())

            self.notebook = ttk.Notebook(right)
            self.notebook.pack(fill="both", expand=True)
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

            self.status = tk.StringVar(value="New world — author geography; export only when valid.")
            ttk.Label(self, textvariable=self.status, anchor="w").pack(fill="x", padx=6, pady=3)
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
            self._labeled_entry(f, "worldId", self.v_world_id, 0, self._apply_world_meta)
            self._labeled_entry(f, "name", self.v_world_name, 1, self._apply_world_meta)
            self._labeled_entry(f, "level", self.v_level, 2, self._apply_world_meta)
            self._labeled_entry(f, "playerFactionId", self.v_player_fid, 3, self._apply_world_meta)
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
            ttk.Label(f, text="References only. Not inlined into this graph.", wraplength=300).pack(anchor="w")
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
            ttk.Button(bf, text="Add reference", command=self._add_contained).pack(side="left")
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
            g = ensure_boundary_graph(self.world)
            if g["nodes"]:
                for nid, q in g["nodes"].items():
                    sx, sy = self.w2s(float(q[0]), float(q[1]))
                    r = 5
                    c.create_rectangle(sx - r, sy - r, sx + r, sy + r, fill="#fff56a", outline="#000")
                    if self.sel and self.sel[0] == "gnode" and self.sel[1] == nid:
                        c.create_oval(sx - 8, sy - 8, sx + 8, sy + 8, outline="#fff", width=2)
                if self.sel and self.sel[0] in ("territory", "island", "gnode", "gedge"):
                    for eid, e in g["edges"].items():
                        poly_e = _sync_edge_poly(g, eid)
                        for i, (x, y) in enumerate(poly_e):
                            if i == 0 or i == len(poly_e) - 1:
                                continue
                            sx, sy = self.w2s(x, y)
                            c.create_oval(sx - 3, sy - 3, sx + 3, sy + 3, fill="#c9e6ff", outline="#000")
                            if self.sel and self.sel[0] == "gedge" and self.sel[1] == eid and self.sel[2] == i:
                                c.create_oval(sx - 7, sy - 7, sx + 7, sy + 7, outline="#fff", width=2)
            elif poly:
                verts = unique_ring_vertices(poly)
                for i, (x, y) in enumerate(verts):
                    sx, sy = self.w2s(x, y)
                    r = 5
                    c.create_rectangle(sx - r, sy - r, sx + r, sy + r, fill="#fff56a", outline="#000")
            if self.show_raw.get():
                live_id = (self.stroke or {}).get("open_id")
                report = self.world.get(EDITOR_CONVERT_REPORT_KEY) if isinstance(self.world.get(EDITOR_CONVERT_REPORT_KEY), dict) else {}
                ignored_ids = {str(i.get("id")) for i in (report.get("ignored") or []) if isinstance(i, dict)}
                used_ids = set(report.get("usedInternalIds") or [])
                island_sid = report.get("islandStrokeId")
                seen_ids: Set[str] = set()
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
                    if sid == island_sid:
                        color, width, dash = "#e8d48a", 2, None
                    elif sid in used_ids:
                        color, width, dash = "#9ad7ff", 2, None
                    elif sid in ignored_ids:
                        color, width, dash = "#666", 1, (4, 4)
                    else:
                        color, width, dash = "#7fe3ff", 2, (5, 3)
                    line_kw: Dict[str, Any] = {
                        "fill": color, "width": width, "capstyle": "round", "joinstyle": "round",
                    }
                    if dash:
                        line_kw["dash"] = dash
                    c.create_line(*coords, **line_kw)
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
            g = ensure_boundary_graph(self.world)
            thresh = 8.0 / max(self.zoom, 0.01)
            best: Optional[Tuple[str, Any, int]] = None
            best_d = thresh
            for nid, q in g["nodes"].items():
                d = math.hypot(wx - float(q[0]), wy - float(q[1]))
                if d < best_d:
                    best_d = d
                    best = ("gnode", nid, 0)
            for eid in g["edges"]:
                poly = _sync_edge_poly(g, eid)
                for i, (x, y) in enumerate(poly):
                    if i == 0 or i == len(poly) - 1:
                        continue
                    d = math.hypot(wx - x, wy - y)
                    if d < best_d:
                        best_d = d
                        best = ("gedge", eid, i)
            if best:
                return best
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
            g = ensure_boundary_graph(self.world)
            if not graph_has_island(g):
                return None
            return nearest_graph_snap(g, (wx, wy), drawing_snap_radius(self.zoom))

        def _on_press(self, event) -> None:
            self.canvas.focus_set()
            wx, wy = self.s2w(event.x, event.y)
            tool = self.tool.get()
            if tool == "draw":
                self._begin_stroke(wx, wy)
                return
            if tool == "pan":
                self._pan_last = (event.x, event.y)
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
            if kind == "gnode":
                self.sel = ("gnode", ident)
            elif kind == "gedge":
                self.sel = ("gedge", ident, index)
            elif kind == "island":
                self.sel = ("vertex", "island", index)
            else:
                self.sel = ("vertex", "territory", index, ident)
            self.drag = {"kind": kind, "ident": ident, "index": index}
            self.dirty = True

        def _on_drag(self, event) -> None:
            if self.stroke is not None:
                wx, wy = self.s2w(event.x, event.y)
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
            g = ensure_boundary_graph(self.world)
            if kind == "gnode":
                move_graph_node(g, ident, (wx, wy))
                apply_boundary_graph_to_world(self.world)
            elif kind == "gedge":
                move_graph_edge_vertex(g, ident, index, (wx, wy))
                apply_boundary_graph_to_world(self.world)
            elif kind == "island":
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
            if self.stroke is not None:
                wx, wy = self.s2w(event.x, event.y)
                self._stroke_add(wx, wy, force=True)
                self._pause_stroke()
                return
            self.drag = None
            self._pan_last = None

        def _on_double(self, event) -> None:
            if self.tool.get() == "draw" or self.stroke:
                return
            wx, wy = self.s2w(event.x, event.y)
            self._try_add_vertex(wx, wy)

        def _try_add_vertex(self, wx: float, wy: float) -> None:
            g = ensure_boundary_graph(self.world)
            thresh = 10.0 / max(self.zoom, 0.01)
            snap = nearest_graph_snap(g, (wx, wy), thresh)
            if snap and snap.get("kind") == "edge" and snap.get("edge"):
                self.undo.push(self.world)
                if insert_graph_edge_vertex(g, snap["edge"], snap["point"], thresh):
                    apply_boundary_graph_to_world(self.world)
                    self.dirty = True
                    self._redraw()
                    return
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
            g = ensure_boundary_graph(self.world)
            changed = False
            if kind == "gnode":
                changed = delete_graph_vertex(g, nid=ident)
            elif kind == "gedge":
                changed = delete_graph_vertex(g, eid=ident, index=idx)
            elif kind == "island":
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
                if kind in ("gnode", "gedge"):
                    apply_boundary_graph_to_world(self.world)
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
            if tool == "draw":
                self.canvas.config(cursor="crosshair")
                self.drag = None
            else:
                try:
                    self.canvas.config(cursor="")
                except tk.TclError:
                    pass
            self._update_draw_banner()
            self._redraw()

        def _update_draw_banner(self) -> None:
            tool = self.tool.get()
            n_raw = sum(
                1 for item in list(iter_drawing_strokes(self.world)) + list(iter_open_strokes(self.world))
                if len(open_stroke_points(item)) >= 2
            )
            if self.stroke:
                n = len(self.stroke.get("raw") or [])
                self.banner_text.set(
                    f"DRAWING — {n} points  ·  release stores the stroke  ·  zoom/pan anytime  ·  "
                    "CONVERT TO MAP interprets the whole drawing  ·  Esc cancels this stroke"
                )
                self.banner.config(bg="#0b5cad", fg="#ffffff")
            elif tool == "draw":
                extra = f"{n_raw} stroke(s) stored. " if n_raw else "Blank canvas. "
                self.banner_text.set(
                    extra + "Drag freely. Lines do not need to snap or close. "
                    "When the drawing looks right, press CONVERT TO MAP."
                )
                self.banner.config(bg="#3d4a1f", fg="#f3f0c8")
            elif n_raw and not polygon_exterior(self.world.get("island")):
                self.banner_text.set(
                    f"{n_raw} raw stroke(s) — press CONVERT TO MAP to interpret island and territories."
                )
                self.banner.config(bg="#3d4a1f", fg="#f3f0c8")
            else:
                self.banner_text.set("")
                self.banner.config(bg="#1c1f24", fg="#d7e4f5")
                self.banner.pack_forget()
                return
            if hasattr(self, "_body") and not self.banner.winfo_ismapped():
                self.banner.pack(fill="x", before=self._body)

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

        def _convert_to_map(self) -> None:
            if self.stroke is not None:
                self._pause_stroke()
            self._snapshot()
            result = convert_drawing_to_map(self.world)
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
                n_raw = sum(
                    1 for item in list(iter_drawing_strokes(self.world)) + list(iter_open_strokes(self.world))
                    if len(open_stroke_points(item)) >= 2
                )
                if n_raw:
                    draw = f"  |  {n_raw} raw stroke(s)"
                elif self.tool.get() == "draw":
                    draw = "  |  DRAW — freehand; CONVERT TO MAP interprets"
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
            self._snapshot()
            rid = (self.world.get("regions") or [{}])[0].get("id", "") if self.world.get("regions") else ""
            self.world.setdefault("containedWorlds", []).append({
                "worldId": "w_prior",
                "regionId": rid,
                "placement": {"origin": {"x": 0, "y": 0}, "rotationDegrees": 0, "scale": 1},
            })
            self.dirty = True
            self._reload_lists()

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
                "Territories come from closed regions in the boundary network. "
                "Use Draw to add a divider that snaps to existing borders; do not duplicate a polygon.",
            )

        def _delete_selection(self, event=None) -> None:
            focus = self.focus_get()
            if focus is not None:
                cls = str(focus.winfo_class())
                if cls in ("Entry", "TEntry", "Text", "TCombobox", "Listbox"):
                    return
            if not self.sel:
                return
            if self.sel[0] in ("gnode", "gedge"):
                self.undo.push(self.world)
                g = ensure_boundary_graph(self.world)
                if self.sel[0] == "gnode":
                    delete_graph_vertex(g, nid=self.sel[1])
                else:
                    delete_graph_vertex(g, eid=self.sel[1], index=self.sel[2])
                apply_boundary_graph_to_world(self.world)
                self.sel = None
                self.dirty = True
                self._reload_lists()
                self._redraw()
                return
            if self.sel[0] == "territory":
                messagebox.showinfo(
                    "Territories",
                    "A territory is a closed region of the boundary network. "
                    "Delete a dividing vertex/edge (right-click) or use World → Clear all map geometry.",
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
                "Remove the island, territories, boundary network, and raw drawing strokes? "
                "This returns to a blank canvas.",
            ):
                return
            self._snapshot()
            self.world["island"] = {"rings": [[]]}
            self.world["territories"] = []
            for r in self.world.get("regions") or []:
                r["territoryIds"] = []
            self.world[EDITOR_GRAPH_KEY] = empty_boundary_graph()
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
            has_drawing = isinstance(drawing, dict) and bool(drawing.get("strokes"))
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
            ensure_boundary_graph(self.world)
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
            if smoke:
                self.update_idletasks()
                self.update()
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
