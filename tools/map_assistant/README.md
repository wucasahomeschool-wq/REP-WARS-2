# REP WARS Map Assistant 4.0

Standalone **authoring** tool for `rep-wars-world.v1` JSON.

It is a **vector boundary editor**, not a game engine and not a world generator.
The drawing is a boundary network. The software finds the spaces enclosed by
those vector lines. It does not rasterize, flood-fill, or guess territories
from pixels.

```
USER DRAWING  →  VECTOR BOUNDARY NETWORK  →  PLANAR GRAPH
          →  ENCLOSED FACES  →  TERRITORY POLYGONS
```

## Philosophy

**The lines are the boundaries.**

- The island starts as one closed outline (one territory).
- Internal lines split that land into faces.
- Live preview updates as the graph changes.
- **COMMIT GEOGRAPHY** writes faces into the playable WorldDefinition.
- Visual props never change geography.

## Drawing

New maps start **blank** — no island, no territories.

1. **Island** — draw a closed outer boundary. Preview shows one territory.
2. **Boundary** — draw internal lines. Endpoints snap to the existing network
   (island, internals, or junctions). Crossing an existing line splits it at
   the intersection. Dangling lines that do not snap are rejected.
3. Continue until the live faces look right.
4. Press **COMMIT GEOGRAPHY**.
5. Assign regions, factions, terrain, theme, challenges, presentation, and
   semantic locations in the sidebar.
6. Switch to **Composition** to place scenery (local prop scale).
7. Use **3/4 preview** to check oblique placement.
8. Review **Nested** for contained-world placement; import a previous level
   via the World menu when coarsening.
9. **Validate**, then export playable World JSON and (optionally) visual
   composition JSON.

Tools: Island, Boundary, Select, Move node, Delete, Place prop, Place location, Pan.

Undo/redo applies to graph edits, commits, props, and metadata snapshots.

## Theme library

Themes load from `tools/map_assistant/data/rep-wars-world-theme-library-112.json`
(or `MAP_ASSISTANT_THEME_LIBRARY`). Theme names are **not** hardcoded in Python.
Only `theme.themeId` is persisted on the world. Library descriptive text is
display-only. Challenges are authored separately — selecting a theme never
auto-enables a challenge.

## Scale hierarchy

```text
asset defaultScale / anchor
  → composition instance scale / rotation / position
  → containedWorlds.placement (whole nested world)
  → presentation.scaleProfileId / camera
```

Do not confuse asset scale, local prop scale, nested-world placement scale,
and world presentation scale. Geography commit does not rewrite presentation
or containedWorlds placement.

## What is not in this tool

- Raster conversion, flood-fill, gap-closing, pixel contours
- Automatic prop scattering
- AI map generation
- Gameplay simulation / challenge execution
- Runtime LOD, culling, Empire Overview, campaign player nesting
- Camera / nested-world navigation simulation

## Scale JSON

If `assets/asset-scale.json` or `tools/map_assistant/asset-scale.json` exists,
its `defaultScale` and `anchor` values are used as asset defaults. Instance
scale overrides are stored on each placed prop. Missing scale data is not
invented in the export.

## Launch

Requires Python 3 with Tkinter. No pip packages.

```text
python tools/map_assistant/map_assistant.py
python tools/map_assistant/map_assistant.py path/to/world.json
python tools/map_assistant/map_assistant.py --self-test
python tools/map_assistant/map_assistant.py --validate worlds/level-1.json
python tools/map_assistant/map_assistant.py --gui-smoke
```

The `.py` file is copyable into another directory and still launches.

## Exports

- **Save** writes an editor document (WorldDefinition + `_editorBoundaryGraph`
  + `_editorGeographyDirty`). Visual props live on playable
  `world.composition`; legacy `_editorComposition` is still **read** on open.
- **Export playable World JSON** is `rep-wars-world.v1` with editor keys
  stripped. Optional fields (`theme`, `challenges`, `presentation`,
  `locations`, `composition`, `description`) are omitted when empty so older
  dumps stay unchanged.
- **Export visual composition JSON** is `rep-wars-visual-composition.v1`
  (same instance model as `world.composition`).

Schema mirrors `docs/WORLD_DEFINITION.md` and `src/worldDefinition/types.ts`.

Existing playable worlds (Level 1 / Level 2) open as committed geography. The
editor does not reinterpret those polygons back into a drawing. Re-authoring
uses a new vector graph; **COMMIT GEOGRAPHY** writes faces into the WorldDefinition.
