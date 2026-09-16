# Test / fixture worlds

Authored **fixture** worlds used by the TypeScript test suite.

The canonical tiny world remains:

`docs/examples/world-level1-tiny.json` (`w_ember_atoll`)

That path is shared with Map Assistant `--validate`. Do not duplicate the
file. It is listed in `FIXTURE_WORLD_REGISTRATIONS`
(`src/worldDefinition/worldConfig.ts`), not in production registrations.

Production Level 1 is `worlds/level-1.json` (`"Level 1"`), not this fixture.

When adding more test-only worlds, put JSON here and register them in
`FIXTURE_WORLD_REGISTRATIONS` (or `WorldCatalog.registerFile` inside the
test). Do not add test worlds to `PRODUCTION_WORLD_REGISTRATIONS`.
