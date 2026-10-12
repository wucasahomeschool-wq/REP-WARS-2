using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using RepWars.WorldPresentation;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.TestTools;

namespace RepWars.PlayModeTests
{
    /// <summary>
    /// Live map sorting checks. The map is the production BuildMap path fed by the authored Level 1 definition.
    /// </summary>
    public class RepWarsMapSortingPlayModeTests
    {
        const int ProbeSize = 48;

        Camera _camera;
        RenderTexture _target;
        readonly List<UnityEngine.Object> _owned = new List<UnityEngine.Object>();
        readonly List<Camera> _disabled = new List<Camera>();

        [UnitySetUp]
        public IEnumerator SetUp()
        {
            foreach (var camera in UnityEngine.Object.FindObjectsByType<Camera>())
            {
                if (!camera.enabled) continue;
                camera.enabled = false;
                _disabled.Add(camera);
            }
            SetRenderer(TransparencySortMode.CustomAxis, RepWarsWorldSorting.SortAxis);
            var lightObject = Own(new GameObject("probe-light"));
            var light = lightObject.AddComponent<Light2D>();
            light.lightType = Light2D.LightType.Global;
            light.intensity = 1f;
            yield return null;
        }

        [UnityTearDown]
        public IEnumerator TearDown()
        {
            SetRenderer(TransparencySortMode.CustomAxis, RepWarsWorldSorting.SortAxis);
            if (_camera != null) _camera.targetTexture = null;
            for (var i = _owned.Count - 1; i >= 0; i--)
                if (_owned[i] != null) UnityEngine.Object.Destroy(_owned[i]);
            _owned.Clear();
            for (var i = 0; i < _disabled.Count; i++)
                if (_disabled[i] != null) _disabled[i].enabled = true;
            _disabled.Clear();
            yield return null;
        }

        [UnityTest]
        public IEnumerator LiveMapUsesTheContractAndSelectionStillPicks()
        {
            var screenObject = Own(new GameObject("MapScreen"));
            screenObject.SetActive(false);
            var screen = screenObject.AddComponent<RepWarsMapScreen>();
            var catalog = Resources.Load<RepWarsPropCatalog>("RepWarsPropCatalog");
            Assert.IsNotNull(catalog);
            Assert.IsNotNull(catalog.authoredWorld);
            var world = WorldDefinitionReader.Read(catalog.authoredWorld.text);
            Assert.Greater(world.territories.Count, 0);
            var territoryId = world.territories[0].id;
            SetField(screen, "world", world);
            SetField(screen, "propCatalog", catalog);
            SetField(screen, "gameState", new PublicGameState
            {
                playerFactionId = "f_player",
                turn = 1,
                armies = new[]
                {
                    new PublicArmy { id = "army-1", owner = "f_player", location = territoryId, troops = 12 },
                },
            });
            Call(screen, "EnsureHud");
            Call(screen, "BuildMap");
            Own(GameObject.Find("Level1Map"));
            Own(GameObject.Find("EmpireHud"));
            Own(GameObject.Find("TerritoryInfo"));

            var props = 0;
            foreach (var renderer in UnityEngine.Object.FindObjectsByType<SpriteRenderer>())
            {
                if (renderer.transform.parent == null || !renderer.transform.parent.name.StartsWith("Prop_")) continue;
                props++;
                Assert.AreEqual(RepWarsWorldSorting.LayerWorld, renderer.sortingLayerName);
                Assert.AreEqual(0, renderer.sortingOrder);
                Assert.AreEqual(SpriteSortPoint.Pivot, renderer.spriteSortPoint);
                Assert.AreEqual(0f, renderer.transform.parent.position.z, 1e-4f);
                var id = renderer.transform.parent.name.Substring("Prop_".Length);
                Assert.AreEqual(RepWarsWorldSorting.TieOffsetZ(id), renderer.transform.localPosition.z, 1e-4f);
            }
            Assert.Greater(props, 0);

            foreach (var renderer in UnityEngine.Object.FindObjectsByType<MeshRenderer>())
            {
                var name = renderer.gameObject.name;
                if (name.StartsWith("Terrain_"))
                {
                    Assert.AreEqual(RepWarsWorldSorting.LayerGround, renderer.sortingLayerName);
                    Assert.AreEqual(RepWarsWorldSorting.GroundOrder.Terrain, renderer.sortingOrder);
                }
                else if (name.StartsWith("Region_"))
                {
                    Assert.AreEqual(RepWarsWorldSorting.LayerWorldOverlay, renderer.sortingLayerName);
                    Assert.AreEqual(RepWarsWorldSorting.WorldOverlayOrder.RegionLabel, renderer.sortingOrder);
                }
                else if (name.StartsWith("Location_"))
                {
                    Assert.AreEqual(RepWarsWorldSorting.LayerWorldOverlay, renderer.sortingLayerName);
                    Assert.AreEqual(RepWarsWorldSorting.WorldOverlayOrder.LocationLabel, renderer.sortingOrder);
                }
            }

            var borders = 0;
            foreach (var line in UnityEngine.Object.FindObjectsByType<LineRenderer>())
            {
                if (!line.gameObject.name.StartsWith("Territory_")) continue;
                borders++;
                Assert.AreEqual(RepWarsWorldSorting.LayerGroundOverlay, line.sortingLayerName);
                Assert.AreEqual(RepWarsWorldSorting.GroundOverlayOrder.Border, line.sortingOrder);
            }
            Assert.Greater(borders, 0);

            var army = GameObject.Find("Army_army-1");
            Assert.IsNotNull(army);
            Assert.IsNull(army.GetComponent<SortingGroup>());
            Assert.AreEqual(5, army.GetComponentsInChildren<SortingGroup>().Length);
            var glyphs = army.transform.Find("TroopCount").GetComponentsInChildren<SpriteRenderer>(true);
            Assert.AreEqual(2, glyphs.Length);
            Assert.AreEqual(RepWarsWorldSorting.LayerWorldOverlay, glyphs[0].sortingLayerName);
            Assert.AreEqual(RepWarsWorldSorting.WorldOverlayOrder.TroopMarker, glyphs[0].sortingOrder);

            var cameraObject = Own(new GameObject("Main Camera"));
            cameraObject.tag = "MainCamera";
            var camera = cameraObject.AddComponent<Camera>();
            camera.enabled = true;
            Call(screen, "FrameCamera");
            Assert.IsNotNull(camera.GetComponent<WorldSortingCameraBinding>());
            Assert.AreEqual(TransparencySortMode.CustomAxis, camera.transparencySortMode);
            Assert.Greater(camera.transparencySortAxis.y, 0.5f);
            Assert.Greater(camera.transparencySortAxis.z, 0.5f);
            Assert.AreEqual(0f, camera.transparencySortAxis.x, 0.02f);
            var mapCamera = camera.GetComponent<RepWarsMapCamera>();
            Assert.IsNotNull(mapCamera);
            Assert.Greater(camera.orthographicSize, 1f);
            mapCamera.Tick();

            var view = army.GetComponentInParent<RepWarsTerritoryView>();
            Physics2D.SyncTransforms();
            var inside = Inside(view.GetComponent<PolygonCollider2D>());
            var path = view.GetComponent<PolygonCollider2D>().GetPath(0);
            screen.PickWorldPoint(inside);
            Assert.AreEqual(view.territoryId, screen.SelectedTerritoryId);
            Assert.AreEqual(view.normalWidth, view.outline.widthMultiplier, 0.001f);
            Assert.AreEqual(RepWarsWorldSorting.LayerGroundOverlay, view.outline.sortingLayerName);
            Assert.AreEqual(RepWarsWorldSorting.GroundOverlayOrder.Border, view.outline.sortingOrder);
            var shown = UnityEngine.Object.FindAnyObjectByType<RepWarsSelectionPresentation>();
            Assert.AreEqual(view.territoryId, shown.ShownTerritoryId);
            Assert.AreEqual(RepWarsWorldSorting.LayerGroundOverlay, shown.Highlight.sortingLayerName);
            Assert.AreEqual(RepWarsWorldSorting.GroundOverlayOrder.Selection, shown.Highlight.sortingOrder);
            Assert.AreEqual(RepWarsWorldSorting.LayerWorldOverlay, shown.Marker.sortingLayerName);
            Assert.AreEqual(RepWarsWorldSorting.WorldOverlayOrder.SelectionMarker, shown.Marker.sortingOrder);
            Assert.AreEqual(path.Length, view.GetComponent<PolygonCollider2D>().GetPath(0).Length);

            RepWarsTerritoryView other = null;
            foreach (var candidate in UnityEngine.Object.FindObjectsByType<RepWarsTerritoryView>())
            {
                if (candidate != view) { other = candidate; break; }
            }
            Assert.IsNotNull(other);
            screen.PickWorldPoint(Inside(other.GetComponent<PolygonCollider2D>()));
            Assert.AreEqual(other.territoryId, screen.SelectedTerritoryId);
            Assert.AreEqual(other.territoryId, shown.ShownTerritoryId);
            Assert.AreEqual(1, UnityEngine.Object.FindObjectsByType<RepWarsSelectionPresentation>().Length);

            camera.enabled = false;
            yield return SelectionOcclusion(shown, camera.orthographicSize);
            camera.enabled = true;

            screen.PickWorldPoint(new Vector2(-10000f, -10000f));
            Assert.IsNull(screen.SelectedTerritoryId);
            Assert.IsFalse(shown.IsShown);
            Assert.AreEqual(view.normalWidth, view.outline.widthMultiplier, 0.001f);
            Assert.AreEqual(other.normalWidth, other.outline.widthMultiplier, 0.001f);

            screen.PresentAuthoritative(screen.LiveState, null);
            Own(GameObject.Find("Level1Map"));
            Assert.IsNull(screen.SelectedTerritoryId);
            var rebuilt = UnityEngine.Object.FindAnyObjectByType<RepWarsSelectionPresentation>();
            Assert.IsNotNull(rebuilt);
            Assert.IsFalse(rebuilt.IsShown);
            yield return null;
        }

        [UnityTest]
        public IEnumerator SoldierCrossfadeKeepsFeetGroupAndLocalOrders()
        {
            var tint = new Color(0.25f, 0.45f, 0.8f, 1f);
            var army = RepWarsArmyVisual.Create(null, Vector2.zero, 3, tint);
            Own(army.gameObject);
            var soldier = army.GetComponentInChildren<RepWarsSoldierVisual>();
            var current = soldier.transform.Find("Presentation/Current").GetComponent<SpriteRenderer>();
            var upcoming = soldier.transform.Find("Presentation/Upcoming").GetComponent<SpriteRenderer>();
            Assert.AreEqual(tint.r, current.color.r, 0.02f);
            Assert.AreEqual(tint.g, current.color.g, 0.02f);
            Assert.AreEqual(tint.b, current.color.b, 0.02f);
            Assert.IsNotNull(current.sprite);
            yield return new WaitForSeconds(RepWarsSoldierVisual.HoldSeconds + RepWarsSoldierVisual.BlendSeconds * 0.45f);
            Assert.Greater(upcoming.color.a, 0.05f);
            Assert.Less(current.color.a, 0.95f);
            Assert.AreEqual(0, current.sortingOrder);
            Assert.AreEqual(1, upcoming.sortingOrder);
            Assert.AreEqual(0, soldier.GetComponentInChildren<SortingGroup>().sortingOrder);
            soldier.transform.position += new Vector3(0f, 0.2f, 0f);
            yield return null;
            Assert.AreEqual(0, current.sortingOrder);
            Assert.AreEqual(0f, soldier.transform.position.z, 1e-5f);
        }

        [UnityTest]
        public IEnumerator ProductionTreeAndSoldierObeyFeetDepth()
        {
            var tree = ProductionTree();
            var treeRenderer = tree.GetComponentInChildren<SpriteRenderer>();
            var army = RepWarsArmyVisual.Create(null, new Vector2(0f, treeRenderer.bounds.max.y), 1, Color.white);
            Own(army.gameObject);
            var soldier = army.GetComponentInChildren<RepWarsSoldierVisual>();
            Paint(soldier, Color.red, 0);
            army.transform.Find("TroopCount").gameObject.SetActive(false);
            PrepareProbe();

            PlaceFeet(soldier, treeRenderer.bounds.min.y + treeRenderer.bounds.size.y * 0.45f);
            yield return CompareOverlap(treeRenderer, CurrentOf(soldier), expectTree: true);

            PlaceFeet(soldier, treeRenderer.bounds.min.y - 0.04f);
            yield return CompareOverlap(treeRenderer, CurrentOf(soldier), expectTree: false);
            Assert.AreEqual(0, treeRenderer.sortingOrder);
            Assert.AreEqual(0, soldier.GetComponentInChildren<SortingGroup>().sortingOrder);
            Assert.AreEqual(SpriteSortPoint.Pivot, treeRenderer.spriteSortPoint);
        }

        [UnityTest]
        public IEnumerator TwoSoldiersCrossAndTieWithoutFlicker()
        {
            var army = RepWarsArmyVisual.Create(null, Vector2.zero, 2, Color.white);
            Own(army.gameObject);
            army.transform.Find("TroopCount").gameObject.SetActive(false);
            var soldiers = army.GetComponentsInChildren<RepWarsSoldierVisual>();
            Assert.AreEqual(2, soldiers.Length);
            Paint(soldiers[0], Color.red, 0);
            Paint(soldiers[1], Color.blue, 1);
            PrepareProbe();

            PlaceFeet(soldiers[0], 0.12f);
            PlaceFeet(soldiers[1], 0f);
            LookAtOverlap(CurrentOf(soldiers[0]), CurrentOf(soldiers[1]));
            yield return null;
            yield return new WaitForEndOfFrame();
            var behind = Read();
            PlaceFeet(soldiers[0], 0f);
            PlaceFeet(soldiers[1], 0.12f);
            LookAtOverlap(CurrentOf(soldiers[0]), CurrentOf(soldiers[1]));
            yield return null;
            yield return new WaitForEndOfFrame();
            var swapped = Read();
            Assert.Greater(VotesFor(behind, Color.blue, Color.red), 0, "Nearer blue soldier should cover the farther red soldier.");
            Assert.Greater(VotesFor(swapped, Color.red, Color.blue), 0, "Crossing Y should put the red soldier in front.");

            PlaceFeet(soldiers[0], 0f);
            PlaceFeet(soldiers[1], 0f);
            LookAt(0f, CurrentOf(soldiers[0]).bounds.center.y);
            yield return null;
            yield return new WaitForEndOfFrame();
            var first = Read();
            yield return new WaitForEndOfFrame();
            var second = Read();
            Assert.AreEqual(0, DifferentPixels(first, second));
            Assert.Greater(VotesFor(first, Color.red, Color.blue), 0, "Equal Y keeps the lower slot index in front.");
            Assert.AreEqual(0, soldiers[0].GetComponentInChildren<SortingGroup>().sortingOrder);
            Assert.AreEqual(0, soldiers[1].GetComponentInChildren<SortingGroup>().sortingOrder);
            Assert.IsNull(army.GetComponent<SortingGroup>());
        }

        [UnityTest]
        public IEnumerator OneArmyCanStandOnBothSidesOfATree()
        {
            var tree = ProductionTree();
            var treeRenderer = tree.GetComponentInChildren<SpriteRenderer>();
            var army = RepWarsArmyVisual.Create(null, Vector2.zero, 2, Color.white);
            Own(army.gameObject);
            army.transform.Find("TroopCount").gameObject.SetActive(false);
            var soldiers = army.GetComponentsInChildren<RepWarsSoldierVisual>();
            Paint(soldiers[0], Color.red, 0);
            Paint(soldiers[1], Color.blue, 1);
            Assert.IsNull(army.GetComponent<SortingGroup>());
            PrepareProbe();

            PlaceFeet(soldiers[0], treeRenderer.bounds.min.y + treeRenderer.bounds.size.y * 0.62f);
            PlaceFeet(soldiers[1], treeRenderer.bounds.min.y - 0.03f);
            yield return CompareOverlap(treeRenderer, CurrentOf(soldiers[0]), expectTree: true);
            yield return CompareOverlap(treeRenderer, CurrentOf(soldiers[1]), expectTree: false);
        }

        [UnityTest]
        public IEnumerator OverlayAndWorldStayInFrontOfGroundRegardlessOfY()
        {
            PrepareProbe();
            var ground = Band("ground", new Color(0.15f, 0.7f, 0.2f), new Vector3(0f, 0f, 0f));
            RepWarsWorldSorting.ApplyOrdered(ground, RepWarsWorldSorting.LayerGround, RepWarsWorldSorting.GroundOrder.Terrain);
            var border = Band("border", new Color(0.2f, 0.35f, 0.9f), new Vector3(0f, 0f, 0f));
            RepWarsWorldSorting.ApplyOrdered(border, RepWarsWorldSorting.LayerGroundOverlay, RepWarsWorldSorting.GroundOverlayOrder.Border);
            var world = Band("world", Color.red, new Vector3(0f, 0.45f, 0f));
            RepWarsWorldSorting.ApplyWorldEntity(world);
            var overlay = Band("overlay", new Color(0.95f, 0.85f, 0.2f), new Vector3(0f, 0.9f, 0f));
            RepWarsWorldSorting.ApplyOrdered(overlay, RepWarsWorldSorting.LayerWorldOverlay, RepWarsWorldSorting.WorldOverlayOrder.RegionLabel);
            LookAt(0f, 1.05f);
            yield return null;
            yield return new WaitForEndOfFrame();
            var pixel = Center(Read());
            Assert.Greater(pixel.r, 0.6f);
            Assert.Greater(pixel.g, 0.5f);
            Assert.Less(pixel.b, 0.4f);
        }

        IEnumerator SelectionOcclusion(RepWarsSelectionPresentation shown, float mapSize)
        {
            PrepareProbe();
            var edge = (shown.Highlight.GetPosition(0) + shown.Highlight.GetPosition(1)) * 0.5f;
            var outward = edge - shown.Marker.transform.position;
            if (outward.sqrMagnitude < 0.0001f) outward = Vector3.up;
            outward.Normalize();
            var outside = edge + outward * (RepWarsSelectionPresentation.HighlightWidth * 0.42f);
            var cover = Band("selection-cover", Color.red, outside - new Vector3(0f, 1f, 0f));
            RepWarsWorldSorting.ApplyWorldEntity(cover);
            LookAt(outside.x, outside.y);
            _camera.orthographicSize = 0.04f;
            yield return null;
            yield return new WaitForEndOfFrame();
            var covered = Center(Read());
            Assert.Greater(covered.r, covered.g + 0.15f, "A World sprite may cover the ground selection highlight.");
            cover.enabled = false;

            var stroke = shown.Marker.transform.TransformPoint(new Vector3(
                RepWarsSelectionPresentation.MarkerHalfExtent * 0.5f,
                RepWarsSelectionPresentation.MarkerHalfExtent * 0.5f,
                0f));
            var scenery = Band("selection-scenery", Color.blue, shown.Marker.transform.position - new Vector3(0f, 1f, 0f));
            RepWarsWorldSorting.ApplyWorldEntity(scenery);
            LookAt(stroke.x, stroke.y);
            _camera.orthographicSize = 0.05f;
            yield return null;
            yield return new WaitForEndOfFrame();
            var marker = Center(Read());
            Assert.Greater(marker.r, 0.55f, "The selection marker stays readable over World scenery.");
            Assert.Greater(marker.g, 0.45f);
            Assert.Greater(marker.r, marker.b);

            var span = RepWarsSelectionPresentation.MarkerHalfExtent * 2f;
            var normalPixels = span / (mapSize * 2f) * 1080f;
            var farPixels = span / (mapSize * 2.5f) * 1080f;
            Assert.Greater(normalPixels, 12f, "The marker should remain visible at the framed map zoom.");
            Assert.Greater(farPixels, 8f, "The marker should remain visible at the map's maximum zoom-out.");
            Assert.Less(normalPixels, 80f, "The marker should stay a small confirmation, not a fill.");
        }

        GameObject ProductionTree()
        {
            var catalog = Resources.Load<RepWarsPropCatalog>("RepWarsPropCatalog");
            var sprite = catalog.Find("tree-1-pine");
            Assert.IsNotNull(sprite);
            var root = Own(new GameObject("Prop_tree-proof"));
            root.transform.localScale = new Vector3(0.15f, 0.15f, 1f);
            RepWarsPropPlacement.AttachSortedSprite(root.transform, sprite, "tree-proof");
            return root;
        }

        void PrepareProbe()
        {
            var cameraObject = Own(new GameObject("ProbeCamera"));
            _camera = cameraObject.AddComponent<Camera>();
            _camera.orthographic = true;
            _camera.orthographicSize = 0.08f;
            _camera.clearFlags = CameraClearFlags.SolidColor;
            _camera.backgroundColor = Color.black;
            _camera.nearClipPlane = 0.01f;
            _camera.farClipPlane = 40f;
            _camera.allowHDR = false;
            _camera.allowMSAA = false;
            _target = new RenderTexture(ProbeSize, ProbeSize, 16, RenderTextureFormat.ARGB32);
            _target.Create();
            _owned.Add(_target);
            _camera.targetTexture = _target;
            RepWarsWorldSorting.ApplySortAxis(_camera);
        }

        SpriteRenderer Band(string name, Color color, Vector3 feet)
        {
            var root = Own(new GameObject(name));
            root.transform.position = feet;
            var renderer = root.AddComponent<SpriteRenderer>();
            renderer.sprite = Block(color);
            renderer.color = Color.white;
            return renderer;
        }

        Sprite Block(Color color)
        {
            var texture = new Texture2D(32, 64, TextureFormat.RGBA32, false);
            var pixels = new Color[32 * 64];
            for (var i = 0; i < pixels.Length; i++) pixels[i] = color;
            texture.SetPixels(pixels);
            texture.Apply();
            texture.filterMode = FilterMode.Point;
            _owned.Add(texture);
            var sprite = Sprite.Create(texture, new Rect(0f, 0f, 32f, 64f), new Vector2(0.5f, 0f), 32f, 0, SpriteMeshType.FullRect);
            _owned.Add(sprite);
            return sprite;
        }

        IEnumerator CompareOverlap(SpriteRenderer tree, SpriteRenderer soldier, bool expectTree)
        {
            LookAt(soldier.bounds.center.x, soldier.bounds.center.y);
            _camera.orthographicSize = Mathf.Max(0.02f, soldier.bounds.size.y * 0.35f);
            tree.enabled = true;
            soldier.enabled = false;
            yield return null;
            yield return new WaitForEndOfFrame();
            var treeOnly = Read();
            tree.enabled = false;
            soldier.enabled = true;
            yield return null;
            yield return new WaitForEndOfFrame();
            var soldierOnly = Read();
            tree.enabled = true;
            yield return null;
            yield return new WaitForEndOfFrame();
            var both = Read();
            var overlaps = 0;
            var treeWins = 0;
            var soldierWins = 0;
            for (var i = 0; i < both.Length; i++)
            {
                if (treeOnly[i].maxColorComponent < 0.08f || soldierOnly[i].maxColorComponent < 0.08f) continue;
                if (Distance(treeOnly[i], soldierOnly[i]) < 0.18f) continue;
                overlaps++;
                var towardTree = Distance(both[i], treeOnly[i]);
                var towardSoldier = Distance(both[i], soldierOnly[i]);
                if (towardTree + 0.05f < towardSoldier) treeWins++;
                else if (towardSoldier + 0.05f < towardTree) soldierWins++;
            }
            Assert.Greater(overlaps, 0, "Tree and soldier sprites did not overlap in the probe.");
            if (expectTree) Assert.Greater(treeWins, soldierWins, "Farther soldier should be covered by the tree.");
            else Assert.Greater(soldierWins, treeWins, "Nearer soldier should draw over the tree.");
        }

        static void PlaceFeet(RepWarsSoldierVisual soldier, float y)
        {
            var position = soldier.transform.position;
            position.x = 0f;
            position.y = y;
            position.z = 0f;
            soldier.transform.position = position;
        }

        static void Paint(RepWarsSoldierVisual soldier, Color color, int slot)
        {
            var current = CurrentOf(soldier);
            soldier.Bind(new[] { current.sprite }, 0f, color, slot);
            soldier.transform.Find("Presentation/Upcoming").GetComponent<SpriteRenderer>().enabled = false;
        }

        static SpriteRenderer CurrentOf(RepWarsSoldierVisual soldier)
        {
            return soldier.transform.Find("Presentation/Current").GetComponent<SpriteRenderer>();
        }

        void LookAtOverlap(SpriteRenderer a, SpriteRenderer b)
        {
            var center = (a.bounds.center + b.bounds.center) * 0.5f;
            LookAt(center.x, center.y);
            _camera.orthographicSize = Mathf.Max(0.03f, Mathf.Min(a.bounds.size.y, b.bounds.size.y) * 0.35f);
        }

        void LookAt(float x, float y)
        {
            _camera.transform.position = new Vector3(x, y, -10f);
        }

        Color[] Read()
        {
            var previous = RenderTexture.active;
            RenderTexture.active = _target;
            var read = new Texture2D(ProbeSize, ProbeSize, TextureFormat.RGBA32, false);
            read.ReadPixels(new Rect(0f, 0f, ProbeSize, ProbeSize), 0, 0);
            read.Apply();
            RenderTexture.active = previous;
            var pixels = read.GetPixels();
            UnityEngine.Object.Destroy(read);
            return pixels;
        }

        static Color Center(Color[] pixels)
        {
            return pixels[(ProbeSize / 2) * ProbeSize + ProbeSize / 2];
        }

        static int VotesFor(Color[] pixels, Color front, Color other)
        {
            var votes = 0;
            for (var i = 0; i < pixels.Length; i++)
            {
                if (pixels[i].maxColorComponent < 0.12f) continue;
                if (Distance(pixels[i], front) + 0.08f < Distance(pixels[i], other)) votes++;
            }
            return votes;
        }

        static int DifferentPixels(Color[] a, Color[] b)
        {
            var count = 0;
            for (var i = 0; i < a.Length; i++)
                if (Distance(a[i], b[i]) > 0.04f) count++;
            return count;
        }

        static float Distance(Color a, Color b)
        {
            return Mathf.Abs(a.r - b.r) + Mathf.Abs(a.g - b.g) + Mathf.Abs(a.b - b.b);
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

        GameObject Own(GameObject gameObject)
        {
            if (gameObject != null) _owned.Add(gameObject);
            return gameObject;
        }

        static void SetRenderer(TransparencySortMode mode, Vector3 axis)
        {
            var data = RendererData();
            const BindingFlags flags = BindingFlags.Instance | BindingFlags.NonPublic;
            data.GetType().GetField("m_TransparencySortMode", flags).SetValue(data, mode);
            data.GetType().GetField("m_TransparencySortAxis", flags).SetValue(data, axis);
        }

        static UnityEngine.Object RendererData()
        {
            var pipeline = QualitySettings.renderPipeline != null
                ? QualitySettings.renderPipeline
                : GraphicsSettings.defaultRenderPipeline;
            var field = pipeline.GetType().GetField("m_RendererDataList", BindingFlags.Instance | BindingFlags.NonPublic);
            var list = field.GetValue(pipeline) as Array;
            return (UnityEngine.Object)list.GetValue(0);
        }
    }
}
