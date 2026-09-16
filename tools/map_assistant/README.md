# REP WARS Map Assistant

Standalone **authoring** tool for `rep-wars-world.v1` JSON.

It is an editor, not a game engine and **not a world generator**. It does not
simulate battles, AI turns, economy, Fitness, rewards, or player progress.

The Map Builder is a **drawing canvas**. You draw enclosed land. You are not
constructing polygons, boundary objects, or a planar graph while drawing.

## Drawing

New maps start **blank** — no island, no territories, no default polygon.

Use the **Draw**, **Rectangle**, **Eraser**, **Select**, **Pan**, and **SCALE**
tools on the canvas:

1. **Draw** — press and drag freehand (outline, then any dividing lines).
2. **Rectangle** — press one corner, drag, release. The rectangle is ink in the
   same raw drawing; it is not a territory by itself.
3. **Eraser** — pending ink only. Committed source strokes are locked. Erasing
   them does **not** change the converted map.
4. **SCALE** — uniformly resize the whole authored map around its bounds center.
   Converted geometry, committed source strokes, and pending strokes use the
   **same** transform and stay in their buckets. This is not zoom.
5. Zoom and pan freely, then continue drawing.
6. Loose ends, overshoot, and crossings are allowed.
7. When the picture looks right, press **CONVERT TO MAP**.

### CONVERT TO MAP is a permanent commit

The first successful conversion locks the island, territories, IDs, adjacency,
and world structure. Later drawing is **pending**. The next CONVERT interprets
**only pending strokes** and appends new territories. It never re-rasterizes,
merges, splits, or resizes already-committed geometry.

Typical additive workflow: draw land → CONVERT → draw more enclosed land around
it → CONVERT again. Repeat as needed. Pressing CONVERT with nothing pending is a
no-op (it will not duplicate territories).

A failed pending conversion leaves the committed map and the pending strokes
unchanged so you can edit and retry.

Raw drawing is **not** an editor for committed map geometry. After convert,
switch to the structured **World editor** sidebar to change regions, ownership,
resources, terrain, and other metadata.

In RAW view, committed source ink is shown dimmer/dashed and is not erasable.
Pending ink stays bright cyan.

Older editor documents that already contain a converted map plus
`_editorDrawing.strokes` (no `committedStrokes` field) treat that converted
geometry as committed and migrate existing strokes into committed source so a
later CONVERT cannot duplicate the map.

### Island extension

New land may grow the committed island. The converter keeps the existing island
when new territories already sit inside it. Otherwise it tries a shared-edge
union with the pending island / new territory rings when the rings are small
enough for exact shared-edge union. If that cannot attach safely, it uses a
convex hull of committed island vertices plus new territory vertices
(append-only; may fill concavities; never shrinks). A 0.2% hull expand is
applied only if float error would leave a committed vertex just outside.
Incomplete pending drawing never clips the committed island.

Typical next-level authoring: open Level 1 → SCALE larger → draw **new** enclosed
territories → CONVERT TO MAP to append. Erasing old source ink will not rebuild
or delete the locked Level 1 tiles. Use the structured editor (or Clear all map
geometry) for committed edits.

The structured **World editor** sidebar stays on the right: world metadata,
regions (including multi-select **MOVE TO REGION**), warlords/personality,
territory fields, diplomacy, contained worlds, and validation. Drawing tools
never rewrite committed geography.

## Scale tool

**SCALE** is an authoring transform. It does not change zoom, gameplay, or
WorldDefinition semantics other than coordinates.

- Factor `2` doubles size; `0.5` halves it; `1` leaves geometry unchanged.
- Allowed range is **0.05–20**.
- Anchor is the center of the current map bounds (converted island/territories
  plus raw strokes). X and Y use the same factor.
- If both raw drawing and converted geometry exist, **both** are scaled with
  that same transform so RAW view and MAP view stay aligned. Committed source
  strokes stay committed; pending strokes stay pending.
- Raw-only documents scale strokes only. Converted-only documents scale
  polygons only and do not invent strokes.
- One undo restores raw drawing and converted geometry together.
- `_editorConvertReport` is cleared so CONVERT TO MAP runs against current
  pending drawing instead of a stale report.
- `containedWorlds[].placement` is **not** scaled. Nested-world origin/scale
  stay sidebar metadata; coarsened tiles that already live in `territories[]`
  do scale because they are current-map geometry.

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
- Raw editor drawing strokes (`_editorDrawing`, including `committedStrokes`
  and pending `strokes`)

Export is refused until the converted world passes validation. Loading a
playable file that fails validation does not replace the current working world.
Editor documents that include `_editorDrawing` can be reopened even before
conversion produces a valid world.

Schema mirrors `docs/WORLD_DEFINITION.md` and `src/worldDefinition/types.ts`.
