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

        static Sprite TinySprite()
        {
            var texture = new Texture2D(4, 8, TextureFormat.RGBA32, false);
            texture.SetPixels(new Color[32]);
            texture.Apply();
            return Sprite.Create(texture, new Rect(0f, 0f, 4f, 8f), new Vector2(0.5f, 0f), 100f, 0, SpriteMeshType.FullRect);
        }
    }
}
