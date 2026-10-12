using UnityEngine;

namespace RepWars.Environment.Effects
{
    /// <summary>
    /// Anchored rising smoke plume (chimney, campfire, burning building). Particles rise from the
    /// anchor, drift with wind, expand and fade; occasional detached puffs break away faster and smaller.
    /// The anchor is this transform plus anchorOffset, so the plume stays attached to its prop.
    /// </summary>
    [AddComponentMenu("RepWars/Environment/Effects/Smoke Plume Controller (Anchored)")]
    public sealed class SmokePlumeController : EnvironmentalEffectBase
    {
        [SerializeField] Sprite[] smokeSprites = new Sprite[0];
        [SerializeField] PlumeSettings settings = new PlumeSettings();
        [SerializeField] Vector2 anchorOffset = Vector2.zero;
        [SerializeField] Color tint = new Color(0.55f, 0.55f, 0.58f, 1f);
        [SerializeField] Material sharedMaterial;
        [SerializeField] SmokePlumePreset preset;

        SpriteParticleSystem _system;
        float _puffAccumulator;

        public PlumeSettings Settings => settings;
        public int AliveCount => _system == null ? 0 : _system.AliveCount;
        public int Capacity => _system == null ? 0 : _system.Capacity;
        public int PuffsEmitted { get; private set; }

        public Vector2 AnchorOffset { get => anchorOffset; set => anchorOffset = value; }

        protected override bool SanitizeSettings()
        {
            if (settings == null) settings = new PlumeSettings();
            return settings.Sanitize();
        }

        protected override void Initialize()
        {
            if (preset != null) CopyFrom(preset);
            _system = new SpriteParticleSystem(transform, "PlumeParticles", settings.body.maxParticles, sharedMaterial);
            ConfigureSystem();
            if (smokeSprites == null || smokeSprites.Length == 0) LogOnce("no smoke sprites assigned (ART ASSET REQUIRED).");
        }

        void ConfigureSystem()
        {
            _system.Space = common.simulationSpace;
            _system.Tint = tint;
            _system.ConfigureRenderers(smokeSprites, common.sortingLayerName, common.sortingOrder, Random);
        }

        public void ApplyPreset(SmokePlumePreset p)
        {
            if (p == null) return;
            CopyFrom(p);
            ValidateAll();
            if (_system != null)
            {
                if (settings.body.maxParticles > _system.Capacity) { settings.body.maxParticles = _system.Capacity; LogOnce("preset maxParticles exceeds pooled capacity; clamped."); }
                ConfigureSystem();
            }
        }

        void CopyFrom(SmokePlumePreset p)
        {
            preset = p;
            settings = JsonUtility.FromJson<PlumeSettings>(JsonUtility.ToJson(p.settings));
            if (p.sprites != null && p.sprites.Length > 0) smokeSprites = p.sprites;
            tint = p.tint;
            anchorOffset = p.anchorOffset;
            if (p.overrideCommon && p.common != null) common = p.common.Clone();
        }

        public void SetSprites(Sprite[] sprites) { smokeSprites = sprites ?? new Sprite[0]; }

        protected override void Tick(float dt)
        {
            bool canEmit = smokeSprites != null && smokeSprites.Length > 0 && Fade.Target > 0f;
            if (canEmit)
            {
                _system.EmitByRate(settings.body, dt, anchorOffset, Random, smokeSprites);
                if (settings.detachedPuffs)
                {
                    _puffAccumulator += settings.puffChancePerSecond * dt;
                    if (_puffAccumulator >= 1f)
                    {
                        _puffAccumulator -= 1f;
                        if (_system.Emit(settings.body, anchorOffset, Random, smokeSprites,
                                Random.Range(settings.puffScaleMultiplier),
                                Random.Range(settings.puffSpeedMultiplier),
                                Random.Range(settings.puffLifetimeMultiplier)))
                            PuffsEmitted++;
                    }
                }
            }
            _system.Simulate(settings.body, dt, MasterOpacity);
        }

        protected override void OnStoppedImmediate() { _system?.Clear(); _puffAccumulator = 0f; }

        void OnDrawGizmosSelected()
        {
            Gizmos.color = new Color(0.5f, 0.5f, 0.5f, 0.8f);
            Gizmos.DrawWireSphere(transform.TransformPoint(anchorOffset), 0.08f);
        }
    }
}
