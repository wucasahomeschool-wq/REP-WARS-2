using System;
using System.Collections.Generic;
using UnityEngine;

namespace RepWars
{
    [Serializable]
    public class RepWarsPropEntry
    {
        public string assetId;
        public Sprite sprite;
    }

    /// <summary>
    /// Explicit assetId to Sprite map. Lookup uses the authored id, not the PNG filename.
    /// </summary>
    [CreateAssetMenu(fileName = "RepWarsPropCatalog", menuName = "RepWars/Prop Catalog")]
    public class RepWarsPropCatalog : ScriptableObject
    {
        public RepWarsPropEntry[] entries = Array.Empty<RepWarsPropEntry>();
        public TextAsset authoredWorld;

        readonly Dictionary<string, Sprite> sprites = new Dictionary<string, Sprite>();

        public Sprite Find(string assetId)
        {
            if (sprites.Count == 0) Rebuild();
            if (string.IsNullOrEmpty(assetId)) return null;
            sprites.TryGetValue(assetId, out var sprite);
            return sprite;
        }

        public void Rebuild()
        {
            sprites.Clear();
            if (entries == null) return;
            foreach (var entry in entries)
            {
                if (entry == null || string.IsNullOrEmpty(entry.assetId) || entry.sprite == null) continue;
                sprites[entry.assetId] = entry.sprite;
            }
        }
    }
}
