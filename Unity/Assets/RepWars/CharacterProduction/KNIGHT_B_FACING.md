# Knight B six-direction presentation — Phase 10

## Checkpoint and boundaries

Phase 9 is already committed as `633aad4629d204064a81ff0a5be5051b6ef890ae`
(`Integrate Knight B production skins`), on `work`. Phase 10 reuses that checkpoint;
it does not create an empty duplicate commit. No branch changes or remote changes
are needed for this implementation.

Implemented in code/tooling: three-view facing definition, shared runtime selection,
whole-rig mirroring, combined proof generation, validation and EditMode tests.
Statically verified: source/configuration provenance and Knight A regression guards.
Requires Unity execution: C# compilation, tests, native proof generation and rendering.
Requires human visual review: source interpretation in the assembled views, mirrored
SpriteSkin, sorting, silhouettes and sockets. No generated prefab is claimed here.

No skin recalibration, new artwork, texture flips, team-color integration, animation,
equipment, map/army integration or gameplay authority is introduced for Knight B.

## Reviewed source handedness

All paths below are relative to `assets/misc/Character Skin PNG pieces/`.

| Authored view | Source | Unmirrored interpretation / evidence |
|---|---|---|
| Front | `Disassembled Dark Knight Armor Set (1).png` | FrontRight: visor/faceplate projects toward image-right in a front-oblique helmet; asymmetric projected torso/shoulders support this reading. |
| Side | `ChatGPT Image Oct 3, 2026, 08_01_25 AM.png` | Right: helmet visor and boot toes explicitly point image-right. |
| Back | `ChatGPT Image Oct 3, 2026, 08_06_16 AM.png` | BackRight: rear helmet/neck and rear-oblique torso expose the rightward-facing profile edge. These cues are weaker than Side; assembled visual approval remains required. |

This is the technical facing assignment from inspecting the supplied sheets, not
confirmation that the unexecuted rig renders those directions convincingly. The
source pixels, anatomy and calibration are unchanged.

| Displayed facing | Authored view | Knight B mirrored | Knight A mirrored (unchanged) |
|---|---|---|---|
| FrontLeft | Front | Yes | No |
| FrontRight | Front | No | Yes |
| Left | Side | Yes | No |
| Right | Side | No | Yes |
| BackLeft | Back | Yes | No |
| BackRight | Back | No | Yes |

`Editor/KnightBFacing.configuration.json` records exactly three unmirrored facings,
source SHA-256 values and corresponding skin-configuration hashes. The Editor
loader rejects duplicate views, wrong facing pairs, stale provenance and assignments
that contradict the reviewed Knight B orientation.

## Small shared runtime contract

`HumanoidFacing` remains the existing six-value enum. `HumanoidFacingContract` is
byte-identical and remains the default Knight A mapping.

`HumanoidFacingDefinition` is a serializable value with one mirror reversal per
authored view. Its default zero values reproduce Knight A exactly; Knight B's
configuration produces `(true, true, true)`. It can change mirror flags only,
never redirect a facing pair to a different view. No character-name branches exist
in runtime logic. Existing serialized rig/facing/scale fields keep their names.

`HumanoidFacingPresentation.Configure(rig, facing, definition, out error)` stores
the mapping once after validation. The previous overload supplies the default
definition. `TrySetFacing` and `TryApplyFacingIntent` remain presentation-only.
Null or invalid requests preserve the last valid facing. A corrupt serialized
enum uses FrontLeft with the stored character mapping, so Knight B remains mirrored
at that safe startup default. No movement-vector classification is added.

Switching disables the other branches, signs only `VisualRoot.localScale.x`, then
enables the selected branch. External placement, bones, SkinMount, weights, sprite
flips and sorting are untouched. There is no Update/hierarchy search loop; hierarchy
checks happen only on explicit requests. The previous temporary three-element
array in the request guard is replaced with equivalent direct checks.

## Anatomy, sockets and sorting

Phase 9 identities remain: Front's screen-left limbs are anatomical Right; Side's
screen-left column is near anatomical Right; Back's screen-left limbs are anatomical
Left. See `KNIGHT_B_SKINS.md` for complete calibration and section provenance.

MainHand remains attached to RightHand; OffHand to LeftHand. Reflection changes
their displayed positions, never their names or semantic parents. Ground stays at
the visual origin. Head and Back sockets follow their existing bone parents.

Front, Side and Back retain their existing independent renderer orders. A global
reflection preserves relative overlap and depth ordering; it is not an operation
that swaps anatomical parts. No mirrored-specific order is invented.

**MIRRORED SORTING — REQUIRES HUMAN VISUAL REVIEW**, especially Side's stronger
near/far projection and Back's helmet/shoulder overlap. SpriteSkin's actual rendered
reflection and any material culling behavior also require native execution.

## Isolated proof construction and review

Use `RepWars > Character Production > Create Knight B Six Direction Proof` in Unity.
Intended output: `Proof/KnightB_SixDirectionProof.prefab` beneath CharacterProduction.
The tool first creates/validates the three skin-only proofs through the existing
pipeline. `HumanoidFacingProofAssembly` clones only their authored branches, preserves
native SpriteSkin references, and rebuilds family metadata. It is also used by the
Knight A builder with the same default mapping and original family factory.

The combined proof has one rig, three branches and 33 SpriteRenderer/SpriteSkin pairs,
not six rigs or mirrored texture copies. It validates all six states before save
and validates after reload. Existing valid assets are left unchanged; invalid or
unloadable assets fail without overwrite. A failed combined save deletes only that
invocation's newly created combined proof, not existing authored proofs.

In Prefab Mode or an isolated scene, the generic facing Inspector exposes manual
six-facing selection, selected authored view, mirror state and definition flags.
Socket positions can be inspected through the hierarchy or `GetActiveSocket` API.
Use `Validate Selected Knight B Six Direction Proof` for family-specific checks:
approved mapping, canonical skins/bindings, one active view, no independent flips,
and no Knight A skin, animation or team-color components.

## Regression and test evidence

`Validation/verify_knight_b_facing.py` checks mapping, source/config hashes,
shared pipeline and absence of prohibited creation paths. `KnightBFacingTests.cs`
covers the six mappings and six actual hierarchy switches, stationary/invalid
intent, serialized startup state, socket reflection, placement and bind-relation
preservation, default Knight A compatibility and malformed recipes.

The frozen `KnightA.phase8-regression.json` is unchanged. Twenty-four protected
files/source hashes still match directly. For the two intentionally refactored
shared facing files, the verifier inverts only the reviewed mapping edits and
requires exact original whole-file hashes. Unexpected changes to mirror, events,
activation or validation still fail the old hash. Fourteen shared skin-generation
method hashes remain protected. Existing Knight A EditMode tests are unchanged.
These source checks are not C# execution or visual evidence.

## Deferred checks and performance

Only one full authored branch is active; future LOD can replace or disable the
presentation without a facing Update loop. No LOD policy is implemented. Facing
changes create no textures, materials, animation clips or temporary arrays.

Carry forward Knight A risks unchanged: Idle/Walk transition ground-reference
undershoot up to about 5.34 source pixels, knee offsets approaching 47 degrees,
SpriteSkin + MaterialPropertyBlock CPU-deformation concern, unmeasured Playable
sampling cost and unverified visual/seam behavior. Knight B is static and has no
color/animation path in this phase; its full skin cost still needs mobile profiling.

Next proposed scope is Knight B selective team-color configuration and isolated
proof support, with explicit mask-region review. No animation or army migration
is implied by this recommendation.
