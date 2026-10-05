# Knight A authored skins — Phase 4

## Evidence and execution status

**IMPLEMENTED IN CODE/TOOLING:** one extraction/mesh/binding/proof pipeline, three independent view definitions, structural validation, and Editor tests.

**STATICALLY VERIFIED:** source hashes/pixel coverage, eleven major sections per view, twenty canonical bone calibrations per view, mesh budgets, weight normalization, sorting completeness, metadata, and scope.

**REQUIRES UNITY EXECUTION:** C# compilation, native Sprite persistence, proof generation/reload, EditMode tests, SpriteSkin readiness, shaders, culling, and rendering.

**REQUIRES HUMAN VISUAL REVIEW:** posed seams, armor stability, ordering, directional readability, silhouette, and gameplay-scale cohesion. No prefabs or derived textures have been generated in Codex.

## Shared pipeline and Front compatibility

- `Editor/KnightASkinConfiguration.cs`: three locked source paths, per-view recipes and provenance.
- `Editor/KnightASkinGeometry.cs`: shared source-pixel extraction and mesh generation. Front retains its accepted analytic weights; Side/Back use explicit per-section transition data.
- `Editor/KnightASkinBuilder.cs`: one generator parameterized by authored view.
- `Editor/KnightASkinValidator.cs`: the same structural checks for every view.
- `Runtime/KnightASkin.cs`: serialized view identity, rig/binding references, and source/configuration hashes; no animation or gameplay behavior.

The existing Front menus and APIs remain thin compatibility entry points. The original Front configuration, positions, grid budgets, sorting, and analytic weight formulas are unchanged. `KnightAFrontSkin` retains its script GUID and now derives from the shared reference component. The Master Humanoid contract is unchanged.

Each proof contains the canonical Front/Side/Back foundation branches, but only its own authored branch has artwork and is active. Other branches remain empty. There is no runtime direction switching. Separate proof prefabs keep validation and regeneration independent; no combined asset is required.

## Source provenance and segmentation

Both new sources are 1024 x 1536 RGBA, read directly from the repository outside Unity's Assets directory:

| View | Read-only source under assets/misc/Character Skin PNG pieces/ | SHA-256 |
| --- | --- | --- |
| Side | ChatGPT Image Sep 30, 2026, 09_27_29 AM.png | ef91959c6aeb3d631b0b53d5091285e6482fe0ce23dad80e2aa68906bfda79c7 |
| Back | Disassembled Knight Armor Sprite Sheet (1).png | 6bdcf79a6bbb3e8b25b204fbf43576ec727ffd45c9c574f1e32ffa5835bcf46a |

Each view has HeadNeck, UpperTorso, LowerTorso, paired UpperArm, ForearmHand, UpperLeg, and LowerLegFoot sections. No boots, hands, shoulder plates, straps, belts, cloth, or helmet ornaments are further subdivided.

Side has eleven separate connected islands. Back has faint connecting fringes around the head/torso/waist and image-left thigh/lower leg. Back uses alpha greater than 16 only to identify eleven distinct painted core islands, then grows all cores together through connected alpha-greater-than-zero fringe. Original pixels and alpha are retained, including the fringe; this is an ownership calculation, not alpha clipping. No horizontal cut is used because head and torso paint occupy overlapping source rows. Core paint cannot migrate between sections.

Shared extraction keeps each island's original RGBA and painted hidden extensions, with eight-pixel padding. Disconnected alpha-0/1/2 fringe within section bounds is retained. Neighboring painted islands are excluded. The read-only verifier confirms no source pixel with alpha greater than one is lost. Original PNGs are never resaved; no pixels are invented.

## Calibration and origin

All three recipes retain the exact twenty-bone Master Humanoid topology and socket semantics. Calibration uses top-left pixel coordinates (Y downward), converted to rig space at 768 pixels/unit:

| View | Ground pixel / Root calibration | Mesh vertices | Triangles |
| --- | --- | --- | --- |
| Front | (512, 1317) | 630 | 932 |
| Side | (512, 1352) | 609 | 888 |
| Back | (512, 1310) | 661 | 986 |

Every ground maps to the same conceptual visual origin (0,0). Section offsets independently align feet and joints. Sole boundaries are within two pixels of each configured ground. Source widths, projected lengths, collar position, shoulder locations, hips, knees, and ankles are calibrated per view rather than copied from Front. Bind rotations are currently neutral; later technical refinement may adjust them without changing topology.

For the unmirrored Side recipe, anatomical Right uses the image-left limb artwork and is near; anatomical Left uses image-right and is far. The torso/helmet face image-right. For Back, anatomical Right uses image-right limb artwork and is near; Left uses image-left and is far. These are initial calibration conventions to review visually, not gameplay facing logic.

## Deformation

All eleven renderers receive SpriteSkin, canonical SpriteBone arrays, renderer-local inverse bind matrices, and explicit Front/Side/Back transform arrays. There is no rigid-pivot-only alternative.

Side/Back section recipes specify a dominant bone and one to three smooth transitions in source-pixel coordinates. Optional X gates restrict torso shoulder response. Transitions successively redistribute existing weight, keeping weights normalized and using at most four influences.

- Head dominates helmet; Neck receives collar transition.
- Chest dominates upper torso; Spine flex is modest and Clavicle response limited at shoulder edges.
- Pelvis dominates waist armor; cloth receives small paired Thigh influence.
- UpperArm dominates sleeves; Clavicle contributes modestly near shoulder and Forearm near elbow.
- Forearm dominates bracer; Hand controls the painted glove through a wrist transition.
- Thigh dominates upper leg; proximal Pelvis response is small, and distal knee guard transitions toward Shin.
- Shin dominates lower leg; Foot takes over through the authored ankle/boot region.

Side has narrower section grids and foreshortened calibration. Back uses its own joint bands and wider waist/boot grids. These weights are provisional and not visually approved. Painted armor is preserved, not simplified or repainted.

## View-specific sorting

One SortingGroup on VisualRoot keeps internal parts together. Recipes use unique ascending order values (back to front):

| View | Section order |
| --- | --- |
| Front | LeftLowerLegFoot, LeftUpperLeg, RightLowerLegFoot, RightUpperLeg, LeftForearmHand, LeftUpperArm, RightUpperArm, LowerTorso, UpperTorso, RightForearmHand, HeadNeck |
| Side | LeftLowerLegFoot, LeftUpperLeg, LeftForearmHand, LeftUpperArm, RightLowerLegFoot, RightUpperLeg, RightUpperArm, UpperTorso, LowerTorso, RightForearmHand, HeadNeck |
| Back | LeftUpperLeg, LeftForearmHand, LeftUpperArm, LeftLowerLegFoot, RightUpperLeg, RightLowerLegFoot, RightForearmHand, HeadNeck, RightUpperArm, UpperTorso, LowerTorso |

Side torso masks both shoulder overlaps; near forearm remains in front. Back torso/waist mask rear shoulder and hip overlaps, with the collar below the upper torso. These orders require visual inspection when posed; they are not universal across views.

## Editor execution

Open Unity 6000.6.2f1 with the project's existing Unity 2D Animation 16.0.1 package.

1. Run `RepWars > Character Production > Validate All Knight A Definitions`.
2. Run the existing `Create Knight A Front Skin Proof`, plus `Create Knight A Side Skin Proof` and `Create Knight A Back Skin Proof`.
3. Select each proof root and run `Validate Selected Knight A Skin`.
4. Run the CharacterProduction EditMode tests.
5. Manually pose joints, then restore the neutral bind pose before running the neutral structural validator. Do not add animation clips.

Outputs are limited to `Skins/KnightA/<View>/Generated/KnightA_<View>_<Section>.png`, matching `.sprite.asset` files, and `Proof/KnightA_<View>_SkinProof.prefab`. The tool saves/reloads its own assets only. Valid existing outputs remain unchanged; stale or partial output requires explicit archive/removal before regeneration. It does not overwrite an existing foundation proof or another view.

Read-only cloud check:

`PYTHONDONTWRITEBYTECODE=1 python Unity/Assets/RepWars/CharacterProduction/Validation/verify_knight_a_skins.py`

The Front-only verifier remains available. Python checks do not compile C# or execute Unity.

## Human-review issues and exclusions

The supplied Back helmet shows a side-facing visor while the torso reads rear-oblique; preserve this artwork and review facing coherence later. Front cloth is blue, while Side and Back cloth is red. Side has a much narrower profile and overlapping painted shoulder caps. Back waist plate/tabard proportions and leg/boot projections differ from Side/Front. No cloth colors, helmet designs, proportions, lighting, or painted details are normalized.

**POSSIBLE ART-OVERLAP ISSUE — REQUIRES HUMAN VISUAL REVIEW:** collar/shoulder layering, sleeve openings, elbows, waist/hip roots, knee cuffs, and ankle seams may expose gaps in posed deformation. Only actual visual testing determines whether an issue matters at map scale.

Whole-visual mirroring remains possible beneath the stable outer root. Individual renderer flips are forbidden. No mirroring, direction switching, animation, gait phase, team colors, equipment, Knight B integration, experimental dependency, production army migration, or gameplay authority is implemented.
