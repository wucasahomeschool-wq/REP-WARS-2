using UnityEngine;

namespace RepWars.Environment.Effects
{
    [CreateAssetMenu(menuName = "RepWars/Environment/Effects/Ember Spark Preset", fileName = "EmberSparkPreset")]
    public sealed class EmberSparkPreset : EnvironmentalEffectPresetBase
    {
        public Sprite[] emberSprites = new Sprite[0];
        public Sprite[] sparkSprites = new Sprite[0];
        public EmberSparkSettings settings = new EmberSparkSettings();
        public Color emberTint = new Color(1f, 0.55f, 0.15f, 1f);
        public Color sparkTint = new Color(1f, 0.9f, 0.55f, 1f);
        public Vector2 anchorOffset = new Vector2(0f, 0.2f);
    }
}
