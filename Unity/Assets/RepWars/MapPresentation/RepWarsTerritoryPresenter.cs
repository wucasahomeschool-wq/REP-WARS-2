using System.Collections.Generic;
using RepWars.WorldPresentation;
using UnityEngine;

namespace RepWars
{
    /// <summary>
    /// Builds one territory object per authored territory: terrain mesh, normal border, view, and pick collider.
    /// The authored world is the geometry source. Territory identity lives on RepWarsTerritoryView.
    /// Meshes and materials created here are owned by the map's RepWarsMapResources.
    /// </summary>
    public static class RepWarsTerritoryPresenter
    {
        const float BorderWidth = 0.35f;

        public static readonly Color BorderColor = new Color32(0x2a, 0x30, 0x38, 255);

        /// <summary>Handle to one built territory. Army placement reads it during the same build.</summary>
        public sealed class Piece
        {
            public AuthoredTerritory Territory;
            public Transform Transform;
            public List<Vector2> Ring;
        }

        public sealed class Result
        {
            public readonly List<Piece> Pieces = new List<Piece>();
            public Bounds Bounds;
            public bool HasBounds;
        }

        public static Result Build(Transform parent, AuthoredWorld world, RepWarsMapResources resources)
        {
            var result = new Result();
            var plains = Resources.Load<Sprite>("Terrain/Plains 1");
            var plainsTileUnits = plains != null ? plains.rect.width / plains.pixelsPerUnit : 0f;
            Material plainsMaterial = null;
            Material borderMaterial = null;
            Dictionary<Color, Material> fallbackMaterials = null;

            foreach (var territory in world.territories)
            {
                if (territory.ring.Count < 3) continue;
                var ring = MapProjection.Project(territory.ring);
                var piece = new GameObject("Territory_" + territory.id);
                piece.transform.SetParent(parent, false);

                var ground = new GameObject("Terrain_" + territory.id);
                ground.transform.SetParent(piece.transform, false);
                var groundFilter = ground.AddComponent<MeshFilter>();
                var groundMesh = resources.Own(TerritoryMeshBuilder.Build(ring));
                if (plains != null) TerritoryMeshBuilder.ApplyWorldUVs(groundMesh, plainsTileUnits);
                groundFilter.sharedMesh = groundMesh;
                var groundRenderer = ground.AddComponent<MeshRenderer>();
                if (plains != null)
                {
                    if (plainsMaterial == null) plainsMaterial = NewPlainsMaterial(resources, plains);
                    groundRenderer.sharedMaterial = plainsMaterial;
                }
                else
                {
                    fallbackMaterials = fallbackMaterials ?? new Dictionary<Color, Material>();
                    var color = TerrainColor(territory.terrain);
                    if (!fallbackMaterials.TryGetValue(color, out var fallback))
                    {
                        fallback = NewColoredMaterial(resources, color);
                        fallbackMaterials[color] = fallback;
                    }
                    groundRenderer.sharedMaterial = fallback;
                }
                RepWarsWorldSorting.ApplyOrdered(groundRenderer, RepWarsWorldSorting.LayerGround, RepWarsWorldSorting.GroundOrder.Terrain);

                if (borderMaterial == null) borderMaterial = NewColoredMaterial(resources, BorderColor);
                var outline = piece.AddComponent<LineRenderer>();
                outline.positionCount = territory.ring.Count;
                outline.loop = true;
                outline.widthMultiplier = BorderWidth;
                outline.sharedMaterial = borderMaterial;
                outline.startColor = BorderColor;
                outline.endColor = BorderColor;
                outline.useWorldSpace = false;
                RepWarsWorldSorting.ApplyOrdered(outline, RepWarsWorldSorting.LayerGroundOverlay, RepWarsWorldSorting.GroundOverlayOrder.Border);

                var view = piece.AddComponent<RepWarsTerritoryView>();
                view.territoryId = territory.id;
                view.outline = outline;
                view.normalColor = BorderColor;
                var collider = piece.AddComponent<PolygonCollider2D>();
                collider.SetPath(0, OpenRing(ring));

                for (var i = 0; i < ring.Count; i++)
                {
                    outline.SetPosition(i, ring[i]);
                    if (!result.HasBounds)
                    {
                        result.Bounds = new Bounds(ring[i], Vector3.zero);
                        result.HasBounds = true;
                    }
                    else result.Bounds.Encapsulate(ring[i]);
                }

                result.Pieces.Add(new Piece { Territory = territory, Transform = piece.transform, Ring = ring });
            }
            return result;
        }

        static Material NewColoredMaterial(RepWarsMapResources resources, Color color)
        {
            var material = resources.NewSpriteMaterial();
            material.color = color;
            return material;
        }

        static Material NewPlainsMaterial(RepWarsMapResources resources, Sprite plains)
        {
            var material = NewColoredMaterial(resources, Color.white);
            var texture = plains.texture;
            texture.wrapMode = TextureWrapMode.Repeat;
            material.SetTexture("_MainTex", texture);
            return material;
        }

        static Vector2[] OpenRing(List<Vector2> ring)
        {
            var count = ring.Count;
            if (count > 1 && (ring[0] - ring[count - 1]).sqrMagnitude < 0.000001f) count--;
            var path = new Vector2[count];
            for (var i = 0; i < count; i++) path[i] = ring[i];
            return path;
        }

        static Color TerrainColor(string terrain)
        {
            switch (terrain)
            {
                case "forest": return new Color32(0x5f, 0x8f, 0x5a, 255);
                case "hills": return new Color32(0xb8, 0xa5, 0x6a, 255);
                case "mountain": return new Color32(0x8b, 0x86, 0x80, 255);
                case "coastal": return new Color32(0x8e, 0xc4, 0xc0, 255);
                case "desert": return new Color32(0xd2, 0xc0, 0x7a, 255);
                case "river": return new Color32(0x5a, 0x9e, 0xc8, 255);
                default: return new Color32(0xc9, 0xd4, 0x8a, 255);
            }
        }
    }
}
