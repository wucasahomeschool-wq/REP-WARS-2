# Phase 17M — Authoritative World / Map Architecture

**Status:** JSON contract specified in 17M; **runtime foundation implemented in Phase 17N.2** (`src/worldDefinition/`, `createGameStateFromWorld`). Map Assistant / editor is still not implemented. Do not treat `MapEngine` or `SAMPLE_MAP` as the production authored-world source (`SAMPLE_MAP` is a legacy test fixture).

**17M.1 (locked):** Level N+1 uses an independently authored, coarser playable territory graph. A completed Level N world is nested geographic/history only. See §9. Do not interpret nested worlds as inlined playable tiles.

**Non-goals for this phase:** Map Assistant implementation, procedural generation, UI, Supabase, GameState integration, Orchestrator changes, architecture audit (17N).

---

## 1. Design principles

1. **The exported world JSON is the source of truth.** Runtime, renderer, AI, and economy consume it. They do not invent geography, adjacency, starting owners, or the personality roster.
2. **Territories are unnamed.** They have stable internal IDs only. Player-facing geography is **regions**.
3. **A playable world is an irregular island**, not a rectangle and not a hex grid. The canvas may be rectangular; the world is the island polygon.
4. **The current world is fully visible.** There is no territory fog, no scouting, and no scout action. Fog exists only *beyond* the current world/level (future worlds).
5. **Worlds are finite and authored.** Level N+1 is another authored file that may *reference* a completed earlier world. Nothing is generated because the player reached the edge.
6. **Each level has its own independent playable territory graph.** Completing Level N does not zoom out on the same tiles. Level N+1 is a newly authored, coarser graph. The completed Level N world is retained as nested geography/history, not merged into the Level N+1 combat/adjacency graph. **No inlining. No cross-level adjacency.**
7. **Adjacency is explicit.** Shared-border checks validate the graph; they are not the runtime source of truth.
8. **Starting ownership is explicit in the JSON.** The editor may compute an even split; the file stores the final assignment. Runtime does not allocate tiles.
9. **No cities in the world definition.** Cities are built in play. Conquest destroys the previous owner's city.
10. **AI warlords and personalities are per-world data**, not a global hardcoded roster.
11. **The Map Assistant is an editor, not a generator.** The `.json` file is the artifact. The editor is disposable.

### What this replaces as authority

| Today (do not preserve as authority) | Tomorrow |
| --- | --- |
| Hex `q,r` graph in `MapEngine` | Arbitrary 2D polygons |
| `NamingSystem` territory names | Region names only |
| Procedural `generateInitialWorld` / frontier expansion | Authored island JSON |
| `PlayerVisibilityMap` / `SCOUT` / `isKnown` | Full current-world visibility |
| `SAMPLE_MAP[].name` + `owner` as a fixture | World JSON territories + factions |
| Global `PersonalityType` presets as the only identity | Per-world trait vectors in JSON |
| `seedEconomyAndCities` creating a city per owned tile at start | Empty `cities` at spawn; build in play |

Reusable later (shape, not authority): `Resources`, `FactionId`/`TerritoryId`/`RegionId` strings, `graphInvariants` reciprocal-neighbor checks, `Personality` trait *fields* (aggression, etc.), `Territory.resourceOutput` → economy, `TerrainType` as a combat modifier until combat is retargeted.

---

## 2. Canonical JSON / schema proposal

**Format:** `rep-wars-world.v1`

One file = one playable world/level. JSON-safe: no `Map`/`Set`/`Date`/functions. Arrays are ordered for stable diffs; IDs are the identity.

```text
WorldDefinition
  island: Polygon
  regions[]
  territories[]
  factions[]          // player slot + this world's AI warlords
  containedWorlds[]   // nested completed worlds: geography/history ONLY, never playable tiles of this level
  completion          // how this world is "done"
```

### 2.1 Identifiers

| ID | Scope | Rules |
| --- | --- | --- |
| `worldId` | Global among authored worlds | Stable, opaque, e.g. `w_ember_atoll` |
| `regionId` | Unique within the file | Opaque, e.g. `r_north_reaches` |
| `territoryId` | Unique within the file | Opaque, e.g. `t_0a3c`. **Never shown as a name.** |
| `factionId` | Unique within the file | Player slot may be reused across worlds (`f_player`); AI ids are world-local |

Prefer globally unique IDs (`w_ember_atoll` / `t_ember_0a3c`) so historical nested outlines can be referenced without colliding with the **current** world’s IDs. Uniqueness is **not** so they can be inlined into a parent combat graph — they must not be.

### 2.2 Geometry primitives

Coordinates are **world-local 2D units** (not pixels, not lat/lon, not hex). +x right, +y up. The renderer scales and fits the island into a rectangular canvas.

```json
{
  "x": 120.5,
  "y": 80.0
}
```

**Polygon** (GeoJSON-like, but world-local):

```json
{
  "rings": [
    [ { "x": 0, "y": 0 }, { "x": 10, "y": 0 }, { "x": 8, "y": 7 } ]
  ]
}
```

- `rings[0]` is the exterior, **counter-clockwise**, closed by repeating the first vertex *or* treated as closed by validators (export **closed**: last point equals first).
- Further rings are holes, clockwise.
- Vertices must be finite numbers. No self-intersection of the exterior (validator error).
- Territories are **simple polygons** (one exterior; holes discouraged at v1).

**Axis-aligned display box** is **not** the world. Optional `displayBounds` is a canvas hint only (see §12).

---

## 3. Example small world JSON

Minimal Level 1 island: 2 named regions, 6 unnamed territories, 1 player + 2 AI. Player owns exactly one tile; remaining five split 3 / 2.

See also `docs/examples/world-level1-tiny.json` (same content, loadable later by the editor). That file is **Level 1**: `"containedWorlds": []`. Its six territories are the Level 1 combat graph only; they are not imported into any later world.

```json
{
  "formatVersion": "rep-wars-world.v1",
  "worldId": "w_ember_atoll",
  "level": 1,
  "name": "Ember Atoll",
  "playerFactionId": "f_player",
  "island": {
    "rings": [[
      { "x": 40, "y": 20 }, { "x": 180, "y": 30 }, { "x": 220, "y": 90 },
      { "x": 200, "y": 170 }, { "x": 110, "y": 200 }, { "x": 30, "y": 140 },
      { "x": 40, "y": 20 }
    ]]
  },
  "completion": {
    "type": "control_fraction",
    "fraction": 0.7
  },
  "containedWorlds": [],
  "factions": [
    {
      "id": "f_player",
      "role": "player",
      "name": "Player",
      "homeTerritoryId": "t_01",
      "startingResources": { "gold": 400, "food": 400, "iron": 80, "wood": 80, "stone": 80 },
      "startingArmy": { "soldiers": 400, "knights": 40, "siegeEngines": 0, "locationTerritoryId": "t_01" },
      "personality": null
    },
    {
      "id": "f_cinder_court",
      "role": "ai",
      "name": "Cinder Court",
      "homeTerritoryId": "t_04",
      "startingResources": { "gold": 500, "food": 500, "iron": 120, "wood": 80, "stone": 80 },
      "startingArmy": { "soldiers": 600, "knights": 80, "siegeEngines": 2, "locationTerritoryId": "t_04" },
      "personality": {
        "id": "p_cinder_court",
        "label": "Ashen Steward",
        "ambition": 0.55,
        "traits": {
          "aggression": 0.35,
          "defensiveness": 0.7,
          "expansionism": 0.4,
          "opportunism": 0.45,
          "diplomacy": 0.6,
          "economics": 0.75,
          "riskTolerance": 0.3,
          "patience": 0.7,
          "forgivingness": 0.5,
          "loyalty": 0.65
        }
      }
    },
    {
      "id": "f_salt_raiders",
      "role": "ai",
      "name": "Salt Raiders",
      "homeTerritoryId": "t_06",
      "startingResources": { "gold": 350, "food": 300, "iron": 60, "wood": 40, "stone": 40 },
      "startingArmy": { "soldiers": 700, "knights": 20, "siegeEngines": 0, "locationTerritoryId": "t_06" },
      "personality": {
        "id": "p_salt_raiders",
        "label": "Tide Wolf",
        "ambition": 0.7,
        "traits": {
          "aggression": 0.9,
          "defensiveness": 0.25,
          "expansionism": 0.75,
          "opportunism": 0.8,
          "diplomacy": 0.15,
          "economics": 0.3,
          "riskTolerance": 0.8,
          "patience": 0.2,
          "forgivingness": 0.15,
          "loyalty": 0.3
        }
      }
    }
  ],
  "startingDiplomacy": [
    { "a": "f_cinder_court", "b": "f_salt_raiders", "state": "tense", "opinion": -20 }
  ],
  "regions": [
    {
      "id": "r_cinder_highlands",
      "name": "Cinder Highlands",
      "worldId": "w_ember_atoll",
      "territoryIds": ["t_01", "t_02", "t_03"]
    },
    {
      "id": "r_salt_margin",
      "name": "Salt Margin",
      "worldId": "w_ember_atoll",
      "territoryIds": ["t_04", "t_05", "t_06"]
    }
  ],
  "territories": [
    {
      "id": "t_01",
      "regionId": "r_cinder_highlands",
      "startingOwnerFactionId": "f_player",
      "neighborIds": ["t_02", "t_03"],
      "terrain": "plains",
      "resourceOutput": { "food": 20, "gold": 8, "iron": 0, "wood": 6, "stone": 4 },
      "polygon": {
        "rings": [[
          { "x": 50, "y": 80 }, { "x": 110, "y": 70 }, { "x": 100, "y": 120 },
          { "x": 55, "y": 125 }, { "x": 50, "y": 80 }
        ]]
      }
    },
    {
      "id": "t_02",
      "regionId": "r_cinder_highlands",
      "startingOwnerFactionId": "f_cinder_court",
      "neighborIds": ["t_01", "t_03", "t_04"],
      "terrain": "hills",
      "resourceOutput": { "food": 10, "gold": 6, "iron": 12, "wood": 4, "stone": 10 },
      "polygon": {
        "rings": [[
          { "x": 110, "y": 70 }, { "x": 165, "y": 75 }, { "x": 150, "y": 125 },
          { "x": 100, "y": 120 }, { "x": 110, "y": 70 }
        ]]
      }
    },
    {
      "id": "t_03",
      "regionId": "r_cinder_highlands",
      "startingOwnerFactionId": "f_cinder_court",
      "neighborIds": ["t_01", "t_02", "t_05"],
      "terrain": "forest",
      "resourceOutput": { "food": 8, "gold": 4, "iron": 0, "wood": 22, "stone": 2 },
      "polygon": {
        "rings": [[
          { "x": 55, "y": 125 }, { "x": 100, "y": 120 }, { "x": 95, "y": 170 },
          { "x": 50, "y": 160 }, { "x": 55, "y": 125 }
        ]]
      }
    },
    {
      "id": "t_04",
      "regionId": "r_salt_margin",
      "startingOwnerFactionId": "f_cinder_court",
      "neighborIds": ["t_02", "t_05", "t_06"],
      "terrain": "mountain",
      "resourceOutput": { "food": 4, "gold": 10, "iron": 24, "wood": 2, "stone": 18 },
      "polygon": {
        "rings": [[
          { "x": 165, "y": 75 }, { "x": 205, "y": 95 }, { "x": 185, "y": 145 },
          { "x": 150, "y": 125 }, { "x": 165, "y": 75 }
        ]]
      }
    },
    {
      "id": "t_05",
      "regionId": "r_salt_margin",
      "startingOwnerFactionId": "f_salt_raiders",
      "neighborIds": ["t_03", "t_04", "t_06"],
      "terrain": "coastal",
      "resourceOutput": { "food": 14, "gold": 16, "iron": 0, "wood": 4, "stone": 4 },
      "polygon": {
        "rings": [[
          { "x": 100, "y": 120 }, { "x": 150, "y": 125 }, { "x": 145, "y": 175 },
          { "x": 95, "y": 170 }, { "x": 100, "y": 120 }
        ]]
      }
    },
    {
      "id": "t_06",
      "regionId": "r_salt_margin",
      "startingOwnerFactionId": "f_salt_raiders",
      "neighborIds": ["t_04", "t_05"],
      "terrain": "coastal",
      "resourceOutput": { "food": 12, "gold": 22, "iron": 2, "wood": 2, "stone": 2 },
      "polygon": {
        "rings": [[
          { "x": 150, "y": 125 }, { "x": 185, "y": 145 }, { "x": 175, "y": 185 },
          { "x": 145, "y": 175 }, { "x": 150, "y": 125 }
        ]]
      }
    }
  ]
}
```

Polygons in the example are schematic (not a surveyed coastline). A real export must satisfy the geometric validators in §13.

---

## 4. World → region → territory hierarchy

```
WorldDefinition (one island, one level)
  └── RegionDefinition[]     named; membership list of territory IDs
        └── TerritoryDefinition[]   unnamed polygons; each has exactly one regionId
```

**Region** is the only player-facing geographic name (“Salt Margin”). UI copy, events, and AI goals that today mention `territory.name` must later say the **region name** (and may mention owner), never a territory title.

**Membership is stored twice for integrity, once as authority:**

- Authoritative: `RegionDefinition.territoryIds`
- Cross-check: `TerritoryDefinition.regionId`

Validator requires exact agreement (every territory in exactly one region; region lists have no extras/duplicates).

**Region geometry is derived**, not stored. Union of member territory polygons (shared edges cancelled) is the region outline for rendering labels. Do not persist a second region polygon unless a future editor cache is explicitly marked `derived: true` and ignored by runtime. v1: **do not persist region polygons at all.**

A region in Level N+1 may *represent* a completed lower-level world geographically (see §9 `containedWorlds[].regionId`). That region’s playable tiles are **this world’s** newly authored, coarser territories. The nested world’s original territories remain in the nested world’s own file. They are not members of this region’s `territoryIds` and are not part of this world’s playable graph.

---

## 5. Polygon representation

| Object | Geometry | Stored? |
| --- | --- | --- |
| Island / coastline | One (possibly detailed) polygon | **Yes** — `WorldDefinition.island` |
| Territory | Arbitrary simple 2D polygon | **Yes** — `TerritoryDefinition.polygon` |
| Region | Union of territories | **No** — derive |
| Display/canvas rectangle | AABB | **No** (or optional non-authoritative `displayBounds`) |
| Hex cell | — | **Forbidden** |

**Island vs territories:** territory union should cover the island interior. Small coastline slivers (beach between island ring and tiles) are allowed within a tolerance. Territories must not extend outside the island except by that same epsilon.

**Coastline points** live on `island.rings[0]`. They exist so a renderer can draw an irregular shore without tracing every territory edge. Territory edges that meet the sea should lie on or inside the island ring.

**No hex coordinates, no `q,r`, no `coordToTerritory`.** Adjacency is not “six neighbors.” A territory may have 2–N neighbors.

---

## 6. Adjacency model

Each territory stores:

```json
"neighborIds": ["t_02", "t_03"]
```

**Runtime rule:** movement, attack staging, invasion, and EXPAND-like rules (if any remain) read `neighborIds` only. Do not call distance or polygon intersection at runtime to decide “are these adjacent?”

`neighborIds` may only contain territory IDs that exist **in the same world file**. There is no adjacency between a Level N tile and a Level N+1 tile. Nested historical worlds are not on this graph.

**Editor/validator rule:** two IDs may be neighbors only if their polygons share a boundary segment of length ≥ `minSharedEdge` (authoring constant, e.g. a small world-unit epsilon above a point-touch). Point-touch is not adjacency. Reciprocal listing is mandatory.

Reuse the *idea* of today’s `collectNeighborGraphIssues` (missing, self, non-reciprocal, duplicate) and add:

- **connected dual graph:** all territories reachable from any territory via neighbor edges (the island is one landmass)
- **no orphan region:** region members need not be a connected subset (enclaves allowed if the designer wants them), but the *world* must be connected
- **geographic plausibility:** shared-edge check
- **island containment:** polygons inside island

The editor may *propose* neighbors from geometry; **export writes the explicit list.**

---

## 7. Starting ownership model

Level 1 rules (authoritative for the exported file):

- The player faction owns **exactly one** territory (`homeTerritoryId` = that territory).
- Every other territory is assigned to an AI warlord.
- AI counts should be **as equal as integer division allows** (difference between any two AI owned-counts ≤ 1), unless the designer explicitly locks an uneven split (validator **warning**, not hard error, if `allowUnevenAiSplit: true` on the world).

**Prefer explicit allocation in JSON.** The editor can run “auto-assign remaining equally” before save. Runtime `createGameState` copies `startingOwnerFactionId` → `Territory.owner` and does not shuffle.

`startingOwnerFactionId: null` is **not** part of the Level 1 default. Wilderness tiles are an optional later authoring flag (`allowUnowned: true`); v1 Level 1 files should assign every tile.

Faction `homeTerritoryId` must be owned by that faction at start. For AI, that tile is their initial home (replaces `isCapital` on the territory record).

Starting **armies** live on the faction (`startingArmy.locationTerritoryId` must be owned by them). Starting **garrison on the tile is 0**. Starting **fortification is 0**. Those are runtime city/construction outcomes, not map setup.

---

## 8. AI warlord / personality model

### 8.1 WorldFactionDefinition

Every world lists its participants. AI identities are **not** the global `WARLORD_SPECS` / `iron_kingdom` roster.

| Field | Player | AI |
| --- | --- | --- |
| `role` | `"player"` | `"ai"` |
| `name` | Display name (may be replaced by profile later) | Warlord/empire name |
| `personality` | `null` (human) | **required** trait document |
| `homeTerritoryId` | The one starting tile | Starting home tile |
| `startingResources` | Yes | Yes |
| `startingArmy` | Yes | Yes |

Count of AI warlords is whatever the designer put in `factions`. Different worlds may have 2 or 12.

Optional `startingDiplomacy[]` pairs (`a`, `b`, `state`, `opinion`) seed runtime `DiplomaticRelationship`. If omitted, runtime defaults to `neutral` / opinion 0.

Do **not** store `resourceIncome` in the world file. Income is derived from owned `resourceOutput` via the existing lazy economy.

### 8.2 Personality as data

Authoritative personality is a **trait vector**, not a hardcoded preset name.

```json
{
  "id": "p_salt_raiders",
  "label": "Tide Wolf",
  "ambition": 0.7,
  "traits": {
    "aggression": 0.9,
    "defensiveness": 0.25,
    "expansionism": 0.75,
    "opportunism": 0.8,
    "diplomacy": 0.15,
    "economics": 0.3,
    "riskTolerance": 0.8,
    "patience": 0.2,
    "forgivingness": 0.15,
    "loyalty": 0.3
  }
}
```

- All traits ∈ `[0, 1]`.
- `ambition` ∈ `[0, 1]`, **not** a personality trait (same split as current `WarlordSnapshot`).
- `label` is designer-facing; runtime may ignore it.
- Optional editor-only `presetHint`: `"aggressive"` etc. to seed sliders from today’s `PersonalitySystem` presets. **Runtime must not require `presetHint`.** If present, traits still win.

**Bridge to today’s DecisionEngine:** map `traits` → existing `Personality` fields; set `Personality.type` to `presetHint` if present, else the nearest preset by L1 distance, *only* as a compatibility label. Scoring already uses numeric traits via `getActionBias`.

World-specific personalities mean two “aggressive” warlords in different worlds can have different vectors. There is no global unique personality table.

---

## 9. World hierarchy / progression model

**This section is authoritative (Phase 17M.1).** It is not a recommendation. Future loaders, editors, and renderers must follow it. There is no alternate “inline the old tiles” interpretation.

Finite authored chain, not infinite generation. The player **advances into a larger world**. They do not zoom out on the same territory graph.

```
LEVEL 1 file (own island, own playable graph)
    │  player meets this file’s completion.condition
    ▼
LEVEL 2 file (new larger island, NEW coarser playable graph)
    containedWorlds: [{ worldId: <level-1-id>, regionId: <level-2-region> }]
    Level 1 remains a nested geographic/history object.
    Level 1 territories are NOT copied into Level 2 territories[].
```

### 9.0 Worked example (normative)

| | Level 1 | After completion → Level 2 |
| --- | --- | --- |
| Playable world | Island A | Larger Island B (newly authored) |
| Playable territories | e.g. 20 polygons in the Level 1 file | **New**, larger/coarser polygons in the Level 2 file |
| Named regions | e.g. 5 regions in the Level 1 file | **New** named regions in the Level 2 file |
| Level 1 island | The playable world | Contained/nested world inside Level 2 (outline + history) |
| Level 1 territory borders | Playable adjacency of Level 1 | **Do not** automatically become Level 2 playable borders |

Concrete IDs from the tiny example: while `w_ember_atoll` is current, `t_01`…`t_06` are the combat graph. When the player later plays a Level 2 world that contains Ember Atoll, those six IDs **stay in the Level 1 file**. Level 2’s `territories[]` are different IDs with coarser polygons. A Level 2 army cannot occupy `t_01`. A Level 2 `neighborIds` list cannot mention `t_01`.

### 9.1 Two graphs, two files, one active combat graph

Each `WorldDefinition` file owns:

1. **The active playable graph for that level:** `territories[]` + `neighborIds` + that file’s `regions[]` + that file’s `factions[]`. This is the only graph used for movement, attack, ownership, economy, and cities **while that world is current**.
2. **Zero or more nested historical worlds:** `containedWorlds[]`. Each entry points at a **different already-authored file** (lower `level`). That file keeps its original island, regions, territories, adjacency, and starting owners as historical/nested geography.

While the player is on Level N+1:

- Load **Level N+1** `territories[]` as GameState tiles.
- Do **not** concatenate Level N `territories[]` into that GameState.
- May load Level N’s `island` (and optionally its territory outlines) **only** to draw nested geography under `placement`. Those outlines are not selectable combat tiles.

While the player is on Level N, Level N+1 is not loaded as playable (see §9.5 / §11).

### 9.2 Fields

```json
{
  "level": 2,
  "containedWorlds": [
    {
      "worldId": "w_ember_atoll",
      "regionId": "r_old_ember",
      "placement": {
        "origin": { "x": 400, "y": 300 },
        "rotationDegrees": 0,
        "scale": 0.35
      }
    }
  ]
}
```

- `worldId` references another authored file by id. It is not generated at runtime.
- `regionId` is a region **in the parent (Level N+1) file**. That parent region is made of **parent territories**. It geographically stands for the completed world (label, nested outline). It does not contain the child’s territory IDs.
- `placement` transforms the **child island polygon** (and, if a renderer later draws historical borders, the child’s polygons) into parent space. Placement is a **render/history transform**. It does not import child territories as parent tiles, does not rewrite IDs, and does not create adjacency.

Level 1 files (including `docs/examples/world-level1-tiny.json`) have `"containedWorlds": []`.

Schematic of a **later** Level 2 file (not shipped in 17M; IDs are new; Ember Atoll is nested, not inlined):

```json
{
  "formatVersion": "rep-wars-world.v1",
  "worldId": "w_greater_archipelago",
  "level": 2,
  "name": "Greater Archipelago",
  "containedWorlds": [
    { "worldId": "w_ember_atoll", "regionId": "r_old_ember", "placement": { "origin": { "x": 400, "y": 300 }, "rotationDegrees": 0, "scale": 0.35 } }
  ],
  "regions": [
    { "id": "r_old_ember", "name": "Ember Reaches", "worldId": "w_greater_archipelago", "territoryIds": ["t_b01", "t_b02"] }
  ],
  "territories": [
    { "id": "t_b01", "regionId": "r_old_ember", "neighborIds": ["t_b02"] },
    { "id": "t_b02", "regionId": "r_old_ember", "neighborIds": ["t_b01"] }
  ]
}
```

`t_b01` / `t_b02` are Level 2 playable tiles covering the area where Ember Atoll sits. They are **not** `t_01`…`t_06`. Those six IDs remain only in `w_ember_atoll`.

### 9.3 Forbidden interpretations (do not implement)

These are **invalid** readings of this spec:

| Forbidden | Why |
| --- | --- |
| Copy / inline every Level N territory into Level N+1 `territories[]` | Level N+1 must be a newly authored coarser graph |
| Reuse Level N `neighborIds` as Level N+1 adjacency | Each file has its own explicit adjacency; no cross-level edges |
| Treat nested historical polygons as Level N+1 combat tiles | Nested worlds are not on the active combat graph |
| Merge both graphs into one GameState adjacency list | One current world ⇒ one playable graph |
| Auto-generate Level N+1 tiles by simplifying Level N polygons | Level N+1 is authored, not derived |
| “Zoom out” gameplay that keeps the same tile IDs at a higher level | Progression is advance-to-larger-world, not LOD of the same graph |
| Cross-level attacks, movement, or ownership of child IDs while parent is current | Child IDs are not in the parent runtime map |

### 9.4 Completion

`completion` is data for a future progression system, not implemented now. v1 allowed types:

| `type` | Meaning |
| --- | --- |
| `control_fraction` | Own ≥ `fraction` of territories |
| `eliminate_ai` | No AI faction holds a territory |
| `manual` | Designer/script marks the world complete |

Runtime persists which worlds the player has completed (GameState / profile), not inside the world JSON.

### 9.5 Fog of future worlds

While playing Level 1, Level 2 is **not in the current world definition loaded as playable**. The UI may show a locked fog mass *outside* the island (“uncharted seas / next world”) using `displayBounds` or a later `exteriorFog` hint. That is not territory fog.

---

## 10. Cities and ownership-transfer implications

**World JSON contains zero cities.** No `City`, no pre-built fortification buildings, no “one city per owned tile” at export.

**Intended runtime (later phase, not 17M code):**

| Event | City rule |
| --- | --- |
| New game | `GameState.cities` empty. Owned territories have no city until constructed. |
| Player/AI completes a city project | City created for that owner on that territory. |
| Territory captured | **Destroy** the previous owner’s city (and in-progress construction, as today). Conqueror receives **bare land**. They must build a new city. |
| Territory unowned | No city. |

This **contradicts** current `seedEconomyAndCities` (creates a city for every owned tile) and `settleTerritoryOwnershipChange` (`ensureCity` for the conqueror). Those are listed in §15 as later removals/changes. Economy `territoryEconomy` records can still be seeded empty without a city.

Fortification stays a **runtime** `Territory.fortification` (and city building once a city exists), starting at 0 from the world file.

---

## 11. Visibility / fog / scouting model

| Concept | v1 world model |
| --- | --- |
| Tiles of the **current** world | All visible to the player. Armies, owners, garrisons, construction on this island are not hidden by fog. |
| Territory fog (`unknown` / `discovered` / `scouted`) | **Removed** for intra-world play |
| `SCOUT` command / `ActionType: 'SCOUT'` | **Obsolete** |
| `PlayerVisibilityMap`, `isKnown`, `scoutedTurnsAgo` | **Obsolete** as gameplay |
| `assertPlayerCanSeeTarget` / `FOG_OF_WAR` for tiles on the current island | **Obsolete** |
| Fog **beyond** the current island | Allowed as “future world / uncharted” presentation, not a per-tile map |

AI `knownTerritories` / `knownFactions` should later mean diplomatic/military memory, not fog. Until retargeted, runtime can treat all current-world tiles as known.

`GET_VISIBLE_WORLD` should eventually return the full current island (plus locked exterior fog), not a scout-filtered subset.

---

## 12. Runtime vs authored-world data boundary

### 12.1 Belongs in the world JSON (authored)

- `worldId`, `level`, display `name` of the world and of **regions**
- Island polygon
- Region membership and names
- Territory IDs, polygons, `neighborIds`, `regionId`, `startingOwnerFactionId`
- `terrain` (until combat is redesigned; used today for defense bonus)
- `resourceOutput` (feeds existing lazy economy)
- Faction roster, names, homes, starting resources/armies
- AI personality documents + ambition
- Optional starting diplomacy
- `containedWorlds` references + `placement` (**history/render only**; not playable tiles of this file)
- `completion` predicate

### 12.2 Belongs only in runtime GameState (not in world JSON)

- `worldTick`, `turn`, `schemaVersion` of GameState, persistence `stateVersion`
- Current `Territory.owner` after play (initialized from starting owner)
- Armies after spawn (positions, movement, attack intents, losses)
- `cities`, `constructions`, `territoryEconomy` clocks / uncollected
- Fortification/garrison after play
- Invasions, cooldowns, pause, fitness, workout history, rewards ledger
- Commitments, memory, evolving diplomacy/opinion, goals
- `mapWorld` hex metadata, visibility maps (until deleted)
- RNG / `WarlordState` engine internals
- Which world file is currently playable; nested-world graphs are **not** GameState territories while a parent world is current

### 12.3 Derived — do not persist in the world definition

- Region polygons (union of territories)
- Remaining construction time, collectible yield, invasion countdown
- Public-view DTOs
- Canvas AABB (optional hint only: `displayBounds`)
- Reciprocal adjacency if stored twice (store once per territory; validator checks symmetry)
- `isCapital` (derive: `faction.homeTerritoryId === territory.id`)
- `Personality.type` preset label (optional derived compatibility)
- Connected-component / “frontier” hex sets
- Faction `resourceIncome` (from owned tiles)
- Territory **names**
- Inlined copies of a contained world’s territories, regions, or `neighborIds` inside the parent file
- Cross-level adjacency lists

### 12.4 Optional non-authoritative editor hints (strip or ignore in runtime)

```json
"editor": {
  "displayBounds": { "minX": 0, "minY": 0, "maxX": 240, "maxY": 220 },
  "notes": "draft coastline"
}
```

Runtime must boot if `editor` is absent.

---

## 13. Validation rules

The editor validates before export. A future runtime loader validates before `createGameState`. Fail closed: invalid world does not start a game (same spirit as 17L corrupt persistence).

**Identity**

- `formatVersion === "rep-wars-world.v1"`
- Unique `worldId`, `regionId`, `territoryId`, `factionId`, personality `id`
- Exactly one `role: "player"`
- `playerFactionId` matches that faction
- `level` ≥ 1 integer

**Hierarchy**

- Every territory `regionId` exists
- Every region `territoryIds` entry exists
- Membership bijection; no territory in two regions
- Regions non-empty
- `homeTerritoryId` exists and `startingOwnerFactionId` equals that faction
- Player owns exactly one territory; `homeTerritoryId` is that one
- AI starting counts differ by at most 1 unless `allowUnevenAiSplit`

**Adjacency**

- No self-neighbors, no duplicates, all IDs exist **in this file**, reciprocal
- Dual graph connected **within this file’s territories[]**
- Shared-edge length ≥ epsilon for each listed neighbor
- No neighbor pair that does not share an edge
- No `neighborIds` entry that names a territory from a contained (or any other) world file

**Geometry**

- Island and territory polygons closed, finite, CCW exterior
- No self-intersection (territory exteriors)
- Territories pairwise interior-disjoint (boundaries may coincide)
- Territories inside island (epsilon)
- Territory area > 0

**Factions / personality**

- AI factions have personality; player has `personality: null`
- Traits and ambition in `[0, 1]`
- `startingArmy.locationTerritoryId` owned by that faction
- Diplomacy endpoints exist; `a !== b`

**Forbidden in file**

- Territory `name`
- `cities`, city buildings
- Hex `q`/`r`
- Visibility / scout fields
- Non-JSON types

**Contained worlds**

- `containedWorlds[].worldId` ≠ this `worldId`
- `regionId` exists in **this** file and that region’s `territoryIds` are **this file’s** territories only
- `level` of contained world must be `<` this world’s level when the referenced file is available
- This file’s `territories[].id` set and the contained file’s `territories[].id` set must not be treated as one graph (IDs should not collide if globally unique; even if they did, they are different worlds)
- **Reject inlining:** this file must not copy a contained world’s territory records into `territories[]` as a way to “include” them
- **Reject cross-level adjacency:** no edge between this file’s territory IDs and a contained file’s territory IDs
- **Reject combat-graph merge:** validating / loading this world uses only this file’s `territories[]` + `neighborIds` as the playable graph
- Missing referenced file: editor warning; runtime of *this* world can still play the parent graph if nested outline is optional

---

## 14. Migration / replacement implications for the current codebase

Do **not** implement these in 17M. This is the replacement map.

| Current | Implication |
| --- | --- |
| `src/map/MapEngine.ts` hex fabricator, themes, frontier expansion | Cease to be the source of world truth. Possible later deletion or test-only leftover. |
| `NamingSystem.generateTerritoryName` | Stop. Regions are named by the designer. |
| `SAMPLE_MAP` / `MapTerritorySpec.name` | Replace with world JSON. IDs may be reused as opaque ids; names move to regions. |
| `MapWorldState.graphMeta.territoryPos {q,r}` | Replace with polygons. |
| `Territory.name`, `isKnown`, `scoutedTurnsAgo` | Drop from canonical territory when GameState is retargeted. Battle/event strings use region name. |
| `SCOUT` command, `handleScout`, `ActionType 'SCOUT'` | Remove from catalog and AI action set. Personality bias key for SCOUT goes away. |
| `PlayerVisibilityMap`, `visibilityOf`, `fogTerritory`, `assertPlayerCanSeeTarget` | Intra-world: always visible. Keep FOG only if reused for “next world locked.” |
| `GET_VISIBLE_WORLD` / public view hiding garrisons on “discovered” tiles | Show current world fully. |
| `seedEconomyAndCities` auto-`ensureCity` | Stop creating cities at spawn. |
| `settleTerritoryOwnershipChange` → `ensureCity` | Change to **remove** previous city and **not** create one for the conqueror. |
| `PersonalitySystem.createPreset` as identity | Keep as editor seed / fallback mapper; world JSON traits are authority. |
| `WARLORD_SPECS` global four empires | Per-world `factions[]`. Tests that hardcode `iron_kingdom` need fixtures. |
| `EXPAND` onto unowned tiles | Level 1 default has no unowned tiles. EXPAND-as-claim-empty-land becomes unused unless `allowUnowned`. |
| Persistence 17L snapshot of `mapWorld` / `visibility` | After retarget, those maps are empty or omitted; world definition is loaded from a world JSON + runtime overlay. |
| BattleEngine `territory.name` / `isCapital` | Display: region name. Capital: `homeTerritoryId` (and later “has city” if design wants). |
| `GoalType: 'control_region'` | Becomes meaningful: regions are real named sets. |
| Frontier expansion / “map grows as you explore” | Replaced by authored Level N+1 files. Completing a world unlocks a **new** coarser graph, not a zoom of the old tiles. |

**Suggested later load path**

```
WorldDefinition JSON for the CURRENT level only
  → validate that file’s playable graph (do not merge contained worlds into it)
  → instantiate GameState.territories / factions / adjacency / resourceOutput from THIS file
  → optionally attach contained-world island outlines for render/history
  → empty cities, empty visibility
  → existing Orchestrator / CWE / economy / invasions (unchanged math)
```

`createGameState({ mapSpecs, warlordSpecs })` is the transitional bridge. A future `createGameStateFromWorld(def)` replaces SAMPLE_MAP without rewriting combat or fitness.

---

## 15. Obsolete systems / concepts to remove later

1. **Territory display names** (`Territory.name`, `MapTerritorySpec.name`, `NamingSystem` territory naming, battle text keyed off tile names).
2. **Scouting** (`SCOUT` command, `ActionType.SCOUT`, `ScoutResult`, scout personality bias, `revealedBy: 'scout'`).
3. **Territory-level fog of war** (`VisibilityState`, `PlayerVisibilityMap`, `isKnown`, `scoutedTurnsAgo`, `knownTerritories` as fog, `fogTerritory`, player attack fog gate).
4. **Hex / axial coordinates** (`HexPos`, `HEX_DIRS`, `graphMeta.coordToTerritory`, `territoryPos.q/r`, hex distance).
5. **Procedural map as authority** (`generateInitialWorld`, `ExpansionRequest`, frontier growth, theme-weighted fabricator, `MapGenerationReport` as world source).
6. **Theme-driven map generation** as required world input (`ThemeDefinition` library for *creating* tiles). Themes may remain flavor text later; they are not required in v1 world JSON.
7. **Rectangular/hex playable world.** Canvas may be rectangular; gameplay island is not.
8. **Cities at world creation** (`seedEconomyAndCities` creating cities; SAMPLE_MAP implying developed settlements).
9. **Conqueror inherits city** (`ensureCity` on ownership transfer).
10. **Global hardcoded warlord roster** as the only AI identities (`WARLORD_SPECS` in production worlds).
11. **Personality as preset enum only** (`PersonalityType` as the stored identity).
12. **Capital flag on territory records** (`isCapital` in authored data).
13. **Runtime-invented starting ownership** (random even split at boot).
14. **Runtime-invented adjacency** (hex neighbors, proximity).
15. **`resourceIncome` authored on factions** (derive from tiles).
16. **Scout-based `GET_VISIBLE_WORLD`** as the player’s actual map.
17. **Inlining a completed world’s territories into the next world’s playable graph** (LOD / zoom-out on the same tiles, cross-level adjacency, merged combat graphs).

Keep until a dedicated combat/economy pass says otherwise: `terrain` → defense bonus, `resourceOutput` → production, garrison/fortification as **runtime** combat/construction fields.

---

## 16. Closed and remaining defaults

### 16.1 Hierarchy — decided in Phase 17M.1 (do not reopen)

**Level N+1 uses its own newly authored, coarser playable territory graph.**

A completed Level N world becomes a **contained geographic/history object** inside Level N+1 (`containedWorlds`). Level N keeps its original territory graph and geometry in **its own file**. Level N+1 does **not** inline those territories, does **not** inherit those borders as playable borders, and does **not** put the nested graph on the Level N+1 combat/adjacency list.

Inlining, cross-level adjacency, and “zoom out on the same tiles” are **rejected**, not deferred.

See §9. There is no remaining product choice on this topic.

### 16.2 Defaults already chosen (say if you disagree later; not blocking 17M)

| Topic | Default |
| --- | --- |
| Unowned tiles at Level 1 | None |
| Region geometry | Derived from territories |
| Starting fortification / garrison | 0; armies are faction stacks |
| Personality | Full trait vector in JSON; presets are editor hints |
| Coordinate space | World-local 2D, y-up |
| Polygon holes | Disallowed in v1 territories |
| Completion types | Data only; not implemented now |
| Map Assistant | Later; tiny standalone Python editor; JSON is the artifact; no generate-from-prompt |
| Terrain in JSON | Keep for current combat modifiers |

---

## Future Map Assistant (contract only)

Not built in 17M. When it is:

- Small standalone Python app (ideally one file).
- Open/save/export `rep-wars-world.v1` JSON.
- Human draws island, regions, territory polygons; assigns membership, neighbors, owners, resources, warlords/personalities.
- Validate with §13; refuse export on errors.
- **No** prompt-to-generate-world.
- Editor is not the source of truth; the file is.

---

## Relationship to Phase 17L persistence

17L persists **runtime** `GameState`. World JSON is **content**. Later: load world JSON once to instantiate a run, then persist GameState (owners, armies, cities, ticks) as today. Do not dump editor polygons into the 17L envelope on every tick; store a `worldId` + `formatVersion` pointer plus runtime overlays.

---

*Phase 17N (architecture audit) is not started. This file is the 17M / 17M.1 deliverable.*
