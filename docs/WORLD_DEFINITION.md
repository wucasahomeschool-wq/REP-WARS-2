# Authored worlds (Phase 17N.2)

Production geography is an authored `WorldDefinition` JSON file
(`rep-wars-world.v1`). The future Map Assistant is an editor that **exports**
this format. It is not part of this phase. Runtime never generates a
production island, hex graph, or personality preset as authority.

## How an authored world becomes a runtime world

```
World JSON (docs/examples/world-level1-tiny.json, later editor exports)
    → WorldCatalog / loadWorldDefinitionFromFile
    → parse + WorldValidator (fail closed)
    → WorldDefinition (immutable)
    → createGameStateFromWorld(definition, { playerId / playerFactionId })
    → GameState (mutable overlay)
```

`createGameState()` with no `mapSpecs`/`warlordSpecs` loads the tiny Level 1
fixture and instantiates it. `SAMPLE_MAP` is **not** the production default.
Use `createLegacySampleMapGameState()` only in tests that have not been
migrated.

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

Do **not** duplicate polygons into each GameState snapshot. Persistence stores
identity (`definitionWorldId` / level) plus the mutable overlay, not a second
copy of the JSON world.

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

## Hierarchy

One JSON file is one authored world/level. Level N+1 is a new graph, not
inlined Level N tiles. A completed lower world may appear as a contained
object with placement; neighbors cannot reference another world's tiles.

## Legacy fixture

`src/simulation/SampleMap.ts` (`SAMPLE_MAP`, `WARLORD_SPECS`, MapEngine
hex generation, `mapDemo`) remains a **legacy test fixture**. Do not treat
it as production geography.
