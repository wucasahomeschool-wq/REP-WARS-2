# Map presentation — Phase 3A

`RepWarsMapScreen` coordinates the live map. Each kind of map object has one builder.

| Owner | Builds |
| --- | --- |
| `RepWarsMapScreen` | Boot, the full rebuild, the `Level1Map` root, selected territory (`selected`), picking, camera framing, the two HUD text meshes |
| `RepWarsTerritoryPresenter` | Territory object, terrain mesh (`Ground`), normal border (`GroundOverlay / Border`), `RepWarsTerritoryView`, pick collider |
| `RepWarsArmyPresenter` | One `RepWarsArmyVisual` per backend army under its territory |
| `RepWarsPropPresenter` | Authored props (`World`, via `RepWarsPropPlacement`) |
| `RepWarsLabelPresenter` | Region labels and location labels (`WorldOverlay`) |
| `RepWarsSelectionPresentation` | Highlight and marker for the selected territory (unchanged from Phase 2B) |
| `RepWarsMapResources` | Owns the meshes and materials created by the presenters above |

Troop-count labels are built by `RepWarsArmyVisual`. Soldier figures are built by `RepWarsSoldierVisual`.

The presenters are static builders. They read the authored world and the live snapshot, create Unity objects, and keep no map state. Ownership, troops, and selection stay where they were.

Sorting layers and orders come from `RepWarsWorldSorting` only.

## Lifecycle

Every rebuild destroys the previous `Level1Map` root and builds a new one, as before. `RepWarsMapResources` sits on that root. When the root is destroyed, it destroys the runtime meshes and materials the presenters registered. Sprites, textures, and fonts come from project assets and are not destroyed. `RepWarsSelectionPresentation` still releases its own line material. A rebuild clears the selection.

One border material and one terrain material are shared by all territories in a build. Fallback terrain colors share one material per color. Props share one material.

## Deferred

Incremental snapshot application, selection persistence across updates, data-driven world definitions, CharacterProduction figures, Environment effects, terrain and biome rendering, world canvas and horizon, structures, roads, touch controls.

Known leftovers: `RepWarsTerritoryPresenter` sets the wrap mode of the shared `Plains 1` project texture to Repeat, as the map screen did before. The HUD text helpers `FormatTerritory`, `FormatEmpire`, `RegionName`, and `RegionNameForOwner` in `RepWarsMapScreen` have no callers and belong to the later HUD work.
