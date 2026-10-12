using UnityEngine;

namespace RepWars.Environment.Effects
{
    /// <summary>
    /// Broad drifting smoke / haze across a local area (battlefield haze, smouldering ruins).
    /// Pooled sprite particles spawn anywhere in the area, drift with wind, expand and fade.
    /// </summary>
    [AddComponentMenu("RepWars/Environment/Effects/Smoke Controller (Broad)")]
    public sealed class SmokeController : EnvironmentalEffectBase
    {
        [SerializeField] Sprite[] smokeSprites = new Sprite[0];
        [SerializeField] SpriteEmissionSettings settings = DefaultBroad();
        [SerializeField] Color tint = new Color(0.75f, 0.75f, 0.78f, 1f);
        [SerializeField] Material sharedMaterial;
        [SerializeField] SmokePreset preset;

        SpriteParticleSystem _system;

        public SpriteEmissionSettings Settings => settings;
        public int AliveCount => _system == null ? 0 : _system.AliveCount;
        public int Capacity => _system == null ? 0 : _system.Capacity;

        public static SpriteEmissionSettings DefaultBroad()
        {
            return new SpriteEmissionSettings
            {
                maxParticles = 14, ratePerSecond = 1.5f, lifetime = new FloatRange(6f, 9f),
                startScale = new FloatRange(0.8f, 1.2f), endScaleMultiplier = new FloatRange(1.3f, 1.7f),
                startAlpha = new FloatRange(0.15f, 0.3f), fadeInFraction = 0.3f, fadeOutFraction = 0.4f,
                velocityX = 0.3f, velocityY = 0.05f, velocityJitter = 0.08f, drag = 0f,
                swayAmplitude = 0.1f, swayFrequency = new FloatRange(0.05f, 0.15f),
                spawnRadiusX = 6f, spawnRadiusY = 2f, rotationSpeed = new FloatRange(-4f, 4f)
            };
        }

        protected override bool SanitizeSettings()
        {
            if (settings == null) settings = DefaultBroad();
            return settings.Sanitize();
        }

        protected override void Initialize()
        {
            if (preset != null) CopyFrom(preset);
            _system = new SpriteParticleSystem(transform, "SmokeParticles", settings.maxParticles, sharedMaterial);
            ConfigureSystem();
            if (smokeSprites == null || smokeSprites.Length == 0) LogOnce("no smoke sprites assigned (ART ASSET REQUIRED).");
        }

        void ConfigureSystem()
        {
            _system.Space = common.simulationSpace;
            _system.Tint = tint;
            _system.ConfigureRenderers(smokeSprites, common.sortingLayerName, common.sortingOrder, Random);
        }

        public void ApplyPreset(SmokePreset p)
        {
            if (p == null) return;
            int oldCap = settings.maxParticles;
            CopyFrom(p);
            ValidateAll();
            if (_system != null)
            {
                if (settings.maxParticles > _system.Capacity) { settings.maxParticles = _system.Capacity; LogOnce("preset maxParticles exceeds pooled capacity; clamped (pool never grows at runtime)."); }
                ConfigureSystem();
            }
            if (oldCap != settings.maxParticles && _system == null) { /* applied before init: pool sized on Initialize */ }
        }

        void CopyFrom(SmokePreset p)
        {
            preset = p;
            settings = JsonUtility.FromJson<SpriteEmissionSettings>(JsonUtility.ToJson(p.settings));
            if (p.sprites != null && p.sprites.Length > 0) smokeSprites = p.sprites;
            tint = p.tint;
            if (p.overrideCommon && p.common != null) common = p.common.Clone();
        }

        protected override void OnPlay()
        {
            // Pre-populate so broad haze is already present instead of building up from nothing.
            if (_system.AliveCount == 0 && smokeSprites != null && smokeSprites.Length > 0)
            {
                int n = Mathf.Min(_system.Capacity, Mathf.CeilToInt(settings.ratePerSecond * settings.lifetime.Lerp(0.5f)));
                for (int i = 0; i < n; i++) _system.Emit(settings, Vector2.zero, Random, smokeSprites, 1f, 1f, Random.Range(0.3f, 1f));
            }
        }

        protected override void Tick(float dt)
        {
            if (smokeSprites != null && smokeSprites.Length > 0 && !IsFadingOut())
                _system.EmitByRate(settings, dt, Vector2.zero, Random, smokeSprites);
            _system.Simulate(settings, dt, MasterOpacity);
        }

        bool IsFadingOut() { return Fade.Target <= 0f; }

        protected override void OnStoppedImmediate() { _system?.Clear(); }

        void OnDrawGizmosSelected()
        {
            if (settings == null) return;
            Gizmos.color = new Color(0.6f, 0.6f, 0.6f, 0.6f);
            Gizmos.matrix = transform.localToWorldMatrix;
            Gizmos.DrawWireCube(Vector3.zero, new Vector3(settings.spawnRadiusX * 2f, settings.spawnRadiusY * 2f, 0f));
        }
    }
}
