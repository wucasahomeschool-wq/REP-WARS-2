# Immutable regression fixture

These two files are byte-identical copies of the approved-engine simulation's small seed-11 week checkpoint:

- `docs/ai-longrun/results/one-week/small-11-online-10080/scenario.json`
- `docs/ai-longrun/results/one-week/small-11-online-10080/final-state.json.gz`

The fixture is a valid schema-27 canonical state with an idle rear army, an army-less surviving faction with local troops, and banked-Food starvation. It contains synthetic NPC/player data only. Keep these small files with the regression tests; the full generated simulation corpus is not a test dependency.

Tests load/hydrate the fixture through the real catalog and persistence adapters. They do not reconstruct its historical decisions from documentation.
