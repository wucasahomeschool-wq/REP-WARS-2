using System;
using UnityEngine;

namespace RepWars.Characters
{
    /// <summary>
    /// One layer of the base body. Positions are base-local units with the feet at the origin.
    /// </summary>
    [Serializable]
    public class BaseVisualLayer
    {
        public string layerId;
        public Sprite sprite;
        public Vector2 localPosition;
        public Vector2 localScale = Vector2.one;
        public int sortingOrder;

        /// <summary>True when the faction tint should multiply this layer (uniform colors). Skin and faces stay false.</summary>
        public bool receivesTint;
    }

    /// <summary>
    /// The fundamental identity of a character: body, rig family, animation profile, and rendering strategy.
    /// A base never contains role clothing. Soldier gear, crowns, and capes are AppearanceDefinitions.
    /// </summary>
    [CreateAssetMenu(fileName = "character_base", menuName = "RepWars/Characters/Character Base")]
    public class CharacterBaseDefinition : ScriptableObject
    {
        public string baseId;
        public string displayName;
        public CompatibilityTier compatibilityTier;
        public string rigProfileId;
        public string animationProfileId;

        /// <summary>Optional root prefab override. Empty means the registry's default actor prefab.</summary>
        public RepWarsCharacterActor actorPrefab;

        public CharacterBackendKind backendKind = CharacterBackendKind.Stub;
        public float defaultScale = 1f;

        /// <summary>The base body only. No role clothing. Phase A uses placeholder sprite layers.</summary>
        public BaseVisualLayer[] intrinsicVisuals = Array.Empty<BaseVisualLayer>();
    }
}
