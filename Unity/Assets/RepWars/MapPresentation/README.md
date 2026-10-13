# Map presentation

`RepWarsMapScreen` coordinates the live map. It draws one resolved world presentation. It does not load a Level 1 file by name.

| Owner | Builds |
| --- | --- |
| `RepWarsMapScreen` | Boot, the full rebuild, the `WorldMap` root, selected territory (`selected`), picking, camera framing, the two HUD text meshes |
| `RepWarsWorldPresentations` | Chooses the authored bundle for the snapshot's `definitionWorldId` |
| `RepWarsTerritoryPresenter` | Territory object, terrain mesh (`Ground`), normal border (`GroundOverlay / Border`), `RepWarsTerritoryView`, pick collider |
| `RepWarsArmyPresenter` | One `RepWarsArmyVisual` per backend army under its territory |
| `RepWarsPropPresenter` | Authored props (`World`, via `RepWarsPropPlacement`) |
| `RepWarsLabelPresenter` | Region labels and location labels (`WorldOverlay`) |
| `RepWarsSelectionPresentation` | Highlight and marker for the selected territory |
| `RepWarsMapResources` | Owns the meshes and materials created by the presenters above |

Troop-count labels are built by `RepWarsArmyVisual`. Soldier figures are built by `RepWarsSoldierVisual`.

The presenters are static builders. They read the resolved authored world and the live snapshot, create Unity objects, and keep no map state. Ownership, troops, and selection stay on the snapshot and on `RepWarsMapScreen.selected`.

Sorting layers and orders come from `RepWarsWorldSorting` only.

## World presentation bundle

A bundle is a `RepWarsPropCatalog` in a Resources folder. Its authored JSON supplies `worldId`, territory rings, regions, locations, and props. Its sprite entries are that world's prop set. `terrainFill` is the optional repeating ground sprite. When it is null, territories use the existing terrain-color fallback.

`RepWarsWorldPresentations` reads every catalog, indexes it by the JSON `worldId`, and caches that index. Level 1 is the catalog whose JSON says `worldId` `"Level 1"`, with the Plains fill sprite on that asset.

Resolution:

- a snapshot `definitionWorldId` selects that bundle;
- an empty id uses the bundle only when exactly one is registered;
- an unknown id, a duplicate id, or an invalid authored world fails and does not draw another world.

`GET_WORLD_DEFINITION` must succeed before the map is shown. Its body is not the sprite-backed bundle. Canonical `definitionWorldId` already exists on the public snapshot. Unity reads that field and does not invent a world id.

Adding a world later means adding another catalog asset whose JSON `worldId` matches the backend id. No map-screen branch is required. Level 2 is registered on the backend and has no Unity bundle, so a Level 2 snapshot fails closed.

There is no theme or background field. A future profile can be a field on the catalog when something renders it.

## Lifecycle

Every rebuild destroys the previous `WorldMap` root and builds a new one. `RepWarsMapResources` sits on that root and destroys the runtime meshes and materials the presenters registered. Sprites, textures, and fonts are project assets and are not destroyed. `RepWarsSelectionPresentation` still releases its own line material. A rebuild clears the selection.

One border material and one terrain material are shared by all territories in a build. Fallback terrain colors share one material per color. Props share one material.

A changed `definitionWorldId` resolves again inside `PresentAuthoritative`. A failed resolve clears the current map.

## Deferred

Incremental snapshot application, selection persistence across updates, production Level 2 presentation, terrain and biome rendering, world canvas and horizon, structures, roads, procedural props, CharacterProduction figures, Environment effects, touch controls.

Known leftovers: the Plains fill sprite's wrap mode is set to Repeat on the shared project texture when that sprite is used. The HUD helpers `FormatTerritory`, `FormatEmpire`, `RegionName`, and `RegionNameForOwner` in `RepWarsMapScreen` have no callers. Snapshot territories without authored geometry, and authored territories missing from the snapshot, are warnings rather than a failed build.
