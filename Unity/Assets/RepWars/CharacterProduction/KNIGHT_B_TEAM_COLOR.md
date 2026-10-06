# Knight B selective team color — Phase 11

## Unified baseline and scope

Phase 11 starts on `work` at `47da66805f7644abb692351d5b1a1bb728cc5422`.
Both `origin/REP-WARS-3` and `origin/codex-character-production` were fetched and
verified at that exact commit before editing; the starting tree was clean.

Implemented in code/tooling: Knight B mask recipe, shared Editor schema/proof
generation, family-specific validation and focused EditMode tests. Source/configuration,
raster references and regression checks can run here. Unity compilation, native asset
generation, shader/render behavior, human visual approval and mobile profiling remain
deferred. No native mask PNG, material or proof prefab has been generated in cloud.

Runtime color API, shader and illustrated color math remain byte-identical. No source
art, skin recipe, bone, mesh, weight, socket, sorting, facing mapping or animation is
changed. Knight B animation, Knight A Run, army migration and LOD are excluded.

## Conservative explicit masks

`Editor/KnightBTeamColor.configuration.json` records exactly three authored views,
their source and skin-configuration SHA-256 values, and eleven explicit section
decisions per view. Only LowerTorso has a nonempty polygon in each view. The other
thirty decisions are empty; an empty mask never implies whole-sprite recoloring.

The original Knight B sheets were visually inspected. These provisional polygons
select small, clearly illustrated red hanging-cloth interiors. Selection is explicit
geometry, not an RGB key, global red-pixel search or source-alpha selection. It does
not establish a final faction palette or final mask coverage approval.

Coordinates are original PNG pixels, top-left origin, Y downward; they do not use
assembled rig positions. All polygons have two-pixel **inward** feathering; outside
coverage is exactly zero.

| View / source | Polygon | Padded section bounds / selected pixel centers |
|---|---|---|
| Front / `Disassembled Dark Knight Armor Set (1).png` (1254×1254) | (618,620), (647,631), (643,681), (630,704), (616,679) | (462,489,353,289) / 1,860 |
| Side / `ChatGPT Image Oct 3, 2026, 08_01_25 AM.png` (1024×1536) | (593,716), (610,729), (612,792), (605,812), (594,794) | (360,556,278,364) / 1,388 |
| Back / `ChatGPT Image Oct 3, 2026, 08_06_16 AM.png` (1024×1536) | (425,687), (441,690), (438,752), (425,789), (413,759), (416,718) | (359,551,288,351) / 1,903 |

The bounds/counts above are Python reference results, not generated Unity textures.
All source paths are under `assets/misc/Character Skin PNG pieces/` and remain read-only.

**TEAM-COLOR MASK DECISION — REQUIRES HUMAN VISUAL REVIEW:** wider hanging cloth,
cloth perimeter, neck scarf, shoulder/elbow/hip/knee undersuit accents, shadowed cloth
and any ambiguous trim. Metal plates, helmet, rivets, gloves, boots, belts, outlines
and deep inter-piece gaps are intentionally not designated. Remaining source red
artwork stays red until an approved mask revision; this partial proof does not promise
complete faction-color consistency across all visible accents.

## Shared architecture and Knight A compatibility

`HumanoidTeamColorConfiguration` holds the existing serializable polygon/view/section
DTOs, validation and `TeamColorMaskRasterizer`. Knight A/B facades specify their own
recipe path and skin loader. Existing DTO identities, serialized data fields, raster
coverage, Y conversion and source verification are preserved. Knight A's JSON is
unchanged, including its original three cloth polygons and all empty decisions.

`HumanoidTeamColorProofBuilder` contains the shared extraction, import, binding,
validation and save/reload pipeline. Thin family builders provide the corresponding
skin/facing proof and validator. It uses `HumanoidSkinGeometry` to recover actual
padded extraction bounds; each mask uses the same dimensions and UVs as its source
section sprite. Painting/generated replacements and new segmentation are unnecessary.

Both families reference **one** shared material at the original Knight A path:
`TeamColor/Generated/IllustratedTeamColor.mat`. Knight A masks keep their original
`TeamColor/Generated/KnightA_<View>_<Section>.mask.png` paths and provenance format.
Knight B masks use `TeamColor/KnightB/Generated/KnightB_<View>_<Section>.mask.png`.
There are three nonempty masks per family, never six-facing copies.

The generator reuses an existing valid shared material without modifying it. If
absent, it creates the shared asset through Editor APIs. Knight A may be generated
after Knight B even if that shared material already occupies Knight A's legacy
directory. Existing masks, unknown/partial outputs, malformed materials or proofs
fail clearly without overwrite. Rollback deletes only outputs newly owned by that
invocation; a reused material is never on the rollback list.

The Phase 10 Knight B **static facing proof** still rejects color by default. Its
validator now permits exactly one explicitly supplied root color component when
called by the separate Phase 11 proof validator. Animation remains rejected. The
Inspector routes proof validation by actual skin metadata, avoiding accidental
Knight A/B cross-validation. Renderer/skin family mismatches are actionable errors.

## Unchanged runtime rendering

One `SelectiveTeamColorPresentation` owns color and enabled state for all 33 bindings.
`SetTeamColor`, `DisableTeamColor` and `ApplyStoredColor` keep the existing behavior:
default disabled; invalid RGB preserves previous state; component disable restores
original mode; reenabling restores stored color. Sprite alpha is retained.

The shader replaces chroma only inside the designated red-channel mask while
preserving painted linear luminance. Highlights, shadows and illustrated texture
retain their value structure. Unmasked/disabled samples return original output
without a color-space round trip. There is no whole-character tint or hue-key fallback.

All renderers use the shared material and a reused MaterialPropertyBlock; unrelated
properties are retained. No runtime texture/material cloning, pixel loop, renderer
discovery loop or new per-frame allocation is introduced. Color is independent of
facing: all authored branches already hold the same stored color, and mirrored
directions reflect the whole rig and reuse the same mask/UV data.

## Isolated proof generation and review

In Unity, use `RepWars > Character Production > Create Knight B Team Color Proof`.
Intended output: `Proof/KnightB_TeamColorProof.prefab`. The tool validates the existing
Knight B six-direction proof, adds 33 explicit color bindings and three derived masks,
checks state persistence through all six facings, then saves/reloads the separate
proof in original-color mode. It requires the existing URP path and a shader without
reported compiler errors; it never changes packages/settings or uses a tint fallback.

Open the proof in Prefab Mode or an isolated scene. Existing Inspector buttons expose
original/no-color, strong technical red/blue/green samples and a custom color. Use
the facing Inspector to inspect all six directions, then alternate facing and color
changes. Review mask alignment, filtered edges, cloth value structure, outline/metal
exclusion, sorting and SpriteSkin/socket behavior at zoomed and gameplay scales.

Masks import as linear uncompressed RGBA32 grayscale, clamp/bilinear, no resizing or
mipmaps. Alpha is opaque and is not the recolor channel. Importer provenance retains
recipe/source/skin/view/section/padded-bounds hashes; exact mask pixels are validated
against deterministic rasterization. Generated PNGs must not be hand-painted.

## Tests, guards and deferred performance

`KnightBTeamColorTests` covers recipes/all 33 decisions, actual source decoding and
mask alignment for three views, source/provenance errors, separate family paths,
shared material identity, six-facing color persistence, empty masks, original mode,
stored-state reapplication and invalid colors. These tests require Unity execution.

`verify_knight_b_team_color.py` independently checks provenance, ownership, exact
padded bounds, deterministic scalar rasterization, no spill into transparent or
foreign section pixels, family binding paths and static rendering boundaries.
`TeamColor.phase10-regression.json` pins thirteen unchanged files and ten moved
schema/raster/import/provenance routines against Phase 10. Existing frozen Phase 8
Knight A guards and existing Knight A color/Idle/Walk tests are retained.

Knight B's three RGBA32 mask textures would total 1,217,188 bytes before readable
copies/import overhead. This is a reference estimate, not measured resident memory.
The known SpriteSkin + MaterialPropertyBlock CPU-deformation/SRP-batching concern
remains accepted and unoptimized. Different masks can split draw calls despite the
shared material. Shader compilation, SpriteSkin/material behavior, mask filtering,
human approval and mobile performance all remain deferred. The one-active-view
architecture remains compatible with later LOD; no LOD implementation is added.

Knight A's prior Idle/Walk ground-reference undershoot, knee amplitude and unverified
seams remain recorded risks; this phase does not tune or redesign those animations.
