# Phase 7 — Knight A Idle animation foundation

Historical Phase 7 checkpoint documentation. Phase 8 incrementally extends this player with optional
Walk/mixer playback and explicit neutral lower-body Idle coverage; see [KNIGHT_A_WALK.md](KNIGHT_A_WALK.md).
The accepted Idle recipe and upper-body motion are unchanged.

Implemented in code/tooling. Static checks are separate from Unity execution, human visual approval,
and mobile performance validation, which remain deferred. No `.anim`, profile `.asset`, controller,
or Idle proof `.prefab` has been generated in this cloud environment.

## Audit and boundaries

CharacterProduction previously contained calibrated bones, SpriteSkin generation, six-facing selection,
selective team color, and tests, but no animation clips/controllers/playback implementation.
`Assets/RepWars/Characters/Runtime/Backends/StubCharacterAnimationBackend.cs` is a Phase A experiment
using flat sprites and procedural bob/reactions. Its `Definitions/AnimationProfileDefinition.cs`
contains temporary clip-name bindings, not this production rig's animation contract.
Neither is reused or modified. The old seven-frame Soldier animation is not revived.

Phase 6 checkpoint: `1560fc73317d8cda52abcf648c6be2257a1e3ad3`.
All implementation stays in CharacterProduction. Source PNGs, skin geometry/weights, neutral calibration,
Master Humanoid topology/sockets, team-color renderer/shader/masks, production armies, packages,
settings, backend and temporal systems are unchanged. This phase has no Walk/Run or Knight B.

## Minimal standard Unity playback

`Runtime/HumanoidIdleProfile.cs` stores one shared duration, provenance, and exactly three authored
AnimationClip references (Front/Side/Back). The runtime is generic to the Master Humanoid, not Knight A.
`HumanoidIdlePresentation` references the rig, existing facing component, three view-local Animators,
and 24 neutral rotation bindings (eight upper-body bones for each view).

The isolated proof has this hierarchy:

```
KnightA_IdleProof          MasterHumanoidRig / HumanoidFacingPresentation / team color / Idle player
  VisualRoot              existing whole-rig mirror and SortingGroup; NOT an animation target
    View_Front            Animator (no controller/avatar/root motion)
      Skeleton/...        Front clip's eight canonical upper-body rotation targets
      SkinMount/...       original eleven SpriteSkin sections; NOT animation targets
    View_Side             same structure, independent calibration/Idle clip
    View_Back             same structure, independent calibration/Idle clip
    Socket_Ground         unchanged
```

A single manually evaluated Unity PlayableGraph contains three AnimationClipPlayables and three
AnimationPlayableOutputs, each targeting its view-local Animator. There is no AnimatorController,
blend tree, procedural deformation, sprite-piece motion, animation event or gameplay callback.
Clips use view-relative `Skeleton/...` paths. Animator roots sit **below** VisualRoot, so animation
cannot bind the actor placement root, VisualRoot or shared ground reference through those paths.
Only the selected view's Animator is enabled; the existing facing system still selects the one visible view.
Every clip shares the same cycle time; mirroring generates opposite directions without duplicate content.

The per-view clip/Animator targets, shared-phase playback, neutral rotation bindings and presentation
notifications are reusable foundations. Future Walk needs its own allowed-bone/data definition and a
deliberate state-selection/handoff policy. Idle data and its behavior remain useful; no locomotion
state, leg motion or transition policy is implemented speculatively here.

## Runtime controls and phase

- `SetIdleEnabled(true)` validates references, creates the graph if needed, and samples the stored phase.
- `SetIdleEnabled(false)` destroys the graph, disables view Animators and restores only the 24 animated
  local rotations to stored neutral values. It retains facing, mirror, color and cosmetic phase.
- `TrySampleAtPhase(double)` supports deliberate proof sampling in [0,1]; 1 wraps to 0.
- `AdvancePresentation(double)` advances the single cosmetic phase; negative/nonfinite inputs are rejected.
- `CurrentClip`, `NormalizedPhase`, `IdleEnabled`, and `IsPlaying` expose proof state.

During Play Mode, Update advances with local `Time.deltaTime`; this is not simulation/server time.
There are no per-instance random offsets or gameplay RNG calls. The graph itself has speed-zero clip
playables and manual evaluation, avoiding a second independently advancing clock.
The Phase 5 component gains only a `FacingChanged` notification after successful activation/mirroring.
Idle subscribes, chooses the corresponding Animator, and samples at the **same stored phase** immediately.
FrontRight/Right/BackRight use their Front/Side/Back clips unchanged under negative VisualRoot X scale.

Disabling the player/component destroys its graph and restores neutral; reenabling resumes its retained
cosmetic phase. Serialized proof defaults are Idle OFF and phase zero, allowing neutral integrity checks.
Runtime generation/playback errors stop and restore rather than leaving an owned partial graph.

## Authored idle intent

Cycle duration is **4.8 seconds**, PROVISIONAL until visual review. Six semantic phases share two signals:

| Phase | Time | Breath | Settle |
| --- | --- | --- | --- |
| Neutral | 0.000 s | 0 | 0 |
| Gentle rise | 0.816 s | 0.55 | -0.10 |
| Breathing crest | 1.776 s | 1.00 | 0.20 |
| Soft settling | 2.880 s | 0.20 | 0.60 |
| Restrained counter-settle | 3.888 s | -0.30 | -0.25 |
| Neutral loop seam | 4.800 s | 0 | 0 |

Each key is `neutralZ + breathDegrees*breath + settleDegrees*settle`.
Keys have unweighted zero in/out tangents: smooth bounded Hermite easing, no overshoot, no noisy micro-keys.
Start/end values and slopes match exactly. Clips loop without asking Unity to blend away discontinuities.
Thirty fps is clip authoring metadata, not a stepped or fixed-rate gameplay clock.

View-specific degrees below are `(breath, settle)` multipliers. These are provisional technical tuning:

| Bone | Front | Side | Back |
| --- | --- | --- | --- |
| Spine | (0.22, 0.03) | (0.14, -0.02) | (-0.18, 0.025) |
| Chest | (0.33, 0.025) | (0.25, 0.02) | (-0.28, -0.02) |
| Neck | (-0.12, 0.10) | (-0.16, 0.045) | (0.11, 0.08) |
| Head | (-0.20, 0.16) | (-0.18, 0.10) | (0.17, 0.12) |
| LeftClavicle | (0.20, 0.035) | (-0.12, 0.025) | (-0.17, 0.02) |
| RightClavicle | (-0.18, 0.025) | (0.16, -0.03) | (0.20, -0.03) |
| LeftUpperArm | (-0.16, 0.04) | (0.11, -0.02) | (0.13, 0.03) |
| RightUpperArm | (0.14, -0.035) | (-0.10, 0.02) | (-0.15, 0.025) |

All use local Z rotations for this 2D rig. Rear emphasis reverses projection-related signs; Side is narrower
and has independent shoulder/arm tuning. Head/neck offsets counter some torso motion. Shared signals
give one coherent idle concept while each view uses its own projected response.
Root, Pelvis, forearms, hands, thighs, shins and feet receive no direct curves. Descendant forearms/hands
follow their upper arms naturally. Feet have no animated ancestors in their Root/Pelvis/leg chains.
No position, scale, SkinMount, SpriteRenderer, socket, material or team-color property is animated.
Armor stability depends on existing controlled SpriteSkin weights/painted overlap, not new mesh warping.

## Deterministic Editor generation

`Editor/KnightAIdle.configuration.json` is the reviewed recipe. It locks the three unchanged source and
skin-calibration hashes, semantic phases and eight per-view rotation multipliers.
Run **RepWars > Character Production > Create Knight A Idle Proof** in Unity.

The generator validates the recipe, creates/reuses the existing team-color proof without modifying it,
loads a separate temporary prefab-content instance, and uses the calibrated view-local bone rotations
as neutral offsets. Unity Editor APIs create three clips, enable native loop settings, create a profile,
add three view-local Animators and configure the idle player. It validates before saving and after reload.
It does not manually write animation/prefab YAML or change source images.

Expected generated outputs (not generated here):

```
Assets/RepWars/CharacterProduction/Animation/Generated/KnightA_Front_Idle.anim
Assets/RepWars/CharacterProduction/Animation/Generated/KnightA_Side_Idle.anim
Assets/RepWars/CharacterProduction/Animation/Generated/KnightA_Back_Idle.anim
Assets/RepWars/CharacterProduction/Animation/Generated/KnightA_Idle.profile.asset
Assets/RepWars/CharacterProduction/Proof/KnightA_IdleProof.prefab
```

Valid existing outputs are validated and retained. Partial/stale outputs fail clearly; explicitly archive
only the Idle generated outputs and Idle proof before regenerating an approved recipe revision.
Failure rolls back only newly owned Idle outputs, never previous skins/team-color/facing proofs.

## Proof review and validation

Generate and instantiate the isolated proof, enter Play Mode, then use the Idle Inspector to enable/disable
idle or inspect normalized phase. Use existing facing controls for six directions and team-color controls
for original/sample colors while idle continues. No live map scene is required.
The phase slider seeks the running cycle; it is not a new paused-animation state. Use clip inspection or
Unity's Play Mode pause for fixed visual scrutiny. Stop Idle to restore neutral before structural validation.

Runtime validation checks canonical references, three clips, duration/loop flags, view-local Animators,
no controller/avatar/root motion, eight allowed bone bindings per view and finite phase/neutral rotations.
Editor validation checks exact native curve targets/times/values/tangents, no object/event tracks, matching
loop endpoints, provenance, native asset paths, neutral recovery and all previous skin/facing/team-color checks.
The earlier validators gain explicit Idle opt-in arguments; their default still rejects animation in static proofs.
Facing notification does not change the locked direction mapping, activation, mirroring, sorting or sockets.
The team-color Inspector's validation guard asks for Idle OFF; its rendering architecture is unchanged.

`Validation/verify_idle.py` checks recipes, source/calibration immutability, bounded zero-tangent reference
curves, lower-body reference-chain stability and rendering/authority boundaries. It does not execute C#.
NUnit tests cover native curve generation, forbidden tracks, shared phase across six facings, planted feet,
root/mirror preservation, neutral recovery, invalid references and team-color state/block coexistence.
They must actually run in Unity before those runtime behaviors can be called verified.

## Deferred checks and costs

Unity compilation, native clip/profile/proof generation, Playable sampling of inactive/reactivated view
Animators, evaluation ordering relative to SpriteSkin, neutral restoration, mirrored rendering and
team-color coexistence require Unity execution. Human review must judge restraint/visibility at map scale,
seams/armor at close scale, head stability, projected tuning and whether looping feels natural.
Motion may be too subtle or need projection-specific adjustment; current values are not art approval.

Carry forward the recorded MaterialPropertyBlock/SpriteSkin CPU-deformation concern unchanged.
New work adds one graph with three clip outputs, a cosmetic phase update and graph sampling per rendered
Update (plus sampling on facing changes). No managed allocation, rig search, texture processing or material
cloning is introduced in the normal per-frame loop. Graph construction and validation allocate only at
configuration/enable/debug checkpoints. Inactive-output cost and CPU skinning must be profiled on mobile;
there is no measured performance claim or speculative optimization in this phase.

Phase 8 recommendation: authored Knight A Walk/March only, with a deliberate state handoff and visual
foot-contact review; preserve all three-view/mirroring/team-color boundaries. No Walk is implemented here.
