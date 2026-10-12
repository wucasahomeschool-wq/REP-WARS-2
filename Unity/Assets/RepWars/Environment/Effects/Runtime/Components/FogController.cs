using UnityEngine;

namespace RepWars.Environment.Effects
{
    /// <summary>
    /// Layers several thin transparent fog sprites inside a local rectangle. Each layer drifts
    /// slowly, bobs, breathes in scale and opacity, and wraps to the opposite edge. Opacity
    /// fades to zero near the edges, so wrapping never pops. Density comes from layerCount x opacity.
    /// Renderers are created once (up to the 64-layer cap) and reused; changing layerCount only toggles them.
    /// </summary>
    [AddComponentMenu("RepWars/Environment/Effects/Fog Controller")]
    public sealed class FogController : EnvironmentalEffectBase
    {
        public const int MaxLayers = 64;

        [SerializeField] Sprite[] fogSprites = new Sprite[0];
        [SerializeField] FogSettings settings = new FogSettings();
        [SerializeField] Material sharedMaterial;
        [SerializeField] FogPreset preset;

        struct Layer
        {
            public float x, y, baseY, speedMul, bobPhase, bobPeriod, baseScale;
            public float baseAlpha, pulsePhase, pulsePeriod, age;
        }

        SpriteRenderer[] _renderers;
        Transform[] _transforms;
        Layer[] _layers;
        int _activeCount;

        public FogSettings Settings => settings;
        public int ActiveLayerCount => _activeCount;
        public int PooledRendererCount => _renderers == null ? 0 : _renderers.Length;

        protected override bool SanitizeSettings()
        {
            if (settings == null) settings = new FogSettings();
            return settings.Sanitize();
        }

        protected override void Initialize()
        {
            if (preset != null) CopyFrom(preset);
            int cap = Mathf.Max(settings.layerCount, 1);
            // Allocate to the larger of current need and a small headroom; never above MaxLayers.
            cap = Mathf.Min(MaxLayers, Mathf.Max(cap, 8));
            _renderers = new SpriteRenderer[cap];
            _transforms = new Transform[cap];
            _layers = new Layer[cap];
            var container = new GameObject("FogLayers").transform;
            container.SetParent(transform, false);
            for (int i = 0; i < cap; i++)
            {
                var go = new GameObject("fog" + i);
                go.transform.SetParent(container, false);
                var r = go.AddComponent<SpriteRenderer>();
                if (sharedMaterial != null) r.sharedMaterial = sharedMaterial;
                r.enabled = false;
                _renderers[i] = r;
                _transforms[i] = go.transform;
            }
            if (fogSprites == null || fogSprites.Length == 0) LogOnce("no fog sprites assigned (ART ASSET REQUIRED); fog will be invisible.");
        }

        public void ApplyPreset(FogPreset p)
        {
            if (p == null) return;
            CopyFrom(p);
            ValidateAll();
            if (_renderers != null && IsPlaying) OnPlay();
        }

        void CopyFrom(FogPreset p)
        {
            preset = p;
            settings = JsonUtility.FromJson<FogSettings>(JsonUtility.ToJson(p.settings)); // deep copy, only on apply
            if (p.sprites != null && p.sprites.Length > 0) fogSprites = p.sprites;
            if (p.overrideCommon && p.common != null) common = p.common.Clone();
        }

        public void SetSprites(Sprite[] sprites) { fogSprites = sprites ?? new Sprite[0]; if (IsPlaying) OnPlay(); }

        /// <summary>Change density at runtime without allocating (clamped to pooled renderer count).</summary>
        public void SetLayerCount(int count)
        {
            settings.layerCount = Mathf.Clamp(count, 0, MaxLayers);
            if (_renderers != null && settings.layerCount > _renderers.Length) LogOnce("layerCount exceeds pooled renderers; extra layers ignored.");
            if (IsPlaying) OnPlay();
        }

        protected override void OnPlay()
        {
            _activeCount = Mathf.Min(settings.layerCount, _renderers.Length);
            for (int i = 0; i < _renderers.Length; i++)
            {
                bool on = i < _activeCount && fogSprites != null && fogSprites.Length > 0;
                _renderers[i].enabled = on;
                if (!on) continue;
                ApplySorting(_renderers[i], i);
                // Stagger initial positions evenly across the area so the first frame is already populated.
                float spread = (i + Random.Value()) / Mathf.Max(1, _activeCount);
                RespawnLayer(i, -settings.areaWidth * 0.5f + spread * settings.areaWidth);
            }
        }

        void RespawnLayer(int i, float x)
        {
            ref var l = ref _layers[i];
            l.x = x;
            l.baseY = Random.Signed(settings.areaHeight * 0.5f);
            l.y = l.baseY;
            l.speedMul = Random.Range(settings.speedVariation);
            l.bobPhase = Random.Range(0f, 6.2831853f);
            l.bobPeriod = Random.Range(settings.verticalBobPeriod);
            l.baseScale = Random.Range(settings.scale);
            l.baseAlpha = Random.Range(settings.opacity);
            l.pulsePhase = Random.Range(0f, 6.2831853f);
            l.pulsePeriod = Random.Range(settings.opacityPulsePeriod);
            l.age = 0f;
            var r = _renderers[i];
            if (fogSprites.Length > 0) r.sprite = fogSprites[Random.Range(0, fogSprites.Length)];
            r.flipX = settings.randomFlipX && Random.Chance(0.5f);
        }

        protected override void Tick(float dt)
        {
            float halfW = settings.areaWidth * 0.5f;
            float edge = settings.areaWidth * settings.edgeFadeFraction;
            float master = MasterOpacity;
            for (int i = 0; i < _activeCount; i++)
            {
                if (!_renderers[i].enabled) continue;
                ref var l = ref _layers[i];
                l.age += dt;
                l.x += settings.driftX * l.speedMul * dt;
                l.baseY += settings.driftY * l.speedMul * dt;
                // Wrap horizontally (alpha is ~0 at edges so this is invisible).
                if (l.x > halfW) RespawnLayer(i, -halfW);
                else if (l.x < -halfW) RespawnLayer(i, halfW);
                // Keep diagonal drift bounded vertically by wrapping inside the band.
                float halfH = settings.areaHeight * 0.5f;
                if (halfH > 0f)
                {
                    if (l.baseY > halfH) l.baseY -= settings.areaHeight;
                    else if (l.baseY < -halfH) l.baseY += settings.areaHeight;
                }
                float bob = settings.verticalBobAmplitude * Mathf.Sin(l.bobPhase + l.age * 6.2831853f / l.bobPeriod);
                float pulse = Mathf.Sin(l.pulsePhase + l.age * 6.2831853f / l.pulsePeriod);
                float distToEdge = halfW - Mathf.Abs(l.x);
                float edgeAlpha = Mathf.Clamp01(distToEdge / edge);
                float vEdge = halfH > 0f ? Mathf.Clamp01((halfH - Mathf.Abs(l.baseY)) / (halfH * 0.25f + 0.0001f)) : 1f;
                float a = l.baseAlpha * (1f + settings.opacityPulseAmount * pulse) * edgeAlpha * vEdge * master;

                float s = l.baseScale * (1f + settings.scalePulseAmount * pulse);
                var tr = _transforms[i];
                tr.localPosition = new Vector3(l.x, l.baseY + bob, 0f);
                tr.localScale = new Vector3(s * (1f + settings.scalePulseAmount * 0.5f * pulse), s, 1f);
                var c = _renderers[i].color;
                c.a = Mathf.Clamp01(a);
                _renderers[i].color = c;
            }
        }

        protected override void OnStoppedImmediate()
        {
            if (_renderers == null) return;
            for (int i = 0; i < _renderers.Length; i++) _renderers[i].enabled = false;
            _activeCount = 0;
        }

        void OnDrawGizmosSelected()
        {
            if (settings == null) return;
            Gizmos.color = new Color(0.7f, 0.8f, 1f, 0.6f);
            Gizmos.matrix = transform.localToWorldMatrix;
            Gizmos.DrawWireCube(Vector3.zero, new Vector3(settings.areaWidth, settings.areaHeight, 0f));
        }
    }
}
