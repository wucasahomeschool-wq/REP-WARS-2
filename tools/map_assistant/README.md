# REP WARS Map Assistant

Standalone **authoring** tool for `rep-wars-world.v1` JSON.

It is an editor, not a game engine and **not a world generator**. It does not
simulate battles, AI turns, economy, Fitness, rewards, or player progress.
It does not invent islands, territories, or personalities.

The exported file is the product. Runtime (`src/worldDefinition`) loads that
JSON; this tool never imports TypeScript or npm packages.

## Launch

Requires a normal Python 3 install with Tkinter (included on Windows and most
desktop Pythons). No pip packages.

```text
python tools/map_assistant/map_assistant.py
python tools/map_assistant/map_assistant.py path/to/world.json
python tools/map_assistant/map_assistant.py --self-test
python tools/map_assistant/map_assistant.py --validate docs/examples/world-level1-tiny.json
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

Save/Export is refused until validation passes. Loading an invalid file does
not replace the current working world.

Schema mirrors `docs/WORLD_DEFINITION.md` and `src/worldDefinition/types.ts`.
