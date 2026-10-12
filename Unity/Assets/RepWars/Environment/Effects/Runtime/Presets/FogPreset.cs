using UnityEngine;

namespace RepWars.Environment.Effects
{
    [CreateAssetMenu(menuName = "RepWars/Environment/Effects/Fog Preset", fileName = "FogPreset")]
    public sealed class FogPreset : EnvironmentalEffectPresetBase
    {
        public Sprite[] sprites = new Sprite[0];
        public FogSettings settings = new FogSettings();
    }
}
