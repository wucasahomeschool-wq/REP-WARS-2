# Rep Wars — Environmental Effects (Phase 1)

Reusable, presentation-only toolkit for **fog, smoke (broad + anchored plume), fire frames, embers and sparks**.
Isolated proof only: not wired into the production map, gameplay, backend, Supabase or Temporal V2.
Water, audio, production depth sorting, and mobile/device profiling are outside Phase 1.

## Authority boundary
These components decide only cosmetic motion, opacity, scale, frame choice and timing.
They never decide whether anything burns, is damaged, or happens. A future layer driven by
authoritative backend state calls `Play()/FadeIn()/FadeOut()/Stop()/ApplyPreset()`.

## Layout
```
Runtime/   (asmdef RepWars.Environment.Effects, no dependency on RepWars gameplay code)
  Core/        engine-free logic: CosmeticRandom (System.Random, seedable), FloatRange/EffectClamp,
               FramePicker (random, no immediate repeat), ObjectPool<T>, EffectFade, *Settings
  Components/  EnvironmentalEffectBase (lifecycle), SpriteParticleSystem (pooled sprites),
               FogController, SmokeController, SmokePlumeController, FireFrameController, EmberSparkController
  Presets/     ScriptableObject presets (Create > RepWars > Environment > Effects)
Editor/    menu: RepWars > Environment > Effects > Build Phase 1 Proof Scene
Tests/Editor    EditMode tests (pure logic)
Tests/PlayMode  lifecycle / pool reuse / no-orphan tests
```

## Usage
Add a controller to an empty child of a prop, assign sprites (or a preset), done.
Common settings per component: sorting layer/order, Scaled (default) or Unscaled time,
Local/World simulation space (particle effects), optional seed, play-on-enable, fade times, intensity.
Invalid values are clamped and one warning is logged per component.

Fog density = more thin layers × opacity range. One sprite set covers every density.

## Art
Repo-root `assets/Animated Pieces/` stays the untouched source library. Unity copies live in
`ProofArt/` and are the only files the proof scene loads.

| Source | Unity copy |
|---|---|
| Nine unique thin fog overlays in `assets/Animated Pieces/` (mist, wisp, fog-bank, and fog-overlay PNGs with real alpha) | `ProofArt/Fog/` — same file names |
| `assets/Animated Pieces/Smoke/` (5 plume PNGs) | `ProofArt/Smoke/` — same file names |
| `assets/Animated Pieces/Campfire Frames/` (6 frames, chronological) | `ProofArt/Fire/campfire_00.png` … `campfire_05.png` |
| No authored ember/spark art | `ProofArt/Embers/ember_proof_dot.png` — one shared proof dot. Bespoke ember art is optional future polish. |

Not copied: exact duplicate `(1)` fog files, `Translucent Blue-Gray Fog Overlay.png` (no transparent edges; it would import as a solid plate), and the three Oct 1 cloud-mass PNGs (dense clouds, not thin fog). `campfire_01.png` is the only derived copy: its source is RGB with an opaque near-white background, so the Unity copy flood-fills that background to alpha. The source file is unchanged.

Import: Sprite, alpha-is-transparency, bilinear, clamp wrap, no mips, uncompressed. Fog PPU 256, smoke and fire PPU 640, fire pivot bottom-center, ember proof dot PPU 32.

## Performance notes
Renderers are created once at init. Playback does not Instantiate or Destroy, use LINQ, or call
Resources.Load, and it does not create material instances (`sharedMaterial` only). There is no
significant object or hierarchy churn. Releasing a particle slot does box one integer. Pools never
grow at runtime; when full, spawns are skipped. Mobile/device profiling remains deferred.
