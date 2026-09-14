# REP WARS Map Assistant

Standalone **authoring** tool for `rep-wars-world.v1` JSON.

It is an editor, not a game engine and **not a world generator**. It does not
simulate battles, AI turns, economy, Fitness, rewards, or player progress.

The Map Builder is a **drawing canvas**. You draw one picture. You are not
constructing polygons, boundary objects, or a planar graph while drawing.

## Drawing

New maps start **blank** — no island, no territories, no default polygon.

Use the **Draw** tool:

1. Press and drag to draw freehand (outline, then any dividing lines).
2. Release stores the stroke. It does not create a territory by itself.
3. Zoom and pan freely, then continue drawing.
4. Loose ends, overshoot, and crossings are allowed.
5. When the picture looks right, press **CONVERT TO MAP**.

CONVERT TO MAP treats **every stroke as one combined drawing**. It rasterizes
the ink, finds the main enclosed island, and turns enclosed areas inside it
into territories. Tiny accidental marks are ignored as noise.

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
