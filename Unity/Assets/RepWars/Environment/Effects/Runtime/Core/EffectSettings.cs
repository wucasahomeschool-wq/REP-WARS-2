using System;

namespace RepWars.Environment.Effects
{
    public enum EffectTimeMode { Scaled = 0, Unscaled = 1 }
    public enum EffectSimulationSpace { Local = 0, World = 1 }

    /// <summary>
    /// Settings shared by every environmental effect. Plain data so it can live in presets and tests.
    /// </summary>
    [Serializable]
    public class EffectCommonSettings
    {
        public string sortingLayerName = "Default";
        public int sortingOrder = 30;
        public EffectTimeMode timeMode = EffectTimeMode.Scaled;
        public EffectSimulationSpace simulationSpace = EffectSimulationSpace.Local;
        public bool useSeed;
        public int seed = 12345;
        public bool playOnEnable = true;
        public float fadeInSeconds = 0.75f;
        public float fadeOutSeconds = 0.75f;
        public float intensity = 1f;

        public bool Sanitize()
        {
            bool c = false;
            if (string.IsNullOrEmpty(sortingLayerName)) { sortingLayerName = "Default"; c = true; }
            fadeInSeconds = EffectClamp.Clamp(fadeInSeconds, 0f, 30f, ref c);
            fadeOutSeconds = EffectClamp.Clamp(fadeOutSeconds, 0f, 30f, ref c);
            intensity = EffectClamp.Clamp(intensity, 0f, 4f, ref c);
            return c;
        }

        public EffectCommonSettings Clone() { return (EffectCommonSettings)MemberwiseClone(); }
    }
}
