# Authored worlds (Phase 17N.2 / 17P / 17Q)

Production geography is an authored `WorldDefinition` JSON file
(`rep-wars-world.v1`). The Python Map Assistant
(`tools/map_assistant/map_assistant.py`) is a standalone editor that
**exports** this format. It is not a game engine and is not imported by
the TypeScript runtime.

```
Authored World JSON
        ↓
WorldCatalog.load(worldId)     ← only production load boundary
        ↓
WorldValidator (fail closed)
        ↓
immutable WorldDefinition
        ↓
createGameStateFromWorld()
        ↓
GameState (mutable overlay)
        ↓
Orchestrator → AI / Battle / Economy / Cities / Invasions / Fitness
```

`createGameState()` / `initializePlayerWorld()` load
`DEFAULT_PRODUCTION_WORLD_ID` from `src/worldDefinition/worldConfig.ts`
through `WorldCatalog`. That ID is the authored production Level 1 file
(`worlds/level-1.json`, worldId `"Level 1"`). Ember Atoll
(`docs/examples/world-level1-tiny.json`) remains a **fixture** for tests.
See `docs/ADDING_A_WORLD.md`.

The catalog never falls back to `SAMPLE_MAP` or an empty world.
If the configured file is missing or invalid, initialization **throws**.

`SAMPLE_MAP` / `WARLORD_SPECS` / `MapEngine` remain **legacy test/demo
fixtures**. Use `createLegacySampleMapGameState()` only in isolated
regression tests.

### Ownership of data

| Lives on `WorldDefinition` (immutable, load via `definitionWorldId`) | Lives on `GameState` (mutable) |
| --- | --- |
| `worldId`, `level`, `name`, format version | `definitionWorldId`, `worldLevel`, `worldName`, `definitionFormatVersion` (identity only) |
| Island polygon, territory polygons | Territory ids, owners, fortification, garrison, `population`/`baseValue` (runtime-only; authored init = 0) |
| Region names and membership | `regions` id/name/territoryIds index (no geometry) |
| Authored adjacency `neighborIds` | Copied to `Territory.neighboring` for MOVE/ATTACK |
| Faction list, starting owners, starting armies/resources | Faction snapshots, armies, resources |
| AI `WorldPersonalityDefinition` | `WarlordSnapshot.personality` / `ambition` via `PersonalitySystem.fromTraits` |
| Contained/nested completed worlds (references only) | Not inlined; no cross-level adjacency |

Do **not** duplicate polygons into each GameState snapshot. Persistence
stores identity (`definitionWorldId` / format / level / player faction)
plus the mutable overlay. Geometry is resolved later with
`resolveWorldDefinition(definitionWorldId)`. On hydrate, adjacency,
region membership, terrain, resource output, and authored personalities
are rebound from the catalog so GameState cannot silently disagree with
the WorldDefinition.

The persistence envelope (`PersistedWorldRecord`) also copies that
identity so a stored row can answer: which authored world, which format,
which level, which player, which player faction. `worldId: 'local'` is
the **instance** key (one local world per player), not the content id.

## Territories and regions

- Territories have **stable internal IDs only**. They have no player-facing
  names. The validator rejects `territory.name`.
- Regions are the named geographic units. Every territory belongs to exactly
  one region. Membership is validated (`regionId` ↔ region `territoryIds`).
- Geometry is irregular 2D polygons. The display canvas may be rectangular;
  the island is not.

## Visibility

The **entire current world** is visible. There is no territory fog, scouting,
`SCOUT` command, or known/unknown tile state. Future worlds are inaccessible
until progression; that is world-level, not tile-level. Public views set
`currentWorldFullyVisible: true`. Enemy army **morale / pending attack plans**
may still be withheld; that is not tile fog.

## Starting ownership, EXPAND, cities

Level 1 JSON assigns every playable tile. The player owns exactly one
territory; remaining tiles are authored for AI warlords. Runtime does not
invent owners. **EXPAND is not a production command.**

Worlds start with **no cities**. Founding a city is `START_CONSTRUCTION` with
`projectType: 'CITY'`. Fortification is a different project and requires a
city. Conquest:

1. Destroy the previous owner's city
2. Transfer ownership
3. Leave the tile without a city
4. The conqueror must found a city explicitly

`Territory.isCapital` is removed. Capital / seat mechanics are **deferred**
and must not be invented in combat or scoring.

## AI

World JSON supplies per-warlord personality traits and ambition.
`DecisionEngine` / `ActionScorer` are reused. `control_region` goals use
`Territory.regionId` against `goal.targetRegion` (from `homeRegionId`).

**Level 1** is a scripted tutorial on the same engines. It is not supposed
to rely on autonomous `AI_DECIDE` for tutorial-critical beats. **Level 2+**
is where true autonomous AI is intended. Scripted attacks still use
`RESOLVE_COMMITMENT` → the same `executeAttack` / invasion path. There is
not yet a tutorial/scenario controller (the smallest missing piece is a
hook that can suppress `AI_DECIDE` during tutorial beats and issue those
scripted commitments, including around the 24h post-workout protection
window).

Polygons are not stored on `GameState`. The frontend loads geometry with
`GET_WORLD_DEFINITION`. Mutable overlay (owners, troops, invasions,
workout session, `worldCompletion`) is on `GET_GAME_STATE` /
`GET_VISIBLE_WORLD`.

## Hierarchy

One JSON file is one authored world/level. Level N+1 is a new graph, not
inlined Level N tiles. A completed lower world may appear as a contained
object with placement; neighbors cannot reference another world's tiles.
Full level-progression gameplay is not implemented yet; the data model
already forbids cross-level adjacency.

## Adding a world

Follow `docs/ADDING_A_WORLD.md`. Production vs fixture lists live only in
`src/worldDefinition/worldConfig.ts`.

## Production vs legacy

| Status | What |
| --- | --- |
| **PRODUCTION** | `src/worldDefinition/**`, `createGameState()`, `createGameStateFromWorld()`, `WorldCatalog` |
| **LEGACY FIXTURE** | `SAMPLE_MAP`, `WARLORD_SPECS`, `createLegacySampleMapGameState()`, `src/simulation/mapDemo.ts` |
| **DEPRECATED / not production** | `src/map/MapEngine.ts`, `NamingSystem.ts`, `Themes.ts` — hex generation, fog, scout, expand. Kept for isolated regression coverage. Not registered on the production EngineRegistry. |
| **REMOVED from production** | `SCOUT`, `EXPAND`, tile fog, `Territory.name` / `isCapital` / `isKnown` |
