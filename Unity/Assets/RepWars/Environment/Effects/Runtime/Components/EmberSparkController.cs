using UnityEngine;

namespace RepWars.Environment.Effects
{
    /// <summary>
    /// Sparse embers (slow, drifting, flickering) and sparks (fast, short, falling) from one anchor,
    /// each with its own rate, pool and enable flag. Designed to sit beside a FireFrameController.
    /// </summary>
    [AddComponentMenu("RepWars/Environment/Effects/Ember Spark Controller")]
    public sealed class EmberSparkController : EnvironmentalEffectBase
    {
        [SerializeField] Sprite[] emberSprites = new Sprite[0];
        [SerializeField] Sprite[] sparkSprites = new Sprite[0];
        [SerializeField] EmberSparkSettings settings = new EmberSparkSettings();
        [SerializeField] Vector2 anchorOffset = new Vector2(0f, 0.2f);
        [SerializeField] Color emberTint = new Color(1f, 0.55f, 0.15f, 1f);
        [SerializeField] Color sparkTint = new Color(1f, 0.9f, 0.55f, 1f);
        [SerializeField] Material sharedMaterial;
        [SerializeField] EmberSparkPreset preset;

        SpriteParticleSystem _embers;
        SpriteParticleSystem _sparks;

        public EmberSparkSettings Settings => settings;
        public int EmberAlive => _embers == null ? 0 : _embers.AliveCount;
        public int SparkAlive => _sparks == null ? 0 : _sparks.AliveCount;
        public int EmberCapacity => _embers == null ? 0 : _embers.Capacity;
        public int SparkCapacity => _sparks == null ? 0 : _sparks.Capacity;

        protected override bool SanitizeSettings()
        {
            if (settings == null) settings = new EmberSparkSettings();
            return settings.Sanitize();
        }

        protected override void Initialize()
        {
            if (preset != null) CopyFrom(preset);
            _embers = new SpriteParticleSystem(transform, "Embers", settings.embers.maxParticles, sharedMaterial);
            _sparks = new SpriteParticleSystem(transform, "Sparks", settings.sparks.maxParticles, sharedMaterial);
            ConfigureSystems();
            if ((emberSprites == null || emberSprites.Length == 0) && (sparkSprites == null || sparkSprites.Length == 0))
                LogOnce("no ember/spark sprites assigned (ART ASSET REQUIRED).");
        }

        void ConfigureSystems()
        {
            _embers.Space = common.simulationSpace; _embers.Tint = emberTint;
            _sparks.Space = common.simulationSpace; _sparks.Tint = sparkTint;
            _embers.ConfigureRenderers(emberSprites, common.sortingLayerName, common.sortingOrder + 1, Random);
            _sparks.ConfigureRenderers(sparkSprites, common.sortingLayerName, common.sortingOrder + 2, Random);
        }

        public void ApplyPreset(EmberSparkPreset p)
        {
            if (p == null) return;
            CopyFrom(p);
            ValidateAll();
            if (_embers != null)
            {
                bool c = false;
                settings.embers.maxParticles = EffectClamp.Clamp(settings.embers.maxParticles, 0, _embers.Capacity, ref c);
                settings.sparks.maxParticles = EffectClamp.Clamp(settings.sparks.maxParticles, 0, _sparks.Capacity, ref c);
                if (c) LogOnce("preset maxParticles exceeds pooled capacity; clamped.");
                ConfigureSystems();
            }
        }

        void CopyFrom(EmberSparkPreset p)
        {
            preset = p;
            settings = JsonUtility.FromJson<EmberSparkSettings>(JsonUtility.ToJson(p.settings));
            if (p.emberSprites != null && p.emberSprites.Length > 0) emberSprites = p.emberSprites;
            if (p.sparkSprites != null && p.sparkSprites.Length > 0) sparkSprites = p.sparkSprites;
            emberTint = p.emberTint; sparkTint = p.sparkTint; anchorOffset = p.anchorOffset;
            if (p.overrideCommon && p.common != null) common = p.common.Clone();
        }

        public void SetSprites(Sprite[] embers, Sprite[] sparks)
        {
            emberSprites = embers ?? new Sprite[0];
            sparkSprites = sparks ?? new Sprite[0];
        }

        protected override void Tick(float dt)
        {
            bool emit = Fade.Target > 0f;
            float m = MasterOpacity;
            if (emit && settings.embersEnabled && emberSprites.Length > 0) _embers.EmitByRate(settings.embers, dt, anchorOffset, Random, emberSprites);
            if (emit && settings.sparksEnabled && sparkSprites.Length > 0) _sparks.EmitByRate(settings.sparks, dt, anchorOffset, Random, sparkSprites);
            _embers.Simulate(settings.embers, dt, m);
            _sparks.Simulate(settings.sparks, dt, m);
        }

        protected override void OnStoppedImmediate() { _embers?.Clear(); _sparks?.Clear(); }
    }
}
