using UnityEngine;

namespace RepWars.Characters
{
    /// <summary>Army character appearances.</summary>
    [CreateAssetMenu(fileName = "RepWarsInfantryCatalog", menuName = "RepWars/Characters/Infantry Catalog")]
    public class RepWarsInfantryCatalog : CharacterCatalogAsset
    {
        /// <summary>Variant armies use when nothing more specific is chosen. Army code reads this instead of hardcoding an id.</summary>
        public string defaultInfantryVariantId = "generic_soldier";
    }
}
