using System;
using UnityEngine;

namespace RepWars.Characters
{
    /// <summary>
    /// Explicit list of every character definition the runtime may resolve by id.
    /// Mirrors RepWarsPropCatalog: content is registered by reference, not discovered by filename.
    /// Loaded from Resources so callers do not need a scene reference.
    /// </summary>
    [CreateAssetMenu(fileName = "RepWarsCharacterRegistry", menuName = "RepWars/Characters/Character Registry")]
    public class RepWarsCharacterRegistry : ScriptableObject
    {
        public const string ResourcePath = "RepWarsCharacterRegistry";

        public CharacterBaseDefinition[] bases = Array.Empty<CharacterBaseDefinition>();
        public AppearanceDefinition[] appearances = Array.Empty<AppearanceDefinition>();
        public CharacterVariantDefinition[] variants = Array.Empty<CharacterVariantDefinition>();
        public RigProfileDefinition[] rigs = Array.Empty<RigProfileDefinition>();
        public AnimationProfileDefinition[] animationProfiles = Array.Empty<AnimationProfileDefinition>();

        public RepWarsEmperorCatalog emperorCatalog;
        public RepWarsInfantryCatalog infantryCatalog;

        /// <summary>Actor root used when a base does not name its own prefab.</summary>
        public RepWarsCharacterActor defaultActorPrefab;
    }
}
