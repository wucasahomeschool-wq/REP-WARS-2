# REP WARS Characters

The 2D character-system foundation for the Unity client. **This is Phase A.** It proves the architecture with
placeholder art and a stub animation backend. It is not a finished character pipeline.

## The pipeline

```
Base ─┐
      ├─► Variant ─► Catalog ─► Presenter ─► Actor ─► Backend
Appearance ─┘
```

| Layer | Asset / type | Role |
| --- | --- | --- |
| Base | `CharacterBaseDefinition` | The body: rig family, animation profile, backend kind, scale, intrinsic visuals |
| Appearance | `AppearanceDefinition` | A reusable role or cosmetic kit (soldier gear, emperor regalia) |
| Variant | `CharacterVariantDefinition` | One base + one appearance + small overrides. This is what gameplay asks for by id |
| Catalog | `RepWarsEmperorCatalog`, `RepWarsInfantryCatalog` | Indexes that list variants for a purpose |
| Presenter | `IRepWarsCharacterPresenter` | The only surface gameplay code touches |
| Actor | `RepWarsCharacterActor` | Common runtime root that implements the presenter |
| Backend | `ICharacterAnimationBackend` | The technology that draws and animates the body |

`RepWarsCharacterCatalog` resolves ids to definitions and validates them. `RepWarsCharacterSpawner.Spawn(variantId, parent)`
is the one way to create a character.

## Base vs appearance vs variant

- **Base** is what the character *is*. Human male, banana. A base never contains role clothing.
- **Appearance** is what the character *wears or carries*. `soldier_gear_01` (helmet, belt, backpack) and
  `emperor_regalia_01` (crown, gold belt). An appearance is reusable across any base whose rig provides the sockets it needs.
- **Variant** is one base wearing one appearance, plus a few overrides (tint, scale multiplier, facing policy).
  A variant owns no prefab. `generic_soldier` and `generic_emperor` are both `human_male` and share the same base asset
  and the same actor prefab. Only the appearance differs.

Phase A variants: `generic_soldier` (human_male + soldier_gear_01), `generic_emperor` (human_male + emperor_regalia_01),
`banana_soldier` (banana + soldier_gear_01), `banana_emperor` (banana + emperor_regalia_01).

## What the catalogs are for

A catalog is an index over variants and nothing more. Each entry has `catalogEntryId`, `variantId`, `displayName`,
optional `tags` and an optional `sortOrder`. Catalogs carry no rendering data.

- `RepWarsEmperorCatalog` lists rulers the player can choose from.
- `RepWarsInfantryCatalog` lists army character looks and has `defaultInfantryVariantId` (`generic_soldier`).
  Army code should read that field instead of hardcoding an id.

Catalog entries are validated. An entry pointing at a missing variant is an error.

## Compatibility tiers

Tiers describe how much rig and animation a base can share. They do not require a common skeleton.

| Tier | Meaning | Example | Phase A |
| --- | --- | --- | --- |
| T0 | Shared humanoid rig family | human male, human female | `human_male` |
| T1 | Non-human rig family with its own short skeleton | banana, mushroom | `banana` |
| T2 | Mechanical or segmented bodies | robot, toy soldier | not built |
| T3 | Specialty bodies | chicken, frog | not built |

Validation checks that a base's tier matches its rig profile's tier.

## Shared API, not shared skeleton

Every character is driven through the same presenter calls: `TrySetVariant`, `TrySetAppearance`, `SetLocomotion`,
`SetFacing`, `PlayReaction`, `SetTint`. Gameplay code must never touch a `SpriteRenderer`, `SpriteSkin`, `Animator`
or a bone. The presenter interface is checked by a test for this.

What is shared is the *vocabulary*: locomotion kinds (Idle, Walk, None), reactions (Celebrate, Defeat), socket names
(`head_top`, `neck`, `torso`, `back`, `waist`). What is not shared is the skeleton or the clips. Each rig family
maps the vocabulary to its own body. That is why `soldier_gear_01` can dress a banana: the banana rig has its own
`head_top` and `waist`, at its own positions and scale.

## Why Banana is a separate base and rig family

Banana is the stress test for the architecture. It has no arms, no legs and a curved body, so it cannot reuse the
humanoid skeleton or its clips. It therefore has:

- its own base (`banana`, tier T1),
- its own rig profile (`banana_v1`),
- its own animation profile (`banana_locomotion_v1`, separate from `humanoid_locomotion_v1`).

If the architecture only worked by bending everything to a humanoid, the banana would expose that. It has no role
clothing of its own. Soldier and emperor looks come from the same appearances the human uses.

## Appearance mechanisms

Each slot binding picks its own mechanism, so an appearance is *not* one big Sprite Library.

| Mechanism | Use | Phase A |
| --- | --- | --- |
| `SocketSprite` | rigid sprite on a socket (helmet, crown, belt) | implemented |
| `SocketPrefab` | rigid prefab on a socket (backpack) | implemented |
| `SpriteLibraryCategory` | swap sprites within a library | reported as skipped |
| `SkinnedOverlay` | cloth that follows bones (cape) | reported as skipped |

Skipped bindings are logged as warnings and returned in `AppearanceApplyResult.Skipped`. They are never dropped silently.
Applying an appearance is all-or-nothing. On error the previous appearance stays.

## Phase boundaries

| Phase | Scope | Status |
| --- | --- | --- |
| A | Definitions, catalogs, presenter API, actor, stub backend, composer, spawner, placeholder art, proof scene, tests | **this phase** |
| B | Real skeletons (2D Animation, `SpriteSkin`), real clips, humanoid and banana backends, skinned overlays | not started |
| C | Emperor and infantry production integration, character selection | not started |
| D | Army integration (replace or wrap `RepWarsArmyVisual`/`RepWarsSoldierVisual`), scale and crowd behavior | not started |
| E | Performance (LOD, batching, impostors), production art pipeline | not started |

## Intentionally not implemented in Phase A

- Real skeletons, `SpriteSkin`, bones, real animation clips. The stub backend fakes motion with transform bobbing.
- Production art. All sprites are generated placeholders in `Placeholders/Sprites`.
- Any change to `RepWarsArmyVisual` or `RepWarsSoldierVisual`. They are untouched and no army code uses this system.
- LOD, crowd rendering, GPU instancing, impostors, Addressables.
- Backend character ids. The server knows nothing about these variants.
- Any TypeScript, Supabase, workout, battle, AI or world-definition change.
- Any backend kind other than `Stub`. Other kinds fail loudly with "not implemented". They never fall back to the stub.
- A `Unity.2D.Animation` assembly reference. The `SpriteLibraryCategory` mechanism stores its category as text so
  Phase A compiles without it.

## Folder layout

```
Characters/
  Definitions/   Bases, Appearances, Variants, Rigs, Animation   (ScriptableObject assets)
  Catalogs/      Emperor and Infantry catalog assets
  Prefabs/       Shared actor prefab, backpack accessory prefab
  Placeholders/  Sprites (generated), Libraries (reserved for Phase B)
  Resources/     RepWarsCharacterRegistry.asset (loaded by id, no Addressables)
  Scenes/        CharacterSystemProof.unity
  Runtime/       Compiled into the existing RepWars assembly
  Editor/        RepWars.Characters.Editor asmdef, Phase A asset builder
  Tests/Editor/  RepWars.Characters.Tests asmdef, NUnit edit-mode tests
```

## Regenerating the placeholder assets

`RepWars > Characters > Build Phase A Assets` recreates the placeholder sprites, definitions, catalogs, registry,
prefabs and proof scene. It updates existing assets in place, so references stay valid.

## Running the proof

Open `Scenes/CharacterSystemProof.unity` and enter Play Mode. Four characters spawn through
`RepWarsCharacterSpawner`. The on-screen panel changes variant, appearance, tint, facing, locomotion and reactions on
the selected character, all through `IRepWarsCharacterPresenter`.
