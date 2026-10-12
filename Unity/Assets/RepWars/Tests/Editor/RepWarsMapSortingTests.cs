using NUnit.Framework;
using RepWars.WorldPresentation;
using UnityEngine;
using UnityEngine.Rendering;

namespace RepWars.Tests
{
    public class RepWarsMapSortingTests
    {
        [Test]
        public void LivePropUsesWorldPivotAndAStableTieWithoutMovingTheRoot()
        {
            var root = new GameObject("Prop_prop_01");
            root.transform.position = new Vector3(3f, 4f, 0f);
            root.transform.localScale = new Vector3(0.15f, 0.15f, 1f);
            var renderer = RepWarsPropPlacement.AttachSortedSprite(root.transform, TinySprite(), "prop_01");

            Assert.AreEqual(RepWarsWorldSorting.LayerWorld, renderer.sortingLayerName);
            Assert.AreEqual(0, renderer.sortingOrder);
            Assert.AreEqual(SpriteSortPoint.Pivot, renderer.spriteSortPoint);
            Assert.AreEqual(new Vector3(3f, 4f, 0f), root.transform.position);
            Assert.AreEqual(RepWarsWorldSorting.TieOffsetZ("prop_01"), renderer.transform.localPosition.z, 1e-6f);
            Assert.AreEqual(0f, renderer.transform.localPosition.x, 1e-6f);
            Assert.AreEqual(0f, renderer.transform.localPosition.y, 1e-6f);
            Assert.AreNotEqual(10, renderer.sortingOrder);
            Assert.AreEqual(RepWarsWorldSorting.TieOffsetZ("prop_01"), RepWarsWorldSorting.TieOffsetZ(RepWarsPropPlacement.TieId("prop_01", "tree")));
            Assert.AreEqual("tree-asset", RepWarsPropPlacement.TieId("", "tree-asset"));
            Object.DestroyImmediate(root);
        }

        [Test]
        public void SoldiersSortIndependentlyAndTheArmyRootIsNotGrouped()
        {
            var army = RepWarsArmyVisual.Create(null, new Vector2(2f, 3f), 12, new Color(0.2f, 0.4f, 0.8f));
            Assert.AreEqual(5, RepWarsArmyVisual.VisibleCount(12));
            Assert.IsNull(army.GetComponent<SortingGroup>());
            Assert.AreEqual(0f, army.transform.position.z, 1e-6f);

            var groups = army.GetComponentsInChildren<SortingGroup>();
            Assert.AreEqual(5, groups.Length);
            for (var i = 0; i < groups.Length; i++)
            {
                Assert.AreEqual(RepWarsWorldSorting.LayerWorld, groups[i].sortingLayerName);
                Assert.AreEqual(0, groups[i].sortingOrder);
                var soldier = groups[i].transform.parent;
                Assert.AreEqual(0f, soldier.localPosition.z, 1e-6f);
                Assert.AreEqual(RepWarsWorldSorting.TieOffsetZ(i), groups[i].transform.localPosition.z, 1e-6f);
                Assert.AreEqual(0f, groups[i].transform.localPosition.x, 1e-6f);
                Assert.AreEqual(0f, groups[i].transform.localPosition.y, 1e-6f);
                var current = groups[i].transform.Find("Current").GetComponent<SpriteRenderer>();
                var upcoming = groups[i].transform.Find("Upcoming").GetComponent<SpriteRenderer>();
                Assert.AreEqual(RepWarsSoldierVisual.CurrentOrder, current.sortingOrder);
                Assert.AreEqual(RepWarsSoldierVisual.UpcomingOrder, upcoming.sortingOrder);
                Assert.AreEqual(SpriteSortPoint.Pivot, current.spriteSortPoint);
                Assert.AreEqual(SpriteSortPoint.Pivot, upcoming.spriteSortPoint);
                Assert.AreEqual(RepWarsWorldSorting.LayerWorld, current.sortingLayerName);
            }

            var count = army.transform.Find("TroopCount");
            var glyphs = count.GetComponentsInChildren<SpriteRenderer>(true);
            Assert.Greater(glyphs.Length, 0);
            for (var i = 0; i < glyphs.Length; i++)
            {
                Assert.AreEqual(RepWarsWorldSorting.LayerWorldOverlay, glyphs[i].sortingLayerName);
                Assert.AreEqual(RepWarsWorldSorting.WorldOverlayOrder.TroopMarker, glyphs[i].sortingOrder);
            }
            Object.DestroyImmediate(army.gameObject);
        }

        [Test]
        public void SelectionUsesOneHighlightAndOneMarkerWithoutTouchingTheBorderOrCollider()
        {
            var first = Triangle("a", new Vector2(0f, 0f), new Vector2(3f, 0f), new Vector2(0f, 3f));
            var second = Triangle("b", new Vector2(10f, 10f), new Vector2(12f, 10f), new Vector2(10f, 13f));
            var collider = first.GetComponent<PolygonCollider2D>();
            var before = collider.GetPath(0);
            var presentation = RepWarsSelectionPresentation.Create(null);

            presentation.Show(first);
            AssertSelection(presentation, first, new Vector3(1f, 1f, 0f));
            Assert.AreEqual(0.35f, first.outline.widthMultiplier, 0.001f);
            Assert.AreEqual(RepWarsWorldSorting.GroundOverlayOrder.Border, first.outline.sortingOrder);
            Assert.AreEqual(RepWarsWorldSorting.LayerGroundOverlay, first.outline.sortingLayerName);
            CollectionAssert.AreEqual(before, collider.GetPath(0));

            presentation.Show(second);
            AssertSelection(presentation, second, new Vector3(32f / 3f, 11f, 0f));
            Assert.AreEqual(1, Object.FindObjectsByType<RepWarsSelectionPresentation>().Length);
            Assert.AreEqual(2, presentation.transform.childCount);

            for (var i = 0; i < 4; i++)
            {
                presentation.Show(i % 2 == 0 ? first : second);
                presentation.Hide();
            }
            Assert.IsFalse(presentation.IsShown);
            Assert.IsNull(presentation.ShownTerritoryId);
            Assert.IsFalse(presentation.Highlight.enabled);
            Assert.IsFalse(presentation.Marker.enabled);
            Assert.AreEqual(2, presentation.transform.childCount);
            Assert.AreEqual(before.Length, collider.GetPath(0).Length);

            Object.DestroyImmediate(presentation.gameObject);
            Object.DestroyImmediate(first.gameObject);
            Object.DestroyImmediate(second.gameObject);
        }

        static void AssertSelection(RepWarsSelectionPresentation presentation, RepWarsTerritoryView view, Vector3 centroid)
        {
            Assert.IsTrue(presentation.IsShown);
            Assert.AreEqual(view.territoryId, presentation.ShownTerritoryId);
            Assert.AreEqual(RepWarsWorldSorting.LayerGroundOverlay, presentation.Highlight.sortingLayerName);
            Assert.AreEqual(RepWarsWorldSorting.GroundOverlayOrder.Selection, presentation.Highlight.sortingOrder);
            Assert.AreEqual(view.outline.positionCount, presentation.Highlight.positionCount);
            Assert.AreEqual(RepWarsWorldSorting.LayerWorldOverlay, presentation.Marker.sortingLayerName);
            Assert.AreEqual(RepWarsWorldSorting.WorldOverlayOrder.SelectionMarker, presentation.Marker.sortingOrder);
            Assert.AreEqual(centroid.x, presentation.Marker.transform.position.x, 0.001f);
            Assert.AreEqual(centroid.y, presentation.Marker.transform.position.y, 0.001f);
            Assert.AreEqual(0f, presentation.Marker.transform.position.z, 0.001f);
            Assert.Less(RepWarsWorldSorting.GroundOverlayOrder.Border, presentation.Highlight.sortingOrder);
            Assert.Greater(RepWarsWorldSorting.WorldOverlayOrder.SelectionMarker, RepWarsWorldSorting.WorldOverlayOrder.TroopMarker);
            Assert.Greater(RepWarsWorldSorting.WorldOverlayOrder.SelectionMarker, RepWarsWorldSorting.WorldOverlayOrder.LocationLabel);
            Assert.Greater(RepWarsWorldSorting.WorldOverlayOrder.SelectionMarker, RepWarsWorldSorting.WorldOverlayOrder.RegionLabel);
        }

        static RepWarsTerritoryView Triangle(string id, Vector2 a, Vector2 b, Vector2 c)
        {
            var piece = new GameObject("Territory_" + id);
            var outline = piece.AddComponent<LineRenderer>();
            outline.positionCount = 3;
            outline.loop = true;
            outline.useWorldSpace = false;
            outline.widthMultiplier = 0.35f;
            outline.SetPosition(0, a);
            outline.SetPosition(1, b);
            outline.SetPosition(2, c);
            RepWarsWorldSorting.ApplyOrdered(outline, RepWarsWorldSorting.LayerGroundOverlay, RepWarsWorldSorting.GroundOverlayOrder.Border);
            var view = piece.AddComponent<RepWarsTerritoryView>();
            view.territoryId = id;
            view.outline = outline;
            var collider = piece.AddComponent<PolygonCollider2D>();
            collider.SetPath(0, new[] { a, b, c });
            return view;
        }

        static Sprite TinySprite()
        {
            var texture = new Texture2D(4, 8, TextureFormat.RGBA32, false);
            texture.SetPixels(new Color[32]);
            texture.Apply();
            return Sprite.Create(texture, new Rect(0f, 0f, 4f, 8f), new Vector2(0.5f, 0f), 100f, 0, SpriteMeshType.FullRect);
        }
    }
}
