# REP WARS Map Assistant

Standalone **authoring** tool for `rep-wars-world.v1` JSON.

It is an editor, not a game engine and **not a world generator**. It does not
simulate battles, AI turns, economy, Fitness, rewards, or player progress.

The Map Builder is a **drawing canvas**. You draw one picture. You are not
constructing polygons, boundary objects, or a planar graph while drawing.

## Drawing

New maps start **blank** — no island, no territories, no default polygon.

Use the **Draw**, **Rectangle**, and **Eraser** tools on the **raw drawing**:

1. **Draw** — press and drag freehand (outline, then any dividing lines).
2. **Rectangle** — press one corner, drag, release. The rectangle is ink in the
   same raw drawing; it is not a territory by itself.
3. **Eraser** — press and drag to cut unwanted ink. This edits the drawing only,
   not the converted map.
4. Zoom and pan freely, then continue drawing.
5. Loose ends, overshoot, and crossings are allowed.
6. When the picture looks right, press **CONVERT TO MAP**.

CONVERT TO MAP treats **every stroke as one combined drawing** (freehand and
rectangles together). It rasterizes the ink, finds the main enclosed island, and
turns enclosed areas inside it into territories. Tiny accidental marks are
ignored as noise.

The structured **World editor** sidebar stays on the right: world metadata,
regions (including multi-select **MOVE TO REGION**), warlords/personality,
territory fields, diplomacy, contained worlds, and validation. Drawing tools
never write those fields; convert rebuilds geography from the raw drawing.

Raw drawing data stays separate from the converted map. Change the drawing and
convert again to rebuild geography from scratch.

**Export JSON** validates the **converted** `rep-wars-world.v1` world. Open
drawing strokes by themselves are not an export error. **Save** keeps the editor
document, including raw strokes, so work in progress can be resumed.

After conversion, use the structured editor for regions, ownership, AI warlords,
personality, resources, terrain, adjacency, and other metadata.

**Regions:** Ctrl+click / Shift+click to multi-select territories, then
**MOVE TO REGION** to assign them in one undoable operation.

## Launch

Requires a normal Python 3 install with Tkinter (included on Windows and most
desktop Pythons). No pip packages.

```text
python tools/map_assistant/map_assistant.py
python tools/map_assistant/map_assistant.py path/to/world.json
python tools/map_assistant/map_assistant.py --self-test
python tools/map_assistant/map_assistant.py --validate docs/examples/world-level1-tiny.json
python tools/map_assistant/map_assistant.py --gui-smoke
```

The `.py` file is copyable into another directory and still launches.

## What you author

- Irregular **island** polygon (the rectangular window is not the world)
- Irregular **territory** polygons (no hex grid)
- Named **regions**; unnamed territories (IDs only, e.g. `t_01`)
- Explicit **adjacency** (`neighborIds`, kept reciprocal in the editor)
- Explicit **starting ownership** (Level 1: exactly one player tile)
- Per-world **AI warlords** and personality trait values
- Contained-world **references** (not inlined playable tiles)

## Previous-level import

**Contained → Import Previous Level JSON** is a coarsening step, not CONVERT TO MAP.

1. Start a **blank** next-level world (set `level` on the World tab, or let import bump it).
2. Open **Contained**.
3. Choose a completed previous-level `rep-wars-world.v1` JSON file.
4. Preview the source name, level, region count, and coarsened outlines.
5. Confirm **Import & Convert**.

The previous world becomes **one region** in the current file. Each previous **region** becomes one current **territory** whose polygon is the union of that region's tiles. Adjacency is rebuilt from shared region boundaries. The source file is only referenced from `containedWorlds` (`worldId`, `regionId`, `placement`) and is never rewritten.

The previous playable graph is **not** copied into `territories[]`. Raw drawing conversion stays a separate workflow.

## What is not in the world file

- Territory display names
- Cities
- Scouting / fog / visibility
- EXPAND
- Capitals / `isCapital`
- Raw editor drawing strokes (`_editorDrawing`)

Export is refused until the converted world passes validation. Loading a
playable file that fails validation does not replace the current working world.
Editor documents that include `_editorDrawing` can be reopened even before
conversion produces a valid world.

Schema mirrors `docs/WORLD_DEFINITION.md` and `src/worldDefinition/types.ts`.
