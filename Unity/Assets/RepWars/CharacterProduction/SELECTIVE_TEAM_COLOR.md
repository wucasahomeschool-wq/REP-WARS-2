# Phase 6 — selective illustrated team color

Status: implemented in code/tooling; Unity execution and human visual approval are deferred.
No generated masks, material, or proof prefab are checked in by this cloud implementation.

## Rendering audit

The project uses Unity 6000.6.2f1, URP 17.6.0 and 2D Animation 16.0.1.
`ProjectSettings/GraphicsSettings.asset` has no global pipeline, but **all six quality levels** in
`ProjectSettings/QualitySettings.asset` select `Assets/Settings/UniversalRP.asset` (GUID
`681886c5eb7344803b6206f758bf0b1c`). Its default renderer is
`Assets/Settings/Renderer2D.asset` (GUID `424799608f7334c24bf367e4bbfa7f9a`).
Current quality is 5; Android/iPhone default to quality 2, also using that pipeline.
`RepWarsMapScreen.cs` already requests URP's `2D/Sprite-Unlit-Default` shared material.
Renderer2D also records its default lit/unlit materials (`m_DefaultMaterialType: 0`);
the new isolated proof explicitly selects unlit painted-art rendering, matching that map material path,
rather than inheriting an implicit SpriteRenderer default. Matching rendered lighting is a visual-review item.
There were no authored material/shader files or property-block infrastructure to reuse in CharacterProduction.
No project settings, packages, or map files were changed.

The new shader's vertex path follows Unity Graphics' URP **17.6.0** source:
`Packages/com.unity.render-pipelines.universal/Shaders/2D/Sprite-Unlit-Default.shader`
(the upstream master package manifest identified version 17.6.0 when inspected).
It uses the installed package's `Core2D.hlsl`, `2DCommon.hlsl`, common vertex/fragment routines,
sprite instance properties, instancing and `SKINNED_SPRITE` inputs/computation.
It retains transparent unlit blending, adds one explicit mask sample, and uses one Universal2D pass.
It introduces no parallel renderer or package dependency. Compilation must be checked in Unity.

## Runtime contract

`SelectiveTeamColorPresentation` is placed on the existing isolated proof's outer root.
`SetTeamColor(Color)` receives an **sRGB** technical presentation color with finite RGB in [0,1].
Alpha is ignored. Invalid input preserves the last valid state.
`DisableTeamColor()` restores original authored output without resetting the facing.
The serialized default is disabled. Disabling the component also restores original mode;
reenabling reapplies its stored state. `ApplyStoredColor()` supports explicit editor reapplication.

One component owns color/enabled state and 33 bindings: eleven sections for each of three authored views.
All bindings share one material. The component writes `_TeamColor`, `_TeamColorEnabled` and
`_TeamColorMask` through a reused MaterialPropertyBlock, preserving unrelated block properties.
No Update loop, texture processing, material instantiation, gameplay query, persistence, or owner decision occurs.
The existing facing component remains unchanged: active-view selection and VisualRoot mirroring need
no recolor callback because inactive renderers already hold the same color state.
There are no per-facing masks. Sockets, bones, calibration, sorting, mesh and weights remain unchanged.

Null masks are intentional **empty** section decisions. They use the shared black texture and enabled=0.
Missing/misaligned mask references or swapped sprites fail closed to original output on reapplication,
and validation reports malformed bindings. There is no whole-sprite tint fallback.
The proof pipeline is static after construction: later external sprite/material changes must trigger explicit
revalidation/reapplication; this component does not poll for unrelated modifications every frame.

## Illustrated recolor algorithm

For a sampled original pixel, `amount = saturate(mask.r * enabled)`.
Zero amount returns the original output directly, including alpha (no color-space round trip).
For nonzero amount, work in linear RGB. Let luminance coefficients be (0.2126, 0.7152, 0.0722),
original luminance be L and team luminance be T. Compute

```
a = min(L / max(T, 0.00001), (1-L) / max(1-T, 0.00001))
target = L + (teamRGB - T) * a
result = lerp(originalRGB, target, amount)
```

This replaces chroma while retaining painted luminance and staying in gamut. Bright highlights
naturally become less saturated; shadows, folds and texture retain their value variation.
Original alpha is returned unchanged. Gamma projects convert the sampled color to linear and back;
the runtime always supplies a manually linearized vector, avoiding implicit Color-property conversions.
Neutral black/white sample inputs desaturate while retaining painted luminance; this is a hue/chroma
system, not a brightness override. Existing outlines/metal/leather are excluded by the mask decisions.
`IllustratedTeamColorMath` is a CPU test reference only; no runtime pixel loop calls it.
Rendering-debug variants return URP's debug output without recolor interference.

## Explicit mask data and preparation

`Editor/KnightATeamColor.configuration.json` records character identity, version, exactly three
authored views, source SHA256, unchanged skin-calibration SHA256 and all eleven section decisions.
Each decision has zero or more simple polygons plus a review note. Polygon points use **original
PNG top-left, Y-down pixel coordinates**, not assembled rig coordinates.
Polygon interiors designate pixels regardless of source RGB or alpha. There is no global color key,
source-alpha mask, naive color replacement, or automatic red/blue selection.
Optional feathering is measured inward from the polygon boundary; outside coverage is exactly zero.
Coverage unions use max(), so overlapping polygons do not amplify recolor.

Current provisional regions are deliberately conservative clear hanging-cloth interiors only:

| View / section | Source-coordinate polygon | Inward feather |
| --- | --- | --- |
| Front / LowerTorso | (531,660), (571,660), (568,774), (550,785), (531,770) | 2 px |
| Side / LowerTorso | (575,713), (603,718), (607,844), (593,858), (577,844) | 2 px |
| Back / LowerTorso | (502,686), (529,700), (540,818), (518,842), (503,828) | 2 px |

All remaining thirty section decisions are empty. Cloth perimeter, gold trim, belts, underlying dark
cloth, neck cloth and accent/undersuit regions are **TEAM-COLOR MASK DECISION — REQUIRES HUMAN
VISUAL REVIEW**. These are partial technical proof masks, not final team-color coverage approval.
Unselected Front blue / Side-Back red artwork intentionally remains as authored.
Changing or extending polygons requires reviewed data changes, not rewriting runtime code or painting
generated PNGs. Source art, subdivision, hidden overlap, bones, meshes and weights are not changed.

## Deterministic Editor construction

Run `RepWars > Character Production > Create Knight A Team Color Proof` in the local Unity Editor.
The generator:

1. Validates all source/skin/recipe hashes, three views, eleven decisions, polygon bounds and geometry.
2. Requires the active URP pipeline and the team-color shader without reported compiler errors.
3. Uses the existing six-direction proof builder without modifying its authored skin or facing outputs.
4. Loads that proof into an isolated temporary prefab-content scene.
5. Reuses the unchanged skin extraction routine to recover each section's exact padded source bounds.
6. Rasterizes nonempty polygons at pixel centers into section-sized masks, reversing Y for Unity pixels.
7. Imports masks as linear, uncompressed RGBA32 grayscale, no mips/resize, clamp/bilinear. Alpha is
   opaque everywhere and **not** the recolor channel. The red channel contains scalar coverage.
8. Records recipe/source/skin/view/section/bounds provenance in TextureImporter.userData.
9. Creates one shared material; binds masks to existing renderer/sprite pairs and empty masks to null.
10. Checks structure, exact mask bytes, alignment, import/provenance and retained color across six facings.
11. Saves/reloads a separate team-color proof in disabled/original mode, initially FrontLeft.

Expected generated paths (not generated in cloud):

```
Assets/RepWars/CharacterProduction/TeamColor/Generated/IllustratedTeamColor.mat
Assets/RepWars/CharacterProduction/TeamColor/Generated/KnightA_Front_LowerTorso.mask.png
Assets/RepWars/CharacterProduction/TeamColor/Generated/KnightA_Side_LowerTorso.mask.png
Assets/RepWars/CharacterProduction/TeamColor/Generated/KnightA_Back_LowerTorso.mask.png
Assets/RepWars/CharacterProduction/Proof/KnightA_TeamColorProof.prefab
```

Valid existing outputs are validated and left untouched. Stale/partial outputs fail clearly instead of
silently overwriting. After an approved recipe revision, explicitly archive/remove only the team-color
generated directory and team-color proof and rerun. Base skins and six-direction proof need no rebuild
unless their own independently reviewed recipes changed. Failed generation rolls back only newly owned outputs.

## Proof and validation

Open the generated proof in Prefab Mode or an isolated scene. The team-color Inspector offers original
mode, editable technical color and red/blue/green samples; those values define no faction palette.
Use the unchanged facing Inspector for all six directions. Test color changes while facing stays fixed,
then facing changes while color stays fixed, including mirrored pairs. Inspector Undo reapplies block state.

Runtime validation checks identities, duplicate/foreign renderers, sprite/mask dimensions, full-rect UV
contract, shared shader/material, white renderer colors, and absence of per-sprite flips.
Editor validation additionally reuses all skin/facing checks (including canonical rig and no army/animation),
verifies correct view-local renderer references, exact extraction bounds, provenance/import settings,
deterministic mask pixels and no unexpected recolor in explicitly empty sections.
Static Python verification checks current source blobs, configuration/alignment, non-spilling polygons,
deterministic reference rasterization and luminance/gamut mathematics; it does not run Unity/C#.
EditMode NUnit tests cover state, all six facings, disabled/invalid/missing-mask behavior, shared materials,
unrelated property-block retention, reference color math, recipe integrity and raster Y alignment.

## Mobile limits and later verification

Three masks only, not 33 nonempty masks or six directional copies. Full section bounds are preserved
for exact UV alignment. Current RGBA32 mask memory is approximately 1.1 MiB combined (plus readable CPU
copies for Editor checks); R8/compressed/channel-packed optimizations are deferred until measured.
Only eleven section renderers are active at once. One additional texture sample and one transparent pass
per section; no full-screen effect. The installed 2D Animation package's `Documentation~/GPUDeformation.md`
states that MaterialPropertyBlocks are incompatible with the SRP Batcher and cause SpriteSkin to fall back
to **CPU mesh deformation**. This architecture accepts that standard fallback; it does not promise GPU
skinning. Pixel recoloring still runs entirely on the GPU, not through CPU pixel processing. Different mask
textures can split draws: **shared materials do not prove batching**. Measure mobile CPU skinning/draw costs
before army migration; a future GPU-skinning optimization would need a different supported parameter path.
Native standalone sprites are currently not atlased. Validation rejects packed/partial-rect sprites;
future atlas support needs paired mask UV/packing metadata, not duplicate facing masks.

Unity must still verify shader compilation, actual SpriteSkin CPU fallback with MPBs, prefab/mask/material
generation/reload, disabled output matching the original unlit path, mirrored UVs, mask edge filtering,
sorting, sockets and mobile draw cost. Human review must approve final regions, painted-value retention,
cross-view consistency and normal-map-scale appearance. Unit tests do not prove these outcomes.

No animation, Knight B, equipment, source repaint, production army migration or gameplay authority was added.
