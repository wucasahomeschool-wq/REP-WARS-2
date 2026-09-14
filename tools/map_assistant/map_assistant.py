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
Editor-only state (selection, zoom, pan, undo) is never exported.

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
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

# ---------------------------------------------------------------------------
# Schema constants (must match src/worldDefinition)
# ---------------------------------------------------------------------------

FORMAT_VERSION = "rep-wars-world.v1"
GEOM_EPS = 1e-6

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
    """Skeleton for New World. Not a generated map — no territories."""
    island = points_to_polygon([
        (0.0, 40.0), (80.0, 0.0), (190.0, 25.0), (220.0, 110.0),
        (150.0, 190.0), (30.0, 170.0), (0.0, 40.0),
    ])
    return {
        "formatVersion": FORMAT_VERSION,
        "worldId": "w_untitled",
        "level": 1,
        "name": "Untitled World",
        "playerFactionId": "f_player",
        "island": island,
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


def run_self_test() -> int:
    loader = unittest.defaultTestLoader
    suite = loader.loadTestsFromTestCase(WorldLogicTests)
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

def launch_editor(initial_path: Optional[str] = None) -> None:
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
            self.tool = tk.StringVar(value="select")
            self.show_ids = tk.BooleanVar(value=True)
            self.show_regions = tk.BooleanVar(value=True)
            self.show_ownership = tk.BooleanVar(value=True)
            self.show_grid = tk.BooleanVar(value=False)
            self.zoom = 3.0
            self.origin_x = 80.0
            self.origin_y = 520.0
            self.sel: Optional[Tuple[str, Any]] = None
            self.drag: Optional[Dict[str, Any]] = None
            self.adj_first: Optional[str] = None
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
                ("add_territory", "Add territory"),
                ("adjacency", "Adjacency"),
                ("island", "Island"),
            ):
                ttk.Radiobutton(toolbar, text=label, variable=self.tool, value=value,
                                command=self._redraw).pack(side="left", padx=2)
            ttk.Button(toolbar, text="Fit", command=self._fit_world).pack(side="left", padx=8)
            ttk.Button(toolbar, text="Validate", command=self._run_validate).pack(side="left")

            body = ttk.Panedwindow(self, orient="horizontal")
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

        def _menu(self) -> None:
            menubar = tk.Menu(self)
            filem = tk.Menu(menubar, tearoff=0)
            filem.add_command(label="New World", command=self._new)
            filem.add_command(label="Open JSON…", command=self._open)
            filem.add_command(label="Save", command=self._save, accelerator="Ctrl+S")
            filem.add_command(label="Save As…", command=self._save_as)
            filem.add_command(label="Export JSON…", command=self._save_as)
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
            viewm.add_command(label="Fit world", command=self._fit_world)
            menubar.add_cascade(label="View", menu=viewm)
            valm = tk.Menu(menubar, tearoff=0)
            valm.add_command(label="Validate world", command=self._run_validate)
            menubar.add_cascade(label="Validate", menu=valm)
            worldm = tk.Menu(menubar, tearoff=0)
            worldm.add_command(label="Suggest shared-edge neighbors (selected)", command=self._suggest_neighbors)
            worldm.add_command(label="Clear island vertices", command=self._clear_island)
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
            ttk.Button(resf, text="Apply resources", command=self._apply_resources).pack(anchor="w", pady=4)
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
            r = 5
            for k, var in self.army_vars.items():
                ttk.Label(form, text=k).grid(row=r, column=0, sticky="w")
                ttk.Entry(form, textvariable=var, width=10).grid(row=r, column=1, sticky="w")
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
            self.valid_text = tk.Text(f, height=20, wrap="word")
            self.valid_text.pack(fill="both", expand=True, pady=4)

        # ----- coordinates -----
        def w2s(self, x: float, y: float) -> Tuple[float, float]:
            return (self.origin_x + x * self.zoom, self.origin_y - y * self.zoom)

        def s2w(self, sx: float, sy: float) -> Point:
            return ((sx - self.origin_x) / self.zoom, (self.origin_y - sy) / self.zoom)

        def _fit_world(self) -> None:
            pts: List[Point] = []
            ext = polygon_exterior(self.world.get("island"))
            if ext:
                pts.extend(unique_ring_vertices(ext))
            for t in self.world.get("territories") or []:
                e = polygon_exterior(t.get("polygon"))
                if e:
                    pts.extend(unique_ring_vertices(e))
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
                selected = self.sel and self.sel[0] == "territory" and self.sel[1] == t.get("id")
                c.create_polygon(*coords, fill=fill, outline="#f2f2f2" if selected else "#111",
                                 width=3 if selected else 1, stipple="gray50")
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
                    if self.sel and self.sel[0] == "vertex" and self.sel[2] == i:
                        c.create_oval(sx - 8, sy - 8, sx + 8, sy + 8, outline="#fff", width=2)
            self._refresh_status()

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
            kinds: List[Tuple[str, Any, List[Point]]] = []
            isle = polygon_exterior(self.world.get("island"))
            if isle:
                kinds.append(("island", None, isle))
            for t in self.world.get("territories") or []:
                ext = polygon_exterior(t.get("polygon"))
                if ext:
                    kinds.append(("territory", t.get("id"), ext))
            thresh = 8.0 / max(self.zoom, 0.01)
            best = None
            best_d = thresh
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

        def _on_press(self, event) -> None:
            wx, wy = self.s2w(event.x, event.y)
            tool = self.tool.get()
            if tool == "pan":
                self._pan_last = (event.x, event.y)
                return
            if tool == "add_territory":
                self._place_territory(wx, wy)
                return
            if tool == "adjacency":
                tid = self._hit_territory(wx, wy)
                if tid:
                    self._toggle_adjacency_click(tid)
                return
            if tool == "island":
                self.sel = ("island", None)
                hit = self._hit_vertex(wx, wy)
                if hit and hit[0] == "island":
                    self._begin_vertex_drag("island", None, hit[2], wx, wy)
                self._redraw()
                self._load_selection_panel()
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
                    self.sel = ("territory", tid)
                    self.adj_first = None
                    self._redraw()
                    self._load_selection_panel()
                    return
                isle = polygon_exterior(self.world.get("island"))
                if isle and point_in_ring((wx, wy), isle):
                    self.sel = ("island", None)
                    self._redraw()
                    self._load_selection_panel()
                    return
                self.sel = None
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

        def _on_drag(self, event) -> None:
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
            self.drag = None
            self._pan_last = None

        def _on_double(self, event) -> None:
            wx, wy = self.s2w(event.x, event.y)
            self._try_add_vertex(wx, wy)

        def _try_add_vertex(self, wx: float, wy: float) -> None:
            poly = self._selected_polygon()
            if not poly:
                return
            thresh = 10.0 / max(self.zoom, 0.01)
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
            wx, wy = self.s2w(event.x, event.y)
            hit = self._hit_vertex(wx, wy)
            if not hit:
                return
            kind, ident, idx = hit
            self.undo.push(self.world)
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

        def _place_territory(self, wx: float, wy: float) -> None:
            regions = self.world.get("regions") or []
            if not regions:
                if not messagebox.askyesno("Region required", "Create a region now so the new territory can belong to it?"):
                    return
                self._snapshot()
                add_region(self.world, "New Region")
            rid = regions[0]["id"] if (self.world.get("regions")) else None
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
            self.dirty = True
            self._reload_lists()
            self._redraw()

        def _toggle_adjacency_click(self, tid: str) -> None:
            if self.adj_first is None or self.adj_first == tid:
                self.adj_first = tid
                self.sel = ("territory", tid)
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
            issues = validate_world(self.world)
            dirty = "• unsaved" if self.dirty else "saved"
            sel = "none"
            if self.sel:
                sel = str(self.sel[0]) + (f" {self.sel[1]}" if len(self.sel) > 1 else "")
            n = len(self.world.get("territories") or [])
            self.status.set(
                f"{self.world.get('name')}  |  {n} territories  |  tool={self.tool.get()}  |  "
                f"sel={sel}  |  zoom={self.zoom:.2f}  |  {dirty}  |  {len(issues)} validation issue(s)"
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
            self._snapshot()
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
                self.sel_info.set(
                    f"Territory ID {t.get('id')} — this is an internal ID, not a player-facing name.\n"
                    f"Region: {t.get('regionId')}  Owner: {t.get('startingOwnerFactionId')}"
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
            t = self._current_territory()
            if not t:
                return
            self._snapshot()
            pts = offset_polygon(t.get("polygon") or {}, 12, 8)
            tid = add_territory(self.world, pts, t.get("regionId"), t.get("startingOwnerFactionId"))
            nt = find_territory(self.world, tid)
            nt["terrain"] = t.get("terrain")
            nt["resourceOutput"] = clone_world(t.get("resourceOutput") or {})
            self.sel = ("territory", tid)
            self.dirty = True
            self._reload_lists()
            self._redraw()

        def _delete_selection(self) -> None:
            if not self.sel:
                return
            if self.sel[0] == "territory":
                self._snapshot()
                delete_territory(self.world, self.sel[1])
                self.sel = None
                self.dirty = True
                self._reload_lists()
                self._redraw()
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
            self.sel = None
            self.adj_first = None
            self._redraw()

        def _clear_island(self) -> None:
            if not messagebox.askyesno("Island", "Replace the island with a 3-vertex triangle you can edit?"):
                return
            self._snapshot()
            set_exterior(self.world["island"], [(0, 0), (80, 10), (30, 70), (0, 0)])
            self.sel = ("island", None)
            self.dirty = True
            self._redraw()

        def _snapshot(self) -> None:
            self.undo.push(self.world)

        def _undo(self) -> None:
            restored = self.undo.apply_undo(self.world)
            if restored is None:
                return
            self.world = restored
            self.dirty = True
            self._reload_lists()
            self._redraw()

        def _redo(self) -> None:
            restored = self.undo.apply_redo(self.world)
            if restored is None:
                return
            self.world = restored
            self.dirty = True
            self._reload_lists()
            self._redraw()

        def _run_validate(self) -> None:
            issues = validate_world(self.world)
            self.notebook.select(self.tab_valid)
            self.valid_text.delete("1.0", "end")
            if not issues:
                self.valid_text.insert("end", "VALID  —  this world matches rep-wars-world.v1 rules.\n")
                return
            self.valid_text.insert("end", f"{len(issues)} issue(s). Export is refused until these are fixed.\n\n")
            for i in issues:
                self.valid_text.insert("end", f"[{i['code']}] {i['message']}\n")

        def _export_blockers(self) -> List[Issue]:
            return validate_world(self.world)

        def _write_json(self, path: str) -> bool:
            issues = self._export_blockers()
            if issues:
                self._run_validate()
                messagebox.showerror(
                    "Invalid world",
                    "Refusing to write JSON. Fix validation issues first.\n\n"
                    + "\n".join(f"[{i['code']}] {i['message']}" for i in issues[:12])
                    + ("\n…" if len(issues) > 12 else ""),
                )
                return False
            text = dumps_world(self.world)
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
            self._reload_lists()
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
            world, issues = parse_world_json(text)
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
            self.path = path
            self.dirty = False
            self.undo = UndoStack()
            self.sel = None
            self._reload_lists()
            self._fit_world()
            self.status.set(f"Loaded {path}")

        def _save(self) -> None:
            if self.path:
                self._write_json(self.path)
            else:
                self._save_as()

        def _save_as(self) -> None:
            path = filedialog.asksaveasfilename(
                title="Save world JSON",
                defaultextension=".json",
                filetypes=[("World JSON", "*.json")],
            )
            if path:
                self._write_json(path)

        def _confirm_discard(self) -> bool:
            if not self.dirty:
                return True
            return messagebox.askyesno("Unsaved changes", "Discard unsaved edits?")

        def _on_close(self) -> None:
            if self._confirm_discard():
                self.destroy()

        def run(self) -> None:
            self._reload_lists()
            self.mainloop()

    app = MapAssistant()
    app.run()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="REP WARS Map Assistant — authoring tool for rep-wars-world.v1",
    )
    parser.add_argument("--self-test", action="store_true", help="Run logic tests (no GUI)")
    parser.add_argument("--validate", metavar="JSON", help="Validate a world JSON file and exit")
    parser.add_argument("path", nargs="?", help="Optional world JSON to open in the editor")
    args = parser.parse_args(argv)
    if args.self_test:
        return run_self_test()
    if args.validate:
        return validate_path(args.validate)
    try:
        launch_editor(args.path)
    except Exception:
        traceback.print_exc()
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
