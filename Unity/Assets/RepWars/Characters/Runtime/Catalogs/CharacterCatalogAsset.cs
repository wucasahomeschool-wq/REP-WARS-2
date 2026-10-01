using System;
using UnityEngine;

namespace RepWars.Characters
{
    /// <summary>Shared shape of the two purpose catalogs. A catalog is an index over variants and nothing more.</summary>
    public abstract class CharacterCatalogAsset : ScriptableObject
    {
        public CharacterCatalogEntry[] entries = Array.Empty<CharacterCatalogEntry>();
    }
}
