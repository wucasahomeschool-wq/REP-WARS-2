using UnityEngine;

namespace RepWars.Environment.Effects
{
    [CreateAssetMenu(menuName = "RepWars/Environment/Effects/Smoke Plume Preset", fileName = "SmokePlumePreset")]
    public sealed class SmokePlumePreset : EnvironmentalEffectPresetBase
    {
        public Sprite[] sprites = new Sprite[0];
        public PlumeSettings settings = new PlumeSettings();
        public Color tint = new Color(0.55f, 0.55f, 0.58f, 1f);
        public Vector2 anchorOffset;
    }
}
