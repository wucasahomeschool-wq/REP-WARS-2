using System;
using UnityEngine;

namespace RepWars.Environment.Effects
{
    /// <summary>
    /// Plays an arbitrary list of authored fire frames in random order with no immediate repeat,
    /// holding each for a bounded random time. The fire is anchored at its base: pulse scales upward
    /// from the base and sway rotates about the base, so the flame never slides off its prop.
    /// An optional glow renderer and OnGlow callback are exposed as hooks (no lighting system is assumed).
    /// </summary>
    [AddComponentMenu("RepWars/Environment/Effects/Fire Frame Controller")]
    public sealed class FireFrameController : EnvironmentalEffectBase
    {
        [SerializeField] Sprite[] frames = new Sprite[0];
        [SerializeField] FireSettings settings = new FireSettings();
        [Tooltip("Optional. Created as a child if left empty.")]
        [SerializeField] SpriteRenderer flameRenderer;
        [Tooltip("Optional soft glow sprite renderer whose alpha follows the glow value.")]
        [SerializeField] SpriteRenderer glowRenderer;
        [SerializeField] Material sharedMaterial;
        [SerializeField] FirePreset preset;

        /// <summary>Glow hook: receives 0..1 glow intensity each frame (e.g. drive a 2D light later). No allocation.</summary>
        public event Action<float> OnGlow;

        FramePicker _picker;
        Transform _pivot;          // sits at the flame base; sway/pulse are applied here
        float _frameTimer;
        float _pulsePhase, _pulsePeriod, _swayPhase, _swayPeriod, _age;

        public FireSettings Settings => settings;
        public int CurrentFrame => _picker == null ? -1 : _picker.Current;
        public int FrameChanges { get; private set; }

        protected override bool SanitizeSettings()
        {
            if (settings == null) settings = new FireSettings();
            return settings.Sanitize();
        }

        protected override void Initialize()
        {
            if (preset != null) CopyFrom(preset);
            _picker = new FramePicker(Random, frames == null ? 0 : frames.Length);
            if (flameRenderer == null)
            {
                var pivotGo = new GameObject("FlamePivot");
                pivotGo.transform.SetParent(transform, false);
                var go = new GameObject("Flame");
                go.transform.SetParent(pivotGo.transform, false);
                flameRenderer = go.AddComponent<SpriteRenderer>();
                if (sharedMaterial != null) flameRenderer.sharedMaterial = sharedMaterial;
            }
            _pivot = flameRenderer.transform.parent != null ? flameRenderer.transform.parent : flameRenderer.transform;
            ApplySorting(flameRenderer, 0);
            if (glowRenderer != null) ApplySorting(glowRenderer, -1);
            flameRenderer.enabled = false;
            if (frames == null || frames.Length == 0) LogOnce("no fire frames assigned (ART ASSET REQUIRED).");
            RandomizePhases();
        }

        void RandomizePhases()
        {
            _pulsePhase = Random.Range(0f, 6.2831853f);
            _pulsePeriod = Random.Range(settings.pulsePeriod);
            _swayPhase = Random.Range(0f, 6.2831853f);
            _swayPeriod = Random.Range(settings.swayPeriod);
        }

        protected override void OnReseeded() { _picker = new FramePicker(Random, frames == null ? 0 : frames.Length); RandomizePhases(); }

        public void ApplyPreset(FirePreset p)
        {
            if (p == null) return;
            CopyFrom(p);
            ValidateAll();
            if (_picker != null) { _picker.SetFrameCount(frames.Length); RandomizePhases(); }
        }

        void CopyFrom(FirePreset p)
        {
            preset = p;
            settings = JsonUtility.FromJson<FireSettings>(JsonUtility.ToJson(p.settings));
            if (p.frames != null && p.frames.Length > 0) frames = p.frames;
            if (p.overrideCommon && p.common != null) common = p.common.Clone();
        }

        public void SetFrames(Sprite[] newFrames)
        {
            frames = newFrames ?? new Sprite[0];
            _picker?.SetFrameCount(frames.Length);
            if (IsPlaying) ShowNextFrame();
        }

        protected override void OnPlay()
        {
            flameRenderer.enabled = frames != null && frames.Length > 0;
            ShowNextFrame();
        }

        void ShowNextFrame()
        {
            int i = _picker.Next();
            if (i < 0) { flameRenderer.enabled = false; return; }
            var sprite = frames[i];
            if (sprite == null) { LogOnce("a fire frame entry is null; it is skipped."); return; }
            flameRenderer.sprite = sprite;
            // Anchor: offset the flame so the sprite's bottom edge sits on the pivot regardless of the frame's pivot.
            var b = sprite.bounds;
            flameRenderer.transform.localPosition = new Vector3(-b.center.x, -b.min.y, 0f);
            _frameTimer = Random.Range(settings.frameTime);
            FrameChanges++;
        }

        protected override void Tick(float dt)
        {
            _age += dt;
            _frameTimer -= dt;
            if (_frameTimer <= 0f) ShowNextFrame();

            float pulse = settings.pulse ? Mathf.Sin(_pulsePhase + _age * 6.2831853f / _pulsePeriod) : 0f;
            float sy = 1f + settings.pulseAmount * pulse;
            float sx = 1f + settings.pulseAmount * 0.4f * pulse;
            _pivot.localScale = new Vector3(sx, sy, 1f);          // grows up from the base only
            float sway = settings.sway ? settings.swayDegrees * Mathf.Sin(_swayPhase + _age * 6.2831853f / _swayPeriod) : 0f;
            _pivot.localRotation = Quaternion.Euler(0f, 0f, sway); // rotates about the base

            float master = MasterOpacity;
            var c = flameRenderer.color; c.a = master; flameRenderer.color = c;

            float glow = Mathf.Clamp01((settings.glowBase + settings.glowFlicker * pulse) * master);
            if (glowRenderer != null) { var g = glowRenderer.color; g.a = glow; glowRenderer.color = g; }
            OnGlow?.Invoke(glow);
        }

        protected override void OnStoppedImmediate()
        {
            if (flameRenderer != null) flameRenderer.enabled = false;
            if (glowRenderer != null) { var g = glowRenderer.color; g.a = 0f; glowRenderer.color = g; }
            OnGlow?.Invoke(0f);
        }
    }
}
