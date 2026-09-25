using UnityEngine;

namespace RepWars
{
    /// <summary>
    /// Places one authored composition instance in the projected map.
    /// Each imported sprite pivot is the bottom-center of its visible opaque pixels.
    /// The SpriteRenderer transform sits on the projected authored position.
    /// Authored scale is the transform scale. Pixels per unit stay at 100.
    /// </summary>
    public static class RepWarsPropPlacement
    {
        /// <summary>
        /// Authored depth is painter order: a larger depth draws in front of a smaller one.
        /// Territory fill uses sortingOrder 0 and 1, borders use 4, and army markers use 20.
        /// This origin plus the rounded depth puts Level 1 depth 5 at sortingOrder 10,
        /// above the land and below troop labels.
        /// Sprites that share a sortingOrder are ordered by the map camera axis (0, 1, -0.2),
        /// so a prop higher on the map draws behind one lower on the map.
        /// </summary>
        public const int SortingOrigin = 5;

        public static int SortingOrder(float depth)
        {
            return SortingOrigin + Mathf.RoundToInt(depth);
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
