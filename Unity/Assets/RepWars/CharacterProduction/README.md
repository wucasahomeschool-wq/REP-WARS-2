# Rep Wars Character Production

This folder contains the isolated production humanoid rig foundation. It does not depend on the Phase A character proof, placeholder sprites, live army renderer, or gameplay authority.

## Master Humanoid contract

`Runtime/MasterHumanoidRigContract.cs` defines contract version 1, stable bone names, direct parent relationships, the Front/Side/Back view identifiers, and socket names. The skeleton has 20 bones. Its topology is deliberately richer than the Soldier skin's approximately 11 body-section sprites: SpriteSkin art may be influenced by multiple bones.

Each view branch contains its own `Skeleton`, `SkinMount`, and socket transforms. Bone names and parent relationships are identical across views; positions can be calibrated independently. The default local positions are a neutral structural starting pose only. They are not final binds or art proportions.

`VisualRoot` is a presentation child beneath the prefab root. Mirroring may be applied to that visual child later. The external parent remains responsible for world position; the rig has no root motion. `Socket_Ground` is parented to `VisualRoot` and provides the stable feet/map-sort origin. Per-view sockets are `Socket_MainHand` (RightHand), `Socket_OffHand` (LeftHand), `Socket_Head` (Head), and `Socket_Back` (Chest). They are attachment points only; no equipment behavior exists.

## SpriteSkin integration boundary

The project manifest includes Unity 2D Animation 16.0.1. Each view's `SkinMount` is reserved for the large painted body-section sprites and their SpriteSkin renderer setup in the next art-integration phase. The validator checks that these mounts and the package declaration exist. This phase creates canonical Transform bones but no meshes, SpriteSkin components, weights, animation clips, or character art. Sprite geometry and weights must be authored/calibrated with the Soldier art in Unity Editor.

## Editor construction and validation

Use `RepWars > Character Production > Create Master Humanoid Proof Rig` to create `Proof/MasterHumanoidRig_Proof.prefab`. The command validates the generated structure before saving. It is safe to rerun: a valid existing prefab is left unchanged; an invalid/existing file is never overwritten and produces an actionable error.

Use `RepWars > Character Production > Validate Selected Master Humanoid Rig` to check a selected prefab root. The runtime validator checks contract version, unique view roots, the complete bone set, unique transform names, direct parent-child relationships, hand/head/back sockets, the stable ground anchor, and each future `SkinMount`. The Editor check also rejects production army component dependencies and confirms Unity 2D Animation is declared in the package manifest.

`Tests/Editor/MasterHumanoidRigValidatorTests.cs` covers the canonical chains, independent views, valid hierarchy, and a missing-bone failure. Unity Editor is required to generate the prefab and run these tests.

## Deliberate exclusions

No Soldier PNG is imported, cropped, split, repainted, regenerated, recolored, or attached. No animations or team-color materials are created. No Phase A character code, production army presentation, or backend/gameplay files are required by this foundation.
