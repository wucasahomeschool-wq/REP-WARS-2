using System;

namespace RepWars.Characters
{
    /// <summary>
    /// One selectable choice in a catalog. It points at a variant. It carries no rendering data.
    /// </summary>
    [Serializable]
    public class CharacterCatalogEntry
    {
        public string catalogEntryId;
        public string variantId;
        public string displayName;
        public string[] tags = Array.Empty<string>();
        public int sortOrder;
    }
}
