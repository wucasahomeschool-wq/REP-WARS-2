using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.TestTools;

namespace RepWars.WorldPresentation.PlayModeTests
{
    /// <summary>
    /// Pixel probes for T0, T1, and T2. Sprites are created in the test and never saved.
    /// </summary>
    public class WorldSortingPlayModeTests
    {
        const int TreeHeight = 128;
        const int PixelsPerUnit = 32;

        Camera _camera;
        RenderTexture _target;
        Channel _front;
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

            var cameraObject = Own(new GameObject("SortingProbeCamera"));
            _camera = cameraObject.AddComponent<Camera>();
            _camera.orthographic = true;
            _camera.orthographicSize = 0.04f;
            _camera.clearFlags = CameraClearFlags.SolidColor;
            _camera.backgroundColor = Color.black;
            _camera.nearClipPlane = 0.01f;
            _camera.farClipPlane = 40f;
            _camera.allowHDR = false;
            _camera.allowMSAA = false;
            _target = new RenderTexture(16, 16, 16, RenderTextureFormat.ARGB32);
            _target.Create();
            _owned.Add(_target);
            _camera.targetTexture = _target;
            RepWarsWorldSorting.ApplySortAxis(_camera);
            var lightObject = Own(new GameObject("probe-light"));
            var light = lightObject.AddComponent<Light2D>();
            light.lightType = Light2D.LightType.Global;
            light.intensity = 1f;
            yield return null;
        }

        [UnityTearDown]
        public IEnumerator TearDown()
        {
            // Always put the shared 2D renderer back on the contract axis. Restoring a
            // pre-test snapshot could write the old Default mode if the editor had not
            // reloaded Renderer2D.asset yet.
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
        public IEnumerator T0_RendererAxisGovernsAndHigherYIsFarther()
        {
            var far = Figure("far", Color.blue, 32, 64, new Vector3(0f, 0.2f, 0f), "t0-far");
            var near = Figure("near", Color.red, 32, 64, new Vector3(0f, 0f, 0f), "t0-near");
            LookAt(0f, 0.4f);

            _camera.transparencySortMode = TransparencySortMode.CustomAxis;
            _camera.transparencySortAxis = new Vector3(0f, -1f, 0f);
            SetRenderer(TransparencySortMode.CustomAxis, RepWarsWorldSorting.SortAxis);
            yield return ReadFront();
            Assert.AreEqual(Channel.Red, _front, "Camera axis must not override the 2D renderer. Lower Y should stay in front.");

            _camera.transparencySortAxis = RepWarsWorldSorting.SortAxis;
            yield return ReadFront();
            Assert.AreEqual(Channel.Red, _front);

            SetRenderer(TransparencySortMode.CustomAxis, new Vector3(0f, -1f, -1f));
            yield return ReadFront();
            Assert.AreEqual(Channel.Blue, _front, "Renderer axis sign must be what flips near and far.");

            SetRenderer(TransparencySortMode.CustomAxis, RepWarsWorldSorting.SortAxis);
            Assert.AreEqual(0, far.GetComponentInChildren<SpriteRenderer>().sortingOrder);
            Assert.AreEqual(0, near.GetComponentInChildren<SpriteRenderer>().sortingOrder);
        }

        [UnityTest]
        public IEnumerator T1_PivotFeetOccludeAgainstATallTree()
        {
            var tree = Figure("tree", new Color(0.1f, 0.7f, 0.2f), 32, TreeHeight, new Vector3(0f, 0f, 0f), "t1-tree");
            var soldier = Figure("soldier", Color.red, 32, 16, new Vector3(0f, 1.6f, 0f), "t1-soldier");
            LookAt(0f, 1.85f);

            yield return ReadFront();
            Assert.AreEqual(Channel.Green, _front, "Feet at Y=1.6 are behind a tree whose feet are at Y=0.");

            tree.GetComponentInChildren<SpriteRenderer>().spriteSortPoint = SpriteSortPoint.Center;
            soldier.GetComponentInChildren<SpriteRenderer>().spriteSortPoint = SpriteSortPoint.Center;
            yield return ReadFront();
            Assert.AreEqual(Channel.Red, _front, "Center sort would hide the tree behind the short soldier. Pivot must not do that.");

            RepWarsWorldSorting.ApplyWorldEntity(tree.GetComponentInChildren<SpriteRenderer>());
            RepWarsWorldSorting.ApplyWorldEntity(soldier.GetComponentInChildren<SpriteRenderer>());
            yield return ReadFront();
            Assert.AreEqual(Channel.Green, _front);
            Assert.AreEqual(0, tree.GetComponentInChildren<SpriteRenderer>().sortingOrder);
            Assert.AreEqual(0, soldier.GetComponentInChildren<SpriteRenderer>().sortingOrder);
        }

        [UnityTest]
        public IEnumerator T1_MinimumYSeparationStillUsesFeet()
        {
            var tree = Figure("tree", new Color(0.1f, 0.7f, 0.2f), 32, 64, new Vector3(0f, 0f, 0f), "t1-min-tree");
            var soldier = Figure("soldier", Color.red, 32, 64, new Vector3(0f, -RepWarsWorldSorting.MinimumMeaningfulY, 0f), "t1-min-soldier");
            tree.transform.GetChild(0).localPosition = Vector3.zero;
            soldier.transform.GetChild(0).localPosition = new Vector3(0f, 0f, RepWarsWorldSorting.MaxTieOffset);
            LookAt(0f, 0.4f);
            yield return ReadFront();
            Assert.AreEqual(Channel.Red, _front, "A 0.01 nearer foot must beat the maximum tie offset.");
            Assert.AreEqual(0, soldier.GetComponentInChildren<SpriteRenderer>().sortingOrder);
        }

        [UnityTest]
        public IEnumerator T2_OrderSwapsWhenYCrossesAndTieIsStable()
        {
            var a = Figure("a", Color.red, 32, 64, new Vector3(0f, 0.05f, 0f), "t2-a");
            var b = Figure("b", Color.blue, 32, 64, new Vector3(0f, 0f, 0f), "t2-b");
            LookAt(0f, 0.2f);
            yield return ReadFront();
            Assert.AreEqual(Channel.Blue, _front);

            a.transform.position = new Vector3(0f, -0.05f, 0f);
            yield return ReadFront();
            Assert.AreEqual(Channel.Red, _front);

            a.transform.position = new Vector3(0f, 0f, 0f);
            yield return ReadFront();
            var first = _front;
            yield return ReadFront();
            var second = _front;
            Assert.AreEqual(first, second);
            var aIndex = RepWarsWorldSorting.TieIndex("t2-a");
            var bIndex = RepWarsWorldSorting.TieIndex("t2-b");
            var expectedFront = aIndex < bIndex ? Channel.Red : Channel.Blue;
            Assert.AreEqual(expectedFront, first);
            Assert.AreEqual(0, a.GetComponentInChildren<SpriteRenderer>().sortingOrder);
            Assert.AreEqual(0, b.GetComponentInChildren<SpriteRenderer>().sortingOrder);
        }

        [UnityTest]
        public IEnumerator MovingAFigureDoesNotWriteSortingOrder()
        {
            var figure = Figure("mover", Color.red, 32, 32, new Vector3(0f, 0f, 0f), "mover");
            var renderer = figure.GetComponentInChildren<SpriteRenderer>();
            for (var i = 0; i < 4; i++)
            {
                figure.transform.position = new Vector3(0f, i * 0.25f, 0f);
                yield return null;
                Assert.AreEqual(0, renderer.sortingOrder);
                Assert.AreEqual(RepWarsWorldSorting.LayerWorld, renderer.sortingLayerName);
                Assert.AreEqual(SpriteSortPoint.Pivot, renderer.spriteSortPoint);
            }
        }

        GameObject Figure(string name, Color color, int width, int height, Vector3 feet, string stableId)
        {
            var root = Own(new GameObject(name));
            root.transform.position = feet;
            var presentation = Own(new GameObject("presentation"));
            presentation.transform.SetParent(root.transform, false);
            RepWarsWorldSorting.ApplyTieOffset(presentation.transform, stableId);
            var rendererObject = Own(new GameObject("sprite"));
            rendererObject.transform.SetParent(presentation.transform, false);
            var renderer = rendererObject.AddComponent<SpriteRenderer>();
            renderer.sprite = SpriteOf(color, width, height);
            renderer.color = Color.white;
            RepWarsWorldSorting.ApplyWorldEntity(renderer);
            return root;
        }

        Sprite SpriteOf(Color color, int width, int height)
        {
            var texture = new Texture2D(width, height, TextureFormat.RGBA32, false);
            var pixels = new Color[width * height];
            for (var i = 0; i < pixels.Length; i++) pixels[i] = color;
            texture.SetPixels(pixels);
            texture.Apply();
            texture.filterMode = FilterMode.Point;
            _owned.Add(texture);
            var sprite = Sprite.Create(texture, new Rect(0f, 0f, width, height), new Vector2(0.5f, 0f), PixelsPerUnit, 0, SpriteMeshType.FullRect);
            _owned.Add(sprite);
            return sprite;
        }

        void LookAt(float x, float y)
        {
            _camera.transform.position = new Vector3(x, y, -10f);
        }

        IEnumerator ReadFront()
        {
            yield return null;
            yield return new WaitForEndOfFrame();
            var previous = RenderTexture.active;
            RenderTexture.active = _target;
            var read = new Texture2D(1, 1, TextureFormat.RGBA32, false);
            read.ReadPixels(new Rect(_target.width / 2, _target.height / 2, 1, 1), 0, 0);
            read.Apply();
            RenderTexture.active = previous;
            _front = ChannelOf(read.GetPixel(0, 0));
            UnityEngine.Object.Destroy(read);
        }

        static Channel ChannelOf(Color pixel)
        {
            if (pixel.g > pixel.r + 0.15f && pixel.g > pixel.b + 0.15f && pixel.g > 0.2f) return Channel.Green;
            if (pixel.r > pixel.g + 0.15f && pixel.r > pixel.b + 0.15f && pixel.r > 0.2f) return Channel.Red;
            if (pixel.b > pixel.r + 0.15f && pixel.b > pixel.g + 0.15f && pixel.b > 0.2f) return Channel.Blue;
            return Channel.Other;
        }

        enum Channel { Red, Green, Blue, Other }

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

        GameObject Own(GameObject gameObject)
        {
            _owned.Add(gameObject);
            return gameObject;
        }
    }
}
