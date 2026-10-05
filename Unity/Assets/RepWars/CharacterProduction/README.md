# Rep Wars Character Production

This folder contains the isolated production humanoid rig foundation. It does not depend on the Phase A character proof, placeholder sprites, live army renderer, or gameplay authority.

Phase 3 adds the Front-only Knight A skin configuration and repeatable generation path. See [KNIGHT_A_FRONT.md](KNIGHT_A_FRONT.md). Unity execution and visual validation remain deferred; generator code is not evidence that generated assets exist.

Phase 4 extends the same pipeline with independent Side and Back configurations. See [KNIGHT_A_VIEWS.md](KNIGHT_A_VIEWS.md) for source provenance, calibration, ordering, execution instructions, and deferred visual checks. Each authored view has its own isolated proof; no direction switching or animation is added.

Phase 5 adds the reusable six-facing presentation component and a combined Knight A proof generation path. See [SIX_DIRECTION_PRESENTATION.md](SIX_DIRECTION_PRESENTATION.md). Three authored branches produce six displayed facings through whole-VisualRoot mirroring; animation and Unity visual approval remain deferred.

Phase 6 adds explicit per-section selective masks, a shared URP 2D recolor shader/material generation path, and one presentation color state across all facings. See [SELECTIVE_TEAM_COLOR.md](SELECTIVE_TEAM_COLOR.md). Source art remains unchanged; only conservative cloth-interior proof regions are designated, with wider mask decisions deferred to human review. Unity generation, shader compilation and visual approval remain deferred.

Phase 7 adds three authored-view Idle definitions, standard AnimationClip/Playable tooling, view-local Animator targets and shared cosmetic phase. See [KNIGHT_A_IDLE.md](KNIGHT_A_IDLE.md). Idle is upper-body-only, restores calibrated neutral rotations when disabled, and leaves facing/team color independent. Unity execution, human visual approval and mobile profiling remain deferred.

## Master Humanoid contract

`Runtime/MasterHumanoidRigContract.cs` defines contract version 1, stable bone names, direct parent relationships, the Front/Side/Back view identifiers, and socket names. The skeleton has 20 bones. Its topology is deliberately richer than the Soldier skin's approximately 11 body-section sprites: SpriteSkin art may be influenced by multiple bones.

Each view branch contains its own `Skeleton`, `SkinMount`, and socket transforms. Bone names and parent relationships are identical across views; positions can be calibrated independently. The default local positions are a neutral structural starting pose only. They are not final binds or art proportions.

`VisualRoot` is a presentation child beneath the prefab root. Mirroring may be applied to that visual child later. The external parent remains responsible for world position; the rig has no root motion. `Socket_Ground` is parented to `VisualRoot` and provides the stable feet/map-sort origin. Per-view sockets are `Socket_MainHand` (RightHand), `Socket_OffHand` (LeftHand), `Socket_Head` (Head), and `Socket_Back` (Chest). They are attachment points only; no equipment behavior exists.

## SpriteSkin integration boundary

The project manifest includes Unity 2D Animation 16.0.1. Each view's `SkinMount` is reserved for the large painted body-section sprites and their SpriteSkin renderer setup. The foundation generator creates canonical Transform bones without meshes or artwork. The Phase 3 generator populates only Front with eleven SpriteSkin sections. Native Sprite mesh/bone/weight data and prefab references must be checked by running the tool and validator in Unity Editor.

Runtime code has a dedicated `RepWars.CharacterProduction.Runtime` assembly referencing the animation package. Editor tooling and tests explicitly reference this isolated assembly. No existing gameplay assembly is changed to depend on the character work. `MasterHumanoidRig` has its own matching script filename so Unity can serialize its component references reliably.

## Editor construction and validation

Use `RepWars > Character Production > Create Master Humanoid Proof Rig` to create `Proof/MasterHumanoidRig_Proof.prefab`. The command validates the generated structure before saving. It is safe to rerun: a valid existing prefab is left unchanged; an invalid/existing file is never overwritten and produces an actionable error.

Use `RepWars > Character Production > Validate Selected Master Humanoid Rig` to check a selected prefab root. The runtime validator checks contract version, unique view roots, the complete bone set, unique transform names, direct parent-child relationships, hand/head/back sockets, the stable ground anchor, and each future `SkinMount`. The Editor check also rejects production army component dependencies and confirms Unity 2D Animation is declared in the package manifest.

`Tests/Editor/MasterHumanoidRigValidatorTests.cs` covers the canonical chains, independent views, valid hierarchy, and a missing-bone failure. Unity Editor is required to generate the prefab and run these tests.

## Deliberate exclusions

Original Soldier PNGs are read-only. The shared Knight A generator technically extracts the authored sections into padded derived textures, preserving source paint and overlap. Source art is never repainted, redesigned, regenerated, or recolored. Selective runtime recolor is rendering only. Idle is the only defined animation; no Walk/Run, Knight B integration, or equipment are implemented. No Phase A character code, production army presentation, or backend/gameplay files are dependencies.
