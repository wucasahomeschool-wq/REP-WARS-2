# World geometry validation continuation

Parent: `e1248f3e68776d57c32460df2fd005cf178de3ca` (completed bounded catch-up). Isolated branch: `fix/backend-world-geometry`. No authored world, Unity asset, save, schema, gameplay rule or reward configuration changes.

## Reproduced gaps

Before the change, three focused regressions failed:

1. Two territories could have identical interiors, including opposite polygon winding, without an overlap diagnostic.
2. All territory vertices could lie inside a concave island while an edge crossed outside it; vertex-only containment accepted that territory.
3. A legitimate shared border split into additional vertices on only one side was not recognized by whole-edge string matching.

These are validation defects, independent of the unresolved choice between backend and Unity Level 1 content. No automatic polygon repair or source selection is performed.

## Correction

`src/worldDefinition/geometry.ts` now measures collinear segment intersections for adjacency, partitions each candidate edge at boundary crossings/contacts for full-ring containment, and detects positive interior intersection between simple exteriors. Coincident edges count as overlap only when filled interiors lie on the same side; edge-only and point-only contact remain legal. Bounding boxes reject clearly separated territory pairs before edge inspection. Existing `WORLD_GEOM_EPS` tolerance remains in effect; this is finite-precision authoring validation, not exact rational geometry.

`validateWorldDefinition` applies containment and pairwise overlap only to independently valid simple polygons and emits deterministic sorted diagnostics. Non-finite area arithmetic is rejected. Input geometry is neither clipped nor mutated. Runtime GameState still stores territory identities rather than a second geometry authority.

The v1 restriction to one simple exterior remains. The validator does **not** demand that territories cover every island point: the existing tiny fixture intentionally leaves unused island area. Full playable-land tiling, holes/multiple islands and missing physical-neighbor inference need explicit authoring contracts; this phase does not invent them. Listed neighbors must still share a physical border and satisfy existing graph validation.

## Validation

- Three original regressions: **0 passed / 3 failed before**, **3 passed / 0 failed after**.
- Expanded focused suite: **16 passed / 0 failed**.
- Independent analytical checks within those tests: **2,500 seeded rectangle pairs** (seed `20261024`) compared with interval arithmetic; **1,296 rectangles** compared with a concave shape represented independently as a union of two rectangles. All match.
- Additional checks cover proper crossings, containment, coincident/reversed/closed/subdivided rings, narrow concave excursions, partial borders, rotation, stable diagnostic ordering, non-finite arithmetic and no input mutation.
- Registered Level 1, registered Level 2 and tiny fixture load and validate unchanged. Initial isolated load checks measured approximately 326 ms, 423 ms and 1 ms respectively; these are smoke measurements, not a benchmark or performance improvement claim.
- Separate synthetic rectangular-grid smoke: 10/30/50/100/500 territories all validate, with observed times 5/4/3/8/34 ms and no issues. This ran alongside the full suite; simple rectangles are not a bound for detailed irregular maps. The script and output are in `/tmp/repwars-geometry/grid-smoke.cjs` and `grid-smoke.log`.
- Alternating same-process comparison against the parent validator, five measured runs after warm-up: Level 1 median **66 → 238 ms**, Level 2 **80 → 346 ms**. The new checks cost more; no speed improvement is claimed. The suite was also running, so these are local smoke figures rather than production throughput. Existing polygons have 1,417 total territory vertices (Level 1) and 2,150 (Level 2). Authored world creation and immutable-definition rebinding during hydration are affected; simulation ticks do not run this validation.
- Production and test-inclusive TypeScript and production build: PASS, zero diagnostics.
- Full backend runner at this checkpoint was interrupted without a final summary, so no full-suite pass is claimed. See `BACKEND_VALIDATION_SCALE.md` for the subsequent combined rerun.
- `git diff --check`: PASS.

Validation is used when loading authored definitions, not once per world tick. Pairwise polygon inspection is intentionally bounded by input size rather than a new arbitrary world-size rule; very detailed/large untrusted authoring uploads still require ingress limits and performance evaluation. No editor upload endpoint was added.

Raw reproduction and test logs live outside the repository in `/tmp/repwars-geometry/`. This document preserves the relevant results; no cloud-local log is required to rerun the tests.
