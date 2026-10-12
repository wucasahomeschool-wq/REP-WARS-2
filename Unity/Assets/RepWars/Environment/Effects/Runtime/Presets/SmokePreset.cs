using UnityEngine;

namespace RepWars.Environment.Effects
{
    [CreateAssetMenu(menuName = "RepWars/Environment/Effects/Smoke Preset (Broad)", fileName = "SmokePreset")]
    public sealed class SmokePreset : EnvironmentalEffectPresetBase
    {
        public Sprite[] sprites = new Sprite[0];
        public SpriteEmissionSettings settings = SmokeController.DefaultBroad();
        public Color tint = new Color(0.75f, 0.75f, 0.78f, 1f);
    }
}
