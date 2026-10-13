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
    /// Map decomposition checks. The map is the production BuildMap path fed by the authored Level 1 definition.
    /// </summary>
    public class RepWarsMapPresenterPlayModeTests
    {
        readonly List<Object> _owned = new List<Object>();

        RepWarsMapScreen _screen;
        AuthoredWorld _world;
        RepWarsPropCatalog _catalog;
        List<AuthoredTerritory> _built;

        [UnityTearDown]
        public IEnumerator TearDown()
        {
            for (var i = _owned.Count - 1; i >= 0; i--)
                if (_owned[i] != null) Object.Destroy(_owned[i]);
            _owned.Clear();
            yield return null;
        }

        [UnityTest]
        public IEnumerator BuildMapCreatesEveryPartUnderOneRoot()
        {
            BuildLevelOne();
            var root = GameObject.Find("Level1Map");
            Assert.IsNotNull(root);
            Assert.AreEqual(1, Object.FindObjectsByType<RepWarsMapResources>().Length);
            Assert.AreEqual(1, Object.FindObjectsByType<RepWarsSelectionPresentation>().Length);

            var views = root.GetComponentsInChildren<RepWarsTerritoryView>();
            Assert.AreEqual(_built.Count, views.Length);
            for (var i = 0; i < _built.Count; i++) Assert.AreEqual(_built[i].id, views[i].territoryId);
            Assert.AreEqual(_built.Count, root.GetComponentsInChildren<Collider2D>().Length, "One collider per territory and no hidden interaction layers.");

            var props = ExpectedPropCount();
            var locations = ExpectedLocationCount();
            var regions = ExpectedRegionCount();
            Assert.Greater(props, 0);
            Assert.AreEqual(_built.Count + 1 + props + locations + regions, root.transform.childCount);
            Assert.AreEqual(props, CountChildren(root.transform, "Prop_"));
            Assert.AreEqual(locations, CountChildren(root.transform, "Location_"));
            Assert.AreEqual(regions, CountChildren(root.transform, "Region_"));

            foreach (var renderer in root.GetComponentsInChildren<MeshRenderer>())
            {
                var name = renderer.gameObject.name;
                if (name.StartsWith("Region_"))
                {
                    Assert.AreEqual(RepWarsWorldSorting.LayerWorldOverlay, renderer.sortingLayerName);
                    Assert.AreEqual(RepWarsWorldSorting.WorldOverlayOrder.RegionLabel, renderer.sortingOrder);
                }
                else if (name.StartsWith("Location_"))
                {
                    Assert.AreEqual(RepWarsWorldSorting.LayerWorldOverlay, renderer.sortingLayerName);
                    Assert.AreEqual(RepWarsWorldSorting.WorldOverlayOrder.LocationLabel, renderer.sortingOrder);
                }
                else if (name.StartsWith("Terrain_"))
                {
                    Assert.AreEqual(RepWarsWorldSorting.LayerGround, renderer.sortingLayerName);
                    Assert.AreEqual(RepWarsWorldSorting.GroundOrder.Terrain, renderer.sortingOrder);
                }
            }

            foreach (var view in views)
            {
                Assert.AreEqual(RepWarsWorldSorting.LayerGroundOverlay, view.outline.sortingLayerName);
                Assert.AreEqual(RepWarsWorldSorting.GroundOverlayOrder.Border, view.outline.sortingOrder);
                Assert.AreEqual(view.normalWidth, view.outline.widthMultiplier, 0.001f);
            }

            Assert.AreEqual(2, CountArmies(root.transform));
            var first = GameObject.Find("Army_army-1");
            var second = GameObject.Find("Army_army-2");
            Assert.AreEqual(_built[0].id, first.GetComponentInParent<RepWarsTerritoryView>().territoryId);
            Assert.AreEqual(_built[1].id, second.GetComponentInParent<RepWarsTerritoryView>().territoryId);
            Assert.AreEqual(5, first.GetComponentsInChildren<RepWarsSoldierVisual>().Length);
            Assert.AreEqual(3, second.GetComponentsInChildren<RepWarsSoldierVisual>().Length);

            Physics2D.SyncTransforms();
            foreach (var view in views)
            {
                _screen.PickWorldPoint(Inside(view.GetComponent<PolygonCollider2D>()));
                Assert.AreEqual(view.territoryId, _screen.SelectedTerritoryId);
            }
            _screen.PickWorldPoint(new Vector2(-10000f, -10000f));
            Assert.IsNull(_screen.SelectedTerritoryId);
            yield return null;
        }

        [UnityTest]
        public IEnumerator RuntimeMeshesAndMaterialsAreOwnedByTheMapAndSharedWhereIdentical()
        {
            BuildLevelOne();
            var root = GameObject.Find("Level1Map");
            var resources = root.GetComponent<RepWarsMapResources>();
            var owned = RuntimeObjects(root);

            Assert.Greater(owned.Count, 0);
            Assert.AreEqual(owned.Count, resources.OwnedCount);

            var borderMaterials = new HashSet<Material>();
            var terrainMaterials = new HashSet<Material>();
            foreach (var view in root.GetComponentsInChildren<RepWarsTerritoryView>())
            {
                borderMaterials.Add(view.outline.sharedMaterial);
                terrainMaterials.Add(view.transform.Find("Terrain_" + view.territoryId).GetComponent<MeshRenderer>().sharedMaterial);
            }
            Assert.AreEqual(1, borderMaterials.Count, "Identical borders share one material.");
            Assert.AreEqual(1, terrainMaterials.Count, "Plains terrain shares one material.");
            yield return null;
        }

        [UnityTest]
        public IEnumerator RebuildReplacesTheMapAndReleasesTheOldRuntimeObjects()
        {
            BuildLevelOne();
            var oldRoot = GameObject.Find("Level1Map");
            var oldObjects = RuntimeObjects(oldRoot);
            var oldSelection = oldRoot.GetComponentInChildren<RepWarsSelectionPresentation>();
            var plains = Resources.Load<Sprite>("Terrain/Plains 1");
            var propSprite = _catalog.Find(FirstRenderedPropAsset());
            Assert.IsNotNull(plains);
            Assert.IsNotNull(propSprite);
            var props = ExpectedPropCount();

            Physics2D.SyncTransforms();
            _screen.PickWorldPoint(Inside(oldRoot.GetComponentInChildren<RepWarsTerritoryView>().GetComponent<PolygonCollider2D>()));
            Assert.IsNotNull(_screen.SelectedTerritoryId);

            _screen.PresentAuthoritative(_screen.LiveState, null);
            yield return null;

            Assert.IsTrue(oldRoot == null, "The old map root is gone.");
            Assert.IsTrue(oldSelection == null);
            foreach (var item in oldObjects) Assert.IsTrue(item == null, "A runtime mesh or material was not released.");
            Assert.IsTrue(plains != null && plains.texture != null, "Project textures are not destroyed.");
            Assert.IsTrue(propSprite != null);

            var root = GameObject.Find("Level1Map");
            Assert.IsNotNull(root);
            Own(root);
            Assert.AreEqual(1, Object.FindObjectsByType<RepWarsMapResources>().Length);
            Assert.AreEqual(1, Object.FindObjectsByType<RepWarsSelectionPresentation>().Length);
            Assert.AreEqual(_built.Count, Object.FindObjectsByType<RepWarsTerritoryView>().Length);
            Assert.AreEqual(_built.Count, Object.FindObjectsByType<PolygonCollider2D>().Length);
            Assert.AreEqual(2, CountArmies(root.transform));
            Assert.AreEqual(props, CountChildren(root.transform, "Prop_"));
            Assert.AreEqual(ExpectedLocationCount(), CountChildren(root.transform, "Location_"));
            Assert.AreEqual(ExpectedRegionCount(), CountChildren(root.transform, "Region_"));
            Assert.IsNull(_screen.SelectedTerritoryId);
            Assert.IsFalse(root.GetComponentInChildren<RepWarsSelectionPresentation>().IsShown);
            Assert.AreEqual(RuntimeObjects(root).Count, root.GetComponent<RepWarsMapResources>().OwnedCount);
        }

        [UnityTest]
        public IEnumerator MapResourcesReleaseOnlyWhatTheyOwn()
        {
            var root = new GameObject("resources-root");
            var resources = RepWarsMapResources.Create(root);
            var mesh = resources.Own(new Mesh());
            var material = resources.NewSpriteMaterial();
            var texture = new Texture2D(2, 2);
            var outside = Own(new Material(material.shader));
            _owned.Add(texture);
            Assert.AreEqual(2, resources.OwnedCount);

            Object.Destroy(root);
            yield return null;

            Assert.IsTrue(mesh == null);
            Assert.IsTrue(material == null);
            Assert.IsTrue(outside != null, "An object that was not registered is untouched.");
            Assert.IsTrue(texture != null);
        }

        void BuildLevelOne()
        {
            var screenObject = Own(new GameObject("MapScreen"));
            screenObject.SetActive(false);
            _screen = screenObject.AddComponent<RepWarsMapScreen>();
            _catalog = Resources.Load<RepWarsPropCatalog>("RepWarsPropCatalog");
            Assert.IsNotNull(_catalog);
            Assert.IsNotNull(_catalog.authoredWorld);
            _world = WorldDefinitionReader.Read(_catalog.authoredWorld.text);
            _built = new List<AuthoredTerritory>();
            foreach (var territory in _world.territories)
                if (territory.ring.Count >= 3) _built.Add(territory);
            Assert.GreaterOrEqual(_built.Count, 2);
            SetField(_screen, "world", _world);
            SetField(_screen, "propCatalog", _catalog);
            SetField(_screen, "gameState", new PublicGameState
            {
                playerFactionId = "f_player",
                turn = 1,
                armies = new[]
                {
                    new PublicArmy { id = "army-1", owner = "f_player", location = _built[0].id, troops = 12 },
                    new PublicArmy { id = "army-2", owner = "f_player", location = _built[1].id, troops = 3 },
                },
            });
            Call(_screen, "EnsureHud");
            Call(_screen, "BuildMap");
            Own(GameObject.Find("Level1Map"));
            Own(GameObject.Find("EmpireHud"));
            Own(GameObject.Find("TerritoryInfo"));
        }

        int ExpectedPropCount()
        {
            var count = 0;
            foreach (var prop in _world.props)
            {
                if (string.IsNullOrEmpty(prop.assetId) || !prop.hasScale) continue;
                if (_catalog.Find(prop.assetId) == null) continue;
                if (!RepWarsPropPlacement.UsesImportedPivot(prop.anchor)) continue;
                count++;
            }
            return count;
        }

        string FirstRenderedPropAsset()
        {
            foreach (var prop in _world.props)
            {
                if (string.IsNullOrEmpty(prop.assetId) || !prop.hasScale) continue;
                if (_catalog.Find(prop.assetId) == null) continue;
                if (RepWarsPropPlacement.UsesImportedPivot(prop.anchor)) return prop.assetId;
            }
            return null;
        }

        int ExpectedLocationCount()
        {
            var count = 0;
            foreach (var location in _world.locations)
                if (location.hasPosition || !string.IsNullOrEmpty(location.name)) count++;
            return count;
        }

        int ExpectedRegionCount()
        {
            var count = 0;
            foreach (var region in _world.regions)
            {
                if (string.IsNullOrEmpty(region.name)) continue;
                foreach (var territory in _world.territories)
                {
                    if (territory.regionId != region.id || territory.ring.Count == 0) continue;
                    count++;
                    break;
                }
            }
            return count;
        }

        static int CountChildren(Transform parent, string prefix)
        {
            var count = 0;
            for (var i = 0; i < parent.childCount; i++)
                if (parent.GetChild(i).name.StartsWith(prefix)) count++;
            return count;
        }

        static int CountArmies(Transform root)
        {
            return root.GetComponentsInChildren<RepWarsArmyVisual>().Length;
        }

        /// <summary>The meshes and materials the territory and prop presenters created for this map.</summary>
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
            foreach (var renderer in root.GetComponentsInChildren<SpriteRenderer>())
            {
                if (renderer.transform.parent == null || !renderer.transform.parent.name.StartsWith("Prop_")) continue;
                objects.Add(renderer.sharedMaterial);
            }
            return objects;
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
