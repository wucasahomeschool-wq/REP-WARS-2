# REP WARS Map Assistant

Standalone **authoring** tool for `rep-wars-world.v1` JSON.

It is an editor, not a game engine and **not a world generator**. It does not
simulate battles, AI turns, economy, Fitness, rewards, or player progress.

The Map Builder is a **drawing tool** plus a **geometry interpreter**. You do
not construct a mathematically perfect topology while drawing.

## Drawing

New maps start **blank** — no island, no territories, no default polygon.

Use the single **Draw** tool:

1. Press and drag to draw freehand strokes (island outline, then dividing lines).
2. Release anytime. Release stores the stroke; it does **not** close a polygon.
3. Zoom and pan freely, then continue drawing elsewhere.
4. Loose ends, slight overshoot, and crossings are allowed.
5. Snap-to-line is an optional visual convenience, not a validity requirement.
6. When the drawing looks right, press **CONVERT TO MAP**.

The converter interprets **all** raw strokes together: it finds the main island,
clips/extends internal lines, splits at intersections, and turns closed faces
into territories. Tiny loops, stray marks, and duplicate strokes are ignored.

Raw drawing data stays separate from the converted map, so you can inspect the
result, adjust strokes, and convert again.

**Export JSON** validates the **converted** `rep-wars-world.v1` world. Open
drawing strokes by themselves are not an export error. **Save** keeps the editor
document, including raw strokes, so work in progress can be resumed.

After conversion, use the existing structured editor for regions, ownership,
AI warlords, personality, resources, terrain, adjacency, and other metadata.

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
