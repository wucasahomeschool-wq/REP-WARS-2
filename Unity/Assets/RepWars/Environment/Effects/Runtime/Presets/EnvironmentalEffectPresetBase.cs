using UnityEngine;

namespace RepWars.Environment.Effects
{
    // Reusable ScriptableObject presets: one preset can drive any number of props.
    // Controllers deep-copy settings on ApplyPreset so runtime tweaks never write back into the asset.
    public abstract class EnvironmentalEffectPresetBase : ScriptableObject
    {
        [Tooltip("If true, sorting/time/seed/fade settings from this preset replace the controller's own.")]
        public bool overrideCommon;
        public EffectCommonSettings common = new EffectCommonSettings();
    }
}
