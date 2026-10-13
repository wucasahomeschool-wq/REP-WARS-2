using RepWars.WorldPresentation;
using UnityEngine;

namespace RepWars
{
    /// <summary>
    /// Places the authored decorative props. Sorting comes from RepWarsPropPlacement and the World contract.
    /// One shared sprite material per build is owned by the map's RepWarsMapResources.
    /// </summary>
    public static class RepWarsPropPresenter
    {
        public static void Build(Transform parent, AuthoredWorld world, RepWarsPropCatalog catalog, RepWarsMapResources resources)
        {
            Material material = null;
            var rendered = 0;
            var skipped = 0;
            foreach (var prop in world.props)
            {
                var placed = PlaceProp(parent, prop, catalog, resources, ref material);
                if (!placed) skipped++;
                else rendered++;
            }
            Debug.Log("[RepWars] authored props=" + world.props.Count
                + " rendered=" + rendered
                + " skipped=" + skipped
                + " locations=" + world.locations.Count);
        }

        static bool PlaceProp(
            Transform parent,
            AuthoredProp prop,
            RepWarsPropCatalog catalog,
            RepWarsMapResources resources,
            ref Material material)
        {
            if (string.IsNullOrEmpty(prop.assetId)) return false;
            if (!prop.hasScale)
            {
                Debug.LogWarning("[RepWars] prop " + prop.instanceId + " has no authored scale");
                return false;
            }
            var sprite = catalog != null ? catalog.Find(prop.assetId) : null;
            if (sprite == null)
            {
                Debug.LogWarning("[RepWars] no sprite registered for " + prop.assetId);
                return false;
            }
            if (!RepWarsPropPlacement.UsesImportedPivot(prop.anchor))
            {
                Debug.LogWarning("[RepWars] prop " + prop.instanceId + " has unsupported anchor " + prop.anchor);
                return false;
            }
            var marker = new GameObject("Prop_" + (string.IsNullOrEmpty(prop.instanceId) ? prop.assetId : prop.instanceId));
            marker.transform.SetParent(parent, false);
            var rotation = Quaternion.Euler(0f, 0f, -prop.rotationDegrees);
            var projected = MapProjection.Project(prop.position);
            marker.transform.SetPositionAndRotation(new Vector3(projected.x, projected.y, 0f), rotation);
            marker.transform.localScale = new Vector3(prop.scale, prop.scale, 1f);
            var renderer = RepWarsPropPlacement.AttachSortedSprite(
                marker.transform,
                sprite,
                RepWarsPropPlacement.TieId(prop.instanceId, prop.assetId));
            if (material == null) material = resources.NewSpriteMaterial();
            renderer.sharedMaterial = material;
            return true;
        }
    }
}
