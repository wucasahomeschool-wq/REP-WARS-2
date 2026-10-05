# Phase 8 — Knight A Walk / March

IMPLEMENTED IN CODE/TOOLING; STATICALLY VERIFIED separately from native execution.
Unity compilation/generation/playback, human visual approval and mobile profiling remain deferred.
No animation clip, profile or prefab was generated in this environment.

Phase 7 checkpoint: `7c0cc76f8ee558e2cb47fe3396ef5ed6f2ddd8c2` on the existing `work` branch.

## Audit and incremental extension

Phase 7 provides three calibrated view-local Animators, standard AnimationClipPlayables, one manually
evaluated graph and a cosmetic phase. It can support Walk without an AnimatorController replacement.
`HumanoidIdlePresentation` is retained to preserve its serialized identity, API and earlier proof assets.
It now owns optional Walk data and `HumanoidAnimationState { Idle, Walk }`. There is still one player,
one active authored view, and no experimental character dependency. `HumanoidIdleViewClip` is reused
as the existing small view/clip reference record; its historic name does not constrain Walk content.

Existing Idle-only proofs keep their three-clip graph and original eight rotation tracks. The new Walk
proof uses six clips (three per state), three two-input AnimationMixerPlayables and the SAME three
Animator outputs. There are no additional Animators, mirrored clips, controllers or blend trees.
The original Idle recipe, original generated Idle clips/proof, rig topology, calibration, weights,
facing logic and team-color renderer/masks are not changed.

Walk proof's companion `IdleCoverage` clips retain the exact accepted eight upper-body Idle curves.
Eight added constant neutral rotation tracks (forearms and legs) plus constant local Pelvis Y match
Walk's target set. This is explicit neutral recovery content, not a second authored Idle motion.
It avoids depending on Unity's implicit default values for channels missing from the original Idle.

## Runtime contract and handoff

- `SetAnimationState(Idle | Walk)` receives a cosmetic intent. No movement/simulation data is read.
- `SetAnimationEnabled(bool)` enables playback or destroys the graph and restores calibrated neutral.
- Legacy `SetIdleEnabled(true)` selects Idle then enables; false disables. `IdleEnabled` remains a
  compatibility alias for the animation-enable flag. New callers should use the state/enable APIs.
- `NormalizedPhase`, `CurrentClip`, `State`, `WalkWeight`, `IsTransitioning` expose proof information.
- `TrySampleAtPhase([0,1])` seeks the selected state and completes any pending handoff; 1 wraps to 0.
- `AdvancePresentation(delta)` uses only finite nonnegative local cosmetic seconds.
- `SetAutomaticAdvance(false)` pauses automatic Update/evaluation, retaining the pose. Explicit seek,
  advance or facing change may still sample. No runtime IK, curve construction or sprite-piece motion.

On an ordinary state change, the incoming phase starts at zero; Walk starts at LeftContact, Idle
at its neutral upper-body key. The outgoing clip phase is retained and advances during a **0.2 second**
smoothstep mixer handoff. Both clips are explicitly sampled; no second independently advancing clock.
Reversing an in-progress handoff swaps the two phases and blends from the current Walk weight, so
neither pose is discarded at the reversal. No neutral flash or graph reconstruction occurs on state changes.
A disabled player changes state without a blend; enabling samples its chosen state/retained phase.
Disabling the component restores neutral; reenabling resumes state and phase without root movement.

Facing changes preserve selected state, shared phase and blend progress, select the correct view-local
Animator and resample immediately. Whole-rig mirroring still belongs exclusively to VisualRoot.
FrontLeft/FrontRight reuse Front; Left/Right reuse Side; BackLeft/BackRight reuse Back. Sorting is unchanged.
MainHand/OffHand sockets follow the existing arm chains; semantic names are never swapped.
Team color receives no animation tracks or callbacks and retains its one independent color state.

## Shared gait and projection

`Editor/KnightAWalk.configuration.json` locks source/calibration hashes and defines one **1.6 second**
cycle (75 individual steps/minute), provisional until review. It is unrelated to gameplay travel speed.
Nine keys represent eight deliberate semantic phases plus an exact repeated endpoint:

| Normalized phase | Meaning | Left stride | Left lift | Left roll signal |
| --- | --- | --- | --- | --- |
| 0 | Left contact / right lift-off boundary | -1 | 0 | 0 |
| .125 | Left loading / right toe-off | -.5 | 0 | 0 |
| .25 | Left support / right passing | 0 | 0 | 0 |
| .375 | Left terminal / right approach | .5 | 0 | 0 |
| .5 | Right contact / left lift-off boundary | 1 | 0 | 0 |
| .625 | Right loading / left toe-off | .5 | .7 | -.6 |
| .75 | Right support / left passing | 0 | 1 | .25 |
| .875 | Right terminal / left approach | -.5 | .7 | .4 |
| 1 | Return to left contact | -1 | 0 | 0 |

Right leg/arm signals are half a cycle later. Shape-preserving periodic cubic semantic curves avoid
overshoot and arbitrary noisy keys. Stance has zero lift/roll; swing has modest lift/foot roll.
The phases describe contact intent, not footstep sounds, events, distance or gameplay actions.

| View | Stride half-range | Swing lift | Local Pelvis drop | Foot-roll multiplier | Arm swing |
| --- | --- | --- | --- | --- | --- |
| Front | 10 source px | 12 px | 7 px | 2 degrees | 3.2 degrees |
| Side (reference) | 32 px | 22 px | 10 px | 4 degrees | 7 degrees |
| Back | 12 px | 14 px | 8 px | 2.5 degrees | 3.8 degrees |

Side uses the clearest stride and knee articulation. Front/Back compress stride/lift and use smaller arm
swing; Back reverses torso/clavicle/forearm emphasis while arm swing still opposes stride. Neither uses lateral Pelvis translation or waddling.
All rotations are local Z around the original identity bind rotations. Feet are never subdivided.
Pelvis gets only a constant local Y drop within Walk, less than 1.4% of calibrated standing height:
this provides reach for nearly straight calibrated leg chains, without rhythmic bobbing or root translation.
No Pelvis rotation, Root track, world/VisualRoot track, socket track, scale or hand track is authored.

Spine/Chest opposing amplitudes are 0.35/-0.55 degrees; Neck/Head 0.12/0.08 degrees counter their sum.
Clavicle response is 0.3 degrees. Arm swing opposes the ipsilateral leg; forearms flex at up to 2 degrees
on their swing phase. No hand motion is authored; painted armor moves through existing SpriteSkin weights.

## Foot-contact construction and limits

Editor tooling derives each leg's two fixed segment vectors from its existing calibration. The foot
reference is the calibrated ankle plus a downward sole-height offset to the existing Ground plane.
This preserves the authored neutral alignment; it does not identify/paint new sole artwork.

For each semantic target, a two-bone planar solve calculates thigh/shin rotations. Foot rotation
counters inherited leg rotation and adds only the restrained swing roll. The small Pelvis drop avoids
unreachable targets; any target beyond reach throws, rather than stretching bones. No runtime solver
or authority is introduced. Stance feet travel backward relative to the stationary character, as an
in-place gait must; world-space planting will also depend on a later external presentation caller's
translation. This phase makes no promise of world-space planting or speed synchronization.

The generator bakes **128 intervals / 129 keys** per track. These are deterministic samples of the nine
semantic phases and calibrated geometry, not 129 independently authored poses. Central-difference
Hermite slopes match at the loop seam. Dense checks bound thigh offsets to 28 degrees and shin/foot
offsets to 48 degrees. Start/end values and slopes are identical. No runtime curves are built.

Double-precision reference sampling at 2,049 times per leg gives maximum contact-target error of
0.005879 px Front, 0.010990 px Side, 0.006857 px Back. These are FK/reference errors, **not SpriteSkin
pixel errors or Unity test results**. Existing blended Shin/Foot weights and painted overlap determine
what the actual boot silhouette does. All neutral mesh/weight configuration is unchanged.

A simple rotation/Pelvis mixer is not contact-constrained during the 0.2 second state handoff. Reference
interpolation predicts transient sole-reference ground undershoot up to approximately **5.34 source px**
(Back worst case), versus <=0.011 px steady-cycle error. This short artifact and final weighted sole
alignment require visual review at gameplay scale. Do not conceal it or add a speculative runtime IK system.

**POSSIBLE ART-OVERLAP ISSUE — REQUIRES HUMAN VISUAL REVIEW:** knee offsets approach 47 degrees;
hip, knee and elbow painted overlaps must be checked during motion. Do not repaint missing pixels.
Inspect ankle/boot stability, near/far limb occlusion, front/back leg readability and existing armor weights.
No source art, segmentation, draw-order workaround or dynamic sorting is changed without evidence.

## Deterministic generation and validation

Run **RepWars > Character Production > Create Knight A Walk Proof** in Unity Editor.
It creates/reuses earlier proofs, loads a separate temporary Idle-proof instance, uses calibrated bones,
and adds the Walk profile/51 neutral bindings plus the covered Idle profile to the existing player.
It saves and reload-validates a NEW proof. Earlier assets remain untouched. Existing valid Walk outputs
are retained; partial/stale outputs fail explicitly. Rollback deletes only newly owned Walk outputs.
Unity APIs handle clips/profiles/prefabs; no hand-authored native YAML.

Expected outputs, not generated here:

```
Assets/RepWars/CharacterProduction/Animation/WalkGenerated/KnightA_Front_Walk.anim
Assets/RepWars/CharacterProduction/Animation/WalkGenerated/KnightA_Side_Walk.anim
Assets/RepWars/CharacterProduction/Animation/WalkGenerated/KnightA_Back_Walk.anim
Assets/RepWars/CharacterProduction/Animation/WalkGenerated/KnightA_Front_IdleCoverage.anim
Assets/RepWars/CharacterProduction/Animation/WalkGenerated/KnightA_Side_IdleCoverage.anim
Assets/RepWars/CharacterProduction/Animation/WalkGenerated/KnightA_Back_IdleCoverage.anim
Assets/RepWars/CharacterProduction/Animation/WalkGenerated/KnightA_Walk.profile.asset
Assets/RepWars/CharacterProduction/Animation/WalkGenerated/KnightA_IdleCoverage.profile.asset
Assets/RepWars/CharacterProduction/Proof/KnightA_WalkProof.prefab
```

The Inspector supports state selection, enable/disable, pause, phase seek, phase/blend inspection and
OFF/neutral full validation. Existing facing and selective-color Inspectors provide all six facings and
sample colors. No live scene is needed. Animation ON is not permitted during full neutral bind validation.

Runtime checks validate both profiles, state, canonical binding identities, three Animator owners,
no root motion/controller/avatar, normalized phase and neutral transforms. Editor checks validate
exact native paths, provenance, all 17 clip targets/keys/tangents, no event/object/forbidden tracks,
neutral calibration, unchanged section generation/binds and previous facing/color contracts.
`verify_walk.py` checks the independent mathematical reference and original blob integrity.
NUnit tests target native curves/Playables, six-facing phase/color reuse, state handoffs, neutral recovery,
root/Ground invariance, invalid input and contact-reference sampling. Unity must run these tests before
native behavior can be called verified. A grammar parse is not C# Unity compilation.

## Performance and future LOD

Carry forward the accepted **MaterialPropertyBlock may force SpriteSkin CPU deformation** risk.
Phase 8 adds three Walk clip playables and three mixers to the existing three-output graph. Native
curve storage/evaluation and blending increase work; inactive-output and CPU-skinned mesh cost remain
unmeasured. Steady Update does not allocate managed objects, construct clips/curves, search bones,
generate textures or clone materials. Profile/binding validation and graph creation allocate only at
setup/enable/checkpoints. All three views' source assets and masks are reused by mirrored directions.

Automatic advancement can be paused; a future caller may manually sample less often or disable the
player (graph destroyed, neutral restored). An isolated visual rig can later be replaced by a cheaper
presentation outside gameplay authority. No visibility policy, LOD, rate scaling or crowd optimization
is implemented. Measure on target mobile hardware before changing team color or skinning.

Next recommended Phase 9: checkpoint Phase 8, generate/compile the isolated proof in Unity, run EditMode
tests, and review/tune existing Idle/Walk contact, seams, transitions, mirroring and color at gameplay
scale. Record mobile baseline cost. No Run, Knight B or production army migration in that validation scope.
