# Knight B authored production skins — Phase 9

Phase 8 checkpoint: `7560d1e84b827f298c0e36f12d88b03f1633e727` (`Add Knight A walk animation`) on the existing `work` branch.

**IMPLEMENTED IN CODE/TOOLING:** three Knight B skin recipes and native Editor construction/validation entry points.
**STATICALLY VERIFIED:** source/configuration identities, ownership/retention reference, calibrated canonical names, normalized multi-bone recipes, mesh totals, sorting/ground definitions and Knight A baseline guards.
**REQUIRES UNITY EXECUTION:** C# type compilation, native Sprite/texture/prefab generation and EditMode tests.
**REQUIRES HUMAN VISUAL REVIEW:** neutral assembly, skin weighting/deformation, joint seams, ordering, sockets and direction readability at normal map scale.
**REQUIRES MOBILE PERFORMANCE VALIDATION:** SpriteSkin/material cost and representative entity counts.

No generated Knight B texture, native Sprite or prefab is committed or claimed to exist. No Knight B facing runtime, team-color mask, animation, equipment or army integration is implemented. Knight A Idle/Walk and their accepted risks are unchanged. No Run exists.

## Shared pipeline and compatibility boundary

`Editor/HumanoidSkinConfiguration.cs` holds common serializable fields and structural checks. Knight A/B subclasses supply only family identity, configuration/source paths, expected dimensions and the legacy-weight policy. `HumanoidSkinGeometry`, `HumanoidSkinBuilder` and `HumanoidSkinValidator` own the shared extraction, geometry/weights, native SpriteSkin construction and generated-reference checks. `KnightBSkinBuilder` is only a menu/factory facade.

Knight A's configuration JSON, runtime animation/facing/color code, material/shader and source pixels are byte-identical to Phase 8. Existing Knight A Builder/Geometry/Validator APIs delegate to shared helpers; `KnightAFrontSkin` identity is preserved. `Runtime/KnightASkin.cs` retains its serialized fields and Configure method, adding only the `IHumanoidSkin` metadata contract. `KnightBSkin` implements that small contract independently; it does not inherit Knight A presentation behavior. Historical `KnightASkin*` plain record names remain in the shared pipeline to preserve public API/serialization compatibility. They contain no character behavior. They are not experimental Phase A dependencies.

All new Knight B views use data-driven weight bands, including Front. Only accepted Knight A Front retains the exact legacy FrontWeights method. The new optional `secondarySeeds` field is absent from every Knight A recipe; its branch is a no-op for Knight A. Shared algorithms are guarded against the Phase 8 baseline in `Validation/KnightA.phase8-regression.json` and `verify_knight_a_regression.py`. This protects 26 file/source hashes and 14 method-body hashes after narrowly normalizing equivalent family/path parameterization.

## Source provenance and extraction

All coordinates below use source-space pixels with origin at top left, X right, Y down. All source PNGs remain read-only. Source sheets are authored body sections, not references for replacement art. The only derived art will be exact RGBA extraction through Unity Editor, never repainting or normalization.

- **Front:** `assets/misc/Character Skin PNG pieces/Disassembled Dark Knight Armor Set (1).png` — RGBA **1254×1254**, SHA-256 `bb11b29fcd7d5da1238e69a3e35f7ffb8208b80cc71f1ac300a95f5838170466`.
- **Side:** `assets/misc/Character Skin PNG pieces/ChatGPT Image Oct 3, 2026, 08_01_25 AM.png` — RGBA **1024×1536**, SHA-256 `7b6b48290af8c18424503659e4e7d436551be7b0cee3f08dad1934c26b83084e`.
- **Back:** `assets/misc/Character Skin PNG pieces/ChatGPT Image Oct 3, 2026, 08_06_16 AM.png` — RGBA **1024×1536**, SHA-256 `5a2ce9487d1df375ded6472c21b367664274e8a527efa989bde427c5104d7b03`.

Core-island seeds use alpha >32 to separate faint connected bridges, then expand through existing alpha >0 fringe. No pixel color is used for selection. Front additionally records **48 explicit disconnected-fringe seeds** (source alpha 3–6); these rejoin original ornamental fringe to its inspected section. They do not create extra sprites. Side/Back need none. All source alpha >2 pixels are retained exactly in one section. Alpha 0–2 disconnected background/edge pixels within a section's existing bound/padding follow the unchanged Knight A retention policy. Faint background outside those bounds is not treated as anatomy. Edge RGB and alpha values are preserved, including Side/Back's authored alpha maximum 254.

Each extraction gets an 8-pixel gutter outside its full selected bounds, including negative source Y for top-edge padding. No hidden overlap is trimmed. Section offsets position those exact pixels; they do not scale individual sections or change painted proportions. Derived imports are RGBA, uncompressed, no mipmaps/NPOT resizing, readable for native validation, alphaIsTransparency=false to prevent edge RGB rewriting. The source path/hash and recipe hash are recorded on skin metadata.

## Anatomical identity

The original islands have no embedded anatomical labels; these are explicit production assembly conventions, not an inference from file ordering alone:

- **Front:** screen-left source limbs = anatomical **Right**, screen-right = **Left**. Right is the foreground/near chain.
- **Side:** camera on the character's **Right flank**; screen-left source column = near **Right**, screen-right = far **Left**. The helmet/boot toes visually point image-right; source column does not define facing.
- **Back:** screen-left source limbs = anatomical **Left**, screen-right = **Right**. Right is the foreground/near chain.

MainHand remains RightHand, OffHand remains LeftHand. Future mirroring must mirror the whole visual hierarchy without renaming or swapping anatomical chains. Knight B facing has not been wired: the Side source's image-right reading must be checked when later assigning canonical facing semantics, rather than copied from Knight A's unmirrored-side assumption. No corrective art or sprite flip is added here.

## Section recipes

All three views preserve the same eleven illustrated section identities. Hands/boots/shoulders/knee plates/straps/cloth details stay painted into those large sections. No mesh-only control requires a new visible art piece. Seeds and offsets are independently calibrated from each Knight B source; influence bands remain provisional until native visual review.

### Front

| Section | Source seed (x,y) | Placement offset (x,y) | Draw order | Grid | Dominant bone → allowed transitions |
|---|---|---|---:|---|---|
| HeadNeck | 620,110 | 0,55 | 100 | 3×7 | Head → Neck |
| UpperTorso | 620,370 | 0,0 | 70 | 6×10 | Chest → Spine, RightClavicle, LeftClavicle |
| LowerTorso | 635,600 | 0,-36 | 80 | 6×9 | Pelvis → Spine, RightThigh, LeftThigh |
| LeftUpperArm | 885,370 | -130,-10 | 30 | 4×9 | LeftUpperArm → LeftClavicle, LeftForearm |
| RightUpperArm | 345,370 | 130,-10 | 60 | 4×9 | RightUpperArm → RightClavicle, RightForearm |
| LeftForearmHand | 950,620 | -160,-35 | 20 | 4×10 | LeftForearm → LeftUpperArm, LeftHand |
| RightForearmHand | 330,610 | 160,-30 | 90 | 4×10 | RightForearm → RightUpperArm, RightHand |
| LeftUpperLeg | 780,790 | -65,-20 | 10 | 4×10 | LeftThigh → Pelvis, LeftShin |
| RightUpperLeg | 540,790 | 15,-44 | 50 | 4×10 | RightThigh → Pelvis, RightShin |
| LeftLowerLegFoot | 825,1050 | -95,-25 | 0 | 4×12 | LeftShin → LeftFoot |
| RightLowerLegFoot | 470,1050 | 30,-74 | 40 | 4×12 | RightShin → RightFoot |

Back-to-front: LeftLowerLegFoot → LeftUpperLeg → LeftForearmHand → LeftUpperArm → RightLowerLegFoot → RightUpperLeg → RightUpperArm → UpperTorso → LowerTorso → RightForearmHand → HeadNeck.

Ground/reference center: **(630,1171)**, **640 pixels/unit**. Coordinates convert as `((x-groundX)/pixelsPerUnit, (groundY-y)/pixelsPerUnit, 0)`.

### Side

| Section | Source seed (x,y) | Placement offset (x,y) | Draw order | Grid | Dominant bone → allowed transitions |
|---|---|---|---:|---|---|
| HeadNeck | 500,110 | 0,50 | 90 | 3×7 | Head → Neck |
| UpperTorso | 480,410 | 0,0 | 70 | 6×10 | Chest → Spine, RightClavicle, LeftClavicle |
| LowerTorso | 480,720 | 0,-40 | 80 | 6×9 | Pelvis → Spine, RightThigh, LeftThigh |
| LeftUpperArm | 805,445 | -185,-15 | 20 | 4×9 | LeftUpperArm → LeftClavicle, LeftForearm |
| RightUpperArm | 225,440 | 220,-40 | 60 | 4×9 | RightUpperArm → RightClavicle, RightForearm |
| LeftForearmHand | 825,750 | -190,-58 | 30 | 4×10 | LeftForearm → LeftUpperArm, LeftHand |
| RightForearmHand | 190,735 | 265,-65 | 100 | 4×10 | RightForearm → RightUpperArm, RightHand |
| LeftUpperLeg | 640,1020 | -29,-110 | 10 | 4×10 | LeftThigh → Pelvis, LeftShin |
| RightUpperLeg | 450,960 | 28,-65 | 50 | 4×10 | RightThigh → Pelvis, RightShin |
| LeftLowerLegFoot | 650,1320 | -20,-103 | 0 | 4×12 | LeftShin → LeftFoot |
| RightLowerLegFoot | 430,1300 | 48,-119 | 40 | 4×12 | RightShin → RightFoot |

Back-to-front: LeftLowerLegFoot → LeftUpperLeg → LeftUpperArm → LeftForearmHand → RightLowerLegFoot → RightUpperLeg → RightUpperArm → UpperTorso → LowerTorso → HeadNeck → RightForearmHand.

Ground/reference center: **(512,1402)**, **768 pixels/unit**. Coordinates convert as `((x-groundX)/pixelsPerUnit, (groundY-y)/pixelsPerUnit, 0)`.

### Back

| Section | Source seed (x,y) | Placement offset (x,y) | Draw order | Grid | Dominant bone → allowed transitions |
|---|---|---|---:|---|---|
| HeadNeck | 500,100 | 0,60 | 80 | 3×7 | Head → Neck |
| UpperTorso | 480,410 | 0,0 | 90 | 6×10 | Chest → Spine, RightClavicle, LeftClavicle |
| LowerTorso | 500,720 | 0,-55 | 70 | 6×9 | Pelvis → Spine, RightThigh, LeftThigh |
| LeftUpperArm | 250,445 | 200,-20 | 20 | 4×9 | LeftUpperArm → LeftClavicle, LeftForearm |
| RightUpperArm | 800,455 | -150,-40 | 60 | 4×9 | RightUpperArm → RightClavicle, RightForearm |
| LeftForearmHand | 220,730 | 233,-55 | 30 | 4×10 | LeftForearm → LeftUpperArm, LeftHand |
| RightForearmHand | 855,750 | -160,-55 | 100 | 4×10 | RightForearm → RightUpperArm, RightHand |
| LeftUpperLeg | 415,980 | 70,-94 | 10 | 4×10 | LeftThigh → Pelvis, LeftShin |
| RightUpperLeg | 640,990 | -22,-90 | 50 | 4×10 | RightThigh → Pelvis, RightShin |
| LeftLowerLegFoot | 400,1260 | 70,-133 | 0 | 4×12 | LeftShin → LeftFoot |
| RightLowerLegFoot | 650,1300 | -22,-164 | 40 | 4×12 | RightShin → RightFoot |

Back-to-front: LeftLowerLegFoot → LeftUpperLeg → LeftUpperArm → LeftForearmHand → RightLowerLegFoot → RightUpperLeg → RightUpperArm → LowerTorso → HeadNeck → UpperTorso → RightForearmHand.

Ground/reference center: **(530,1357)**, **768 pixels/unit**. Coordinates convert as `((x-groundX)/pixelsPerUnit, (groundY-y)/pixelsPerUnit, 0)`.

## Canonical bone calibration

Every view uses the unchanged `MasterHumanoidRigContract` version 1, the same 20 names and direct parents. Positions below are assembled source-space neutral points. The builder sets each bone in canonical parent order, preserving parent-child relationships and identity bind rotations. SkinMount remains identity under its own authored view; all section positions are computed relative to VisualRoot. External character/world placement is untouched.

| Bone | Front (x,y) | Side (x,y) | Back (x,y) |
|---|---|---|---|
| Root | 630,1171 | 512,1402 | 530,1357 |
| Pelvis | 630,510 | 495,563 | 510,548 |
| Spine | 625,470 | 494,515 | 504,500 |
| Chest | 626,368 | 496,396 | 505,391 |
| Neck | 637,266 | 504,266 | 508,274 |
| Head | 625,164 | 506,153 | 515,160 |
| LeftClavicle | 724,288 | 555,333 | 436,316 |
| LeftUpperArm | 769,322 | 584,365 | 430,341 |
| LeftForearm | 763,478 | 614,555 | 413,512 |
| LeftHand | 771,650 | 630,805 | 440,777 |
| RightClavicle | 552,281 | 450,306 | 567,302 |
| RightUpperArm | 505,320 | 432,335 | 615,334 |
| RightForearm | 490,466 | 448,522 | 655,525 |
| RightHand | 505,648 | 465,780 | 678,785 |
| LeftThigh | 714,711 | 601,838 | 482,807 |
| LeftShin | 735,846 | 621,1020 | 483,984 |
| LeftFoot | 697,1063 | 618,1262 | 492,1257 |
| RightThigh | 555,690 | 475,827 | 604,806 |
| RightShin | 538,824 | 463,1010 | 614,999 |
| RightFoot | 490,1056 | 463,1260 | 630,1267 |

Front soles are one fringe-reference pixel above Ground; Side/Back both sole-reference rows coincide with Ground. Solid painted contact still needs human inspection; this is not a foot-plant rendering claim. `Socket_Ground` stays at VisualRoot origin. MainHand/OffHand follow the canonical hands; optional Head/Back sockets follow Head/Chest. No equipment or animation behavior exists on Knight B.

## Geometry and controlled weights

Every view independently produces **629 vertices / 926 triangles / 11 SpriteSkin sections**. All three definitions together describe 1887 vertices, 2778 triangles and 33 sections, not an instruction to render all views concurrently. Per section: HeadNeck 32 vertices, UpperTorso 77, LowerTorso 70, each UpperArm 50, ForearmHand 55, UpperLeg 55 and LowerLegFoot 65. Native Sprite data includes the canonical 20-slot bone/bind-pose array. Actual geometry sizes follow each view's padded extraction bounds, not Knight A dimensions.

These are modest transparent rectangular grids (3×7 to 6×10 and 4×12), not outline-tessellated or hand-finalized meshes. They retain useful shoulder/elbow/hip/knee/ankle transition rows. Transparent corners cost some vertices/overdraw; no speculative optimization is introduced. Knight A has 630/609/661 configured vertices and 932/888/986 triangles in Front/Side/Back respectively; Knight B remains comparable.

Weights use a dominant bone and 1–3 sequential smooth transitions in the original source coordinate system. Each transition redistributes existing weight, keeping the total normalized; packing drops zero weights and permits at most four canonical influences. All eleven recipes have multibone samples. Chest remains dominant over plate armor (13% Spine, at most 6% RightClavicle/4% LeftClavicle); lower torso remains mostly Pelvis (7% Spine, 5%/4% thigh responses); arm/hip attachment influence is only 6%, while elbows and knee/ankle bands can hand off to child bones. Head transfers to Neck only near its painted neck; forearm+hand and lower-leg+foot remain single sprites with Hand/Foot influence in their existing distal regions. Exact bands live in the three JSON files, including optional X-gated shoulder influence. These are technical starting weights, not final art approval.

**POSSIBLE ART-OVERLAP ISSUE — REQUIRES HUMAN VISUAL REVIEW:** the Front thigh-to-knee joins are compact; Side/Back armholes/pauldrons contain opaque painted recesses and duplicated overlapping shoulder forms; deep elbow/knee posing may expose hollow joint rims. Preserve the pixels and test, do not invent painted extensions or subdivide armor. Native sorting must confirm near/far masking and whether the foreground forearm should cross the lower torso. The unarmed base Soldier is intentional.

## Repeatable Unity execution path

Use the existing project Editor version and installed Unity 2D Animation; no packages/settings changed.

1. Run `RepWars > Character Production > Validate All Knight B Definitions` (configuration/provenance only).
2. Run `Create Knight B Front Skin Proof`, then Side and Back.
3. Expected outputs under `Skins/KnightB/<View>/Generated/`: eleven exact derived PNGs and eleven native `.sprite.asset` files per view. Expected prefabs: `Proof/KnightB_Front_SkinProof.prefab`, `KnightB_Side_SkinProof.prefab`, `KnightB_Back_SkinProof.prefab`.
4. Select each prefab and run `Validate Selected Knight B Skin`. Shared native validation recomputes source ownership/RGBA, mesh vertices/indices, weights/bind poses, canonical references, calibration, source/configuration hashes, order, SkinMount, ground and sprite asset locations; it rejects animation/facing/recolor/army components in an isolated skin proof.
5. Run CharacterProduction EditMode tests, including Knight A suites and `KnightBSkinTests`.
6. Human review at close scale and actual map scale: neutral assembly, sockets, compact knee/elbow seams, all projected bone chains, pauldron masking, silhouette and source-facing interpretation. Deformation pose tests may be manual Editor rotation checks; no Knight B animation is authored in this phase.

Valid existing outputs are left unchanged. Stale/partial outputs are never silently overwritten: explicitly archive/remove the generated assets before requesting regeneration. Failure rolls back only output files absent during preflight; original/source assets are never deleted. A proof activates only its authored view; the other two foundation branches contain no Knight B art. No combined-facing proof is created.

## Available checks and regression checkpoint

Run with Python 3 + Pillow and bytecode disabled:

```
PYTHONDONTWRITEBYTECODE=1 python Unity/Assets/RepWars/CharacterProduction/Validation/verify_knight_b_skins.py
PYTHONDONTWRITEBYTECODE=1 python Unity/Assets/RepWars/CharacterProduction/Validation/verify_knight_a_regression.py
```

The first verifies three source locks/hashes/dimensions, anatomical section identities, all painted ownership, 48 Front fringe seeds, grids, normalized permitted weights, sorting, ground, shared-generation boundaries and no generated/animated Knight B outputs. The second guards the accepted Knight A artifacts and shared extraction/grid/weight/native-binding method bodies against Phase 8. Existing Knight A Idle/Walk static validators invoke the regression guard after the shared-code move. Unity compilation/API/render behavior is not validated by Python reference checks or C# grammar parsing.

`Tests/Editor/KnightBSkinTests.cs` adds 17 EditMode cases: locked definitions, exact RGBA/ownership and normalized meshes, anatomical shoulder gates, fringe seeds, invalid recipes, canonical sockets/metadata isolation and Knight A accepted-recipe/native-facade parity. Tests are authored but require Unity execution.

## Unmodified differences and outstanding risks

Front has a square sheet and more compact thighs, a stronger pointed helmet/front visor and bilateral waist cloth. Side/Back are portrait sheets with layered shoulder silhouettes and laterally hanging redcloth; the Back helmet/torso rear-oblique reading differs from Side. These painted proportions, reds/highlights/lighting and decorations are unchanged. Initial per-view PPU/origins are technical calibration, not a product-approved relative body scale.

Carry forward unchanged Knight A risks: Idle/Walk handoff sole-reference undershoot up to about **5.34 source px**, knee offsets near **47°**, SpriteSkin + MaterialPropertyBlock may force CPU deformation, three Playable outputs/per-frame sampling and rendered seam/foot quality remain unmeasured. Knight B introduces no animation update loop, material property blocks, runtime pixel processing or additional per-frame allocations. Eventual mobile profiling must measure its 11 renderers/skins and projected meshes. No CPU-skinning/team-color redesign is performed.

LOD readiness is preserved by inert metadata and independently contained view/skin roots. A future caller can stop animation, reduce samples, disable skin branches or replace representative army visuals; no always-update/always-full-quality policy is encoded here. LOD is not implemented.

Phase 10 recommendation: checkpoint this skin-only phase, then add Knight B's isolated three-view/six-facing proof using the existing facing contract, **only after explicitly resolving the supplied Side source's image-right reading** in the technical facing calibration. Preserve canonical anatomical names and whole-visual mirroring; do not repaint art, introduce six rigs, add team color/animation/Run or migrate armies. Human facing approval and Unity execution stay separately reportable.
