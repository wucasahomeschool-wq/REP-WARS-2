using System;
using UnityEngine;

namespace RepWars.Characters
{
    /// <summary>Small per-variant visual adjustments. Kept intentionally minimal.</summary>
    [Serializable]
    public class VariantVisualOverrides
    {
        public Color tint = Color.white;
        public float scaleMultiplier = 1f;
        public FacingPolicy facingPolicy = FacingPolicy.Mirror;
    }

    /// <summary>
    /// Base + appearance + optional overrides. This is the unit gameplay asks for by id.
    /// A variant does not own a prefab. It combines two existing definitions.
    /// </summary>
    [CreateAssetMenu(fileName = "character_variant", menuName = "RepWars/Characters/Character Variant")]
    public class CharacterVariantDefinition : ScriptableObject
    {
        public string variantId;
        public string displayName;
        public string baseId;
        public string appearanceId;
        public VariantVisualOverrides visualOverrides = new VariantVisualOverrides();
    }
}
