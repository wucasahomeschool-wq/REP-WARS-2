using UnityEngine;

namespace RepWars.Environment.Effects
{
    [CreateAssetMenu(menuName = "RepWars/Environment/Effects/Fire Preset", fileName = "FirePreset")]
    public sealed class FirePreset : EnvironmentalEffectPresetBase
    {
        public Sprite[] frames = new Sprite[0];
        public FireSettings settings = new FireSettings();
    }
}
