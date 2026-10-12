using UnityEngine;
using UnityEngine.Rendering;

namespace RepWars.WorldPresentation
{
    /// <summary>
    /// Presentation-only world sorting contract. This type does not read gameplay state,
    /// move authoritative objects, or decide where anything is allowed to stand.
    /// Depth-aware entities use the World layer at order 0. Their order comes from the
    /// shared custom transparency axis and the sprite pivot (feet / base), not from sortingOrder.
    /// A cosmetic z tie lives on a presentation child so the authoritative position stays put.
    /// Territory selection uses a GroundOverlay highlight at <see cref="GroundOverlayOrder.Selection"/>
    /// and a world-anchored marker at <see cref="WorldOverlayOrder.SelectionMarker"/>.
    /// </summary>
    public static class RepWarsWorldSorting
    {
        public const string LayerBackdrop = "Backdrop";
        public const string LayerGround = "Ground";
        public const string LayerGroundOverlay = "GroundOverlay";
        public const string LayerWorld = "World";
        public const string LayerAtmosphere = "Atmosphere";
        public const string LayerWorldOverlay = "WorldOverlay";

        /// <summary>
        /// Provisional axis (0, 1, 1), kept after T0 because a larger Y sorts farther
        /// and a larger z sorts farther. URP 2D reads this from Renderer2DData.
        /// The camera is set to the same axis so the two configurations match;
        /// the 2D renderer does not use the camera axis.
        /// </summary>
        public static readonly Vector3 SortAxis = new Vector3(0f, 1f, 1f);

        public const int WorldEntityOrder = 0;

        public const float TieEpsilon = 0.0001f;
        public const int TieIndexMin = 0;
        public const int TieIndexMax = 63;

        /// <summary>
        /// One prop pixel at the map's imported 100 pixels-per-unit. Any real foot
        /// separation at least this large must beat the whole tie range.
        /// </summary>
        public const float MinimumMeaningfulY = 0.01f;

        public static float MaxTieOffset => TieIndexMax * TieEpsilon;

        public static class BackdropOrder
        {
            public const int Sky = 0;
            public const int Horizon = 10;
            public const int Distant = 30;
        }

        public static class GroundOrder
        {
            public const int Canvas = 0;
            public const int Terrain = 10;
            public const int Road = 20;
            public const int BakedScenery = 30;
        }

        public static class GroundOverlayOrder
        {
            public const int Ownership = 0;
            public const int Border = 10;
            public const int Selection = 20;
            public const int Target = 30;
            public const int Route = 40;
        }

        public static class AtmosphereOrder
        {
            public const int Ambient = 0;
            public const int WorldEdgeFog = 20;
            public const int Weather = 50;
        }

        public static class WorldOverlayOrder
        {
            public const int RegionLabel = 0;
            public const int LocationLabel = 10;
            public const int TroopMarker = 20;
            public const int SelectionMarker = 30;
        }

        /// <summary>FNV-1a over UTF-16 code units, then folded into the tie range. Stable across runs.</summary>
        public static int TieIndex(string stableId)
        {
            uint hash = 2166136261u;
            var text = stableId ?? "";
            for (var i = 0; i < text.Length; i++)
            {
                hash ^= text[i];
                hash *= 16777619u;
            }
            return (int)(hash % (uint)(TieIndexMax - TieIndexMin + 1)) + TieIndexMin;
        }

        public static float TieOffsetZ(string stableId)
        {
            return TieIndex(stableId) * TieEpsilon;
        }

        /// <summary>
        /// Slot ties stay on the slot index. Values outside 0..63 clamp so the offset cannot grow.
        /// </summary>
        public static int TieIndex(int slotIndex)
        {
            if (slotIndex <= TieIndexMin) return TieIndexMin;
            if (slotIndex >= TieIndexMax) return TieIndexMax;
            return slotIndex;
        }

        public static float TieOffsetZ(int slotIndex)
        {
            return TieIndex(slotIndex) * TieEpsilon;
        }

        /// <summary>
        /// Writes only local z. Call this on a presentation child, not on a gameplay transform.
        /// </summary>
        public static void ApplyTieOffset(Transform presentation, string stableId)
        {
            if (presentation == null) return;
            WriteTieZ(presentation, TieOffsetZ(stableId));
        }

        public static void ApplyTieOffset(Transform presentation, int slotIndex)
        {
            if (presentation == null) return;
            WriteTieZ(presentation, TieOffsetZ(slotIndex));
        }

        static void WriteTieZ(Transform presentation, float z)
        {
            var local = presentation.localPosition;
            local.z = z;
            presentation.localPosition = local;
        }

        public static void ApplyWorldEntity(SpriteRenderer renderer)
        {
            if (renderer == null) return;
            renderer.sortingLayerName = LayerWorld;
            renderer.sortingOrder = WorldEntityOrder;
            renderer.spriteSortPoint = SpriteSortPoint.Pivot;
        }

        public static void ApplyWorldGroup(SortingGroup group)
        {
            if (group == null) return;
            group.sortingLayerName = LayerWorld;
            group.sortingOrder = WorldEntityOrder;
        }

        public static void ApplyOrdered(Renderer renderer, string layerName, int order)
        {
            if (renderer == null) return;
            renderer.sortingLayerName = layerName;
            renderer.sortingOrder = order;
        }

        public static void ApplySortAxis(Camera camera)
        {
            if (camera == null) return;
            camera.transparencySortMode = TransparencySortMode.CustomAxis;
            camera.transparencySortAxis = SortAxis;
        }
    }
}
