#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""REP WARS Map Assistant 4.0 — vector boundary-graph authoring tool.

Standalone. Standard library only. Copy this file; it still runs.

THE LINES ARE THE BOUNDARIES. The editor stores a planar vector graph
(nodes + polyline edges), derives enclosed faces, and commits those faces
to rep-wars-world.v1. It does not rasterize, flood-fill, or guess regions
from pixels.

Schema mirrors (TypeScript remains authoritative):
  docs/WORLD_DEFINITION.md
  src/worldDefinition/types.ts
  src/worldDefinition/validate.ts

Usage:
  python map_assistant.py
  python map_assistant.py path/to/world.json
  python map_assistant.py --self-test
  python map_assistant.py --validate worlds/level-1.json
  python map_assistant.py --gui-smoke
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
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Set, Tuple

# ---------------------------------------------------------------------------
# Schema / editor constants
# ---------------------------------------------------------------------------

FORMAT_VERSION = "rep-wars-world.v1"
COMPOSITION_FORMAT = "rep-wars-visual-composition.v1"
THEME_LIBRARY_FILENAME = "rep-wars-world-theme-library-112.json"
GEOM_EPS = 1e-6
MIN_ISLAND_AREA = 4.0
SNAP_SCREEN_PX = 10.0
SIDEBAR_WIDTH = 420

EDITOR_GRAPH_KEY = "_editorBoundaryGraph"
EDITOR_COMPOSITION_KEY = "_editorComposition"
EDITOR_DIRTY_KEY = "_editorGeographyDirty"
EDITOR_KEYS = (EDITOR_GRAPH_KEY, EDITOR_COMPOSITION_KEY, EDITOR_DIRTY_KEY)

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
ANCHORS = ("bottom-center", "center", "custom")
COMPOSITION_LAYERS = (
    "water", "landform", "ground-detail", "vegetation", "structure", "prop", "landmark",
)
COMPOSITION_IMPORTANCE = ("background", "normal", "landmark")
LOCATION_KINDS = ("city", "mine", "farm", "landmark", "settlement")
LAYER_DEPTH = {name: float(i) for i, name in enumerate(COMPOSITION_LAYERS)}
IMAGE_EXTS = {".png", ".webp", ".jpg", ".jpeg", ".gif"}

FORBIDDEN_TERRITORY_FIELDS = (
    "name", "label", "title", "isCapital", "isKnown", "scoutedTurnsAgo",
    "visibility", "cities", "city", "scout", "scouting", "expand", "capital",
    "fog", "discovered",
)
FORBIDDEN_WORLD_FIELDS = (
    "mapWorld", "visibility", "cities", "scout", "expand", "isCapital", "fog",
)

# Core keys first (legacy dumps stay bit-identical when optionals are absent).
WORLD_KEY_ORDER = (
    "formatVersion", "worldId", "level", "name", "playerFactionId", "island",
    "completion", "containedWorlds", "factions", "startingDiplomacy", "regions",
    "territories", "allowUnevenAiSplit",
    "description", "theme", "challenges", "presentation", "locations", "composition",
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
THEME_KEY_ORDER = ("themeId",)
CHALLENGE_KEY_ORDER = ("challengeId", "config")
PRESENTATION_KEY_ORDER = ("scaleProfileId", "cameraProfileId", "lodProfileId", "camera")
CAMERA_KEY_ORDER = ("minZoom", "maxZoom", "initialZoom")
LOCATION_KEY_ORDER = ("id", "kind", "territoryId", "position", "name", "visualAssetId")
COMPOSITION_INSTANCE_KEY_ORDER = (
    "instanceId", "assetId", "position", "rotationDegrees", "scale", "anchor",
    "depth", "importance", "lodProfileId", "territoryId",
)

TERRAIN_FILL = {
    "plains": "#c9d48a",
    "mountain": "#8b8680",
    "hills": "#b8a56a",
    "forest": "#5f8f5a",
    "coastal": "#8ec4c0",
    "desert": "#d2c07a",
    "river": "#5a9ec8",
    "fortress": "#a09080",
}

Point = Tuple[float, float]
Issue = Dict[str, str]


# ---------------------------------------------------------------------------
# Geometry (world +x right, +y up)
# ---------------------------------------------------------------------------

def almost_equal(a: float, b: float, eps: float = GEOM_EPS) -> bool:
    return abs(a - b) <= eps


def points_equal(a: Point, b: Point, eps: float = GEOM_EPS) -> bool:
    return almost_equal(a[0], b[0], eps) and almost_equal(a[1], b[1], eps)


def quantize_point(p: Point, ndigits: int = 9) -> Point:
    return (round(float(p[0]), ndigits), round(float(p[1]), ndigits))


def close_ring(points: Sequence[Point]) -> List[Point]:
    if not points:
        return []
    first, last = points[0], points[-1]
    if points_equal(first, last):
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


def edge_length(a: Point, b: Point) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])


def polyline_length(points: Sequence[Point]) -> float:
    return sum(edge_length(points[i], points[i + 1]) for i in range(len(points) - 1))


def dist_point_to_segment(p: Point, a: Point, b: Point) -> Tuple[float, Point, float]:
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    len2 = dx * dx + dy * dy
    if len2 <= GEOM_EPS * GEOM_EPS:
        q = a
        t = 0.0
    else:
        t = ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2
        t = max(0.0, min(1.0, t))
        q = (ax + t * dx, ay + t * dy)
    return (math.hypot(p[0] - q[0], p[1] - q[1]), q, t)


def point_in_ring(pt: Point, ring: Sequence[Point]) -> bool:
    """Inclusive even-odd. Vertices and edges count as inside."""
    verts = unique_ring_vertices(ring)
    if len(verts) < 3:
        return False
    for i, v in enumerate(verts):
        if points_equal(pt, v):
            return True
        nxt = verts[(i + 1) % len(verts)]
        d, _, _ = dist_point_to_segment(pt, v, nxt)
        if d <= GEOM_EPS:
            return True
    x, y = pt
    inside = False
    j = len(verts) - 1
    for i, vi in enumerate(verts):
        vj = verts[j]
        yi, yj = vi[1], vj[1]
        if (yi > y) != (yj > y):
            xinters = (vj[0] - vi[0]) * (y - yi) / ((yj - yi) or GEOM_EPS) + vi[0]
            if x < xinters:
                inside = not inside
        j = i
    return inside


def all_vertices_inside(inner: Sequence[Point], outer: Sequence[Point]) -> bool:
    return all(point_in_ring(p, outer) for p in unique_ring_vertices(inner))


def polygon_exterior(poly: Optional[Dict[str, Any]]) -> Optional[List[Point]]:
    if not isinstance(poly, dict):
        return None
    rings = poly.get("rings")
    if not isinstance(rings, list) or not rings:
        return None
    ring = rings[0]
    if not isinstance(ring, list) or len(ring) < 2:
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


def points_to_polygon(points: Sequence[Point]) -> Dict[str, Any]:
    closed = close_ring([quantize_point(p) for p in points])
    return {"rings": [[{"x": x, "y": y} for x, y in closed]]}


def ring_edges(points: Sequence[Point]) -> List[Tuple[Point, Point]]:
    verts = unique_ring_vertices(points)
    return [(verts[i], verts[(i + 1) % len(verts)]) for i in range(len(verts))]


def undirected_edge_key(a: Point, b: Point) -> str:
    a = quantize_point(a)
    b = quantize_point(b)
    if (a[0], a[1]) <= (b[0], b[1]):
        return f"{a[0]:.9f},{a[1]:.9f}|{b[0]:.9f},{b[1]:.9f}"
    return f"{b[0]:.9f},{b[1]:.9f}|{a[0]:.9f},{a[1]:.9f}"


def shared_edge_length(poly_a: Dict[str, Any], poly_b: Dict[str, Any]) -> float:
    ra = polygon_exterior(poly_a)
    rb = polygon_exterior(poly_b)
    if not ra or not rb:
        return 0.0
    total = 0.0
    for a0, a1 in ring_edges(ra):
        key = undirected_edge_key(a0, a1)
        for b0, b1 in ring_edges(rb):
            if undirected_edge_key(b0, b1) == key:
                total += edge_length(a0, a1)
                break
    return total


def _orient(a: Point, b: Point, c: Point) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def ring_self_intersects(points: Sequence[Point]) -> bool:
    verts = unique_ring_vertices(points)
    n = len(verts)
    if n < 4:
        return False
    for i in range(n):
        a, b = verts[i], verts[(i + 1) % n]
        for j in range(i + 1, n):
            if abs(i - j) <= 1 or (i == 0 and j == n - 1):
                continue
            c, d = verts[j], verts[(j + 1) % n]
            if proper_intersect(a, b, c, d):
                return True
    return False


def proper_intersect(a: Point, b: Point, c: Point, d: Point) -> bool:
    hit = segment_intersection(a, b, c, d)
    if hit is None:
        return False
    t, u = hit
    return GEOM_EPS < t < 1.0 - GEOM_EPS and GEOM_EPS < u < 1.0 - GEOM_EPS


def segment_intersection(a: Point, b: Point, c: Point, d: Point) -> Optional[Tuple[float, float]]:
    ax, ay = a
    rx, ry = b[0] - ax, b[1] - ay
    sx, sy = d[0] - c[0], d[1] - c[1]
    den = rx * sy - ry * sx
    if abs(den) <= GEOM_EPS:
        return None
    t = ((c[0] - ax) * sy - (c[1] - ay) * sx) / den
    u = ((c[0] - ax) * ry - (c[1] - ay) * rx) / den
    if -GEOM_EPS <= t <= 1.0 + GEOM_EPS and -GEOM_EPS <= u <= 1.0 + GEOM_EPS:
        return (max(0.0, min(1.0, t)), max(0.0, min(1.0, u)))
    return None


def lerp(a: Point, b: Point, t: float) -> Point:
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def ensure_ccw(points: Sequence[Point]) -> List[Point]:
    closed = close_ring(points)
    if ring_area(closed) < 0:
        closed = list(reversed(closed))
    return closed


def polyline_self_intersects(points: Sequence[Point]) -> bool:
    if len(points) < 4:
        return False
    for i in range(len(points) - 1):
        a, b = points[i], points[i + 1]
        for j in range(i + 2, len(points) - 1):
            if i == 0 and j == len(points) - 2 and points_equal(points[0], points[-1]):
                continue
            if proper_intersect(a, b, points[j], points[j + 1]):
                return True
    return False


def clean_polyline(points: Sequence[Point]) -> List[Point]:
    out: List[Point] = []
    for p in points:
        q = quantize_point(p)
        if not out or not points_equal(out[-1], q):
            out.append(q)
    return out


def split_polyline_at_t(points: Sequence[Point], t_global: float) -> Tuple[List[Point], List[Point], Point]:
    """Split a polyline at a normalized distance t in [0, 1]."""
    pts = list(points)
    total = polyline_length(pts)
    if total <= GEOM_EPS or t_global <= GEOM_EPS:
        return [pts[0]], pts, pts[0]
    if t_global >= 1.0 - GEOM_EPS:
        return pts, [pts[-1]], pts[-1]
    target = t_global * total
    acc = 0.0
    for i in range(len(pts) - 1):
        seg = edge_length(pts[i], pts[i + 1])
        if acc + seg >= target - GEOM_EPS:
            local = 0.0 if seg <= GEOM_EPS else (target - acc) / seg
            mid = lerp(pts[i], pts[i + 1], max(0.0, min(1.0, local)))
            left = pts[: i + 1] + [mid]
            right = [mid] + pts[i + 1 :]
            return clean_polyline(left), clean_polyline(right), quantize_point(mid)
        acc += seg
    return pts, [pts[-1]], pts[-1]


def point_along_polyline(points: Sequence[Point], t_global: float) -> Point:
    _, _, mid = split_polyline_at_t(points, t_global)
    return mid


def dist_point_to_polyline(p: Point, points: Sequence[Point]) -> Tuple[float, Point, float]:
    best_d = float("inf")
    best_q = points[0] if points else (0.0, 0.0)
    best_t = 0.0
    total = polyline_length(points)
    acc = 0.0
    for i in range(len(points) - 1):
        d, q, t = dist_point_to_segment(p, points[i], points[i + 1])
        seg = edge_length(points[i], points[i + 1])
        t_global = 0.0 if total <= GEOM_EPS else (acc + t * seg) / total
        if d < best_d:
            best_d = d
            best_q = q
            best_t = t_global
        acc += seg
    return best_d, best_q, best_t


def insert_points_along_polyline(pts: Sequence[Point], extras: Sequence[Point]) -> List[Point]:
    """Merge extra points into a polyline, ordered by distance along it."""
    base = list(pts)
    if len(base) < 2:
        return clean_polyline(list(base) + list(extras))
    items: List[Tuple[float, int, Point]] = []
    total = polyline_length(base)
    acc = 0.0
    items.append((0.0, 0, base[0]))
    for i in range(len(base) - 1):
        acc += edge_length(base[i], base[i + 1])
        t = 0.0 if total <= GEOM_EPS else acc / total
        items.append((t, i + 1, base[i + 1]))
    for k, extra in enumerate(extras):
        _d, q, t = dist_point_to_polyline(extra, base)
        items.append((t, 1000 + k, q))
    items.sort(key=lambda it: (it[0], it[1]))
    return clean_polyline([p for _t, _i, p in items])


def point_to_json(p: Point) -> Dict[str, float]:
    return {"x": float(p[0]), "y": float(p[1])}


def point_from_json(raw: Any) -> Optional[Point]:
    if isinstance(raw, dict) and "x" in raw and "y" in raw:
        try:
            return (float(raw["x"]), float(raw["y"]))
        except (TypeError, ValueError):
            return None
    if isinstance(raw, (list, tuple)) and len(raw) >= 2:
        try:
            return (float(raw[0]), float(raw[1]))
        except (TypeError, ValueError):
            return None
    return None


def issue(code: str, message: str) -> Issue:
    return {"code": code, "message": message}


# ---------------------------------------------------------------------------
# Planar boundary graph
# ---------------------------------------------------------------------------

class GraphError(Exception):
    def __init__(self, message: str, code: str = "graph.invalid") -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class BoundaryGraph:
    """Undirected planar graph. Edges store the authored polyline geometry."""

    def __init__(self) -> None:
        self.nodes: Dict[str, Point] = {}
        self.edges: Dict[str, Dict[str, Any]] = {}
        self._nid = 0
        self._eid = 0

    def clone(self) -> "BoundaryGraph":
        g = BoundaryGraph()
        g.nodes = {k: tuple(v) for k, v in self.nodes.items()}
        g.edges = copy.deepcopy(self.edges)
        g._nid = self._nid
        g._eid = self._eid
        return g

    def to_json(self) -> Dict[str, Any]:
        return {
            "nodes": {nid: point_to_json(p) for nid, p in self.nodes.items()},
            "edges": {
                eid: {
                    "a": e["a"],
                    "b": e["b"],
                    "kind": e.get("kind", "internal"),
                    "points": [point_to_json(p) for p in (e.get("points") or [])],
                }
                for eid, e in self.edges.items()
            },
            "_nid": self._nid,
            "_eid": self._eid,
        }

    @classmethod
    def from_json(cls, raw: Any) -> "BoundaryGraph":
        g = cls()
        if not isinstance(raw, dict):
            return g
        for nid, p in (raw.get("nodes") or {}).items():
            parsed = point_from_json(p)
            if parsed is not None:
                g.nodes[str(nid)] = parsed
        for eid, e in (raw.get("edges") or {}).items():
            if not isinstance(e, dict):
                continue
            a = str(e.get("a", ""))
            b = str(e.get("b", ""))
            pts: List[Point] = []
            for pt in e.get("points") or []:
                parsed = point_from_json(pt)
                if parsed is not None:
                    pts.append(parsed)
            if len(pts) < 2 and a in g.nodes and b in g.nodes:
                pts = [g.nodes[a], g.nodes[b]]
            g.edges[str(eid)] = {"a": a, "b": b, "kind": e.get("kind", "internal"), "points": pts}
        g._nid = int(raw.get("_nid") or 0)
        g._eid = int(raw.get("_eid") or 0)
        if g._nid < len(g.nodes):
            g._nid = len(g.nodes)
        if g._eid < len(g.edges):
            g._eid = len(g.edges)
        return g

    def _adopt(self, other: "BoundaryGraph") -> None:
        self.nodes = other.nodes
        self.edges = other.edges
        self._nid = other._nid
        self._eid = other._eid

    def _new_node_id(self) -> str:
        self._nid += 1
        return f"n{self._nid}"

    def _new_edge_id(self) -> str:
        self._eid += 1
        return f"e{self._eid}"

    def add_node(self, p: Point, nid: Optional[str] = None) -> str:
        p = quantize_point(p)
        existing = self.nearest_node(p, GEOM_EPS * 10)
        if existing is not None:
            return existing[0]
        nid = nid or self._new_node_id()
        self.nodes[nid] = p
        return nid

    def nearest_node(self, p: Point, radius: float) -> Optional[Tuple[str, float]]:
        best: Optional[Tuple[str, float]] = None
        for nid, q in self.nodes.items():
            d = math.hypot(p[0] - q[0], p[1] - q[1])
            if d <= radius and (best is None or d < best[1]):
                best = (nid, d)
        return best

    def nearest_edge(self, p: Point, radius: float) -> Optional[Tuple[str, float, Point, float]]:
        best: Optional[Tuple[str, float, Point, float]] = None
        for eid, e in self.edges.items():
            d, q, t = dist_point_to_polyline(p, e["points"])
            if d <= radius and (best is None or d < best[1]):
                best = (eid, d, q, t)
        return best

    def snap_point(self, p: Point, radius: float) -> Dict[str, Any]:
        node = self.nearest_node(p, radius)
        edge = self.nearest_edge(p, radius)
        if node and (edge is None or node[1] <= edge[1] + GEOM_EPS):
            return {"kind": "node", "id": node[0], "point": self.nodes[node[0]], "distance": node[1]}
        if edge:
            return {
                "kind": "edge",
                "id": edge[0],
                "point": edge[2],
                "t": edge[3],
                "distance": edge[1],
            }
        return {"kind": "none", "point": p, "distance": None}

    def incident_edges(self, nid: str) -> List[str]:
        return [eid for eid, e in self.edges.items() if e["a"] == nid or e["b"] == nid]

    def has_island(self) -> bool:
        return any(e.get("kind") == "island" for e in self.edges.values())

    def _edge_points_oriented(self, e: Dict[str, Any]) -> List[Point]:
        pts = list(e.get("points") or [])
        a = self.nodes[e["a"]]
        b = self.nodes[e["b"]]
        if len(pts) < 2:
            return [a, b]
        if points_equal(pts[0], a) and points_equal(pts[-1], b):
            pts[0], pts[-1] = a, b
            return pts
        if points_equal(pts[0], b) and points_equal(pts[-1], a):
            pts = list(reversed(pts))
            pts[0], pts[-1] = a, b
            return pts
        return [a] + pts[1:-1] + [b]

    def _has_undirected_edge(self, na: str, nb: str) -> bool:
        for e in self.edges.values():
            if (e["a"] == na and e["b"] == nb) or (e["a"] == nb and e["b"] == na):
                return True
        return False

    def split_edge(self, eid: str, p: Point) -> str:
        """Insert a node on edge eid at p. Returns the node id. Geometry is preserved."""
        e = self.edges[eid]
        pts = self._edge_points_oriented(e)
        _d, q, t = dist_point_to_polyline(p, pts)
        if t <= GEOM_EPS or points_equal(q, pts[0]):
            return e["a"]
        if t >= 1.0 - GEOM_EPS or points_equal(q, pts[-1]):
            return e["b"]
        left, right, mid = split_polyline_at_t(pts, t)
        nid = self.add_node(mid)
        if nid in (e["a"], e["b"]):
            return nid
        kind = e["kind"]
        a, b = e["a"], e["b"]
        del self.edges[eid]
        left_pts = clean_polyline([self.nodes[a]] + left[1:-1] + [self.nodes[nid]])
        right_pts = clean_polyline([self.nodes[nid]] + right[1:-1] + [self.nodes[b]])
        if len(left_pts) < 2:
            left_pts = [self.nodes[a], self.nodes[nid]]
        if len(right_pts) < 2:
            right_pts = [self.nodes[nid], self.nodes[b]]
        e1 = self._new_edge_id()
        e2 = self._new_edge_id()
        self.edges[e1] = {"a": a, "b": nid, "kind": kind, "points": left_pts}
        self.edges[e2] = {"a": nid, "b": b, "kind": kind, "points": right_pts}
        return nid

    def _ensure_snapped_node(self, p: Point, radius: float, allow_new: bool) -> str:
        snap = self.snap_point(p, radius)
        if snap["kind"] == "node":
            return snap["id"]
        if snap["kind"] == "edge":
            return self.split_edge(snap["id"], snap["point"])
        if allow_new:
            return self.add_node(p)
        raise GraphError(
            f"Endpoint ({p[0]:.2f}, {p[1]:.2f}) is not on the boundary network. "
            f"Move within snap distance of an existing boundary.",
            "graph.unsnapped_endpoint",
        )

    def _collect_crossings(self, points: Sequence[Point]) -> List[Tuple[str, Point, float, float]]:
        """Existing-edge crossings with the new polyline (proper intersections)."""
        hits: List[Tuple[str, Point, float, float]] = []
        new_len = polyline_length(points)
        acc_new = 0.0
        for i in range(len(points) - 1):
            a, b = points[i], points[i + 1]
            seg_new = edge_length(a, b)
            for eid, e in list(self.edges.items()):
                acc_old = 0.0
                old_pts = e["points"]
                old_len = polyline_length(old_pts)
                for j in range(len(old_pts) - 1):
                    c, d = old_pts[j], old_pts[j + 1]
                    seg_old = edge_length(c, d)
                    hit = segment_intersection(a, b, c, d)
                    if hit is None:
                        acc_old += seg_old
                        continue
                    t, u = hit
                    if not (GEOM_EPS < t < 1.0 - GEOM_EPS and GEOM_EPS < u < 1.0 - GEOM_EPS):
                        acc_old += seg_old
                        continue
                    pt = lerp(a, b, t)
                    t_new = 0.0 if new_len <= GEOM_EPS else (acc_new + t * seg_new) / new_len
                    t_old = 0.0 if old_len <= GEOM_EPS else (acc_old + u * seg_old) / old_len
                    hits.append((eid, quantize_point(pt), t_new, t_old))
                    acc_old += seg_old
            acc_new += seg_new
        return hits

    def add_island(self, points: Sequence[Point]) -> Dict[str, Any]:
        if self.has_island():
            raise GraphError("The island boundary is already closed. Edit nodes or add internal boundaries.", "graph.island_exists")
        pts = clean_polyline(points)
        if len(pts) >= 2 and points_equal(pts[0], pts[-1]):
            pts = pts[:-1]
        if len(pts) < 3:
            raise GraphError("Island needs at least 3 vertices.", "graph.island_too_small")
        closed = close_ring(pts)
        if abs(ring_area(closed)) < MIN_ISLAND_AREA:
            raise GraphError("Island area is too small.", "graph.island_area")
        if ring_self_intersects(closed):
            raise GraphError("Island boundary intersects itself.", "graph.self_intersection")
        ids = [self.add_node(p) for p in unique_ring_vertices(closed)]
        created: List[str] = []
        n = len(ids)
        for i in range(n):
            a, b = ids[i], ids[(i + 1) % n]
            pa, pb = self.nodes[a], self.nodes[b]
            eid = self._new_edge_id()
            self.edges[eid] = {"a": a, "b": b, "kind": "island", "points": [pa, pb]}
            created.append(eid)
        return {"ok": True, "edgeIds": created, "kind": "island"}

    def add_boundary(self, points: Sequence[Point], snap_radius: float) -> Dict[str, Any]:
        if not self.has_island():
            raise GraphError("Draw a closed island before adding internal boundaries.", "graph.no_island")
        pts = clean_polyline(points)
        if len(pts) < 2:
            raise GraphError("Boundary needs two endpoints.", "graph.too_short")
        if polyline_self_intersects(pts):
            raise GraphError("Internal boundary intersects itself.", "graph.self_intersection")
        start_snap = self.snap_point(pts[0], snap_radius)
        end_snap = self.snap_point(pts[-1], snap_radius)
        if start_snap["kind"] == "none" or end_snap["kind"] == "none":
            raise GraphError(
                "Internal boundaries must snap to the existing network at both ends.",
                "graph.unsnapped_endpoint",
            )
        crossings = self._collect_crossings(pts)
        extras: List[Point] = [pt for _eid, pt, _tn, _to in crossings]
        for _nid, np in self.nodes.items():
            d, _q, t = dist_point_to_polyline(np, pts)
            if d <= snap_radius and GEOM_EPS < t < 1.0 - GEOM_EPS:
                extras.append(np)
        backup = self.clone()
        try:
            return self._add_boundary_apply(pts, extras, snap_radius)
        except GraphError:
            self._adopt(backup)
            raise

    def _add_boundary_apply(
        self,
        pts: List[Point],
        extras: Sequence[Point],
        snap_radius: float,
    ) -> Dict[str, Any]:
        for pt in extras:
            node = self.nearest_node(pt, GEOM_EPS * 20)
            if node is not None:
                continue
            hit = self.nearest_edge(pt, snap_radius)
            if hit is not None:
                self.split_edge(hit[0], pt)

        a = self._ensure_snapped_node(pts[0], snap_radius, allow_new=False)
        b = self._ensure_snapped_node(pts[-1], snap_radius, allow_new=False)
        work = insert_points_along_polyline(pts, list(extras) + [self.nodes[a], self.nodes[b]])
        if work:
            work[0] = self.nodes[a]
            work[-1] = self.nodes[b]
        work = clean_polyline(work)

        junctions: List[Tuple[int, str]] = []
        for i, p in enumerate(work):
            if i == 0:
                junctions.append((i, a))
                continue
            if i == len(work) - 1:
                junctions.append((i, b))
                continue
            node = self.nearest_node(p, snap_radius)
            if node is not None:
                junctions.append((i, node[0]))

        created: List[str] = []
        for k in range(len(junctions) - 1):
            i0, na = junctions[k]
            i1, nb = junctions[k + 1]
            if na == nb:
                continue
            if self._has_undirected_edge(na, nb):
                continue
            sub = clean_polyline([self.nodes[na]] + work[i0 + 1:i1] + [self.nodes[nb]])
            if len(sub) < 2:
                continue
            eid = self._new_edge_id()
            self.edges[eid] = {"a": na, "b": nb, "kind": "internal", "points": sub}
            created.append(eid)
        if not created:
            raise GraphError("That boundary already exists or collapsed to a point.", "graph.duplicate")
        return {"ok": True, "edgeIds": created, "kind": "internal"}

    def delete_edge(self, eid: str) -> None:
        if eid not in self.edges:
            raise GraphError("No such boundary.", "graph.missing_edge")
        kind = self.edges[eid]["kind"]
        del self.edges[eid]
        if kind == "island" and not self.has_island():
            raise GraphError("Cannot delete the last island boundary.", "graph.island_required")
        # Drop isolated nodes.
        used = set()
        for e in self.edges.values():
            used.add(e["a"])
            used.add(e["b"])
        for nid in list(self.nodes):
            if nid not in used:
                del self.nodes[nid]

    def move_node(self, nid: str, p: Point) -> None:
        if nid not in self.nodes:
            raise GraphError("No such node.", "graph.missing_node")
        p = quantize_point(p)
        old = self.nodes[nid]
        self.nodes[nid] = p
        for e in self.edges.values():
            if e["a"] == nid:
                e["points"][0] = p
            if e["b"] == nid:
                e["points"][-1] = p
            for i, q in enumerate(e["points"]):
                if points_equal(q, old):
                    e["points"][i] = p

    def island_ring(self) -> Optional[List[Point]]:
        faces = detect_faces(self)
        if not faces["bounded"]:
            return None
        # Island outline is the union of island-kind edges, walked as the largest bounded face
        # when there are no internals; otherwise the outer cycle of island edges.
        island_edges = [e for e in self.edges.values() if e.get("kind") == "island"]
        if not island_edges:
            return None
        # Prefer the largest-area bounded face's ring if it uses island edges; else walk island-only.
        bounded = faces["bounded"]
        if bounded:
            return max(bounded, key=lambda f: abs(f["area"]))["ring"]
        return None


def detect_faces(graph: BoundaryGraph) -> Dict[str, Any]:
    """Half-edge face walk. Bounded positive-area faces are territories."""
    if not graph.edges:
        return {"bounded": [], "unbounded": None}

    class HE:
        __slots__ = ("origin", "dest", "edge_id", "points", "angle", "twin", "nxt")

        def __init__(self, origin: str, dest: str, edge_id: str, points: List[Point]) -> None:
            self.origin = origin
            self.dest = dest
            self.edge_id = edge_id
            self.points = points
            dx = points[1][0] - points[0][0] if len(points) > 1 else 0.0
            dy = points[1][1] - points[0][1] if len(points) > 1 else 0.0
            self.angle = math.atan2(dy, dx)
            self.twin: Optional["HE"] = None
            self.nxt: Optional["HE"] = None

    hes: List[HE] = []
    outgoing: Dict[str, List[HE]] = defaultdict(list)
    for eid, e in graph.edges.items():
        pts = list(e["points"])
        if len(pts) < 2:
            continue
        if not points_equal(pts[0], graph.nodes[e["a"]]):
            pts = list(reversed(pts))
        fwd = HE(e["a"], e["b"], eid, pts)
        rev = HE(e["b"], e["a"], eid, list(reversed(pts)))
        fwd.twin = rev
        rev.twin = fwd
        hes.extend((fwd, rev))
        outgoing[fwd.origin].append(fwd)
        outgoing[rev.origin].append(rev)

    for nid, bag in outgoing.items():
        bag.sort(key=lambda h: h.angle)

    for h in hes:
        bag = outgoing[h.dest]
        twin = h.twin
        assert twin is not None
        try:
            idx = bag.index(twin)
        except ValueError:
            continue
        h.nxt = bag[(idx - 1) % len(bag)]

    visited: Set[int] = set()
    bounded: List[Dict[str, Any]] = []
    unbounded: Optional[Dict[str, Any]] = None

    for h in hes:
        if id(h) in visited:
            continue
        cycle: List[HE] = []
        cur: Optional[HE] = h
        guard = 0
        while cur is not None and id(cur) not in visited and guard < len(hes) + 2:
            visited.add(id(cur))
            cycle.append(cur)
            cur = cur.nxt
            guard += 1
            if cur is h:
                break
        if not cycle or cur is not h:
            continue
        ring_pts: List[Point] = []
        edge_ids: List[str] = []
        for he in cycle:
            edge_ids.append(he.edge_id)
            chunk = he.points
            if not ring_pts:
                ring_pts.extend(chunk)
            else:
                ring_pts.extend(chunk[1:])
        if len(cycle) <= 2:
            continue
        ring = close_ring(clean_polyline(ring_pts))
        area = ring_area(ring)
        if abs(area) <= GEOM_EPS:
            continue
        face = {
            "ring": ensure_ccw(ring) if area > 0 else ring,
            "area": area,
            "edgeIds": edge_ids,
            "half_count": len(cycle),
        }
        if area > 0:
            bounded.append(face)
        else:
            if unbounded is None or abs(area) > abs(unbounded["area"]):
                unbounded = face

    bounded.sort(key=lambda f: -f["area"])
    return {"bounded": bounded, "unbounded": unbounded}


def face_adjacency(faces: Sequence[Dict[str, Any]]) -> Dict[int, Set[int]]:
    """Two faces are neighbors iff they share an undirected graph edge id."""
    owner: Dict[str, List[int]] = defaultdict(list)
    for i, face in enumerate(faces):
        seen = set()
        for eid in face["edgeIds"]:
            if eid in seen:
                continue
            seen.add(eid)
            owner[eid].append(i)
    adj: Dict[int, Set[int]] = defaultdict(set)
    for ids in owner.values():
        if len(ids) == 2:
            a, b = ids[0], ids[1]
            adj[a].add(b)
            adj[b].add(a)
    return adj


def snap_radius_world(zoom: float) -> float:
    z = zoom if abs(zoom) > 1e-6 else 1.0
    return SNAP_SCREEN_PX / abs(z)


# ---------------------------------------------------------------------------
# WorldDefinition helpers + validation
# ---------------------------------------------------------------------------

def clone_world(world: Dict[str, Any]) -> Dict[str, Any]:
    return copy.deepcopy(world)


def next_id(prefix: str, existing: Iterable[Any]) -> str:
    taken = {str(x) for x in existing if x}
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


def _pt(raw: Any) -> Dict[str, float]:
    if not isinstance(raw, dict):
        return {"x": 0.0, "y": 0.0}
    return {"x": float(raw.get("x", 0) or 0), "y": float(raw.get("y", 0) or 0)}


def instance_id(inst: Dict[str, Any]) -> str:
    return str(inst.get("instanceId") or inst.get("id") or "")


def instance_point(inst: Dict[str, Any]) -> Point:
    pos = inst.get("position")
    if isinstance(pos, dict):
        return (float(pos.get("x", 0) or 0), float(pos.get("y", 0) or 0))
    return (float(inst.get("x", 0) or 0), float(inst.get("y", 0) or 0))


def instance_depth(inst: Dict[str, Any]) -> float:
    if isinstance(inst.get("depth"), (int, float)) and math.isfinite(float(inst["depth"])):
        return float(inst["depth"])
    layer = inst.get("layer") or "prop"
    return float(LAYER_DEPTH.get(str(layer), 5.0))


def normalize_composition_instance(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    iid = instance_id(raw)
    asset_id = raw.get("assetId")
    if not iid or not isinstance(asset_id, str) or not asset_id:
        return None
    x, y = instance_point(raw)
    scale = raw.get("scale", None)
    if scale is not None:
        try:
            scale = float(scale)
        except (TypeError, ValueError):
            scale = None
    body: Dict[str, Any] = {
        "instanceId": iid,
        "assetId": asset_id,
        "position": {"x": x, "y": y},
        "rotationDegrees": float(raw.get("rotationDegrees", 0) or 0),
        "scale": scale,
        "anchor": str(raw.get("anchor") or "bottom-center"),
        "depth": instance_depth(raw),
    }
    importance = raw.get("importance")
    if importance in COMPOSITION_IMPORTANCE:
        body["importance"] = importance
    lod = raw.get("lodProfileId")
    if isinstance(lod, str) and lod.strip():
        body["lodProfileId"] = lod.strip()
    tid = raw.get("territoryId")
    if tid is None or (isinstance(tid, str) and tid):
        body["territoryId"] = tid
    return ordered_dict(body, COMPOSITION_INSTANCE_KEY_ORDER)


def normalize_composition_payload(raw: Any) -> Dict[str, Any]:
    instances: List[Dict[str, Any]] = []
    if isinstance(raw, dict):
        src = raw.get("instances")
    elif isinstance(raw, list):
        src = raw
    else:
        src = []
    if isinstance(src, list):
        for item in src:
            norm = normalize_composition_instance(item)
            if norm is not None:
                instances.append(norm)
    return {"instances": instances}


def _ordered_location(loc: Dict[str, Any]) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "id": loc.get("id", ""),
        "kind": loc.get("kind", "landmark"),
        "territoryId": loc.get("territoryId", ""),
        "position": _pt(loc.get("position")),
    }
    if isinstance(loc.get("name"), str) and loc.get("name"):
        body["name"] = loc["name"]
    if isinstance(loc.get("visualAssetId"), str) and loc.get("visualAssetId"):
        body["visualAssetId"] = loc["visualAssetId"]
    return ordered_dict(body, LOCATION_KEY_ORDER)


def _ordered_challenge(ch: Dict[str, Any]) -> Dict[str, Any]:
    body: Dict[str, Any] = {"challengeId": ch.get("challengeId", "")}
    cfg = ch.get("config")
    if isinstance(cfg, dict) and cfg:
        body["config"] = {
            k: v for k, v in cfg.items()
            if v is None or isinstance(v, (str, bool, int, float))
        }
    return ordered_dict(body, CHALLENGE_KEY_ORDER)


def _ordered_presentation(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    body: Dict[str, Any] = {}
    for key in ("scaleProfileId", "cameraProfileId", "lodProfileId"):
        v = raw.get(key)
        if isinstance(v, str) and v.strip():
            body[key] = v.strip()
    cam = raw.get("camera")
    if isinstance(cam, dict):
        try:
            body["camera"] = ordered_dict({
                "minZoom": float(cam["minZoom"]),
                "maxZoom": float(cam["maxZoom"]),
                "initialZoom": float(cam["initialZoom"]),
            }, CAMERA_KEY_ORDER)
        except (KeyError, TypeError, ValueError):
            pass
    if not body:
        return None
    return ordered_dict(body, PRESENTATION_KEY_ORDER)


# Theme library cache (loaded from JSON data file — never hardcoded theme names).
_THEME_LIBRARY_CACHE: Optional[Dict[str, Any]] = None
_THEME_LIBRARY_TRIED = False


def theme_library_search_paths(explicit: Optional[str] = None) -> List[str]:
    paths: List[str] = []
    if explicit:
        paths.append(explicit)
    env = os.environ.get("MAP_ASSISTANT_THEME_LIBRARY")
    if env:
        paths.append(env)
    here = os.path.dirname(os.path.abspath(__file__))
    paths.append(os.path.join(here, "data", THEME_LIBRARY_FILENAME))
    # Repo-relative fallback when the script is copied elsewhere.
    paths.append(os.path.join(here, "..", "..", "tools", "map_assistant", "data", THEME_LIBRARY_FILENAME))
    return paths


def load_theme_library(path: Optional[str] = None, *, force: bool = False) -> Optional[Dict[str, Any]]:
    """Load the 112-theme (or replacement) library JSON. Returns None if not found."""
    global _THEME_LIBRARY_CACHE, _THEME_LIBRARY_TRIED
    if _THEME_LIBRARY_CACHE is not None and not force and path is None:
        return _THEME_LIBRARY_CACHE
    if _THEME_LIBRARY_TRIED and not force and path is None:
        return _THEME_LIBRARY_CACHE
    if path is None:
        _THEME_LIBRARY_TRIED = True
    for candidate in theme_library_search_paths(path):
        try:
            with open(candidate, "r", encoding="utf-8") as fh:
                raw = json.load(fh)
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(raw, dict) or not isinstance(raw.get("themes"), list):
            continue
        themes = [t for t in raw["themes"] if isinstance(t, dict) and isinstance(t.get("themeId"), str)]
        by_id = {t["themeId"]: t for t in themes}
        _THEME_LIBRARY_CACHE = {
            "path": candidate,
            "schemaVersion": raw.get("schemaVersion"),
            "libraryName": raw.get("libraryName"),
            "themeCount": len(themes),
            "themes": themes,
            "byId": by_id,
            "categories": sorted({
                str(t["category"]) for t in themes
                if isinstance(t.get("category"), str) and t.get("category")
            }),
        }
        return _THEME_LIBRARY_CACHE
    return None


def known_theme_ids() -> Optional[Set[str]]:
    lib = load_theme_library()
    if lib is None:
        return None
    return set(lib["byId"].keys())


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


def _ordered_personality(p: Dict[str, Any]) -> Dict[str, Any]:
    traits = p.get("traits") or {}
    return ordered_dict({
        "id": p.get("id", ""),
        "label": p.get("label", ""),
        "ambition": float(p.get("ambition", 0.5)),
        "traits": {k: float(traits.get(k, 0.5)) for k in TRAIT_KEYS},
    }, PERSONALITY_KEY_ORDER)


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


def strip_editor_keys(world: Dict[str, Any]) -> Dict[str, Any]:
    w = clone_world(world)
    for k in EDITOR_KEYS:
        w.pop(k, None)
    return w


def ordered_world(world: Dict[str, Any]) -> Dict[str, Any]:
    w = strip_editor_keys(world)
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
        for c in (w.get("containedWorlds") or []) if isinstance(c, dict)
    ]
    w["factions"] = [_ordered_faction(f) for f in (w.get("factions") or []) if isinstance(f, dict)]
    w["startingDiplomacy"] = [
        ordered_dict(rel, DIPLOMACY_KEY_ORDER) for rel in (w.get("startingDiplomacy") or []) if isinstance(rel, dict)
    ]
    w["regions"] = [ordered_dict(r, REGION_KEY_ORDER) for r in (w.get("regions") or []) if isinstance(r, dict)]
    w["territories"] = [_ordered_territory(t) for t in (w.get("territories") or []) if isinstance(t, dict)]

    # Optional authored metadata — omit when absent/empty so legacy dumps stay identical.
    desc = w.get("description")
    if isinstance(desc, str) and desc.strip():
        w["description"] = desc
    else:
        w.pop("description", None)

    theme = w.get("theme")
    if isinstance(theme, dict) and isinstance(theme.get("themeId"), str) and theme["themeId"].strip():
        w["theme"] = ordered_dict({"themeId": theme["themeId"].strip()}, THEME_KEY_ORDER)
    else:
        w.pop("theme", None)

    challenges = w.get("challenges")
    if isinstance(challenges, list) and challenges:
        ordered_ch = [
            _ordered_challenge(c) for c in challenges
            if isinstance(c, dict) and isinstance(c.get("challengeId"), str) and c["challengeId"].strip()
        ]
        if ordered_ch:
            w["challenges"] = ordered_ch
        else:
            w.pop("challenges", None)
    else:
        w.pop("challenges", None)

    presentation = _ordered_presentation(w.get("presentation"))
    if presentation:
        w["presentation"] = presentation
    else:
        w.pop("presentation", None)

    locations = w.get("locations")
    if isinstance(locations, list) and locations:
        ordered_locs = [_ordered_location(loc) for loc in locations if isinstance(loc, dict)]
        if ordered_locs:
            w["locations"] = ordered_locs
        else:
            w.pop("locations", None)
    else:
        w.pop("locations", None)

    composition = normalize_composition_payload(w.get("composition"))
    if composition["instances"]:
        w["composition"] = composition
    else:
        w.pop("composition", None)

    out = ordered_dict(w, WORLD_KEY_ORDER)
    if not w.get("allowUnevenAiSplit"):
        out.pop("allowUnevenAiSplit", None)
    return out


def dumps_world(world: Dict[str, Any]) -> str:
    return json.dumps(ordered_world(world), indent=2, ensure_ascii=False) + "\n"


def is_integer_at_least(value: Any, minimum: int) -> bool:
    return isinstance(value, (int, float)) and float(value).is_integer() and int(value) >= minimum


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


def _graph_connected(ids: List[str], neighbors_of: Callable[[str], Sequence[str]]) -> bool:
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

    world = strip_editor_keys(world) if isinstance(world, dict) else world

    for key in FORBIDDEN_WORLD_FIELDS:
        if key in world:
            push("world.forbidden_field", f"world must not contain {key}")

    if world.get("formatVersion") != FORMAT_VERSION:
        push("format.unsupported", f"formatVersion must be {FORMAT_VERSION}")
    if not world.get("worldId") or not isinstance(world.get("worldId"), str):
        push("world.missing_id", "worldId is required")
    if not is_integer_at_least(world.get("level"), 1):
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

    if "description" in world and world.get("description") is not None and not isinstance(world.get("description"), str):
        push("world.description", "description must be a string when present")

    theme = world.get("theme")
    if theme is not None:
        if not isinstance(theme, dict):
            push("theme.invalid", "theme must be an object with themeId")
        else:
            tid = theme.get("themeId")
            if not isinstance(tid, str) or not tid.strip():
                push("theme.missing_id", "theme.themeId must be a non-empty string")
            else:
                known = known_theme_ids()
                if known is not None and tid not in known:
                    push("theme.unknown_id", f"theme.themeId {tid} is not in the loaded theme library")

    challenges = world.get("challenges")
    if challenges is not None:
        if not isinstance(challenges, list):
            push("challenge.invalid", "challenges must be an array when present")
        else:
            seen_ch: Set[str] = set()
            for ch in challenges:
                if not isinstance(ch, dict):
                    push("challenge.invalid", "each challenge must be an object")
                    continue
                cid = ch.get("challengeId")
                if not isinstance(cid, str) or not cid.strip():
                    push("challenge.missing_id", "challenge.challengeId must be a non-empty string")
                    continue
                if cid in seen_ch:
                    push("challenge.duplicate", f"duplicate challengeId {cid}")
                seen_ch.add(cid)
                cfg = ch.get("config")
                if cfg is not None:
                    if not isinstance(cfg, dict):
                        push("challenge.config", f"challenge {cid} config must be a plain object")
                    else:
                        for k, v in cfg.items():
                            if v is not None and not isinstance(v, (str, bool, int, float)):
                                push("challenge.config", f"challenge {cid} config.{k} must be a JSON scalar")
                            elif isinstance(v, float) and not math.isfinite(v):
                                push("challenge.config", f"challenge {cid} config.{k} must be a JSON scalar")

    presentation = world.get("presentation")
    if presentation is not None:
        if not isinstance(presentation, dict):
            push("presentation.invalid", "presentation must be an object when present")
        else:
            for key in ("scaleProfileId", "cameraProfileId", "lodProfileId"):
                v = presentation.get(key)
                if v is not None and (not isinstance(v, str) or not v.strip()):
                    push("presentation.profile", f"presentation.{key} must be a non-empty string when present")
            cam = presentation.get("camera")
            if cam is not None:
                if not isinstance(cam, dict):
                    push("presentation.camera", "presentation.camera must be an object")
                else:
                    try:
                        mn = float(cam["minZoom"])
                        mx = float(cam["maxZoom"])
                        ini = float(cam["initialZoom"])
                    except (KeyError, TypeError, ValueError):
                        push("presentation.camera", "camera zoom values must be finite and positive")
                    else:
                        if not all(math.isfinite(v) and v > 0 for v in (mn, mx, ini)):
                            push("presentation.camera", "camera zoom values must be finite and positive")
                        elif mn < 0.05 or mx > 64 or mn > mx:
                            push("presentation.camera", "camera zoom bounds must satisfy 0.05 <= minZoom <= maxZoom <= 64")
                        elif ini < mn or ini > mx:
                            push("presentation.camera", "initialZoom must be within [minZoom, maxZoom]")

    locations = world.get("locations")
    if locations is not None:
        if not isinstance(locations, list):
            push("location.invalid", "locations must be an array when present")
        else:
            seen_loc: Set[str] = set()
            for loc in locations:
                if not isinstance(loc, dict):
                    push("location.invalid", "each location must be an object")
                    continue
                lid = loc.get("id")
                if not isinstance(lid, str) or not lid.strip():
                    push("location.missing_id", "location id is required")
                    continue
                if lid in seen_loc:
                    push("location.duplicate_id", f"duplicate location id {lid}")
                seen_loc.add(lid)
                if loc.get("kind") not in LOCATION_KINDS:
                    push("location.kind", f"location {lid} has invalid kind {loc.get('kind')}")
                if loc.get("territoryId") not in territory_ids:
                    push("location.territory", f"location {lid} territoryId {loc.get('territoryId')} does not exist")
                pos = loc.get("position")
                if (
                    not isinstance(pos, dict)
                    or not isinstance(pos.get("x"), (int, float))
                    or not isinstance(pos.get("y"), (int, float))
                    or not math.isfinite(float(pos["x"]))
                    or not math.isfinite(float(pos["y"]))
                ):
                    push("location.position", f"location {lid} position must be finite {{x,y}}")
                if "name" in loc and loc.get("name") is not None and not isinstance(loc.get("name"), str):
                    push("location.name", f"location {lid} name must be a string when present")
                if "visualAssetId" in loc and loc.get("visualAssetId") is not None and not isinstance(loc.get("visualAssetId"), str):
                    push("location.visual", f"location {lid} visualAssetId must be a string when present")

    composition = world.get("composition")
    if composition is not None:
        if not isinstance(composition, dict):
            push("composition.invalid", "composition must be an object when present")
        elif not isinstance(composition.get("instances"), list):
            push("composition.instances", "composition.instances must be an array")
        else:
            seen_inst: Set[str] = set()
            for inst in composition["instances"]:
                if not isinstance(inst, dict):
                    push("composition.invalid", "each composition instance must be an object")
                    continue
                iid = instance_id(inst)
                if not iid:
                    push("composition.missing_id", "composition instanceId is required")
                    continue
                if iid in seen_inst:
                    push("composition.duplicate_id", f"duplicate composition instanceId {iid}")
                seen_inst.add(iid)
                if not isinstance(inst.get("assetId"), str) or not inst.get("assetId"):
                    push("composition.asset", f"instance {iid} assetId is required")
                x, y = instance_point(inst)
                if not math.isfinite(x) or not math.isfinite(y):
                    push("composition.position", f"instance {iid} position must be finite {{x,y}}")
                rot = inst.get("rotationDegrees", 0)
                if not isinstance(rot, (int, float)) or not math.isfinite(float(rot)):
                    push("composition.rotation", f"instance {iid} rotationDegrees must be finite")
                scale = inst.get("scale", None)
                if scale is not None and (
                    not isinstance(scale, (int, float)) or not math.isfinite(float(scale)) or float(scale) <= 0
                ):
                    push("composition.scale", f"instance {iid} scale must be null or a positive finite number")
                anchor = inst.get("anchor")
                if not isinstance(anchor, str) or not anchor.strip():
                    push("composition.anchor", f"instance {iid} anchor is required")
                depth = inst.get("depth", instance_depth(inst))
                if not isinstance(depth, (int, float)) or not math.isfinite(float(depth)):
                    push("composition.depth", f"instance {iid} depth must be finite")
                importance = inst.get("importance")
                if importance is not None and importance not in COMPOSITION_IMPORTANCE:
                    push("composition.importance", f"instance {iid} has invalid importance")
                lod = inst.get("lodProfileId")
                if lod is not None and (not isinstance(lod, str) or not lod.strip()):
                    push("composition.lod", f"instance {iid} lodProfileId must be a non-empty string")
                tid = inst.get("territoryId")
                if tid is not None and tid not in territory_ids:
                    push("composition.territory", f"instance {iid} territoryId does not exist")

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
    world = strip_editor_keys(clone_world(raw))
    if not isinstance(world.get("startingDiplomacy"), list):
        world["startingDiplomacy"] = []
    if not isinstance(world.get("containedWorlds"), list):
        world["containedWorlds"] = []
    issues = validate_world(world)
    if issues:
        return None, issues
    return world, []


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
            "id": pid, "label": "Custom", "ambition": 0.5,
            "traits": {k: 0.5 for k in TRAIT_KEYS},
        },
    })
    return fid


def new_blank_world() -> Dict[str, Any]:
    return {
        "formatVersion": FORMAT_VERSION,
        "worldId": "w_untitled",
        "level": 1,
        "name": "Untitled World",
        "playerFactionId": "f_player",
        "island": {"rings": [[]]},
        "completion": {"type": "control_fraction", "fraction": 0.7},
        "containedWorlds": [],
        "factions": [{
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
        }],
        "startingDiplomacy": [],
        "regions": [],
        "territories": [],
    }


def identity_contained_placement() -> Dict[str, Any]:
    return {"origin": {"x": 0.0, "y": 0.0}, "rotationDegrees": 0.0, "scale": 1.0}


def _ensure_ccw(points: Sequence[Point]) -> List[Point]:
    return ensure_ccw(points)


def _quantize_point(p: Point) -> Point:
    return quantize_point(p)


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
        a, b = quantize_point(a), quantize_point(b)
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
            ring = ensure_ccw(path)
            if abs(ring_area(ring)) > GEOM_EPS:
                rings.append(ring)
    return rings


def union_polygon_exteriors(
    polygons: Sequence[Dict[str, Any]],
) -> Tuple[Optional[List[Point]], Optional[str]]:
    if not polygons:
        return None, "no polygons to union"
    rings: List[List[Point]] = []
    for poly in polygons:
        ring = polygon_exterior(poly)
        if not ring:
            return None, "a territory is missing a polygon"
        verts = unique_ring_vertices(ensure_ccw(ring))
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
            return None, "region union has a hole; v1 territories must be a simple exterior."
        return None, "region is geographically disconnected; coarsening needs one contiguous region outline."
    if ring_self_intersects(exterior):
        return None, "region union is self-intersecting"
    return ensure_ccw(exterior), None


def _import_fail(message: str, issues: Optional[List[Issue]] = None) -> Dict[str, Any]:
    return {"ok": False, "error": message, "issues": issues or [], "territories": []}


def plan_previous_level_import(source: Dict[str, Any], target: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(source, dict) or not isinstance(target, dict):
        return _import_fail("Import requires a WorldDefinition object.")
    src_issues = validate_world(source)
    if src_issues:
        msgs = "\n".join(f"[{i['code']}] {i['message']}" for i in src_issues[:20])
        return _import_fail("The selected JSON is not a valid WorldDefinition.\n" + msgs, src_issues)
    source_id = source.get("worldId") or ""
    if not source_id:
        return _import_fail("The imported world is missing worldId.")
    if source_id == (target.get("worldId") or ""):
        return _import_fail("A world cannot import itself as a contained previous level.")
    existing_contained = {c.get("worldId") for c in (target.get("containedWorlds") or []) if isinstance(c, dict)}
    if source_id in existing_contained:
        return _import_fail(f"{source_id} is already a contained world in this file.")
    regions = [r for r in (source.get("regions") or []) if isinstance(r, dict)]
    if not regions:
        return _import_fail("The previous-level world has no named regions.")
    by_id = {t.get("id"): t for t in (source.get("territories") or []) if isinstance(t, dict) and t.get("id")}
    planned: List[Dict[str, Any]] = []
    unions: Dict[str, Dict[str, Any]] = {}
    for region in regions:
        rid = region.get("id") or ""
        name = region.get("name") or rid
        member_ids = [tid for tid in (region.get("territoryIds") or []) if tid in by_id]
        if not member_ids:
            return _import_fail(f"Source region {name} has no territories.")
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
    tid_to_region = {t.get("id"): t.get("regionId") for t in (source.get("territories") or []) if isinstance(t, dict)}
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
    target_island = polygon_exterior(target.get("island") if isinstance(target.get("island"), dict) else None)
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
                "Imported geography does not lie on the current island and cannot be merged into one island outline."
            )
        island_out = points_to_polygon(merged)
    region_name = str(source.get("name") or source_id)
    return {
        "ok": True, "error": None, "issues": [], "warnings": warnings,
        "sourceWorldId": source_id, "sourceName": str(source.get("name") or source_id),
        "sourceLevel": source_level, "sourceRegionCount": len(regions),
        "sourceTerritoryCount": len(source.get("territories") or []),
        "targetLevel": next_level, "regionName": region_name,
        "island": island_out, "territories": planned,
        "placement": identity_contained_placement(),
    }


def apply_previous_level_import(target: Dict[str, Any], plan: Dict[str, Any]) -> Dict[str, Any]:
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
    existing = [t for t in (target.get("territories") or []) if isinstance(t, dict) and t.get("id") not in new_ids]
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
    return {"ok": True, "error": None, "regionId": rid, "territoryIds": new_ids, "idMap": id_map}


def import_plan_from_json_text(text: str, target: Dict[str, Any]) -> Dict[str, Any]:
    source, issues = parse_world_json(text)
    if source is None or issues:
        msgs = "\n".join(f"[{i['code']}] {i['message']}" for i in issues[:20])
        return _import_fail("The selected JSON is not a valid WorldDefinition.\n" + msgs, issues)
    return plan_previous_level_import(source, target)


def format_previous_level_import_preview(plan: Dict[str, Any]) -> str:
    if not plan.get("ok"):
        return plan.get("error") or "Import failed."
    rows = [
        f"World: {plan.get('sourceName')} ({plan.get('sourceWorldId')})",
        f"Source level: {plan.get('sourceLevel')}  ->  current level: {plan.get('targetLevel')}",
        f"New territories: {len(plan.get('territories') or [])}",
    ]
    return "\n".join(rows)


# ---------------------------------------------------------------------------
# Visual composition + assets
# ---------------------------------------------------------------------------

def classify_asset(path: str, name: str) -> str:
    blob = f"{path} {name}".lower().replace("\\", "/")
    non_world = ("emperor", "empress", "secretary", "logo", "badge", "hud", "cover", "/ui/", "portrait")
    if any(k in blob for k in non_world):
        return "NON_WORLD"
    state = ("army", "troop", "city", "farm", "mine", "lumber", "fortification", "garrison")
    if any(k in blob for k in state):
        return "STATE_DRIVEN"
    return "WORLD_PLACEABLE"


def default_layer_for_asset(name: str) -> str:
    n = name.lower()
    if "river" in n or "water" in n:
        return "water"
    if "mountain" in n or "hill" in n:
        return "landform"
    if "grass" in n or "brush" in n or "rock" in n:
        return "ground-detail"
    if "tree" in n or "forest" in n:
        return "vegetation"
    if "bridge" in n or "well" in n or "fence" in n:
        return "structure"
    if "landmark" in n:
        return "landmark"
    return "prop"


def find_repo_root() -> Optional[str]:
    roots = [os.getcwd()]
    here = os.path.abspath(os.path.dirname(__file__)) if "__file__" in globals() else os.getcwd()
    roots.extend([here, os.path.dirname(here), os.path.dirname(os.path.dirname(here))])
    seen: Set[str] = set()
    for root in roots:
        cur = os.path.abspath(root)
        for _ in range(8):
            if cur in seen:
                break
            seen.add(cur)
            if os.path.isdir(os.path.join(cur, "worlds")) or os.path.isfile(os.path.join(cur, "package.json")):
                return cur
            parent = os.path.dirname(cur)
            if parent == cur:
                break
            cur = parent
    return None


def find_world_path(rel: str) -> Optional[str]:
    roots = [os.getcwd()]
    repo = find_repo_root()
    if repo:
        roots.append(repo)
    here = os.path.abspath(os.path.dirname(__file__)) if "__file__" in globals() else os.getcwd()
    roots.extend([here, os.path.dirname(here), os.path.dirname(os.path.dirname(here))])
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


def find_tiny_world_path() -> Optional[str]:
    return find_world_path(os.path.join("docs", "examples", "world-level1-tiny.json"))


def find_level1_world_path() -> Optional[str]:
    return find_world_path(os.path.join("worlds", "level-1.json"))


def find_level2_world_path() -> Optional[str]:
    return find_world_path(os.path.join("worlds", "level-2.json"))


def load_scale_json(path: Optional[str] = None) -> Dict[str, Any]:
    candidates: List[str] = []
    if path:
        candidates.append(path)
    repo = find_repo_root()
    here = os.path.abspath(os.path.dirname(__file__)) if "__file__" in globals() else os.getcwd()
    for base in filter(None, [repo, here, os.path.join(here, "..", "..")]):
        candidates.extend([
            os.path.join(base, "assets", "asset-scale.json"),
            os.path.join(base, "tools", "map_assistant", "asset-scale.json"),
            os.path.join(here, "asset-scale.json"),
        ])
    for cand in candidates:
        if cand and os.path.isfile(cand):
            try:
                with open(cand, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(data, dict):
                assets = data.get("assets")
                if isinstance(assets, dict):
                    return assets
                return data
    return {}


def discover_assets(extra_roots: Optional[Sequence[str]] = None) -> List[Dict[str, Any]]:
    roots: List[str] = []
    repo = find_repo_root()
    here = os.path.abspath(os.path.dirname(__file__)) if "__file__" in globals() else os.getcwd()
    for base in filter(None, [repo, here]):
        roots.extend([
            os.path.join(base, "assets"),
            os.path.join(base, "art"),
            os.path.join(base, "images"),
            os.path.join(here, "assets"),
        ])
    if extra_roots:
        roots.extend(extra_roots)
    scale = load_scale_json()
    found: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    for root in roots:
        if not os.path.isdir(root):
            continue
        for dirpath, _dirnames, filenames in os.walk(root):
            for fn in filenames:
                ext = os.path.splitext(fn)[1].lower()
                if ext not in IMAGE_EXTS:
                    continue
                full = os.path.abspath(os.path.join(dirpath, fn))
                if full in seen:
                    continue
                seen.add(full)
                stem = os.path.splitext(fn)[0]
                rel = full
                if repo:
                    try:
                        rel = os.path.relpath(full, repo).replace("\\", "/")
                    except ValueError:
                        rel = full.replace("\\", "/")
                scale_entry = scale.get(stem) or scale.get(rel)
                default_scale = None
                anchor = "bottom-center"
                if isinstance(scale_entry, dict):
                    if "defaultScale" in scale_entry and isinstance(scale_entry["defaultScale"], (int, float)):
                        default_scale = float(scale_entry["defaultScale"])
                    if scale_entry.get("anchor") in ANCHORS:
                        anchor = str(scale_entry["anchor"])
                found.append({
                    "id": stem,
                    "path": rel,
                    "absPath": full,
                    "kind": classify_asset(rel, stem),
                    "defaultScale": default_scale,
                    "anchor": anchor,
                    "layer": default_layer_for_asset(stem),
                })
    found.sort(key=lambda a: (a["kind"], a["id"]))
    return found


class CompositionDocument:
    def __init__(self) -> None:
        self.instances: List[Dict[str, Any]] = []
        self._n = 0

    def clone(self) -> "CompositionDocument":
        c = CompositionDocument()
        c.instances = copy.deepcopy(self.instances)
        c._n = self._n
        return c

    def to_json(self, world_id: str = "") -> Dict[str, Any]:
        return {
            "formatVersion": COMPOSITION_FORMAT,
            "worldId": world_id,
            "instances": [normalize_composition_instance(i) or i for i in self.instances],
        }

    def to_world_composition(self) -> Dict[str, Any]:
        return normalize_composition_payload({"instances": self.instances})

    @classmethod
    def from_json(cls, raw: Any) -> "CompositionDocument":
        c = cls()
        payload = normalize_composition_payload(raw)
        c.instances = payload["instances"]
        max_n = 0
        for inst in c.instances:
            iid = instance_id(inst)
            if iid.startswith("prop_"):
                try:
                    max_n = max(max_n, int(iid.split("_", 1)[1]))
                except ValueError:
                    pass
        c._n = max(max_n, len(c.instances))
        return c

    def place(self, asset: Dict[str, Any], x: float, y: float) -> Dict[str, Any]:
        if asset.get("kind") != "WORLD_PLACEABLE":
            raise GraphError("That asset is not world-placeable composition.", "composition.not_placeable")
        self._n += 1
        layer = asset.get("layer") or "prop"
        inst = {
            "instanceId": f"prop_{self._n:02d}",
            "assetId": asset.get("id"),
            "position": {"x": float(x), "y": float(y)},
            "scale": None,
            "rotationDegrees": 0.0,
            "anchor": asset.get("anchor") or "bottom-center",
            "depth": float(LAYER_DEPTH.get(str(layer), 5.0)),
            "importance": "normal",
            "territoryId": None,
        }
        self.instances.append(inst)
        return inst

    def find(self, pid: str) -> Optional[Dict[str, Any]]:
        for inst in self.instances:
            if instance_id(inst) == pid:
                return inst
        return None

    def delete(self, pid: str) -> None:
        self.instances = [i for i in self.instances if instance_id(i) != pid]

    def duplicate(self, pid: str) -> Dict[str, Any]:
        src = self.find(pid)
        if src is None:
            raise GraphError("No such prop.", "composition.missing")
        self._n += 1
        inst = clone_world(src)
        inst["instanceId"] = f"prop_{self._n:02d}"
        inst.pop("id", None)
        x, y = instance_point(src)
        inst["position"] = {"x": x + 2.0, "y": y + 2.0}
        inst.pop("x", None)
        inst.pop("y", None)
        self.instances.append(inst)
        return inst


def dumps_composition(comp: CompositionDocument, world_id: str = "") -> str:
    return json.dumps(comp.to_json(world_id), indent=2, ensure_ascii=False) + "\n"


def effective_instance_scale(inst: Dict[str, Any], catalog: Sequence[Dict[str, Any]]) -> Optional[float]:
    if inst.get("scale") is not None:
        return float(inst["scale"])
    for asset in catalog:
        if asset.get("id") == inst.get("assetId"):
            return asset.get("defaultScale")
    return None


def territory_at_point(world: Dict[str, Any], pt: Point) -> Optional[str]:
    for t in world.get("territories") or []:
        if not isinstance(t, dict):
            continue
        ring = polygon_exterior(t.get("polygon") if isinstance(t.get("polygon"), dict) else None)
        if ring and point_in_ring(pt, ring):
            return str(t.get("id") or "")
    return None


def add_semantic_location(
    world: Dict[str, Any],
    kind: str,
    x: float,
    y: float,
    *,
    name: str = "",
    visual_asset_id: str = "",
) -> Dict[str, Any]:
    if kind not in LOCATION_KINDS:
        raise GraphError(f"Invalid location kind {kind}", "location.kind")
    tid = territory_at_point(world, (x, y))
    if not tid:
        raise GraphError("Location must be placed inside a territory.", "location.outside")
    existing = [
        loc.get("id") for loc in (world.get("locations") or [])
        if isinstance(loc, dict) and isinstance(loc.get("id"), str)
    ]
    lid = next_id("loc_", existing)
    loc: Dict[str, Any] = {
        "id": lid,
        "kind": kind,
        "territoryId": tid,
        "position": {"x": float(x), "y": float(y)},
    }
    if name.strip():
        loc["name"] = name.strip()
    if visual_asset_id.strip():
        loc["visualAssetId"] = visual_asset_id.strip()
    world.setdefault("locations", []).append(loc)
    return loc


# ---------------------------------------------------------------------------
# Document: draft graph + committed WorldDefinition + composition
# ---------------------------------------------------------------------------

class WorldDocument:
    def __init__(self) -> None:
        self.world = new_blank_world()
        self.graph = BoundaryGraph()
        self.composition = CompositionDocument()
        self.geography_dirty = False

    def clone(self) -> "WorldDocument":
        d = WorldDocument()
        d.world = clone_world(self.world)
        d.graph = self.graph.clone()
        d.composition = self.composition.clone()
        d.geography_dirty = self.geography_dirty
        return d

    def sync_composition_to_world(self) -> None:
        payload = self.composition.to_world_composition()
        if payload["instances"]:
            self.world["composition"] = payload
        else:
            self.world.pop("composition", None)

    def preview_faces(self) -> List[Dict[str, Any]]:
        return detect_faces(self.graph)["bounded"]

    def display_territory_rings(self) -> List[Dict[str, Any]]:
        if not self.geography_dirty:
            rows = []
            for t in self.world.get("territories") or []:
                ring = polygon_exterior(t.get("polygon") if isinstance(t, dict) else None)
                if ring:
                    rows.append({"id": t.get("id"), "ring": ring, "terrain": t.get("terrain", "plains")})
            if rows:
                return rows
        out = []
        for i, face in enumerate(self.preview_faces()):
            out.append({"id": f"draft_{i + 1}", "ring": face["ring"], "terrain": "plains"})
        return out

    def commit_geography(self) -> Dict[str, Any]:
        faces = self.preview_faces()
        if not faces:
            raise GraphError("No enclosed territories to commit. Close the island first.", "commit.empty")
        island = max(faces, key=lambda f: abs(f["area"]))
        # When internals exist, island outline is the largest face only if there is one face;
        # otherwise union of island-kind edges via unbounded twin. Use island-edge walk:
        island_ring = self._island_outline(faces)
        if island_ring is None:
            island_ring = island["ring"]
        interiors = faces
        if len(faces) > 1:
            # Drop a face that is the whole island if internals split it — all bounded faces are tiles.
            interiors = faces
        adj = face_adjacency(interiors)
        old = [t for t in (self.world.get("territories") or []) if isinstance(t, dict)]

        def match_old(ring: Sequence[Point]) -> Optional[Dict[str, Any]]:
            c = ring_centroid(ring)
            for t in old:
                ext = polygon_exterior(t.get("polygon"))
                if ext and point_in_ring(c, ext):
                    return t
            return None

        if not self.world.get("regions"):
            add_region(self.world, "Region")
        default_region = self.world["regions"][0]["id"]
        default_owner = self.world.get("playerFactionId") or "f_player"
        new_terrs: List[Dict[str, Any]] = []
        used_ids: Set[str] = set()
        for i, face in enumerate(interiors):
            prev = match_old(face["ring"])
            tid = prev["id"] if prev and prev.get("id") not in used_ids else next_id("t_", list(used_ids) + [t.get("id") for t in old])
            used_ids.add(tid)
            base = prev or {}
            new_terrs.append({
                "id": tid,
                "regionId": base.get("regionId") or default_region,
                "startingOwnerFactionId": base.get("startingOwnerFactionId") or default_owner,
                "neighborIds": [],
                "terrain": base.get("terrain") or "plains",
                "resourceOutput": clone_world(base.get("resourceOutput") or {k: 0 for k in RESOURCE_KEYS}),
                "polygon": points_to_polygon(face["ring"]),
                "_face": i,
            })
        id_by_face = {t["_face"]: t["id"] for t in new_terrs}
        for i, face in enumerate(interiors):
            tid = id_by_face[i]
            nbs = sorted(id_by_face[j] for j in adj.get(i, set()) if j in id_by_face)
            find = next(t for t in new_terrs if t["id"] == tid)
            find["neighborIds"] = nbs
        for t in new_terrs:
            t.pop("_face", None)
        self.world["island"] = points_to_polygon(island_ring)
        self.world["territories"] = new_terrs
        # Rebuild region membership lists.
        for r in self.world.get("regions") or []:
            r["territoryIds"] = [t["id"] for t in new_terrs if t.get("regionId") == r.get("id")]
        orphan = [t for t in new_terrs if not any(t["id"] in (r.get("territoryIds") or []) for r in self.world.get("regions") or [])]
        if orphan:
            rid = default_region
            for t in orphan:
                sync_region_membership(self.world, t["id"], rid)
        player = find_faction(self.world, str(self.world.get("playerFactionId") or ""))
        if player and new_terrs:
            if not find_territory(self.world, player.get("homeTerritoryId") or ""):
                player["homeTerritoryId"] = new_terrs[0]["id"]
            army = player.get("startingArmy") if isinstance(player.get("startingArmy"), dict) else None
            if army is not None and not find_territory(self.world, army.get("locationTerritoryId") or ""):
                army["locationTerritoryId"] = player["homeTerritoryId"]
        self.geography_dirty = False
        return {"ok": True, "territoryCount": len(new_terrs)}

    def _island_outline(self, faces: Sequence[Dict[str, Any]]) -> Optional[List[Point]]:
        island_eids = {eid for eid, e in self.graph.edges.items() if e.get("kind") == "island"}
        if not island_eids:
            return None
        # Walk island edges only via a temporary subgraph.
        sub = BoundaryGraph()
        id_map: Dict[str, str] = {}
        for eid in island_eids:
            e = self.graph.edges[eid]
            if e["a"] not in id_map:
                id_map[e["a"]] = sub.add_node(self.graph.nodes[e["a"]])
            if e["b"] not in id_map:
                id_map[e["b"]] = sub.add_node(self.graph.nodes[e["b"]])
            ne = sub._new_edge_id()
            pts = [sub.nodes[id_map[e["a"]]]] + list(e["points"][1:-1]) + [sub.nodes[id_map[e["b"]]]]
            sub.edges[ne] = {"a": id_map[e["a"]], "b": id_map[e["b"]], "kind": "island", "points": pts}
        found = detect_faces(sub)["bounded"]
        if not found:
            return faces[0]["ring"] if faces else None
        return max(found, key=lambda f: abs(f["area"]))["ring"]

    def to_editor_json(self) -> Dict[str, Any]:
        self.sync_composition_to_world()
        payload = clone_world(self.world)
        payload[EDITOR_GRAPH_KEY] = self.graph.to_json()
        # Prefer playable world.composition; keep reading legacy _editorComposition on open.
        payload.pop(EDITOR_COMPOSITION_KEY, None)
        payload[EDITOR_DIRTY_KEY] = bool(self.geography_dirty)
        return payload

    def dumps_editor(self) -> str:
        return json.dumps(self.to_editor_json(), indent=2, ensure_ascii=False) + "\n"


def reconstruct_graph_from_world(world: Dict[str, Any]) -> BoundaryGraph:
    """Best-effort vector graph from committed polygons (no raster). Used by import, not by open."""
    g = BoundaryGraph()
    island = polygon_exterior(world.get("island") if isinstance(world.get("island"), dict) else None)
    verts = unique_ring_vertices(island) if island else []
    if len(verts) >= 3:
        try:
            g.add_island(verts)
        except GraphError:
            pass
    existing_keys: Set[str] = set()
    for e in g.edges.values():
        pts = e.get("points") or []
        if len(pts) >= 2:
            existing_keys.add(undirected_edge_key(pts[0], pts[-1]))
    for t in world.get("territories") or []:
        ring = polygon_exterior(t.get("polygon") if isinstance(t, dict) else None)
        if not ring:
            continue
        for a, b in ring_edges(unique_ring_vertices(ring)):
            key = undirected_edge_key(a, b)
            if key in existing_keys:
                continue
            existing_keys.add(key)
            if not g.has_island():
                continue
            na = g.add_node(a)
            nb = g.add_node(b)
            if na == nb or g._has_undirected_edge(na, nb):
                continue
            eid = g._new_edge_id()
            g.edges[eid] = {
                "a": na,
                "b": nb,
                "kind": "internal",
                "points": [g.nodes[na], g.nodes[nb]],
            }
    return g


def document_from_raw(raw: Dict[str, Any]) -> WorldDocument:
    doc = WorldDocument()
    graph_raw = raw.get(EDITOR_GRAPH_KEY)
    comp_raw = raw.get(EDITOR_COMPOSITION_KEY)
    dirty = bool(raw.get(EDITOR_DIRTY_KEY))
    doc.world = strip_editor_keys(clone_world(raw))
    if not isinstance(doc.world.get("startingDiplomacy"), list):
        doc.world["startingDiplomacy"] = []
    if not isinstance(doc.world.get("containedWorlds"), list):
        doc.world["containedWorlds"] = []
    if isinstance(graph_raw, dict) and (graph_raw.get("edges") or graph_raw.get("nodes")):
        doc.graph = BoundaryGraph.from_json(graph_raw)
        doc.geography_dirty = dirty
    else:
        # Existing playable worlds have committed polygons and no editor graph.
        # Do not reinterpret those polygons into a fake drawing.
        doc.graph = BoundaryGraph()
        doc.geography_dirty = False
    world_comp = doc.world.get("composition")
    if isinstance(world_comp, dict) and isinstance(world_comp.get("instances"), list) and world_comp["instances"]:
        doc.composition = CompositionDocument.from_json(world_comp)
    elif isinstance(comp_raw, dict):
        doc.composition = CompositionDocument.from_json(comp_raw)
    doc.sync_composition_to_world()
    return doc


class UndoStack:
    def __init__(self, limit: int = 80) -> None:
        self.limit = limit
        self.undo: List[WorldDocument] = []
        self.redo: List[WorldDocument] = []

    def push(self, doc: WorldDocument) -> None:
        self.undo.append(doc.clone())
        if len(self.undo) > self.limit:
            self.undo.pop(0)
        self.redo.clear()

    def apply_undo(self, current: WorldDocument) -> Optional[WorldDocument]:
        if not self.undo:
            return None
        self.redo.append(current.clone())
        return self.undo.pop()

    def apply_redo(self, current: WorldDocument) -> Optional[WorldDocument]:
        if not self.redo:
            return None
        self.undo.append(current.clone())
        return self.redo.pop()


# ---------------------------------------------------------------------------
# Fixtures (tests only — not a map generator)
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


def square_island_points() -> List[Point]:
    return [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class WorldLogicTests(unittest.TestCase):
    def test_blank_world_has_schema_fields(self) -> None:
        w = new_blank_world()
        self.assertEqual(w["formatVersion"], FORMAT_VERSION)
        self.assertEqual(w["playerFactionId"], "f_player")
        self.assertEqual(w["territories"], [])
        self.assertIsNone(w["factions"][0]["personality"])
        self.assertNotIn("cities", w)
        codes = {i["code"] for i in validate_world(w)}
        self.assertIn("territory.empty", codes)
        self.assertNotIn(EDITOR_GRAPH_KEY, w)

    def test_minimal_world_valid(self) -> None:
        self.assertEqual(validate_world(make_minimal_valid_world()), [])

    def test_round_trip_deterministic(self) -> None:
        w = make_minimal_valid_world()
        text1 = dumps_world(w)
        loaded, issues = parse_world_json(text1)
        self.assertEqual(issues, [])
        text2 = dumps_world(loaded)  # type: ignore[arg-type]
        self.assertEqual(text1, text2)
        self.assertNotIn("isCapital", text1)
        self.assertNotIn(EDITOR_GRAPH_KEY, text1)

    def test_territory_create_delete(self) -> None:
        w = make_minimal_valid_world()
        rid = w["regions"][0]["id"]
        tid = add_territory(w, [(4, 4), (6, 4), (6, 6), (4, 6)], rid, "f_ai_01")
        self.assertIsNotNone(find_territory(w, tid))
        delete_territory(w, tid)
        self.assertIsNone(find_territory(w, tid))

    def test_region_create_and_assign(self) -> None:
        w = make_minimal_valid_world()
        rid = add_region(w, "North")
        sync_region_membership(w, "t_02", rid)
        self.assertEqual(find_territory(w, "t_02")["regionId"], rid)

    def test_reciprocal_adjacency(self) -> None:
        w = make_minimal_valid_world()
        w["territories"][0]["neighborIds"] = []
        w["territories"][1]["neighborIds"] = []
        set_reciprocal_neighbor(w, "t_01", "t_02", True)
        self.assertIn("t_02", find_territory(w, "t_01")["neighborIds"])
        set_reciprocal_neighbor(w, "t_01", "t_02", False)
        self.assertEqual(find_territory(w, "t_01")["neighborIds"], [])

    def test_non_reciprocal_rejected(self) -> None:
        w = make_minimal_valid_world()
        w["territories"][0]["neighborIds"] = ["t_02"]
        w["territories"][1]["neighborIds"] = []
        self.assertIn("adjacency.non_reciprocal", {i["code"] for i in validate_world(w)})

    def test_ownership_assignment(self) -> None:
        w = make_minimal_valid_world()
        find_territory(w, "t_02")["startingOwnerFactionId"] = "f_player"
        self.assertIn("owner.player_count", {i["code"] for i in validate_world(w)})

    def test_personality_editing(self) -> None:
        w = make_minimal_valid_world()
        p = find_faction(w, "f_ai_01")["personality"]
        p["traits"]["aggression"] = 0.91
        self.assertEqual(validate_world(w), [])
        p["traits"]["aggression"] = 2
        self.assertIn("personality.trait", {i["code"] for i in validate_world(w)})

    def test_forbidden_legacy_fields(self) -> None:
        w = make_minimal_valid_world()
        w["territories"][0]["name"] = "Named Tile"
        self.assertIn("territory.named", {i["code"] for i in validate_world(w)})
        w = make_minimal_valid_world()
        w["scout"] = True
        self.assertIn("world.forbidden_field", {i["code"] for i in validate_world(w)})

    def test_invalid_json_does_not_invent_world(self) -> None:
        world, issues = parse_world_json("{")
        self.assertIsNone(world)
        self.assertTrue(any(i["code"] == "json.parse" for i in issues))

    def test_export_has_no_editor_keys(self) -> None:
        doc = WorldDocument()
        doc.graph.add_island(square_island_points())
        doc.geography_dirty = True
        playable = dumps_world(doc.to_editor_json())
        self.assertNotIn(EDITOR_GRAPH_KEY, playable)
        self.assertNotIn(EDITOR_COMPOSITION_KEY, playable)

    def test_tiny_world_file_round_trip_if_present(self) -> None:
        path = find_tiny_world_path()
        if not path:
            self.skipTest("docs/examples/world-level1-tiny.json not found")
        with open(path, "r", encoding="utf-8") as fh:
            original = fh.read()
        world, issues = parse_world_json(original)
        self.assertEqual(issues, [], msg=issues)
        self.assertEqual(world["worldId"], "w_ember_atoll")
        exported = dumps_world(world)
        again, issues2 = parse_world_json(exported)
        self.assertEqual(issues2, [])
        self.assertEqual(dumps_world(again), exported)
        with open(path, "r", encoding="utf-8") as fh:
            self.assertEqual(fh.read(), original)

    def test_level1_opens_without_corruption(self) -> None:
        path = find_level1_world_path()
        if not path:
            self.skipTest("worlds/level-1.json not found")
        with open(path, "r", encoding="utf-8") as fh:
            original = fh.read()
        raw = json.loads(original)
        world, issues = parse_world_json(original)
        self.assertEqual(issues, [], msg=issues)
        doc = document_from_raw(raw)
        self.assertFalse(doc.geography_dirty)
        exported = dumps_world(doc.world)
        again, issues2 = parse_world_json(exported)
        self.assertEqual(issues2, [])
        self.assertEqual(again["worldId"], world["worldId"])
        self.assertEqual(len(again["territories"]), len(world["territories"]))
        with open(path, "r", encoding="utf-8") as fh:
            self.assertEqual(fh.read(), original)

    def test_level2_opens_without_corruption(self) -> None:
        path = find_level2_world_path()
        if not path:
            self.skipTest("worlds/level-2.json not found")
        with open(path, "r", encoding="utf-8") as fh:
            original = fh.read()
        world, issues = parse_world_json(original)
        self.assertEqual(issues, [], msg=issues)
        doc = document_from_raw(json.loads(original))
        self.assertEqual(doc.world["worldId"], world["worldId"])
        self.assertEqual(len(doc.world["territories"]), len(world["territories"]))
        with open(path, "r", encoding="utf-8") as fh:
            self.assertEqual(fh.read(), original)


class BoundaryGraphTests(unittest.TestCase):
    def test_add_node_and_edge(self) -> None:
        g = BoundaryGraph()
        a = g.add_node((0, 0))
        b = g.add_node((1, 0))
        self.assertNotEqual(a, b)
        g.edges["e"] = {"a": a, "b": b, "kind": "internal", "points": [g.nodes[a], g.nodes[b]]}
        self.assertEqual(len(g.incident_edges(a)), 1)

    def test_closed_island_one_territory(self) -> None:
        g = BoundaryGraph()
        g.add_island(square_island_points())
        faces = detect_faces(g)["bounded"]
        self.assertEqual(len(faces), 1)

    def test_one_division_two_territories(self) -> None:
        g = BoundaryGraph()
        g.add_island(square_island_points())
        g.add_boundary([(5, 0), (5, 10)], snap_radius=0.2)
        faces = detect_faces(g)["bounded"]
        self.assertEqual(len(faces), 2)
        adj = face_adjacency(faces)
        self.assertEqual(adj[0], {1})
        self.assertEqual(adj[1], {0})

    def test_two_divisions_four_territories(self) -> None:
        g = BoundaryGraph()
        g.add_island(square_island_points())
        g.add_boundary([(5, 0), (5, 10)], snap_radius=0.2)
        g.add_boundary([(0, 5), (10, 5)], snap_radius=0.2)
        faces = detect_faces(g)["bounded"]
        self.assertEqual(len(faces), 4)
        adj = face_adjacency(faces)
        for i in range(4):
            self.assertEqual(len(adj[i]), 2)

    def test_endpoint_snapping_and_split(self) -> None:
        g = BoundaryGraph()
        g.add_island(square_island_points())
        before = len(g.edges)
        g.add_boundary([(5.04, 0.02), (5.01, 9.97)], snap_radius=0.2)
        self.assertGreater(len(g.nodes), 4)
        self.assertGreater(len(g.edges), before)

    def test_unsnapped_internal_rejected(self) -> None:
        g = BoundaryGraph()
        g.add_island(square_island_points())
        with self.assertRaises(GraphError) as ctx:
            g.add_boundary([(5, 5), (6, 6)], snap_radius=0.05)
        self.assertEqual(ctx.exception.code, "graph.unsnapped_endpoint")
        self.assertEqual(len(detect_faces(g)["bounded"]), 1)

    def test_self_intersecting_island_rejected(self) -> None:
        g = BoundaryGraph()
        with self.assertRaises(GraphError):
            g.add_island([(0, 0), (4, 4), (4, 0), (0, 4)])

    def test_boundary_before_island_rejected(self) -> None:
        g = BoundaryGraph()
        with self.assertRaises(GraphError) as ctx:
            g.add_boundary([(0, 0), (1, 0)], snap_radius=0.2)
        self.assertEqual(ctx.exception.code, "graph.no_island")

    def test_move_node_updates_geometry(self) -> None:
        g = BoundaryGraph()
        g.add_island(square_island_points())
        nid = next(n for n, p in g.nodes.items() if points_equal(p, (0.0, 0.0)))
        g.move_node(nid, (-1.0, -1.0))
        self.assertTrue(points_equal(g.nodes[nid], (-1.0, -1.0)))

    def test_delete_internal_edge(self) -> None:
        g = BoundaryGraph()
        g.add_island(square_island_points())
        created = g.add_boundary([(5, 0), (5, 10)], snap_radius=0.2)
        self.assertEqual(len(detect_faces(g)["bounded"]), 2)
        g.delete_edge(created["edgeIds"][0])
        self.assertEqual(len(detect_faces(g)["bounded"]), 1)

    def test_irregular_island(self) -> None:
        g = BoundaryGraph()
        g.add_island([(0, 0), (8, 1), (9, 7), (3, 10), (-1, 4)])
        self.assertEqual(len(detect_faces(g)["bounded"]), 1)

    def test_shared_boundary_identity(self) -> None:
        g = BoundaryGraph()
        g.add_island(square_island_points())
        created = g.add_boundary([(5, 0), (5, 10)], snap_radius=0.2)
        faces = detect_faces(g)["bounded"]
        shared = set(faces[0]["edgeIds"]) & set(faces[1]["edgeIds"])
        self.assertTrue(shared)
        self.assertTrue(set(created["edgeIds"]) & shared)


class CommitAndEditTests(unittest.TestCase):
    def test_commit_two_faces(self) -> None:
        doc = WorldDocument()
        doc.graph.add_island(square_island_points())
        doc.graph.add_boundary([(5, 0), (5, 10)], snap_radius=0.2)
        result = doc.commit_geography()
        self.assertTrue(result["ok"])
        self.assertEqual(len(doc.world["territories"]), 2)
        ai_id = add_ai_faction(doc.world)
        t1, t2 = doc.world["territories"]
        player = doc.world["playerFactionId"]
        t1["startingOwnerFactionId"] = player
        t2["startingOwnerFactionId"] = ai_id
        player_f = find_faction(doc.world, player)
        ai_f = find_faction(doc.world, ai_id)
        assert player_f is not None and ai_f is not None
        player_f["homeTerritoryId"] = t1["id"]
        player_f["startingArmy"]["locationTerritoryId"] = t1["id"]
        ai_f["homeTerritoryId"] = t2["id"]
        ai_f["startingArmy"]["locationTerritoryId"] = t2["id"]
        self.assertEqual(validate_world(doc.world), [])

    def test_undo_redo_boundary(self) -> None:
        doc = WorldDocument()
        stack = UndoStack()
        stack.push(doc)
        doc.graph.add_island(square_island_points())
        stack.push(doc)
        doc.graph.add_boundary([(5, 0), (5, 10)], snap_radius=0.2)
        self.assertEqual(len(detect_faces(doc.graph)["bounded"]), 2)
        restored = stack.apply_undo(doc)
        self.assertIsNotNone(restored)
        self.assertEqual(len(detect_faces(restored.graph)["bounded"]), 1)
        redone = stack.apply_redo(restored)
        self.assertEqual(len(detect_faces(redone.graph)["bounded"]), 2)

    def test_save_reload_draft(self) -> None:
        doc = WorldDocument()
        doc.graph.add_island(square_island_points())
        doc.geography_dirty = True
        raw = json.loads(doc.dumps_editor())
        graph_json = raw[EDITOR_GRAPH_KEY]
        self.assertTrue(graph_json["edges"])
        first_edge = next(iter(graph_json["edges"].values()))
        self.assertIsInstance(first_edge["points"][0], dict)
        loaded = document_from_raw(raw)
        self.assertTrue(loaded.graph.has_island())
        self.assertEqual(len(detect_faces(loaded.graph)["bounded"]), 1)

    def test_playable_export_strips_editor(self) -> None:
        doc = WorldDocument()
        doc.graph.add_island(square_island_points())
        doc.commit_geography()
        add_ai_faction(doc.world)
        doc.world["factions"][1]["homeTerritoryId"] = "t_01"
        doc.world["factions"][1]["startingArmy"]["locationTerritoryId"] = "t_01"
        # one-territory world is not level-1 valid (player count); bump owners for export strip test only
        text = dumps_world(doc.to_editor_json())
        data = json.loads(text)
        self.assertNotIn(EDITOR_GRAPH_KEY, data)
        self.assertNotIn(EDITOR_COMPOSITION_KEY, data)


class CompositionTests(unittest.TestCase):
    def _asset(self) -> Dict[str, Any]:
        return {
            "id": "tree_cluster_2", "path": "assets/world/tree_cluster_2.png",
            "kind": "WORLD_PLACEABLE", "defaultScale": 1.5, "anchor": "bottom-center",
            "layer": "vegetation",
        }

    def test_place_move_scale_rotate_duplicate_delete(self) -> None:
        c = CompositionDocument()
        inst = c.place(self._asset(), 3.0, 4.0)
        self.assertEqual(instance_point(inst), (3.0, 4.0))
        inst["position"] = {"x": 8.0, "y": 4.0}
        inst["scale"] = 2.0
        inst["rotationDegrees"] = 45.0
        dup = c.duplicate(instance_id(inst))
        self.assertEqual(len(c.instances), 2)
        self.assertNotEqual(instance_id(dup), instance_id(inst))
        c.delete(instance_id(inst))
        self.assertEqual(len(c.instances), 1)

    def test_non_world_rejected(self) -> None:
        c = CompositionDocument()
        with self.assertRaises(GraphError):
            c.place({"id": "emperor", "kind": "NON_WORLD", "path": "x.png"}, 0, 0)

    def test_save_reload_and_export(self) -> None:
        c = CompositionDocument()
        c.place(self._asset(), 1, 2)
        blob = dumps_composition(c, "w_test")
        data = json.loads(blob)
        self.assertEqual(data["formatVersion"], COMPOSITION_FORMAT)
        self.assertIn("instanceId", data["instances"][0])
        self.assertIn("position", data["instances"][0])
        loaded = CompositionDocument.from_json(data)
        self.assertEqual(len(loaded.instances), 1)

    def test_legacy_editor_composition_migrates(self) -> None:
        legacy = {
            "formatVersion": COMPOSITION_FORMAT,
            "instances": [{
                "id": "prop_01", "assetId": "tree", "x": 1.0, "y": 2.0,
                "scale": None, "rotationDegrees": 0, "anchor": "bottom-center",
                "layer": "vegetation", "territoryId": None,
            }],
        }
        loaded = CompositionDocument.from_json(legacy)
        self.assertEqual(instance_id(loaded.instances[0]), "prop_01")
        self.assertEqual(instance_point(loaded.instances[0]), (1.0, 2.0))
        self.assertEqual(instance_depth(loaded.instances[0]), LAYER_DEPTH["vegetation"])

    def test_scale_json_default_and_override(self) -> None:
        inst = {"assetId": "tree_cluster_2", "scale": None}
        catalog = [self._asset()]
        self.assertEqual(effective_instance_scale(inst, catalog), 1.5)
        inst["scale"] = 3.0
        self.assertEqual(effective_instance_scale(inst, catalog), 3.0)
        self.assertIsNone(effective_instance_scale({"assetId": "missing", "scale": None}, catalog))

    def test_classify_assets(self) -> None:
        self.assertEqual(classify_asset("assets/ui/emperor.png", "emperor"), "NON_WORLD")
        self.assertEqual(classify_asset("assets/units/army.png", "army"), "STATE_DRIVEN")
        self.assertEqual(classify_asset("assets/world/tree.png", "tree"), "WORLD_PLACEABLE")

    def test_load_scale_json_file(self) -> None:
        fd, path = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        try:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump({"assets": {"well": {"defaultScale": 0.4, "anchor": "center"}}}, fh)
            data = load_scale_json(path)
            self.assertEqual(data["well"]["defaultScale"], 0.4)
        finally:
            os.remove(path)


class WorldArchitectureTests(unittest.TestCase):
    def test_legacy_minimal_keys_unchanged(self) -> None:
        w = make_minimal_valid_world()
        exported = json.loads(dumps_world(w))
        self.assertEqual(
            list(exported.keys()),
            [
                "formatVersion", "worldId", "level", "name", "playerFactionId", "island",
                "completion", "containedWorlds", "factions", "startingDiplomacy", "regions",
                "territories",
            ],
        )
        self.assertNotIn("theme", exported)
        self.assertNotIn("challenges", exported)
        self.assertNotIn("presentation", exported)
        self.assertNotIn("locations", exported)
        self.assertNotIn("composition", exported)
        self.assertNotIn("description", exported)

    def test_theme_library_loads_112(self) -> None:
        lib = load_theme_library(force=True)
        self.assertIsNotNone(lib)
        assert lib is not None
        self.assertEqual(lib["themeCount"], 112)
        self.assertIn("barren_desert", lib["byId"])
        self.assertIn("tutorial_realm", lib["byId"])

    def test_theme_set_change_round_trip(self) -> None:
        w = make_minimal_valid_world()
        w["theme"] = {"themeId": "barren_desert"}
        self.assertEqual(validate_world(w), [])
        text = dumps_world(w)
        loaded, issues = parse_world_json(text)
        self.assertEqual(issues, [])
        assert loaded is not None
        self.assertEqual(loaded["theme"]["themeId"], "barren_desert")
        loaded["theme"] = {"themeId": "redstone_badlands"}
        again = json.loads(dumps_world(loaded))
        self.assertEqual(again["theme"]["themeId"], "redstone_badlands")

    def test_unknown_theme_rejected_when_library_loaded(self) -> None:
        lib = load_theme_library(force=True)
        self.assertIsNotNone(lib)
        w = make_minimal_valid_world()
        w["theme"] = {"themeId": "not_a_real_theme_xyz"}
        codes = {i["code"] for i in validate_world(w)}
        self.assertIn("theme.unknown_id", codes)

    def test_challenge_and_presentation_round_trip(self) -> None:
        w = make_minimal_valid_world()
        w["challenges"] = [
            {"challengeId": "drought", "config": {"severity": 0.5}},
            {"challengeId": "difficult_travel"},
        ]
        w["presentation"] = {
            "scaleProfileId": "regional_world",
            "cameraProfileId": "world_default",
            "camera": {"minZoom": 0.8, "maxZoom": 2.5, "initialZoom": 1.0},
        }
        self.assertEqual(validate_world(w), [])
        loaded, issues = parse_world_json(dumps_world(w))
        self.assertEqual(issues, [])
        assert loaded is not None
        self.assertEqual(len(loaded["challenges"]), 2)
        self.assertEqual(loaded["presentation"]["scaleProfileId"], "regional_world")
        self.assertEqual(loaded["presentation"]["camera"]["initialZoom"], 1.0)

    def test_theme_does_not_auto_apply_challenge(self) -> None:
        w = make_minimal_valid_world()
        w["theme"] = {"themeId": "barren_desert"}
        self.assertNotIn("challenges", dumps_world(w))
        self.assertIsNone(json.loads(dumps_world(w)).get("challenges"))

    def test_locations_and_composition_round_trip(self) -> None:
        w = make_minimal_valid_world()
        w["locations"] = [{
            "id": "loc_01", "kind": "mine", "territoryId": "t_01",
            "position": {"x": 3.0, "y": 4.0}, "name": "Iron Pit",
        }]
        w["composition"] = {"instances": [{
            "instanceId": "prop_01", "assetId": "oak_tree",
            "position": {"x": 2.0, "y": 3.0}, "rotationDegrees": 15.0,
            "scale": 0.85, "anchor": "bottom-center", "depth": 3.0,
            "importance": "normal", "territoryId": "t_01",
        }]}
        self.assertEqual(validate_world(w), [])
        loaded, issues = parse_world_json(dumps_world(w))
        self.assertEqual(issues, [])
        assert loaded is not None
        self.assertEqual(loaded["locations"][0]["kind"], "mine")
        self.assertEqual(loaded["composition"]["instances"][0]["scale"], 0.85)

    def test_contained_world_placement_round_trip(self) -> None:
        w = make_minimal_valid_world()
        w["containedWorlds"] = [{
            "worldId": "w_child",
            "regionId": "r_01",
            "placement": {"origin": {"x": 1.0, "y": 2.0}, "rotationDegrees": 10.0, "scale": 0.25},
        }]
        self.assertEqual(validate_world(w), [])
        loaded, issues = parse_world_json(dumps_world(w))
        self.assertEqual(issues, [])
        assert loaded is not None
        self.assertEqual(loaded["containedWorlds"][0]["placement"]["scale"], 0.25)

    def test_new_metadata_does_not_change_geometry(self) -> None:
        base = make_minimal_valid_world()
        geo_before = dumps_world(base)
        enriched = clone_world(base)
        enriched["theme"] = {"themeId": "barren_desert"}
        enriched["description"] = "A dry world"
        enriched["challenges"] = [{"challengeId": "drought"}]
        enriched["presentation"] = {"scaleProfileId": "regional_world"}
        # Strip new fields and compare geography core
        stripped = ordered_world(enriched)
        for k in ("theme", "description", "challenges", "presentation"):
            stripped.pop(k, None)
        base_obj = json.loads(geo_before)
        stripped_obj = json.loads(json.dumps(stripped, indent=2, ensure_ascii=False) + "\n")
        for key in ("island", "territories", "regions", "containedWorlds", "factions"):
            self.assertEqual(stripped_obj[key], base_obj[key])

    def test_playable_composition_sync_from_document(self) -> None:
        doc = WorldDocument()
        doc.world = make_minimal_valid_world()
        doc.composition.place({
            "id": "tree", "kind": "WORLD_PLACEABLE", "path": "x.png",
            "anchor": "bottom-center", "layer": "vegetation",
        }, 1.0, 2.0)
        doc.sync_composition_to_world()
        exported = json.loads(dumps_world(doc.world))
        self.assertIn("composition", exported)
        self.assertEqual(exported["composition"]["instances"][0]["assetId"], "tree")
        self.assertNotIn(EDITOR_COMPOSITION_KEY, exported)


class PreviousLevelImportTests(unittest.TestCase):
    def test_plan_and_apply(self) -> None:
        source = make_minimal_valid_world()
        target = new_blank_world()
        plan = plan_previous_level_import(source, target)
        self.assertTrue(plan["ok"], msg=plan.get("error"))
        applied = apply_previous_level_import(target, plan)
        self.assertTrue(applied["ok"])
        self.assertTrue(any(c.get("worldId") == "w_test_min" for c in target["containedWorlds"]))


def run_self_test() -> int:
    loader = unittest.defaultTestLoader
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromTestCase(WorldLogicTests))
    suite.addTests(loader.loadTestsFromTestCase(BoundaryGraphTests))
    suite.addTests(loader.loadTestsFromTestCase(CommitAndEditTests))
    suite.addTests(loader.loadTestsFromTestCase(CompositionTests))
    suite.addTests(loader.loadTestsFromTestCase(WorldArchitectureTests))
    suite.addTests(loader.loadTestsFromTestCase(PreviousLevelImportTests))
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
    print(
        f"VALID  {world['worldId']}  level {world['level']}  "
        f"{len(world['territories'])} territories  {len(world['regions'])} regions"
    )
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
            "Tkinter is required for the editor GUI.\n"
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
            self.title("REP WARS Map Assistant 4.0")
            self.geometry("1280x800")
            self.minsize(960, 600)
            self.doc = WorldDocument()
            self.path: Optional[str] = None
            self.dirty = False
            self.undo = UndoStack()
            self.tool = tk.StringVar(value="island")
            self.preview_mode = tk.StringVar(value="authoring")
            self.show_ids = tk.BooleanVar(value=True)
            self.show_terrain = tk.BooleanVar(value=True)
            self.show_props = tk.BooleanVar(value=True)
            self.zoom = 12.0
            self.origin_x = 120.0
            self.origin_y = 560.0
            self.stroke: Optional[List[Point]] = None
            self.sel: Optional[Tuple[str, str]] = None
            self.selected_territories: Set[str] = set()
            self.catalog = discover_assets()
            self.place_asset: Optional[Dict[str, Any]] = None
            self.place_location_kind = tk.StringVar(value="city")
            self.theme_lib = load_theme_library()
            self._pan_last: Optional[Tuple[int, int]] = None
            self._suspend = False
            self._build()
            self.protocol("WM_DELETE_WINDOW", self._on_close)
            self.after(80, self._fit)
            if initial_path:
                self.after(100, lambda: self._open_path(initial_path, replacing=True))

        def _build(self) -> None:
            self._menu()
            toolbar = ttk.Frame(self)
            toolbar.pack(side="top", fill="x", padx=4, pady=2)
            for value, label in (
                ("island", "Island"),
                ("boundary", "Boundary"),
                ("select", "Select"),
                ("node", "Move node"),
                ("delete", "Delete"),
                ("prop", "Place prop"),
                ("location", "Place location"),
                ("pan", "Pan"),
            ):
                ttk.Radiobutton(toolbar, text=label, value=value, variable=self.tool).pack(side="left")
            ttk.Button(toolbar, text="COMMIT GEOGRAPHY", command=self._commit).pack(side="left", padx=8)
            ttk.Radiobutton(toolbar, text="Authoring", value="authoring", variable=self.preview_mode, command=self._redraw).pack(side="left")
            ttk.Radiobutton(toolbar, text="3/4 preview", value="oblique", variable=self.preview_mode, command=self._redraw).pack(side="left")
            ttk.Checkbutton(toolbar, text="IDs", variable=self.show_ids, command=self._redraw).pack(side="left")
            ttk.Checkbutton(toolbar, text="Terrain", variable=self.show_terrain, command=self._redraw).pack(side="left")
            ttk.Checkbutton(toolbar, text="Props", variable=self.show_props, command=self._redraw).pack(side="left")
            ttk.Button(toolbar, text="Validate", command=self._validate_dialog).pack(side="right")

            body = ttk.Frame(self)
            body.pack(fill="both", expand=True)
            self.canvas = tk.Canvas(body, bg="#1b1f24", highlightthickness=0)
            self.canvas.pack(side="left", fill="both", expand=True)
            self.canvas.bind("<ButtonPress-1>", self._down)
            self.canvas.bind("<B1-Motion>", self._drag)
            self.canvas.bind("<ButtonRelease-1>", self._up)
            self.canvas.bind("<MouseWheel>", self._wheel)
            self.canvas.bind("<Button-4>", self._wheel)
            self.canvas.bind("<Button-5>", self._wheel)

            side = ttk.Notebook(body, width=SIDEBAR_WIDTH)
            side.pack(side="right", fill="y")
            self.nb = side
            self._build_world_tab(side)
            self._build_theme_tab(side)
            self._build_challenge_tab(side)
            self._build_presentation_tab(side)
            self._build_geo_tab(side)
            self._build_locations_tab(side)
            self._build_assets_tab(side)
            self._build_nested_tab(side)

            self.status = tk.StringVar(value="Draw a closed island, then internal boundaries. Faces update live.")
            ttk.Label(self, textvariable=self.status, anchor="w").pack(side="bottom", fill="x")
            self.bind("<Control-z>", lambda e: self._undo())
            self.bind("<Control-y>", lambda e: self._redo())
            self.bind("<Control-s>", lambda e: self._save())

        def _menu(self) -> None:
            m = tk.Menu(self)
            self.config(menu=m)
            filem = tk.Menu(m, tearoff=0)
            m.add_cascade(label="File", menu=filem)
            filem.add_command(label="New", command=self._new)
            filem.add_command(label="Open…", command=self._open)
            filem.add_command(label="Save", command=self._save)
            filem.add_command(label="Save As…", command=self._save_as)
            filem.add_separator()
            filem.add_command(label="Export playable World JSON…", command=self._export_world)
            filem.add_command(label="Export visual composition JSON…", command=self._export_comp)
            filem.add_separator()
            filem.add_command(label="Exit", command=self._on_close)
            edit = tk.Menu(m, tearoff=0)
            m.add_cascade(label="Edit", menu=edit)
            edit.add_command(label="Undo", command=self._undo)
            edit.add_command(label="Redo", command=self._redo)
            wm = tk.Menu(m, tearoff=0)
            m.add_cascade(label="World", menu=wm)
            wm.add_command(label="Import previous level JSON…", command=self._import_previous)

        def _build_world_tab(self, nb: Any) -> None:
            tab = ttk.Frame(nb)
            nb.add(tab, text="World")
            self.var_id = tk.StringVar()
            self.var_name = tk.StringVar()
            self.var_level = tk.StringVar()
            self.var_description = tk.StringVar()
            for i, (label, var) in enumerate((
                ("worldId", self.var_id),
                ("name", self.var_name),
                ("level", self.var_level),
                ("description", self.var_description),
            )):
                ttk.Label(tab, text=label).grid(row=i, column=0, sticky="w", padx=4, pady=2)
                e = ttk.Entry(tab, textvariable=var, width=28)
                e.grid(row=i, column=1, sticky="ew", padx=4)
                e.bind("<FocusOut>", lambda _e: self._apply_world_meta())
            tab.columnconfigure(1, weight=1)
            self.lists = {}
            self.lists["factions"] = tk.Listbox(tab, height=8)
            ttk.Label(tab, text="Factions").grid(row=4, column=0, columnspan=2, sticky="w", padx=4)
            self.lists["factions"].grid(row=5, column=0, columnspan=2, sticky="nsew", padx=4)
            ttk.Button(tab, text="Add AI warlord", command=self._add_ai).grid(row=6, column=0, columnspan=2, pady=4)
            tab.rowconfigure(5, weight=1)

        def _build_theme_tab(self, nb: Any) -> None:
            tab = ttk.Frame(nb)
            nb.add(tab, text="Theme")
            self.var_theme_search = tk.StringVar()
            self.var_theme_category = tk.StringVar(value="All")
            self.var_theme_selected = tk.StringVar(value="(none)")
            ttk.Label(tab, text="Selected").pack(anchor="w", padx=4)
            ttk.Label(tab, textvariable=self.var_theme_selected, wraplength=SIDEBAR_WIDTH - 24).pack(anchor="w", padx=4)
            row = ttk.Frame(tab)
            row.pack(fill="x", padx=4, pady=2)
            ttk.Label(row, text="Search").pack(side="left")
            se = ttk.Entry(row, textvariable=self.var_theme_search, width=18)
            se.pack(side="left", fill="x", expand=True, padx=4)
            se.bind("<KeyRelease>", lambda _e: self._refresh_theme_list())
            cats = ["All"]
            if self.theme_lib:
                cats.extend(self.theme_lib.get("categories") or [])
            crow = ttk.Frame(tab)
            crow.pack(fill="x", padx=4, pady=2)
            ttk.Label(crow, text="Category").pack(side="left")
            ttk.Combobox(
                crow, textvariable=self.var_theme_category, values=cats, width=16, state="readonly",
            ).pack(side="left", padx=4)
            self.var_theme_category.trace_add("write", lambda *_a: self._refresh_theme_list())
            self.theme_list = tk.Listbox(tab, height=14)
            self.theme_list.pack(fill="both", expand=True, padx=4, pady=4)
            self.theme_list.bind("<<ListboxSelect>>", self._on_theme_select)
            self.theme_detail = tk.StringVar(value="")
            ttk.Label(tab, textvariable=self.theme_detail, wraplength=SIDEBAR_WIDTH - 24, justify="left").pack(
                anchor="w", padx=4, pady=4,
            )
            brow = ttk.Frame(tab)
            brow.pack(fill="x", padx=4, pady=4)
            ttk.Button(brow, text="Apply theme", command=self._apply_selected_theme).pack(side="left")
            ttk.Button(brow, text="Clear theme", command=self._clear_theme).pack(side="left", padx=4)
            self._refresh_theme_list()

        def _build_challenge_tab(self, nb: Any) -> None:
            tab = ttk.Frame(nb)
            nb.add(tab, text="Challenges")
            ttk.Label(
                tab,
                text="Data references only.\nTheme does not auto-enable challenges.",
                wraplength=SIDEBAR_WIDTH - 24,
            ).pack(anchor="w", padx=4, pady=4)
            self.lists["challenges"] = tk.Listbox(tab, height=10)
            self.lists["challenges"].pack(fill="both", expand=True, padx=4)
            row = ttk.Frame(tab)
            row.pack(fill="x", padx=4, pady=4)
            self.var_challenge_id = tk.StringVar()
            ttk.Entry(row, textvariable=self.var_challenge_id, width=18).pack(side="left", fill="x", expand=True)
            ttk.Button(row, text="Add", command=self._add_challenge).pack(side="left", padx=4)
            ttk.Button(tab, text="Remove selected", command=self._remove_challenge).pack(fill="x", padx=4, pady=2)

        def _build_presentation_tab(self, nb: Any) -> None:
            tab = ttk.Frame(nb)
            nb.add(tab, text="Presentation")
            ttk.Label(
                tab,
                text="Authored camera/scale intent. Not a runtime simulator.",
                wraplength=SIDEBAR_WIDTH - 24,
            ).pack(anchor="w", padx=4, pady=4)
            self.var_scale_profile = tk.StringVar()
            self.var_camera_profile = tk.StringVar()
            self.var_lod_profile = tk.StringVar()
            self.var_min_zoom = tk.StringVar()
            self.var_max_zoom = tk.StringVar()
            self.var_initial_zoom = tk.StringVar()
            fields = (
                ("scaleProfileId", self.var_scale_profile),
                ("cameraProfileId", self.var_camera_profile),
                ("lodProfileId", self.var_lod_profile),
                ("minZoom", self.var_min_zoom),
                ("maxZoom", self.var_max_zoom),
                ("initialZoom", self.var_initial_zoom),
            )
            for i, (label, var) in enumerate(fields):
                ttk.Label(tab, text=label).grid(row=i + 1, column=0, sticky="w", padx=4, pady=2)
                e = ttk.Entry(tab, textvariable=var, width=22)
                e.grid(row=i + 1, column=1, sticky="ew", padx=4)
                e.bind("<FocusOut>", lambda _e: self._apply_presentation())
            tab.columnconfigure(1, weight=1)
            ttk.Button(tab, text="Clear presentation", command=self._clear_presentation).grid(
                row=len(fields) + 1, column=0, columnspan=2, pady=6,
            )

        def _build_geo_tab(self, nb: Any) -> None:
            tab = ttk.Frame(nb)
            nb.add(tab, text="Territories")
            self.lists["territories"] = tk.Listbox(tab, height=12, selectmode="extended")
            self.lists["territories"].pack(fill="both", expand=True, padx=4, pady=4)
            self.lists["territories"].bind("<<ListboxSelect>>", self._on_terr_select)
            row = ttk.Frame(tab)
            row.pack(fill="x")
            ttk.Label(row, text="Terrain").pack(side="left")
            self.var_terrain = tk.StringVar(value="plains")
            ttk.Combobox(row, textvariable=self.var_terrain, values=list(TERRAIN), width=12, state="readonly").pack(side="left")
            ttk.Button(row, text="Apply", command=self._apply_terrain).pack(side="left", padx=4)
            ttk.Label(tab, text="Primary edit is boundary lines, not polygons.").pack(anchor="w", padx=4)

        def _build_locations_tab(self, nb: Any) -> None:
            tab = ttk.Frame(nb)
            nb.add(tab, text="Locations")
            ttk.Label(
                tab,
                text="Semantic gameplay places (city/mine/farm/…). Distinct from visual props.",
                wraplength=SIDEBAR_WIDTH - 24,
            ).pack(anchor="w", padx=4, pady=4)
            ttk.Label(tab, text="Kind for Place location tool").pack(anchor="w", padx=4)
            ttk.Combobox(
                tab, textvariable=self.place_location_kind, values=list(LOCATION_KINDS),
                width=16, state="readonly",
            ).pack(anchor="w", padx=4, pady=2)
            self.lists["locations"] = tk.Listbox(tab, height=12)
            self.lists["locations"].pack(fill="both", expand=True, padx=4, pady=4)
            ttk.Button(tab, text="Remove selected", command=self._remove_location).pack(fill="x", padx=4, pady=2)

        def _build_assets_tab(self, nb: Any) -> None:
            tab = ttk.Frame(nb)
            nb.add(tab, text="Composition")
            self.asset_list = tk.Listbox(tab, height=18)
            self.asset_list.pack(fill="both", expand=True, padx=4, pady=4)
            self.asset_list.bind("<<ListboxSelect>>", self._on_asset_select)
            self._reload_assets()
            ttk.Label(tab, text="WORLD-PLACEABLE assets can be placed.\nSTATE-DRIVEN and NON-WORLD are listed but not placed.").pack(anchor="w", padx=4)

        def _build_nested_tab(self, nb: Any) -> None:
            tab = ttk.Frame(nb)
            nb.add(tab, text="Nested")
            ttk.Label(
                tab,
                text="Authored containedWorlds placement (origin/rotation/scale).\nImport previous level via World menu. Not player campaign state.",
                wraplength=SIDEBAR_WIDTH - 24,
            ).pack(anchor="w", padx=4, pady=4)
            self.lists["contained"] = tk.Listbox(tab, height=14)
            self.lists["contained"].pack(fill="both", expand=True, padx=4, pady=4)

        def _reload_assets(self) -> None:
            self.asset_list.delete(0, "end")
            for a in self.catalog:
                self.asset_list.insert("end", f"{a['kind']}: {a['id']}")

        def _on_asset_select(self, _e: Any = None) -> None:
            sel = self.asset_list.curselection()
            if not sel:
                return
            self.place_asset = self.catalog[sel[0]]
            self.tool.set("prop")
            self.status.set(f"Place {self.place_asset['id']} ({self.place_asset['kind']})")

        def _refresh_theme_list(self) -> None:
            if not hasattr(self, "theme_list"):
                return
            self.theme_list.delete(0, "end")
            self._theme_rows = []
            lib = self.theme_lib or load_theme_library()
            self.theme_lib = lib
            if not lib:
                self.theme_list.insert("end", "(theme library not found)")
                return
            q = (self.var_theme_search.get() or "").strip().lower()
            cat = self.var_theme_category.get() or "All"
            for theme in lib["themes"]:
                tid = theme.get("themeId", "")
                name = theme.get("name", "")
                tcat = theme.get("category") or ""
                if cat != "All" and tcat != cat:
                    continue
                blob = f"{tid} {name} {theme.get('visualIdentity', '')} {theme.get('strategicChallenge', '')}".lower()
                if q and q not in blob:
                    continue
                self._theme_rows.append(theme)
                label = f"{tid} — {name}" if name else tid
                self.theme_list.insert("end", label)

        def _on_theme_select(self, _e: Any = None) -> None:
            sel = self.theme_list.curselection()
            if not sel or not getattr(self, "_theme_rows", None):
                return
            idx = sel[0]
            if idx >= len(self._theme_rows):
                return
            theme = self._theme_rows[idx]
            self.theme_detail.set(
                f"{theme.get('name', '')}\n"
                f"visual: {theme.get('visualIdentity', '')}\n"
                f"challenge note: {theme.get('strategicChallenge', '')}\n"
                f"twist: {theme.get('twist', '')}\n"
                "(Library text is display-only; only themeId is persisted.)"
            )

        def _apply_selected_theme(self) -> None:
            sel = self.theme_list.curselection()
            if not sel or not getattr(self, "_theme_rows", None):
                return
            theme = self._theme_rows[sel[0]]
            tid = theme.get("themeId")
            if not tid:
                return
            self._push()
            self.doc.world["theme"] = {"themeId": tid}
            # Intentionally do NOT auto-add challenges from library descriptive text.
            self.dirty = True
            self._reload_lists()
            self.status.set(f"Theme set to {tid}")

        def _clear_theme(self) -> None:
            self._push()
            self.doc.world.pop("theme", None)
            self.dirty = True
            self._reload_lists()

        def _add_challenge(self) -> None:
            cid = (self.var_challenge_id.get() or "").strip()
            if not cid:
                return
            existing = self.doc.world.setdefault("challenges", [])
            if any(isinstance(c, dict) and c.get("challengeId") == cid for c in existing):
                self.status.set(f"Challenge {cid} already present")
                return
            self._push()
            existing.append({"challengeId": cid, "config": {}})
            self.var_challenge_id.set("")
            self.dirty = True
            self._reload_lists()

        def _remove_challenge(self) -> None:
            if "challenges" not in self.lists:
                return
            sel = self.lists["challenges"].curselection()
            if not sel:
                return
            challenges = self.doc.world.get("challenges") or []
            idx = sel[0]
            if idx >= len(challenges):
                return
            self._push()
            challenges.pop(idx)
            if not challenges:
                self.doc.world.pop("challenges", None)
            self.dirty = True
            self._reload_lists()

        def _apply_presentation(self) -> None:
            body: Dict[str, Any] = {}
            for key, var in (
                ("scaleProfileId", self.var_scale_profile),
                ("cameraProfileId", self.var_camera_profile),
                ("lodProfileId", self.var_lod_profile),
            ):
                v = (var.get() or "").strip()
                if v:
                    body[key] = v
            zooms = []
            for var in (self.var_min_zoom, self.var_max_zoom, self.var_initial_zoom):
                raw = (var.get() or "").strip()
                if raw:
                    try:
                        zooms.append(float(raw))
                    except ValueError:
                        self.status.set("Camera zoom values must be numbers")
                        return
                else:
                    zooms.append(None)
            if all(z is not None for z in zooms):
                body["camera"] = {
                    "minZoom": zooms[0],
                    "maxZoom": zooms[1],
                    "initialZoom": zooms[2],
                }
            elif any(z is not None for z in zooms):
                self.status.set("Set all three zoom values or leave all blank")
                return
            self._push()
            if body:
                self.doc.world["presentation"] = body
            else:
                self.doc.world.pop("presentation", None)
            self.dirty = True

        def _clear_presentation(self) -> None:
            self._push()
            self.doc.world.pop("presentation", None)
            self.dirty = True
            self._reload_lists()

        def _remove_location(self) -> None:
            if "locations" not in self.lists:
                return
            sel = self.lists["locations"].curselection()
            if not sel:
                return
            locs = self.doc.world.get("locations") or []
            idx = sel[0]
            if idx >= len(locs):
                return
            self._push()
            locs.pop(idx)
            if not locs:
                self.doc.world.pop("locations", None)
            self.dirty = True
            self._reload_lists()
            self._redraw()

        def world_from_screen(self, sx: float, sy: float) -> Point:
            if self.preview_mode.get() == "oblique":
                # Inverse of x' = x + 0.4 y, y' = 0.55 y
                wy = (self.origin_y - sy) / (self.zoom * 0.55)
                wx = (sx - self.origin_x) / self.zoom - 0.4 * wy
                return (wx, wy)
            wx = (sx - self.origin_x) / self.zoom
            wy = (self.origin_y - sy) / self.zoom
            return (wx, wy)

        def screen_from_world(self, p: Point) -> Tuple[float, float]:
            wx, wy = p
            if self.preview_mode.get() == "oblique":
                px = wx + 0.4 * wy
                py = 0.55 * wy
                return (self.origin_x + px * self.zoom, self.origin_y - py * self.zoom)
            return (self.origin_x + wx * self.zoom, self.origin_y - wy * self.zoom)

        def _snap_r(self) -> float:
            return snap_radius_world(self.zoom)

        def _push(self) -> None:
            self.undo.push(self.doc)
            self.dirty = True

        def _down(self, e: Any) -> None:
            tool = self.tool.get()
            p = self.world_from_screen(e.x, e.y)
            if tool == "pan":
                self._pan_last = (e.x, e.y)
                return
            if tool == "island" or tool == "boundary":
                self.stroke = [p]
                return
            if tool == "prop":
                if not self.place_asset:
                    self.status.set("Select a WORLD-PLACEABLE asset first.")
                    return
                try:
                    self._push()
                    inst = self.doc.composition.place(self.place_asset, p[0], p[1])
                    self.sel = ("prop", instance_id(inst))
                    self.status.set(f"Placed {inst['assetId']}")
                except GraphError as err:
                    self.status.set(err.message)
                    messagebox.showinfo("Composition", err.message)
                self._redraw()
                return
            if tool == "location":
                kind = self.place_location_kind.get() or "city"
                try:
                    self._push()
                    loc = add_semantic_location(self.doc.world, kind, p[0], p[1])
                    self.status.set(f"Placed {loc['kind']} {loc['id']} on {loc['territoryId']}")
                    self._reload_lists()
                except GraphError as err:
                    self.status.set(err.message)
                    messagebox.showinfo("Location", err.message)
                self._redraw()
                return
            if tool == "node":
                hit = self.doc.graph.nearest_node(p, self._snap_r())
                if hit:
                    self.sel = ("node", hit[0])
                    self._push()
                return
            if tool == "delete":
                edge = self.doc.graph.nearest_edge(p, self._snap_r())
                prop = self._hit_prop(p)
                if prop:
                    self._push()
                    self.doc.composition.delete(prop)
                    self._redraw()
                    return
                if edge:
                    try:
                        self._push()
                        self.doc.graph.delete_edge(edge[0])
                        self.doc.geography_dirty = True
                    except GraphError as err:
                        self.status.set(err.message)
                    self._redraw()
                return
            if tool == "select":
                prop = self._hit_prop(p)
                if prop:
                    self.sel = ("prop", prop)
                    self._redraw()
                    return
                for row in self.doc.display_territory_rings():
                    if point_in_ring(p, row["ring"]):
                        self.selected_territories = {row["id"]}
                        self._redraw()
                        return

        def _hit_prop(self, p: Point) -> Optional[str]:
            best = None
            best_d = self._snap_r() * 2
            for inst in self.doc.composition.instances:
                ix, iy = instance_point(inst)
                d = math.hypot(p[0] - ix, p[1] - iy)
                if d < best_d:
                    best_d = d
                    best = instance_id(inst)
            return best

        def _drag(self, e: Any) -> None:
            if self._pan_last is not None:
                dx, dy = e.x - self._pan_last[0], e.y - self._pan_last[1]
                self.origin_x += dx
                self.origin_y += dy
                self._pan_last = (e.x, e.y)
                self._redraw()
                return
            p = self.world_from_screen(e.x, e.y)
            if self.stroke is not None:
                if not self.stroke or edge_length(self.stroke[-1], p) > 0.05:
                    self.stroke.append(p)
                self._redraw()
                return
            if self.sel and self.sel[0] == "node":
                self.doc.graph.move_node(self.sel[1], p)
                self.doc.geography_dirty = True
                self._redraw()
                return
            if self.sel and self.sel[0] == "prop":
                inst = self.doc.composition.find(self.sel[1])
                if inst:
                    inst["position"] = {"x": p[0], "y": p[1]}
                    inst.pop("x", None)
                    inst.pop("y", None)
                    self._redraw()

        def _up(self, e: Any) -> None:
            self._pan_last = None
            if self.stroke is None:
                return
            pts = self.stroke
            self.stroke = None
            if polyline_length(pts) < 0.5:
                self._redraw()
                return
            try:
                self._push()
                if self.tool.get() == "island" or not self.doc.graph.has_island():
                    closed = pts if points_equal(pts[0], pts[-1]) else pts + [pts[0]]
                    self.doc.graph.add_island(closed)
                else:
                    self.doc.graph.add_boundary(pts, self._snap_r())
                self.doc.geography_dirty = True
                n = len(self.doc.preview_faces())
                self.status.set(f"Live preview: {n} territor{'y' if n == 1 else 'ies'}")
            except GraphError as err:
                self.status.set(err.message)
                messagebox.showinfo("Boundary", err.message)
            self._redraw()
            self._reload_lists()

        def _wheel(self, e: Any) -> None:
            delta = 1 if getattr(e, "delta", 0) > 0 or getattr(e, "num", 0) == 4 else -1
            factor = 1.1 if delta > 0 else 1 / 1.1
            wx, wy = self.world_from_screen(e.x, e.y)
            self.zoom = max(0.4, min(80.0, self.zoom * factor))
            sx, sy = self.screen_from_world((wx, wy))
            self.origin_x += e.x - sx
            self.origin_y += e.y - sy
            self._redraw()

        def _redraw(self) -> None:
            self.canvas.delete("all")
            faces = self.doc.display_territory_rings()
            owners = {t.get("id"): t.get("startingOwnerFactionId") for t in self.doc.world.get("territories") or []}
            factions = [f.get("id") for f in self.doc.world.get("factions") or []]
            for row in faces:
                ring = row["ring"]
                if len(unique_ring_vertices(ring)) < 3:
                    continue
                coords: List[float] = []
                for p in close_ring(ring):
                    sx, sy = self.screen_from_world(p)
                    coords.extend((sx, sy))
                fill = TERRAIN_FILL.get(row.get("terrain") or "plains", "#c9d48a") if self.show_terrain.get() else "#6d7a55"
                oid = owners.get(row.get("id"))
                if oid in factions:
                    fill = OWNER_PALETTE[factions.index(oid) % len(OWNER_PALETTE)]
                outline = "#f0e6c8" if row.get("id") in self.selected_territories else "#2a3038"
                self.canvas.create_polygon(*coords, fill=fill, outline=outline, width=2)
                if self.show_ids.get():
                    c = ring_centroid(ring)
                    sx, sy = self.screen_from_world(c)
                    self.canvas.create_text(sx, sy, text=str(row.get("id") or ""), fill="#111", font=("Segoe UI", 9, "bold"))
            for e in self.doc.graph.edges.values():
                pts = e["points"]
                if len(pts) < 2:
                    continue
                coords = []
                for p in pts:
                    sx, sy = self.screen_from_world(p)
                    coords.extend((sx, sy))
                color = "#f2d36b" if e.get("kind") == "island" else "#9ad7ff"
                self.canvas.create_line(*coords, fill=color, width=3 if e.get("kind") == "island" else 2)
            for nid, p in self.doc.graph.nodes.items():
                sx, sy = self.screen_from_world(p)
                self.canvas.create_oval(sx - 4, sy - 4, sx + 4, sy + 4, fill="#fff", outline="#333")
            if self.show_props.get():
                props = sorted(
                    self.doc.composition.instances,
                    key=lambda inst: (instance_depth(inst), -instance_point(inst)[1]),
                )
                for inst in props:
                    ix, iy = instance_point(inst)
                    sx, sy = self.screen_from_world((ix, iy))
                    sc = effective_instance_scale(inst, self.catalog)
                    r = 8 if sc is None else max(6, min(28, 8 * float(sc)))
                    col = "#e8f5c8" if self.sel == ("prop", instance_id(inst)) else "#d7b56d"
                    self.canvas.create_oval(sx - r, sy - r * 1.4, sx + r, sy + r * 0.2, fill=col, outline="#333")
                    self.canvas.create_text(sx, sy - r * 1.6, text=str(inst.get("assetId") or ""), fill="#eee", font=("Segoe UI", 8))
            for loc in self.doc.world.get("locations") or []:
                if not isinstance(loc, dict):
                    continue
                pos = loc.get("position") if isinstance(loc.get("position"), dict) else {}
                sx, sy = self.screen_from_world((float(pos.get("x", 0) or 0), float(pos.get("y", 0) or 0)))
                self.canvas.create_rectangle(sx - 6, sy - 6, sx + 6, sy + 6, fill="#7ec8e3", outline="#1a3a4a")
                self.canvas.create_text(sx, sy - 12, text=str(loc.get("kind") or ""), fill="#cfefff", font=("Segoe UI", 8))
            if self.stroke and len(self.stroke) >= 2:
                coords = []
                for p in self.stroke:
                    sx, sy = self.screen_from_world(p)
                    coords.extend((sx, sy))
                self.canvas.create_line(*coords, fill="#7fe3ff", width=2, dash=(4, 2))

        def _fit(self) -> None:
            rings = [row["ring"] for row in self.doc.display_territory_rings()]
            if not rings and self.doc.graph.nodes:
                pts = list(self.doc.graph.nodes.values())
                xs = [p[0] for p in pts]
                ys = [p[1] for p in pts]
                bounds = (min(xs), min(ys), max(xs), max(ys))
            elif rings:
                xs: List[float] = []
                ys: List[float] = []
                for ring in rings:
                    for p in unique_ring_vertices(ring):
                        xs.append(p[0])
                        ys.append(p[1])
                bounds = (min(xs), min(ys), max(xs), max(ys)) if xs else None
            else:
                bounds = None
            if not bounds:
                self._redraw()
                return
            minx, miny, maxx, maxy = bounds
            w = max(1.0, maxx - minx)
            h = max(1.0, maxy - miny)
            cw = max(200, self.canvas.winfo_width() or 800)
            ch = max(200, self.canvas.winfo_height() or 600)
            self.zoom = max(0.5, min(40.0, 0.8 * min(cw / w, ch / h)))
            cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
            sx, sy = self.screen_from_world((cx, cy))
            self.origin_x += cw / 2 - sx
            self.origin_y += ch / 2 - sy
            self._redraw()

        def _reload_lists(self) -> None:
            if "factions" in self.lists:
                self.lists["factions"].delete(0, "end")
                for f in self.doc.world.get("factions") or []:
                    self.lists["factions"].insert("end", f"{f.get('id')}  {f.get('role')}  {f.get('name')}")
            if "territories" in self.lists:
                self.lists["territories"].delete(0, "end")
                for t in self.doc.world.get("territories") or []:
                    self.lists["territories"].insert("end", f"{t.get('id')}  {t.get('terrain')}  {t.get('startingOwnerFactionId')}")
            if "challenges" in self.lists:
                self.lists["challenges"].delete(0, "end")
                for ch in self.doc.world.get("challenges") or []:
                    if isinstance(ch, dict):
                        self.lists["challenges"].insert("end", str(ch.get("challengeId") or ""))
            if "locations" in self.lists:
                self.lists["locations"].delete(0, "end")
                for loc in self.doc.world.get("locations") or []:
                    if isinstance(loc, dict):
                        self.lists["locations"].insert(
                            "end",
                            f"{loc.get('id')}  {loc.get('kind')}  {loc.get('territoryId')}",
                        )
            if "contained" in self.lists:
                self.lists["contained"].delete(0, "end")
                for c in self.doc.world.get("containedWorlds") or []:
                    if not isinstance(c, dict):
                        continue
                    pl = c.get("placement") if isinstance(c.get("placement"), dict) else {}
                    self.lists["contained"].insert(
                        "end",
                        f"{c.get('worldId')} @ {c.get('regionId')}  scale={pl.get('scale', 1)}",
                    )
            self.var_id.set(str(self.doc.world.get("worldId") or ""))
            self.var_name.set(str(self.doc.world.get("name") or ""))
            self.var_level.set(str(self.doc.world.get("level") or 1))
            self.var_description.set(str(self.doc.world.get("description") or ""))
            theme = self.doc.world.get("theme") if isinstance(self.doc.world.get("theme"), dict) else None
            tid = theme.get("themeId") if theme else None
            if tid and self.theme_lib and tid in self.theme_lib["byId"]:
                tmeta = self.theme_lib["byId"][tid]
                self.var_theme_selected.set(f"{tid} — {tmeta.get('name', '')}")
            elif tid:
                self.var_theme_selected.set(str(tid))
            else:
                self.var_theme_selected.set("(none)")
            pres = self.doc.world.get("presentation") if isinstance(self.doc.world.get("presentation"), dict) else {}
            self.var_scale_profile.set(str(pres.get("scaleProfileId") or ""))
            self.var_camera_profile.set(str(pres.get("cameraProfileId") or ""))
            self.var_lod_profile.set(str(pres.get("lodProfileId") or ""))
            cam = pres.get("camera") if isinstance(pres.get("camera"), dict) else {}
            self.var_min_zoom.set("" if cam.get("minZoom") is None else str(cam.get("minZoom")))
            self.var_max_zoom.set("" if cam.get("maxZoom") is None else str(cam.get("maxZoom")))
            self.var_initial_zoom.set("" if cam.get("initialZoom") is None else str(cam.get("initialZoom")))

        def _apply_world_meta(self) -> None:
            self.doc.world["worldId"] = self.var_id.get().strip() or self.doc.world["worldId"]
            self.doc.world["name"] = self.var_name.get().strip() or self.doc.world["name"]
            try:
                self.doc.world["level"] = int(self.var_level.get())
            except ValueError:
                pass
            desc = (self.var_description.get() or "").strip()
            if desc:
                self.doc.world["description"] = desc
            else:
                self.doc.world.pop("description", None)
            for r in self.doc.world.get("regions") or []:
                r["worldId"] = self.doc.world["worldId"]
            self.dirty = True

        def _on_terr_select(self, _e: Any = None) -> None:
            sel = self.lists["territories"].curselection()
            ids = []
            terrs = self.doc.world.get("territories") or []
            for i in sel:
                if 0 <= i < len(terrs):
                    ids.append(terrs[i].get("id"))
            self.selected_territories = {i for i in ids if i}
            self._redraw()

        def _apply_terrain(self) -> None:
            terrain = self.var_terrain.get()
            if terrain not in TERRAIN:
                return
            self._push()
            for tid in self.selected_territories:
                t = find_territory(self.doc.world, tid)
                if t:
                    t["terrain"] = terrain
            self._reload_lists()
            self._redraw()

        def _add_ai(self) -> None:
            self._push()
            add_ai_faction(self.doc.world)
            self._reload_lists()

        def _commit(self) -> None:
            try:
                self._push()
                result = self.doc.commit_geography()
                self.status.set(f"Committed {result['territoryCount']} territories.")
            except GraphError as err:
                messagebox.showerror("Commit", err.message)
                return
            self._reload_lists()
            self._redraw()

        def _undo(self) -> None:
            nxt = self.undo.apply_undo(self.doc)
            if nxt:
                self.doc = nxt
                self._reload_lists()
                self._redraw()

        def _redo(self) -> None:
            nxt = self.undo.apply_redo(self.doc)
            if nxt:
                self.doc = nxt
                self._reload_lists()
                self._redraw()

        def _validate_dialog(self) -> None:
            issues = validate_world(self.doc.world)
            if not issues:
                messagebox.showinfo("Validate", "Playable WorldDefinition is VALID.")
                return
            messagebox.showerror("Validate", "\n".join(f"[{i['code']}] {i['message']}" for i in issues[:24]))

        def _new(self) -> None:
            if not self._confirm_discard():
                return
            self.doc = WorldDocument()
            self.path = None
            self.undo = UndoStack()
            self.dirty = False
            self._reload_lists()
            self._redraw()

        def _open(self) -> None:
            path = filedialog.askopenfilename(filetypes=[("World JSON", "*.json")])
            if path:
                self._open_path(path, replacing=True)

        def _open_path(self, path: str, replacing: bool) -> None:
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    raw = json.load(fh)
            except (OSError, json.JSONDecodeError) as err:
                messagebox.showerror("Open", str(err))
                return
            if not isinstance(raw, dict) or raw.get("formatVersion") != FORMAT_VERSION:
                messagebox.showerror("Open", "Not a rep-wars-world.v1 document.")
                return
            if replacing and not self._confirm_discard():
                return
            self.doc = document_from_raw(raw)
            self.path = path
            self.undo = UndoStack()
            self.dirty = False
            self._reload_lists()
            self._fit()
            self.status.set(f"Loaded {path}")

        def _write(self, path: str, playable: bool) -> None:
            try:
                self.doc.sync_composition_to_world()
                text = dumps_world(self.doc.world) if playable else self.doc.dumps_editor()
                if playable:
                    issues = validate_world(self.doc.world)
                    if issues:
                        messagebox.showerror("Export", "World is not valid:\n" + "\n".join(f"[{i['code']}] {i['message']}" for i in issues[:16]))
                        return
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(text)
            except OSError as err:
                messagebox.showerror("Save", str(err))
                return
            self.path = path
            self.dirty = False
            self.status.set(f"Wrote {path}")

        def _save(self) -> None:
            if self.path:
                self._write(self.path, playable=False)
            else:
                self._save_as()

        def _save_as(self) -> None:
            path = filedialog.asksaveasfilename(defaultextension=".json", filetypes=[("World JSON", "*.json")])
            if path:
                self._write(path, playable=False)

        def _export_world(self) -> None:
            path = filedialog.asksaveasfilename(defaultextension=".json", filetypes=[("World JSON", "*.json")])
            if path:
                self._write(path, playable=True)

        def _export_comp(self) -> None:
            path = filedialog.asksaveasfilename(defaultextension=".json", filetypes=[("Composition JSON", "*.json")])
            if not path:
                return
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(dumps_composition(self.doc.composition, str(self.doc.world.get("worldId") or "")))
            self.status.set(f"Wrote {path}")

        def _import_previous(self) -> None:
            path = filedialog.askopenfilename(filetypes=[("World JSON", "*.json")])
            if not path:
                return
            with open(path, "r", encoding="utf-8") as fh:
                text = fh.read()
            plan = import_plan_from_json_text(text, self.doc.world)
            if not plan.get("ok"):
                messagebox.showerror("Import", plan.get("error") or "Import failed")
                return
            if not messagebox.askyesno("Import previous level", format_previous_level_import_preview(plan)):
                return
            self._push()
            apply_previous_level_import(self.doc.world, plan)
            self.doc.graph = reconstruct_graph_from_world(self.doc.world)
            self.doc.geography_dirty = False
            self._reload_lists()
            self._fit()

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


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="REP WARS Map Assistant 4.0 — vector boundary authoring")
    parser.add_argument("--self-test", action="store_true", help="Run logic tests (no GUI)")
    parser.add_argument("--validate", metavar="JSON", help="Validate a world JSON file and exit")
    parser.add_argument("--gui-smoke", action="store_true", help="Build the Tk window, then exit")
    parser.add_argument("path", nargs="?", help="Optional world JSON to open")
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
