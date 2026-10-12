using RepWars.WorldPresentation;
using UnityEngine;

namespace RepWars
{
    /// <summary>
    /// Places one authored composition instance in the projected map.
    /// The prop root stays on the projected position. A presentation child carries the cosmetic tie z.
    /// Each imported sprite pivot is the bottom-center of its visible opaque pixels.
    /// Authored scale is the root scale. Pixels per unit stay at 100.
    /// Authored depth remains in the world definition and does not choose sorting order.
    /// </summary>
    public static class RepWarsPropPlacement
    {
        public static string TieId(string instanceId, string assetId)
        {
            if (!string.IsNullOrEmpty(instanceId)) return instanceId;
            return assetId ?? "";
        }

        /// <summary>
        /// Sprite sits on a presentation child at the root. The root position is unchanged.
        /// </summary>
        public static SpriteRenderer AttachSortedSprite(Transform propRoot, Sprite sprite, string stableId)
        {
            var presentation = new GameObject("Presentation");
            presentation.transform.SetParent(propRoot, false);
            RepWarsWorldSorting.ApplyTieOffset(presentation.transform, stableId ?? "");
            var renderer = presentation.AddComponent<SpriteRenderer>();
            renderer.sprite = sprite;
            RepWarsWorldSorting.ApplyWorldEntity(renderer);
            return renderer;
        }

        /// <summary>
        /// Level 1 pivots are imported as the visible bottom-center.
        /// Only that authored anchor matches those pivots.
        /// </summary>
        public static bool UsesImportedPivot(string anchor)
        {
            return anchor == "bottom-center";
        }
    }
}
