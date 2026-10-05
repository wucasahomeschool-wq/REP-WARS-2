# Knight A Front — Phase 3 technical skin proof

Phase 4 preserves this Front recipe and its weights through thin compatibility entry points, while sharing the generator with independently calibrated Side/Back skins. See [KNIGHT_A_VIEWS.md](KNIGHT_A_VIEWS.md). Each proof still contains artwork for only its own view.

## Status and execution

The configuration, extraction, rig calibration, mesh/weight generation, validation, and Editor tests are implemented in code. Unity Editor has not executed this phase in Codex Cloud. No generated PNG, Sprite asset, or prefab is claimed to exist yet. No rendered SpriteSkin or visual deformation result is claimed.

Open the repository's `Unity/` project in Unity 6000.6.2f1 and run:

1. `RepWars > Character Production > Create Knight A Front Skin Proof`.
2. Select `Proof/KnightA_Front_SkinProof.prefab` and run `Validate Selected Knight A Front Skin`.
3. Run the `RepWars.CharacterProduction.Tests` EditMode assembly.
4. Inspect the neutral proof and manually pose bones for close and normal gameplay-scale review. Do not add animation clips during this milestone.

The generator does not require the separately saved foundation prefab: it constructs the same Master Humanoid contract through `MasterHumanoidRigBuilder.CreateRigObject`. It neither replaces nor alters an existing foundation prefab. Valid existing Front proof assets are left unchanged. An existing/stale proof or partial derived output blocks generation with an error; archive/remove it explicitly before regeneration. Failure cleanup deletes only paths absent at preflight and created by that invocation. The tool saves only its own assets, reloads each native Sprite after saving, and loads the saved prefab contents for structural validation; these execution paths still require Unity verification.

## Reviewed source and extraction

Only `assets/misc/Character Skin PNG pieces/ChatGPT Image Sep 30, 2026, 09_27_22 AM.png` is read. SHA-256 is `8cb218285545c667a1c5ce179de968c709a6d5398de68b54be507b042f0f52f1`; dimensions are 1024 × 1536. The source path resolves from the `Unity/` project's repository parent. A missing or changed source stops the tool. Hash verification happens before generation and again before the prefab is saved.

`Editor/KnightAFront.configuration.json` is the inspectable production recipe. Coordinates are source/assembly pixels measured from the top-left, with Y downward. Character anatomical Right is image-left in this unmirrored Front calibration; it is treated as the near side for the initial ordering.

Seeds select the eleven authored connected body islands. The upper/lower torso share a low-alpha connecting halo; the recipe partitions that halo at source Y=575 between their painted bodies. Each selected island retains its entire connected painted overlap, with eight additional padding pixels on every side, including beyond source image bounds. Faint disconnected edge pixels with alpha 0-2 inside those bounds retain their exact source RGBA. Neighboring painted islands are excluded, so overlapping extraction rectangles cannot introduce another body section. No painted plates, straps, hands, boots, cloth, or helmet details are separated into new sprites.

Unity generates eleven `KnightA_Front_<Section>.png` textures and eleven `KnightA_Front_<Section>.sprite.asset` native Sprite assets under `Skins/KnightA/Front/Generated/`. Derived textures use uncompressed RGBA, no mipmaps, no resizing, no alpha-RGB rewriting, and readable pixels for proof verification. The original PNG is never resaved. This is technical extraction of supplied pixels, not new source artwork.

## Calibration, meshes, and weights

The full 20-bone Master Humanoid names and hierarchy remain intact. Front-only positions are calibrated by the recipe; Side/Back retain empty foundation hierarchies. The ground anchor is assembly pixel (512, 1317), at 768 pixels per Unity unit. Both boot soles finish within two pixels of that ground boundary. `SkinMount` and section transforms have no root motion or gameplay logic.

Each Sprite stores the full canonical SpriteBone array and renderer-local inverse bind matrices; each SpriteSkin explicitly references that same Front transform array and Root. SpriteSkin automatic rebinding is disabled. The native skinning APIs are those in the project's Unity 2D Animation 16.0.1 package: `SetRootBone`, `SetBoneTransforms`, and Sprite bone/bind-pose/BlendWeight data APIs. No complex Unity YAML is hand-authored.

Meshes are regular padded grids with 28-99 vertices per body section, 630 vertices/932 triangles total. Alpha retains the illustrated silhouette. At most four positive influences apply to any vertex:

| Section | Main influences and initial behavior |
| --- | --- |
| HeadNeck | Helmet mainly Head; collar transitions toward Neck |
| UpperTorso | Chest dominates; limited Spine flex and small Clavicle/UpperArm response at shoulder edges |
| LowerTorso | Pelvis dominates belt/plates; small Spine response and limited paired Thigh influence in central cloth |
| Left/Right UpperArm | UpperArm dominates; small proximal Clavicle response and distal Forearm transition |
| Left/Right ForearmHand | Forearm dominates armor; small proximal UpperArm response; glove follows Hand across the wrist transition |
| Left/Right UpperLeg | Thigh dominates; small proximal Pelvis response; painted knee guard follows Shin at the distal end |
| Left/Right LowerLegFoot | Shin dominates lower armor; ankle transition moves toward Foot; boot follows Foot |

These are initial technical weights. They are not visually approved and must be reviewed at joints. They preserve rigid-looking regions without converting the sections into rigid paper-doll pivots.

## Front ordering

One SortingGroup on VisualRoot keeps the eleven parts together. Initial internal order, back to front:

| Order | Section |
| --- | --- |
| 0 | LeftLowerLegFoot |
| 10 | LeftUpperLeg |
| 20 | RightLowerLegFoot |
| 30 | RightUpperLeg |
| 40 | LeftForearmHand |
| 50 | LeftUpperArm |
| 60 | RightUpperArm |
| 70 | LowerTorso |
| 80 | UpperTorso |
| 90 | RightForearmHand |
| 100 | HeadNeck |

Torso paint masks shoulder and hip overlaps. Both arms retain their illustrated caps; no duplicate-looking plate is cut away. This is Front-only data, not the assumed ordering for future Side/Back views. Whole-visual mirroring remains possible beneath the stable outer root; no mirroring/direction logic is added.

## Validation and audit

`KnightAFrontSkinValidator` checks source/configuration provenance, all eleven identities and renderer references, canonical bone/parent/bind data, explicit SpriteSkin transform references, deterministic mesh positions/indices/weights, normalized permitted influences, placement, PPU, white source-preserving tint, derived texture pixels, Front sorting, stable ground, no Side/Back renderers, no animation components, and no production army components. It checks saved assets after generation and refuses stale outputs rather than overwriting them.

The read-only check `python Unity/Assets/RepWars/CharacterProduction/Validation/verify_knight_a_front.py` requires Python/Pillow. It verifies the actual sheet's connected-island selection, pixel coverage, hash, configuration identities, calibration completeness, sorting uniqueness, mesh budgets, and ground boundary. It does not execute C# or Unity.

Human review must check collar cohesion, shoulder and elbow overlap, hip masking, knee transitions, ankle/boot shape, silhouette, and near/far ordering. **POSSIBLE ART-OVERLAP ISSUE — REQUIRES HUMAN VISUAL REVIEW:** sleeve openings, under-shoulder regions, hip roots, knee cuffs, and ankle seams may expose gaps in posed deformation. No missing pixels have been painted or generated. Actual posing decides whether these concerns matter at map scale.

Native Sprite asset persistence/reloading, Unity compilation, EditMode tests, SpriteSkin culling/rendering, shader behavior, deformation quality, and all seam/sorting judgments require Unity Editor execution. Production map integration, team colors, equipment, Side/Back art, and animations remain outside this proof.
