using UnityEngine;

namespace RepWars.Environment.Effects
{
    /// <summary>
    /// Shared lifecycle for every environmental presentation effect:
    /// Play / Stop / FadeIn / FadeOut / ApplyPreset, master opacity, time mode, sorting, seeding,
    /// and fail-safe config clamping that logs once per component.
    /// Presentation only: nothing here decides whether something burns or is foggy.
    /// Future authoritative state tells a higher layer which effect to Play.
    /// </summary>
    public abstract class EnvironmentalEffectBase : MonoBehaviour
    {
        [SerializeField] protected EffectCommonSettings common = new EffectCommonSettings();

        protected CosmeticRandom Random { get; private set; }
        protected readonly EffectFade Fade = new EffectFade();
        bool _loggedInvalid;
        bool _initialized;
        bool _stopping;

        public bool IsPlaying { get; private set; }
        public float MasterOpacity => Fade.Value * common.intensity;
        public EffectCommonSettings Common => common;

        protected virtual void OnEnable()
        {
            EnsureInitialized();
            if (common.playOnEnable) FadeIn();
        }

        protected virtual void OnDisable()
        {
            IsPlaying = false;
            _stopping = false;
            Fade.Set(0f);
            OnStoppedImmediate();
        }

        protected void EnsureInitialized()
        {
            if (_initialized) return;
            _initialized = true;
            ValidateAll();
            Random = CosmeticRandom.Create(common.useSeed, common.seed);
            Fade.Set(0f);
            Initialize();
        }

        /// <summary>Re-seed (e.g. for deterministic captures). Cosmetic only.</summary>
        public void Reseed(int seed)
        {
            common.useSeed = true;
            common.seed = seed;
            Random = new CosmeticRandom(seed);
            OnReseeded();
        }

        public void Play() { EnsureInitialized(); _stopping = false; IsPlaying = true; Fade.Set(1f); OnPlay(); }

        public void FadeIn() { FadeIn(common.fadeInSeconds); }
        public void FadeIn(float seconds)
        {
            EnsureInitialized();
            _stopping = false;
            if (!IsPlaying) { IsPlaying = true; OnPlay(); }
            Fade.FadeTo(1f, seconds);
        }

        public void FadeOut() { FadeOut(common.fadeOutSeconds); }
        public void FadeOut(float seconds)
        {
            if (!IsPlaying) return;
            _stopping = true;
            Fade.FadeTo(0f, seconds);
            if (seconds <= 0f) Stop();
        }

        /// <summary>Immediate stop: hides and returns all pooled visuals.</summary>
        public void Stop()
        {
            IsPlaying = false;
            _stopping = false;
            Fade.Set(0f);
            OnStoppedImmediate();
        }

        protected float DeltaTime => common.timeMode == EffectTimeMode.Unscaled ? Time.unscaledDeltaTime : Time.deltaTime;

        void Update()
        {
            if (!IsPlaying) return;
            float dt = DeltaTime;
            Fade.Tick(dt);
            Tick(dt);
            if (_stopping && Fade.Value <= 0f) Stop();
        }

        /// <summary>Run all Sanitize() passes; logs a single warning per component on first correction.</summary>
        protected void ValidateAll()
        {
            if (common == null) common = new EffectCommonSettings();
            bool changed = common.Sanitize();
            changed |= SanitizeSettings();
            if (changed) LogOnce("config contained invalid values; they were clamped to safe bounds.");
        }

        protected void LogOnce(string message)
        {
            if (_loggedInvalid) return;
            _loggedInvalid = true;
            Debug.LogWarning("[EnvironmentalEffects] " + GetType().Name + " on '" + name + "': " + message, this);
        }

        protected void ApplySorting(SpriteRenderer r, int orderOffset)
        {
            r.sortingLayerName = common.sortingLayerName;
            r.sortingOrder = common.sortingOrder + orderOffset;
        }

        protected virtual void OnValidate()
        {
            if (common == null) common = new EffectCommonSettings();
            common.Sanitize();
            SanitizeSettings();
        }

        protected abstract bool SanitizeSettings();
        protected abstract void Initialize();
        protected abstract void Tick(float dt);
        protected virtual void OnPlay() { }
        protected virtual void OnStoppedImmediate() { }
        protected virtual void OnReseeded() { }
    }
}
