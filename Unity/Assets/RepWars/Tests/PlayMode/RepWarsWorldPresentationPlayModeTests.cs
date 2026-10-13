using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using RepWars.WorldPresentation;
using UnityEngine;
using UnityEngine.TestTools;

namespace RepWars.PlayModeTests
{
    /// <summary>
    /// A test-only second world through the production BuildMap path.
    /// </summary>
    public class RepWarsWorldPresentationPlayModeTests
    {
        readonly List<Object> _owned = new List<Object>();

        [UnityTearDown]
        public IEnumerator TearDown()
        {
            for (var i = _owned.Count - 1; i >= 0; i--)
                if (_owned[i] != null) Object.Destroy(_owned[i]);
            _owned.Clear();
            yield return null;
        }

        [UnityTest]
        public IEnumerator ASecondWorldReplacesTheFirstOnTheSameBuildPath()
        {
            var screen = Screen();
            var first = World("test-world-a", "ra", "Alpha", new[] { "ta", "tb" }, withProp: true, withLocation: true);
            var second = World("test-world-b", "rb", "Beta", new[] { "ua", "ub", "uc" }, withProp: false, withLocation: true);
            Show(screen, first);
            Physics2D.SyncTransforms();
            var root = GameObject.Find(RepWarsMapScreen.MapRootName);
            var firstView = root.transform.Find("Territory_ta").GetComponent<RepWarsTerritoryView>();
            screen.PickWorldPoint(Inside(firstView.GetComponent<PolygonCollider2D>()));
            Assert.AreEqual("ta", screen.SelectedTerritoryId);
            var oldObjects = RuntimeObjects(root);
            var oldSelection = root.GetComponentInChildren<RepWarsSelectionPresentation>();

            SetField(screen, "world", second.World);
            SetField(screen, "propCatalog", second.Catalog);
            SetField(screen, "terrainFill", second.TerrainFill);
            screen.PresentAuthoritative(screen.LiveState, null);
            yield return null;

            Assert.IsTrue(root == null);
            Assert.IsTrue(oldSelection == null);
            foreach (var item in oldObjects) Assert.IsTrue(item == null);
            var rebuilt = GameObject.Find(RepWarsMapScreen.MapRootName);
            Own(rebuilt);
            Assert.AreEqual(1, Object.FindObjectsByType<RepWarsMapResources>().Length);
            Assert.IsNull(GameObject.Find("Territory_ta"));
            Assert.IsNull(GameObject.Find("Prop_marker"));
            Assert.IsNull(GameObject.Find("Region_ra"));
            Assert.AreEqual(3, rebuilt.GetComponentsInChildren<RepWarsTerritoryView>().Length);
            Assert.AreEqual(3, rebuilt.GetComponentsInChildren<PolygonCollider2D>().Length);
            Assert.AreEqual(0, Count(rebuilt.transform, "Prop_"));
            Assert.AreEqual(1, Count(rebuilt.transform, "Location_"));
            Assert.AreEqual(1, Count(rebuilt.transform, "Region_"));
            Assert.IsNull(screen.SelectedTerritoryId);
            Assert.IsFalse(rebuilt.GetComponentInChildren<RepWarsSelectionPresentation>().IsShown);

            foreach (var view in rebuilt.GetComponentsInChildren<RepWarsTerritoryView>())
            {
                Assert.AreEqual(RepWarsWorldSorting.LayerGroundOverlay, view.outline.sortingLayerName);
                Assert.AreEqual(RepWarsWorldSorting.GroundOverlayOrder.Border, view.outline.sortingOrder);
                var terrain = view.transform.Find("Terrain_" + view.territoryId).GetComponent<MeshRenderer>();
                Assert.AreEqual(RepWarsWorldSorting.LayerGround, terrain.sortingLayerName);
                Assert.AreEqual(RepWarsWorldSorting.GroundOrder.Terrain, terrain.sortingOrder);
                screen.PickWorldPoint(Inside(view.GetComponent<PolygonCollider2D>()));
                Assert.AreEqual(view.territoryId, screen.SelectedTerritoryId);
            }
            var region = rebuilt.transform.Find("Region_rb").GetComponent<MeshRenderer>();
            Assert.AreEqual(RepWarsWorldSorting.LayerWorldOverlay, region.sortingLayerName);
            Assert.AreEqual(RepWarsWorldSorting.WorldOverlayOrder.RegionLabel, region.sortingOrder);
            var location = rebuilt.transform.Find("Location_Camp").GetComponent<MeshRenderer>();
            Assert.AreEqual(RepWarsWorldSorting.WorldOverlayOrder.LocationLabel, location.sortingOrder);
        }

        [UnityTest]
        public IEnumerator AnUnknownWorldIdClearsTheMapInsteadOfKeepingThePreviousOne()
        {
            var screen = Screen();
            Show(screen, World("test-world-a", "ra", "Alpha", new[] { "ta", "tb" }, false, false));
            Assert.IsNotNull(GameObject.Find("Territory_ta"));

            LogAssert.Expect(LogType.Error, "[RepWars] No presentation definition is registered for world 'Level 2'.");
            screen.PresentAuthoritative(new PublicGameState { definitionWorldId = "Level 2", playerFactionId = "f_player" }, null);
            yield return null;

            Assert.IsNull(GameObject.Find(RepWarsMapScreen.MapRootName));
            Assert.IsNull(GameObject.Find("Territory_ta"));
            Assert.IsNull(screen.SelectedTerritoryId);
            var hud = GameObject.Find("EmpireHud").GetComponent<TextMesh>();
            StringAssert.Contains("Level 2", hud.text);
        }

        RepWarsMapScreen Screen()
        {
            var screenObject = Own(new GameObject("MapScreen"));
            screenObject.SetActive(false);
            var screen = screenObject.AddComponent<RepWarsMapScreen>();
            Call(screen, "EnsureHud");
            Own(GameObject.Find("EmpireHud"));
            Own(GameObject.Find("TerritoryInfo"));
            return screen;
        }

        void Show(RepWarsMapScreen screen, RepWarsWorldPresentationDefinition definition)
        {
            SetField(screen, "world", definition.World);
            SetField(screen, "propCatalog", definition.Catalog);
            SetField(screen, "terrainFill", definition.TerrainFill);
            SetField(screen, "presentation", null);
            SetField(screen, "gameState", new PublicGameState { playerFactionId = "f_player", turn = 1 });
            Call(screen, "BuildMap");
            Own(GameObject.Find(RepWarsMapScreen.MapRootName));
        }

        RepWarsWorldPresentationDefinition World(string worldId, string regionId, string regionName, string[] territoryIds, bool withProp, bool withLocation)
        {
            var world = new AuthoredWorld { worldId = worldId, name = worldId, level = 0 };
            world.regions.Add(new AuthoredRegion { id = regionId, name = regionName });
            for (var i = 0; i < territoryIds.Length; i++)
            {
                var origin = new Vector2(i * 10f, 0f);
                world.territories.Add(new AuthoredTerritory
                {
                    id = territoryIds[i],
                    regionId = regionId,
                    terrain = "desert",
                    ring = new List<Vector2>
                    {
                        origin,
                        origin + new Vector2(4f, 0f),
                        origin + new Vector2(0f, 4f),
                    },
                });
            }
            RepWarsPropCatalog catalog = null;
            if (withProp)
            {
                catalog = ScriptableObject.CreateInstance<RepWarsPropCatalog>();
                _owned.Add(catalog);
                var texture = new Texture2D(4, 4);
                _owned.Add(texture);
                var sprite = Sprite.Create(texture, new Rect(0f, 0f, 4f, 4f), new Vector2(0.5f, 0f), 100f);
                _owned.Add(sprite);
                catalog.entries = new[] { new RepWarsPropEntry { assetId = "marker", sprite = sprite } };
                world.props.Add(new AuthoredProp
                {
                    instanceId = "marker",
                    assetId = "marker",
                    territoryId = territoryIds[0],
                    position = new Vector2(1f, 1f),
                    scale = 1f,
                    hasScale = true,
                    anchor = "bottom-center",
                });
            }
            if (withLocation)
            {
                world.locations.Add(new AuthoredLocation
                {
                    territoryId = territoryIds[0],
                    name = "Camp",
                    position = new Vector2(1f, 1f),
                    hasPosition = true,
                });
            }
            return RepWarsWorldPresentations.Define(world, catalog, null);
        }

        static HashSet<Object> RuntimeObjects(GameObject root)
        {
            var objects = new HashSet<Object>();
            foreach (var view in root.GetComponentsInChildren<RepWarsTerritoryView>())
            {
                objects.Add(view.outline.sharedMaterial);
                var ground = view.transform.Find("Terrain_" + view.territoryId);
                objects.Add(ground.GetComponent<MeshFilter>().sharedMesh);
                objects.Add(ground.GetComponent<MeshRenderer>().sharedMaterial);
            }
            return objects;
        }

        static int Count(Transform parent, string prefix)
        {
            var count = 0;
            for (var i = 0; i < parent.childCount; i++)
                if (parent.GetChild(i).name.StartsWith(prefix)) count++;
            return count;
        }

        static Vector2 Inside(PolygonCollider2D collider)
        {
            var path = collider.GetPath(0);
            var sum = Vector2.zero;
            for (var i = 0; i < path.Length; i++) sum += (Vector2)collider.transform.TransformPoint(path[i]);
            var centroid = sum / path.Length;
            if (collider.OverlapPoint(centroid)) return centroid;
            for (var i = 0; i < path.Length; i++)
            {
                var mid = Vector2.Lerp(centroid, collider.transform.TransformPoint(path[i]), 0.5f);
                if (collider.OverlapPoint(mid)) return mid;
            }
            return centroid;
        }

        static void SetField(object target, string name, object value)
        {
            var field = target.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.IsNotNull(field, name);
            field.SetValue(target, value);
        }

        static void Call(object target, string name)
        {
            var method = target.GetType().GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.IsNotNull(method, name);
            method.Invoke(target, null);
        }

        T Own<T>(T item) where T : Object
        {
            if (item != null) _owned.Add(item);
            return item;
        }
    }
}
