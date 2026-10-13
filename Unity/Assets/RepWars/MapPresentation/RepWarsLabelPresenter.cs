using RepWars.WorldPresentation;
using UnityEngine;

namespace RepWars
{
    /// <summary>
    /// Region and location text on the WorldOverlay layer. Troop-count labels are built by RepWarsArmyVisual.
    /// Text meshes use the built-in font and its shared material, so nothing here needs disposal.
    /// </summary>
    public static class RepWarsLabelPresenter
    {
        public static readonly Color Ink = new Color32(0xf0, 0xe6, 0xc8, 255);

        public static void BuildLocationLabels(Transform parent, AuthoredWorld world)
        {
            foreach (var location in world.locations)
            {
                if (!location.hasPosition && string.IsNullOrEmpty(location.name)) continue;
                var marker = new GameObject("Location_" + (location.name ?? location.territoryId));
                marker.transform.SetParent(parent, false);
                var projected = MapProjection.Project(location.position);
                marker.transform.position = new Vector3(projected.x, projected.y, -0.2f);
                var label = marker.AddComponent<TextMesh>();
                label.text = string.IsNullOrEmpty(location.visualAssetId) ? location.name : location.visualAssetId;
                label.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
                label.fontSize = 32;
                label.characterSize = 0.7f;
                label.anchor = TextAnchor.MiddleCenter;
                label.color = Ink;
                RepWarsWorldSorting.ApplyOrdered(label.GetComponent<MeshRenderer>(), RepWarsWorldSorting.LayerWorldOverlay, RepWarsWorldSorting.WorldOverlayOrder.LocationLabel);
            }
        }

        public static void BuildRegionLabels(Transform parent, AuthoredWorld world, Bounds bounds, bool hasBounds)
        {
            var characterSize = hasBounds ? Mathf.Max(0.07f, bounds.size.y * 0.0048f) : 0.09f;
            foreach (var region in world.regions)
            {
                if (string.IsNullOrEmpty(region.name) || !TryRegionLabelPoint(world, region.id, out var projected)) continue;
                var labelObject = new GameObject("Region_" + region.id);
                labelObject.transform.SetParent(parent, false);
                labelObject.transform.position = new Vector3(projected.x, projected.y, -0.5f);
                var label = labelObject.AddComponent<TextMesh>();
                label.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
                label.fontSize = 48;
                label.characterSize = characterSize;
                label.anchor = TextAnchor.MiddleCenter;
                label.alignment = TextAlignment.Center;
                label.color = new Color(Ink.r, Ink.g, Ink.b, 0.82f);
                label.text = region.name;
                var labelRenderer = label.GetComponent<MeshRenderer>();
                RepWarsWorldSorting.ApplyOrdered(labelRenderer, RepWarsWorldSorting.LayerWorldOverlay, RepWarsWorldSorting.WorldOverlayOrder.RegionLabel);
            }
        }

        static bool TryRegionLabelPoint(AuthoredWorld world, string regionId, out Vector2 point)
        {
            var has = false;
            var min = Vector2.zero;
            var max = Vector2.zero;
            foreach (var territory in world.territories)
            {
                if (territory.regionId != regionId) continue;
                for (var i = 0; i < territory.ring.Count; i++)
                {
                    var projected = MapProjection.Project(territory.ring[i]);
                    if (!has)
                    {
                        min = max = projected;
                        has = true;
                    }
                    else
                    {
                        min = Vector2.Min(min, projected);
                        max = Vector2.Max(max, projected);
                    }
                }
            }
            point = has ? new Vector2((min.x + max.x) * 0.5f, max.y - (max.y - min.y) * 0.16f) : Vector2.zero;
            return has;
        }
    }
}
