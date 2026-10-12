using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace RepWars.WorldPresentation.Editor
{
    /// <summary>
    /// Isolated sorting proof. Does not open or save production map scenes.
    /// </summary>
    public static class WorldSortingProofSceneBuilder
    {
        const string Root = "Assets/RepWars/WorldPresentation/Sorting";
        public const string ScenePath = Root + "/Scenes/WorldSortingProof.unity";
        const string Art = Root + "/ProofArt";

        [MenuItem("RepWars/World Presentation/Sorting/Build Phase 1 Proof Scene")]
        public static void Build()
        {
            BuildInternal(true);
        }

        public static void BuildBatch()
        {
            BuildInternal(false);
        }

        public static void BuildInternal(bool promptToSaveOpenScene)
        {
            if (promptToSaveOpenScene && !EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var treeSprite = ProofSprite(Art + "/tree.png", 32, 128, new Color32(28, 110, 48, 255), true);
            var figureSprite = ProofSprite(Art + "/figure.png", 24, 48, new Color32(255, 255, 255, 255), false);
            var quadSprite = ProofSprite(Art + "/quad.png", 32, 32, new Color32(255, 255, 255, 255), false);

            var cameraObject = new GameObject("Main Camera");
            cameraObject.tag = "MainCamera";
            var camera = cameraObject.AddComponent<Camera>();
            camera.orthographic = true;
            camera.orthographicSize = 3.4f;
            camera.transform.position = new Vector3(0f, 0.4f, -10f);
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.16f, 0.20f, 0.18f);
            cameraObject.AddComponent<WorldSortingCameraBinding>();
            var light = new GameObject("Global Light 2D").AddComponent<Light2D>();
            light.lightType = Light2D.LightType.Global;
            light.intensity = 1f;

            Band("Backdrop sky", new Vector3(0f, 1.6f, 0f), new Vector3(14f, 2.4f, 1f), new Color(0.45f, 0.62f, 0.78f), RepWarsWorldSorting.LayerBackdrop, RepWarsWorldSorting.BackdropOrder.Sky, quadSprite);
            Band("Ground terrain", new Vector3(0f, -3.2f, 0f), new Vector3(14f, 1.5f, 1f), new Color(0.38f, 0.32f, 0.22f), RepWarsWorldSorting.LayerGround, RepWarsWorldSorting.GroundOrder.Terrain, quadSprite);
            Band("GroundOverlay border", new Vector3(0f, -1.7f, 0f), new Vector3(14f, 0.08f, 1f), new Color(0.85f, 0.75f, 0.35f), RepWarsWorldSorting.LayerGroundOverlay, RepWarsWorldSorting.GroundOverlayOrder.Border, quadSprite);
            Band("Atmosphere band", new Vector3(0f, 3.15f, 0f), new Vector3(14f, 0.35f, 1f), new Color(0.9f, 0.93f, 0.95f, 0.45f), RepWarsWorldSorting.LayerAtmosphere, RepWarsWorldSorting.AtmosphereOrder.Ambient, quadSprite);

            WorldSprite("Tree", new Vector3(-0.1f, 0f, 0f), Vector3.one, new Color(0.12f, 0.48f, 0.22f), treeSprite, "proof-tree");
            WorldSprite("Soldier far", new Vector3(0.55f, 0.85f, 0f), Vector3.one, new Color(0.25f, 0.45f, 0.9f), figureSprite, "proof-soldier-far");
            WorldSprite("Soldier near", new Vector3(-0.7f, -0.55f, 0f), Vector3.one, new Color(0.9f, 0.22f, 0.18f), figureSprite, "proof-soldier-near");
            WorldSprite("Equal Y A", new Vector3(2.5f, -0.2f, 0f), Vector3.one, new Color(0.95f, 0.78f, 0.2f), figureSprite, "proof-equal-a");
            WorldSprite("Equal Y B", new Vector3(2.5f, -0.2f, 0f), Vector3.one, new Color(0.62f, 0.28f, 0.78f), figureSprite, "proof-equal-b");
            Composite("Composite figure", new Vector3(-2.6f, 0.2f, 0f), figureSprite);

            Label("Farther feet are behind the tree", new Vector3(-0.1f, 2.15f, 0f));
            Label("Equal Y tie. Lower index draws in front.", new Vector3(2.5f, 0.85f, 0f));
            Label("Selection marker slot is WorldOverlay 30. Not wired.", new Vector3(0f, -2.9f, 0f));

            Directory.CreateDirectory(Path.GetDirectoryName(ScenePath));
            EditorSceneManager.SaveScene(scene, ScenePath);
            Debug.Log("[WorldSorting] Proof scene written to " + ScenePath);
        }

        static void WorldSprite(string name, Vector3 feet, Vector3 scale, Color tint, Sprite sprite, string stableId)
        {
            var root = new GameObject(name);
            root.transform.position = feet;
            var presentation = new GameObject("Presentation");
            presentation.transform.SetParent(root.transform, false);
            RepWarsWorldSorting.ApplyTieOffset(presentation.transform, stableId);
            var renderer = presentation.AddComponent<SpriteRenderer>();
            renderer.sprite = sprite;
            renderer.color = tint;
            renderer.transform.localScale = scale;
            RepWarsWorldSorting.ApplyWorldEntity(renderer);
        }

        static void Composite(string name, Vector3 feet, Sprite sprite)
        {
            var root = new GameObject(name);
            root.transform.position = feet;
            var presentation = new GameObject("Presentation");
            presentation.transform.SetParent(root.transform, false);
            RepWarsWorldSorting.ApplyTieOffset(presentation.transform, "proof-composite");
            RepWarsWorldSorting.ApplyWorldGroup(presentation.AddComponent<SortingGroup>());
            var body = presentation.AddComponent<SpriteRenderer>();
            body.sprite = sprite;
            body.color = new Color(0.72f, 0.48f, 0.28f);
            body.sortingOrder = 0;
            body.spriteSortPoint = SpriteSortPoint.Pivot;
            var badgeObject = new GameObject("Badge");
            badgeObject.transform.SetParent(presentation.transform, false);
            badgeObject.transform.localPosition = new Vector3(0.15f, 0.7f, 0f);
            badgeObject.transform.localScale = new Vector3(0.35f, 0.35f, 1f);
            var badge = badgeObject.AddComponent<SpriteRenderer>();
            badge.sprite = sprite;
            badge.color = new Color(0.95f, 0.95f, 0.9f);
            badge.sortingOrder = 1;
            badge.spriteSortPoint = SpriteSortPoint.Pivot;
        }

        static void Band(string name, Vector3 position, Vector3 scale, Color color, string layer, int order, Sprite sprite)
        {
            var renderer = new GameObject(name).AddComponent<SpriteRenderer>();
            renderer.transform.position = position;
            renderer.transform.localScale = scale;
            renderer.sprite = sprite;
            renderer.color = color;
            RepWarsWorldSorting.ApplyOrdered(renderer, layer, order);
        }

        static void Label(string text, Vector3 position)
        {
            var mesh = new GameObject("Label").AddComponent<TextMesh>();
            mesh.transform.position = position;
            mesh.text = text;
            mesh.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            mesh.alignment = TextAlignment.Center;
            mesh.characterSize = 0.08f;
            mesh.fontSize = 48;
            mesh.color = new Color(0.95f, 0.95f, 0.9f);
            RepWarsWorldSorting.ApplyOrdered(mesh.GetComponent<MeshRenderer>(), RepWarsWorldSorting.LayerWorldOverlay, RepWarsWorldSorting.WorldOverlayOrder.LocationLabel);
        }

        static Sprite ProofSprite(string assetPath, int width, int height, Color32 color, bool tree)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(assetPath));
            if (!File.Exists(assetPath))
            {
                var texture = new Texture2D(width, height, TextureFormat.RGBA32, false);
                var pixels = new Color32[width * height];
                for (var y = 0; y < height; y++)
                for (var x = 0; x < width; x++)
                {
                    var pixel = color;
                    if (tree && y < 36 && x > 10 && x < 22) pixel = new Color32(92, 58, 32, 255);
                    pixels[y * width + x] = pixel;
                }
                texture.SetPixels32(pixels);
                File.WriteAllBytes(assetPath, texture.EncodeToPNG());
                Object.DestroyImmediate(texture);
                AssetDatabase.ImportAsset(assetPath);
            }
            var importer = (TextureImporter)AssetImporter.GetAtPath(assetPath);
            importer.textureType = TextureImporterType.Sprite;
            importer.spriteImportMode = SpriteImportMode.Single;
            importer.alphaIsTransparency = true;
            importer.mipmapEnabled = false;
            importer.wrapMode = TextureWrapMode.Clamp;
            importer.filterMode = FilterMode.Bilinear;
            importer.textureCompression = TextureImporterCompression.Uncompressed;
            var settings = new TextureImporterSettings();
            importer.ReadTextureSettings(settings);
            settings.spriteMeshType = SpriteMeshType.FullRect;
            settings.spriteAlignment = (int)SpriteAlignment.BottomCenter;
            settings.spritePivot = new Vector2(0.5f, 0f);
            importer.SetTextureSettings(settings);
            importer.spritePixelsToUnits = 32f;
            importer.SaveAndReimport();
            return AssetDatabase.LoadAssetAtPath<Sprite>(assetPath);
        }
    }
}
