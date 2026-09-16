# How to add a new authored Rep Wars world

The Python Map Assistant is an **editor**. It is not the game engine.

The exported JSON (`rep-wars-world.v1`) is the **authoritative** world. The
TypeScript runtime loads that file through `WorldCatalog`. It does **not**
generate geography, starting ownership, or AI personalities.

```
Map Assistant (edit / export / validate)
        ↓
rep-wars-world.v1 JSON file
        ↓
WorldCatalog.registerFile(path)   ← explicit; no directory scanning
        ↓
WorldCatalog.load(worldId)
        ↓
WorldValidator (fail closed)
        ↓
createGameStateFromWorld() / initializePlayerWorld()
        ↓
persist GameState identity (definitionWorldId / format / level)
```

## Steps

1. **Create or edit** the world in `tools/map_assistant/map_assistant.py`.
2. **Export** `rep-wars-world.v1` JSON.
3. **Validate** the file:
   `python tools/map_assistant/map_assistant.py --validate path/to/world.json`
4. **Place** the JSON in the repo (for example `worlds/level-1.json`).
   Do not put production worlds under `docs/examples/` or `tests/fixtures/`.
5. **Register** it in the single config file `src/worldDefinition/worldConfig.ts`:
   - Add `{ worldId, relativePath, role: 'production' }` to
     `PRODUCTION_WORLD_REGISTRATIONS`.
   - Set `DEFAULT_PRODUCTION_WORLD_ID` to that `worldId`.
6. **Start a new game** with `ensurePlayerWorld({ playerId, store })` for a
   persisted session, or `initializePlayerWorld({ playerId })` /
   `createGameState()` in memory. All three load `DEFAULT_PRODUCTION_WORLD_ID`.
   Pass `worldId` only to use a different **registered** world.
   **Returning players must reuse the same `playerId`.** Login must not mint a
   second game identity (`docs/PLAYER_IDENTITY.md`).

The catalog never auto-discovers JSON files. A world is available because
it was listed in `worldConfig.ts` or registered with
`WorldCatalog.register` / `registerFile` in tests.

If the configured ID is missing, the file is unreadable, JSON is malformed,
`formatVersion` is unsupported, or validation fails, startup **throws**.
There is no fallback to SAMPLE_MAP, the tiny Ember Atoll fixture, a
generated map, or an empty world.

## Fixture vs production

| Kind | Where | Purpose |
| --- | --- | --- |
| **Production** | `worlds/level-1.json` (`PRODUCTION_LEVEL_1_WORLD_ID` = `"Level 1"`) | Shipped Level 1 tutorial world. Listed in `PRODUCTION_WORLD_REGISTRATIONS`. |
| **Fixture** | `docs/examples/world-level1-tiny.json` (`FIXTURE_TINY_WORLD_ID`) | Ember Atoll six-tile tests. Listed in `FIXTURE_WORLD_REGISTRATIONS` only. |
| **Legacy** | `SAMPLE_MAP` / MapEngine | Isolated regression demos. Not WorldCatalog. |

`DEFAULT_PRODUCTION_WORLD_ID` is `"Level 1"`. Ember Atoll is not the conceptual or production Level 1 map.

Level 1 is a **scripted tutorial** world. It still boots through the same Orchestrator/engines as later worlds. Autonomous AI for tutorial-critical beats is a future vertical-slice controller (see `docs/PLAYER_AI_INTERACTION_ARCHITECTURE.md`). Level 2+ is where true autonomous AI is intended.

See also `docs/WORLD_DEFINITION.md`.
