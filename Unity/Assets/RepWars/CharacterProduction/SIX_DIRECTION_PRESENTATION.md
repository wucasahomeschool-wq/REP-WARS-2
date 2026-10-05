# Six-direction presentation — Phase 5

## Status

**IMPLEMENTED IN CODE/TOOLING:** reusable facing contract and component, whole-VisualRoot mirroring, stationary intent retention, combined Knight A proof generation, Inspector controls, validators, and EditMode tests.

**STATICALLY VERIFIED:** locked source mappings, C# grammar, source/recipe integrity, metadata/assembly structure, and modification scope.

**REQUIRES UNITY EXECUTION:** C# compilation, EditMode tests, authored/combined prefab generation and reload, component lifecycle, SpriteSkin behavior under negative parent scale, culling, shaders, and Inspector Undo/prefab overrides.

**REQUIRES HUMAN VISUAL REVIEW:** facing readability, mirrored silhouette, seams, ordering, socket alignment, and gameplay-scale cohesion. Code and source checks do not establish rendered quality.

## Locked contract

`Runtime/HumanoidFacingContract.cs` defines exactly these stable values:

| Value | Facing | Authored view | VisualRoot X |
| --- | --- | --- | --- |
| 0 | FrontLeft | Front | positive |
| 1 | FrontRight | Front | negative |
| 2 | Left | Side | positive |
| 3 | Right | Side | negative |
| 4 | BackLeft | Back | positive |
| 5 | BackRight | Back | negative |

These labels follow the locked product mapping, irrespective of source-sheet orientation. There are no straight-front/back states, extra Side skins, or six separately authored rigs.

## Runtime boundary

`HumanoidFacingPresentation` resides on the same outer object as `MasterHumanoidRig`. `Configure(rig, initialFacing, out error)` validates local ownership and the three authored branches, records the positive unmirrored VisualRoot scale, and applies the initial facing.

- `TrySetFacing(HumanoidFacing)` accepts explicit presentation intent. Invalid values or broken references return false without changing the established state.
- `TryApplyFacingIntent(HumanoidFacing?)` accepts optional intent. Null means stationary/no new direction: return false, leave the last valid facing, mirror, and activation unchanged.
- `TryApplyStoredFacing()` restores serialized presentation state, including on enable. A corrupt serialized enum falls back to FrontLeft when the rig can be applied safely. Invalid runtime requests do not trigger that fallback.
- `GetActiveSocket(MasterHumanoidSocket)` returns the selected authored branch's socket; Ground remains the shared ground anchor.

No vector/angle classification is implemented. No motion polling or Update loop exists. A later external caller supplies facing; this component does not query backend state or determine movement.

## Hierarchy, mirroring, and ordering

The combined proof has one presentation root, one VisualRoot/SortingGroup, one shared ground anchor, and three authored branches (twenty canonical bones and eleven SpriteSkin sections each):

```text
KnightA_SixDirectionProof
  MasterHumanoidRig + HumanoidFacingPresentation
  VisualRoot                         <- only this local X scale changes sign
    Socket_Ground
    View_Front / View_Side / View_Back <- exactly one activeSelf at a time
      Skeleton
      SkinMount
      per-view socket hierarchy
      KnightASkin metadata
```

Other branches are disabled before the chosen branch is enabled. Each mirror command assigns a sign from the recorded baseline; it does not multiply the previous scale repeatedly. Y/Z scale and all outer placement transforms remain unchanged.

Individual SpriteRenderer flips, section transforms, bone local calibration, inverse bind matrices, artwork, and renderer order remain untouched. Front/Side/Back preserve their own ordering when mirrored. MainHand stays on RightHand; OffHand stays on LeftHand. Their transforms mirror with the complete visual branch without swapping semantic names. Labels, UI, and unrelated colliders belong outside VisualRoot. No equipment exists.

The common visual-parent transform cancels from the bone-to-renderer bind relation mathematically; actual SpriteSkin rendering/culling with negative scale must still be executed and reviewed in Unity.

## Combined proof and Editor controls

Run `RepWars > Character Production > Create Knight A Six Direction Proof`.

The tool first creates or validates the three independent authored proofs using their existing no-overwrite policy. It clones only each authored branch into one new Master Humanoid proof, replaces the corresponding empty foundation branches, and reuses the same Sprite/texture assets. It does not create mirrored art copies or clone six rigs.

Expected output: `Assets/RepWars/CharacterProduction/Proof/KnightA_SixDirectionProof.prefab`.

Each branch receives `KnightASkin` metadata referencing the combined rig. The skin validator's default mode still validates isolated Phase 4 proofs; its explicit combined mode validates one branch without requiring the other branches to be empty or active. All mesh, weight, source/configuration provenance, sorting, placement, and canonical-binding checks remain applied.

Before saving, the tool applies and structurally validates all six facings, then saves FrontLeft. It loads saved prefab contents and checks references again. Valid existing combined proofs remain unchanged. Invalid/unloadable existing outputs are not overwritten. On failure, cleanup removes only the previously absent combined proof created by that invocation; independently created authored proofs are retained.

Open the combined proof in Prefab Mode or instantiate it in an isolated scene. Select its `HumanoidFacingPresentation` component and use `Choose facing`. The custom Inspector changes activation and VisualRoot scale through the runtime API, with Undo and prefab-instance override recording. Direct controls on a persistent prefab asset are disabled; open Prefab Mode instead.

Run `Validate Selected Knight A Six Direction Proof` for provenance plus full skin validation. The Inspector's validation button checks generic presentation structure.

## Verification and later review

Run the CharacterProduction EditMode tests. Added tests cover the six mappings, one active branch, mirror sign/magnitude, unchanged placement/UI roots, preserved renderer order and bind relation, invalid/default input, null intent, broken references, and socket identity for all three view pairs. These tests do not assert visual quality.

Cloud read-only checks:

```text
python Unity/Assets/RepWars/CharacterProduction/Validation/verify_humanoid_facing.py
PYTHONDONTWRITEBYTECODE=1 python Unity/Assets/RepWars/CharacterProduction/Validation/verify_knight_a_skins.py
```

The first inspects C# source contracts; it does not execute the C# methods. The second checks actual source/configuration data and extraction/weight recipes. Neither executes Unity.

Human review must assess all six displayed directions, including the supplied Back helmet orientation and existing cross-view cloth differences, without silently repainting source art. Pose/weight quality remains deferred from earlier phases. Source PNGs and all three calibration JSON files remain unchanged in this phase.

No animation, gait phase, team colors, Knight B, weapons/equipment, production army integration, experimental architecture dependency, or gameplay authority is added.
