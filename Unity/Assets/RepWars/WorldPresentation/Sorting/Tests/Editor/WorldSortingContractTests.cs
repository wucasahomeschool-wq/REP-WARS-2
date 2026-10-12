using NUnit.Framework;
using UnityEngine;
using UnityEngine.Rendering;

namespace RepWars.WorldPresentation.Tests
{
    public class WorldSortingContractTests
    {
        [Test]
        public void WorldEntityOrderIsZero()
        {
            Assert.AreEqual(0, RepWarsWorldSorting.WorldEntityOrder);
        }

        [Test]
        public void CategoryOrdersStaySmallAndDistinctInsideEachLayer()
        {
            AssertInRange(RepWarsWorldSorting.BackdropOrder.Sky, RepWarsWorldSorting.BackdropOrder.Horizon, RepWarsWorldSorting.BackdropOrder.Distant);
            AssertInRange(RepWarsWorldSorting.GroundOrder.Canvas, RepWarsWorldSorting.GroundOrder.Terrain, RepWarsWorldSorting.GroundOrder.Road, RepWarsWorldSorting.GroundOrder.BakedScenery);
            AssertInRange(RepWarsWorldSorting.GroundOverlayOrder.Ownership, RepWarsWorldSorting.GroundOverlayOrder.Border, RepWarsWorldSorting.GroundOverlayOrder.Selection, RepWarsWorldSorting.GroundOverlayOrder.Target, RepWarsWorldSorting.GroundOverlayOrder.Route);
            AssertInRange(RepWarsWorldSorting.AtmosphereOrder.Ambient, RepWarsWorldSorting.AtmosphereOrder.WorldEdgeFog, RepWarsWorldSorting.AtmosphereOrder.Weather);
            AssertInRange(RepWarsWorldSorting.WorldOverlayOrder.RegionLabel, RepWarsWorldSorting.WorldOverlayOrder.LocationLabel, RepWarsWorldSorting.WorldOverlayOrder.TroopMarker, RepWarsWorldSorting.WorldOverlayOrder.SelectionMarker);
            Assert.AreNotEqual(RepWarsWorldSorting.GroundOverlayOrder.Selection, RepWarsWorldSorting.WorldOverlayOrder.SelectionMarker);
        }

        [Test]
        public void NamedLayersMatchTheContract()
        {
            Assert.AreEqual("Backdrop", RepWarsWorldSorting.LayerBackdrop);
            Assert.AreEqual("Ground", RepWarsWorldSorting.LayerGround);
            Assert.AreEqual("GroundOverlay", RepWarsWorldSorting.LayerGroundOverlay);
            Assert.AreEqual("World", RepWarsWorldSorting.LayerWorld);
            Assert.AreEqual("Atmosphere", RepWarsWorldSorting.LayerAtmosphere);
            Assert.AreEqual("WorldOverlay", RepWarsWorldSorting.LayerWorldOverlay);
        }

        [Test]
        public void ProjectSortingLayersAreBackToFront()
        {
            Assert.Less(Index("Default"), Index(RepWarsWorldSorting.LayerBackdrop));
            Assert.Less(Index(RepWarsWorldSorting.LayerBackdrop), Index(RepWarsWorldSorting.LayerGround));
            Assert.Less(Index(RepWarsWorldSorting.LayerGround), Index(RepWarsWorldSorting.LayerGroundOverlay));
            Assert.Less(Index(RepWarsWorldSorting.LayerGroundOverlay), Index(RepWarsWorldSorting.LayerWorld));
            Assert.Less(Index(RepWarsWorldSorting.LayerWorld), Index(RepWarsWorldSorting.LayerAtmosphere));
            Assert.Less(Index(RepWarsWorldSorting.LayerAtmosphere), Index(RepWarsWorldSorting.LayerWorldOverlay));
        }

        [Test]
        public void TieIndexIsStableAndInsideRange()
        {
            Assert.AreEqual(21, RepWarsWorldSorting.TieIndex("tree"));
            Assert.AreEqual(11, RepWarsWorldSorting.TieIndex("soldier-a"));
            Assert.AreEqual(30, RepWarsWorldSorting.TieIndex("soldier-b"));
            Assert.AreEqual(5, RepWarsWorldSorting.TieIndex(""));
            Assert.AreEqual(5, RepWarsWorldSorting.TieIndex(null));
            Assert.AreEqual(RepWarsWorldSorting.TieIndex("army-7"), RepWarsWorldSorting.TieIndex("army-7"));
            for (var i = 0; i < 200; i++)
            {
                var index = RepWarsWorldSorting.TieIndex("id-" + i);
                Assert.GreaterOrEqual(index, RepWarsWorldSorting.TieIndexMin);
                Assert.LessOrEqual(index, RepWarsWorldSorting.TieIndexMax);
            }
        }

        [Test]
        public void TieOffsetStaysBelowMeaningfulY()
        {
            Assert.AreEqual(0f, RepWarsWorldSorting.TieOffsetZ("missing") - RepWarsWorldSorting.TieIndex("missing") * RepWarsWorldSorting.TieEpsilon, 1e-8f);
            Assert.GreaterOrEqual(RepWarsWorldSorting.TieOffsetZ("soldier-a"), 0f);
            Assert.LessOrEqual(RepWarsWorldSorting.TieOffsetZ("soldier-b"), RepWarsWorldSorting.MaxTieOffset);
            Assert.Less(RepWarsWorldSorting.MaxTieOffset, RepWarsWorldSorting.MinimumMeaningfulY);
            Assert.Less(63f * RepWarsWorldSorting.TieEpsilon, 0.01f);
            Assert.AreEqual(RepWarsWorldSorting.TieIndexMax * RepWarsWorldSorting.TieEpsilon, RepWarsWorldSorting.MaxTieOffset, 1e-8f);
        }

        [Test]
        public void TieOffsetWritesOnlyLocalZ()
        {
            var root = new GameObject("authoritative");
            root.transform.position = new Vector3(4f, 5f, 0f);
            var presentation = new GameObject("presentation");
            presentation.transform.SetParent(root.transform, false);
            presentation.transform.localPosition = new Vector3(0f, 0f, 9f);
            RepWarsWorldSorting.ApplyTieOffset(presentation.transform, "soldier-a");
            Assert.AreEqual(new Vector3(4f, 5f, 0f), root.transform.position);
            Assert.AreEqual(0f, presentation.transform.localPosition.x, 1e-6f);
            Assert.AreEqual(0f, presentation.transform.localPosition.y, 1e-6f);
            Assert.AreEqual(11f * RepWarsWorldSorting.TieEpsilon, presentation.transform.localPosition.z, 1e-6f);
            Object.DestroyImmediate(presentation);
            Object.DestroyImmediate(root);
        }

        [Test]
        public void WorldEntityHelperForcesPivotAndOrderZero()
        {
            var go = new GameObject("figure");
            var renderer = go.AddComponent<SpriteRenderer>();
            renderer.sortingOrder = 40;
            renderer.spriteSortPoint = SpriteSortPoint.Center;
            RepWarsWorldSorting.ApplyWorldEntity(renderer);
            Assert.AreEqual(RepWarsWorldSorting.LayerWorld, renderer.sortingLayerName);
            Assert.AreEqual(0, renderer.sortingOrder);
            Assert.AreEqual(SpriteSortPoint.Pivot, renderer.spriteSortPoint);
            Object.DestroyImmediate(go);
        }

        static void AssertInRange(params int[] orders)
        {
            for (var i = 0; i < orders.Length; i++)
            {
                Assert.GreaterOrEqual(orders[i], 0);
                Assert.LessOrEqual(orders[i], 63);
                for (var j = i + 1; j < orders.Length; j++) Assert.AreNotEqual(orders[i], orders[j]);
            }
        }

        static int Index(string name)
        {
            var layers = SortingLayer.layers;
            for (var i = 0; i < layers.Length; i++)
                if (layers[i].name == name) return i;
            Assert.Fail("Missing sorting layer " + name);
            return -1;
        }
    }
}
