using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RepWars.Characters.EditorTools
{
    /// <summary>
    /// Generates the Phase A placeholder sprites, definition assets, catalogs, registry, prefabs and proof scene.
    /// Safe to run repeatedly: existing assets are updated in place so references and GUIDs are kept.
    /// The sprites are intentionally ugly. They exist to prove the system, not to be art.
    /// </summary>
    public static class RepWarsCharacterPhaseABuilder
    {
        public const string Root = "Assets/RepWars/Characters";
        const string SpriteDir = Root + "/Placeholders/Sprites";
        const string DefinitionsDir = Root + "/Definitions";
        const string CatalogDir = Root + "/Catalogs";
        const string PrefabDir = Root + "/Prefabs";
        const string ResourcesDir = Root + "/Resources";
        public const string ScenePath = Root + "/Scenes/CharacterSystemProof.unity";
        public const float PixelsPerUnit = 32f;

        static readonly Color Skin = new Color(0.86f, 0.70f, 0.52f);
        static readonly Color SkinDark = new Color(0.72f, 0.56f, 0.40f);
        static readonly Color Outline = new Color(0.10f, 0.08f, 0.08f);
        static readonly Color Gear = new Color(0.82f, 0.82f, 0.84f);
        static readonly Color GearDark = new Color(0.62f, 0.62f, 0.66f);
        static readonly Color Gold = new Color(0.98f, 0.80f, 0.20f);
        static readonly Color GoldDark = new Color(0.75f, 0.55f, 0.10f);
        static readonly Color Banana = new Color(0.98f, 0.88f, 0.22f);
        static readonly Color BananaDark = new Color(0.80f, 0.66f, 0.10f);
        static readonly Color Stem = new Color(0.45f, 0.32f, 0.12f);

        [MenuItem("RepWars/Characters/Build Phase A Assets")]
        public static void BuildAllMenu()
        {
            BuildAll();
        }

        public static void BuildAll()
        {
            EnsureFolders();
            var sprites = BuildSprites();
            var backpackPrefab = BuildBackpackPrefab(sprites["backpack"]);

            var animHumanoid = BuildAnimationProfile("humanoid_locomotion_v1", "humanoid");
            var animBanana = BuildAnimationProfile("banana_locomotion_v1", "banana");

            var rigHumanoid = BuildHumanoidRig();
            var rigBanana = BuildBananaRig();

            var humanMale = BuildHumanMale(sprites);
            var banana = BuildBananaBase(sprites);

            var soldierGear = BuildSoldierGear(sprites, backpackPrefab);
            var emperorRegalia = BuildEmperorRegalia(sprites);

            var vSoldier = BuildVariant("generic_soldier", "Generic Soldier", "human_male", "soldier_gear_01", 1f);
            var vEmperor = BuildVariant("generic_emperor", "Generic Emperor", "human_male", "emperor_regalia_01", 1.15f);
            var vBananaSoldier = BuildVariant("banana_soldier", "Banana Soldier", "banana", "soldier_gear_01", 1f);
            var vBananaEmperor = BuildVariant("banana_emperor", "Banana Emperor", "banana", "emperor_regalia_01", 1.15f);

            var emperorCatalog = LoadOrCreate<RepWarsEmperorCatalog>(CatalogDir + "/RepWarsEmperorCatalog.asset");
            emperorCatalog.entries = new[]
            {
                Entry("emperor_generic", "generic_emperor", "Generic Emperor", 0, "human"),
                Entry("emperor_banana", "banana_emperor", "Banana Emperor", 1, "novelty"),
            };
            EditorUtility.SetDirty(emperorCatalog);

            var infantryCatalog = LoadOrCreate<RepWarsInfantryCatalog>(CatalogDir + "/RepWarsInfantryCatalog.asset");
            infantryCatalog.defaultInfantryVariantId = "generic_soldier";
            infantryCatalog.entries = new[]
            {
                Entry("infantry_generic", "generic_soldier", "Generic Soldier", 0, "human"),
                Entry("infantry_banana", "banana_soldier", "Banana Soldier", 1, "novelty"),
            };
            EditorUtility.SetDirty(infantryCatalog);

            var actorPrefab = BuildActorPrefab();

            var registry = LoadOrCreate<RepWarsCharacterRegistry>(ResourcesDir + "/RepWarsCharacterRegistry.asset");
            registry.bases = new[] { humanMale, banana };
            registry.appearances = new[] { soldierGear, emperorRegalia };
            registry.variants = new[] { vSoldier, vEmperor, vBananaSoldier, vBananaEmperor };
            registry.rigs = new[] { rigHumanoid, rigBanana };
            registry.animationProfiles = new[] { animHumanoid, animBanana };
            registry.emperorCatalog = emperorCatalog;
            registry.infantryCatalog = infantryCatalog;
            registry.defaultActorPrefab = actorPrefab;
            EditorUtility.SetDirty(registry);

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            RepWarsCharacterCatalog.ReloadDefault();

            BuildProofScene();
            AssetDatabase.SaveAssets();
            Debug.Log("[RepWarsCharacters] Phase A assets built.");
        }

        // ---------------------------------------------------------------- folders / helpers

        static void EnsureFolders()
        {
            var folders = new[]
            {
                Root + "/Definitions", Root + "/Definitions/Bases", Root + "/Definitions/Appearances",
                Root + "/Definitions/Variants", Root + "/Definitions/Rigs", Root + "/Definitions/Animation",
                Root + "/Catalogs", Root + "/Prefabs", Root + "/Placeholders", Root + "/Placeholders/Sprites",
                Root + "/Placeholders/Libraries", Root + "/Scenes", Root + "/Resources",
            };
            foreach (var folder in folders)
            {
                if (AssetDatabase.IsValidFolder(folder)) continue;
                var parent = Path.GetDirectoryName(folder).Replace('\\', '/');
                AssetDatabase.CreateFolder(parent, Path.GetFileName(folder));
            }
        }

        static T LoadOrCreate<T>(string path) where T : ScriptableObject
        {
            var existing = AssetDatabase.LoadAssetAtPath<T>(path);
            if (existing != null) return existing;
            var created = ScriptableObject.CreateInstance<T>();
            AssetDatabase.CreateAsset(created, path);
            return created;
        }

        static CharacterCatalogEntry Entry(string entryId, string variantId, string displayName, int order, params string[] tags)
        {
            return new CharacterCatalogEntry
            {
                catalogEntryId = entryId,
                variantId = variantId,
                displayName = displayName,
                sortOrder = order,
                tags = tags,
            };
        }

        // ---------------------------------------------------------------- definitions

        static AnimationProfileDefinition BuildAnimationProfile(string id, string clipPrefix)
        {
            var asset = LoadOrCreate<AnimationProfileDefinition>(DefinitionsDir + "/Animation/" + id + ".asset");
            asset.animationProfileId = id;
            asset.locomotion = new[]
            {
                new LocomotionBinding { kind = LocomotionKind.None, clipId = "" },
                new LocomotionBinding { kind = LocomotionKind.Idle, clipId = clipPrefix + "_idle" },
                new LocomotionBinding { kind = LocomotionKind.Walk, clipId = clipPrefix + "_walk" },
            };
            asset.reactions = new[]
            {
                new ReactionBinding { kind = ReactionKind.Celebrate, clipId = clipPrefix + "_celebrate" },
                new ReactionBinding { kind = ReactionKind.Defeat, clipId = clipPrefix + "_defeat" },
            };
            EditorUtility.SetDirty(asset);
            return asset;
        }

        static RigSocketDefinition Socket(string name, float x, float y, float scale = 1f)
        {
            return new RigSocketDefinition
            {
                socketName = name,
                defaultLocalPosition = new Vector2(x, y),
                defaultLocalScale = new Vector2(scale, scale),
            };
        }

        static RigProfileDefinition BuildHumanoidRig()
        {
            var asset = LoadOrCreate<RigProfileDefinition>(DefinitionsDir + "/Rigs/humanoid_v1.asset");
            asset.rigProfileId = "humanoid_v1";
            asset.compatibilityTier = CompatibilityTier.T0SharedHumanoid;
            asset.supportedAnimationProfileIds = new[] { "humanoid_locomotion_v1" };
            asset.sockets = new[]
            {
                Socket(SocketNames.HeadTop, 0f, 1.45f),
                Socket(SocketNames.Neck, 0f, 1.08f),
                Socket(SocketNames.Torso, 0f, 0.80f),
                Socket(SocketNames.Back, -0.34f, 0.85f),
                Socket(SocketNames.Waist, 0f, 0.60f),
            };
            EditorUtility.SetDirty(asset);
            return asset;
        }

        static RigProfileDefinition BuildBananaRig()
        {
            var asset = LoadOrCreate<RigProfileDefinition>(DefinitionsDir + "/Rigs/banana_v1.asset");
            asset.rigProfileId = "banana_v1";
            asset.compatibilityTier = CompatibilityTier.T1NonHumanRigFamily;
            asset.supportedAnimationProfileIds = new[] { "banana_locomotion_v1" };
            // Same socket vocabulary as the humanoid. Different places, smaller scale for a narrow body.
            asset.sockets = new[]
            {
                Socket(SocketNames.HeadTop, 0.10f, 1.32f, 0.6f),
                Socket(SocketNames.Neck, 0.08f, 1.10f, 0.6f),
                Socket(SocketNames.Torso, 0f, 0.72f, 0.6f),
                Socket(SocketNames.Back, -0.24f, 0.72f, 0.6f),
                Socket(SocketNames.Waist, 0f, 0.50f, 0.6f),
            };
            EditorUtility.SetDirty(asset);
            return asset;
        }

        static BaseVisualLayer Layer(string id, Sprite sprite, float x, float y, int order)
        {
            return new BaseVisualLayer
            {
                layerId = id,
                sprite = sprite,
                localPosition = new Vector2(x, y),
                localScale = Vector2.one,
                sortingOrder = order,
                receivesTint = false,
            };
        }

        static CharacterBaseDefinition BuildHumanMale(Dictionary<string, Sprite> sprites)
        {
            var asset = LoadOrCreate<CharacterBaseDefinition>(DefinitionsDir + "/Bases/human_male.asset");
            asset.baseId = "human_male";
            asset.displayName = "Human (Male)";
            asset.compatibilityTier = CompatibilityTier.T0SharedHumanoid;
            asset.rigProfileId = "humanoid_v1";
            asset.animationProfileId = "humanoid_locomotion_v1";
            asset.backendKind = CharacterBackendKind.Stub;
            asset.defaultScale = 1f;
            asset.intrinsicVisuals = new[]
            {
                Layer("legs", sprites["human_legs"], 0f, 0.25f, 0),
                Layer("arms", sprites["human_arms"], 0f, 0.84f, 0),
                Layer("torso", sprites["human_torso"], 0f, 0.78f, 1),
                Layer("head", sprites["human_head"], 0f, 1.28f, 2),
            };
            EditorUtility.SetDirty(asset);
            return asset;
        }

        static CharacterBaseDefinition BuildBananaBase(Dictionary<string, Sprite> sprites)
        {
            var asset = LoadOrCreate<CharacterBaseDefinition>(DefinitionsDir + "/Bases/banana.asset");
            asset.baseId = "banana";
            asset.displayName = "Banana";
            asset.compatibilityTier = CompatibilityTier.T1NonHumanRigFamily;
            asset.rigProfileId = "banana_v1";
            asset.animationProfileId = "banana_locomotion_v1";
            asset.backendKind = CharacterBackendKind.Stub;
            asset.defaultScale = 1f;
            asset.intrinsicVisuals = new[]
            {
                Layer("banana_body", sprites["banana_body"], 0f, 0.6875f, 0),
            };
            EditorUtility.SetDirty(asset);
            return asset;
        }

        static AppearanceSlotBinding SpriteBinding(AppearanceSlot slot, string socket, Sprite sprite, int order, bool tint, float offsetY = 0f)
        {
            return new AppearanceSlotBinding
            {
                slot = slot,
                mechanism = AppearanceMechanism.SocketSprite,
                socketName = socket,
                sprite = sprite,
                localOffset = new Vector2(0f, offsetY),
                localScale = Vector2.one,
                sortingOrder = order,
                receivesTint = tint,
            };
        }

        static AppearanceDefinition BuildSoldierGear(Dictionary<string, Sprite> sprites, GameObject backpackPrefab)
        {
            var asset = LoadOrCreate<AppearanceDefinition>(DefinitionsDir + "/Appearances/soldier_gear_01.asset");
            asset.appearanceId = "soldier_gear_01";
            asset.displayName = "Soldier Gear 01";
            asset.bindings = new[]
            {
                SpriteBinding(AppearanceSlot.Headwear, SocketNames.HeadTop, sprites["helmet"], 3, true, -0.04f),
                SpriteBinding(AppearanceSlot.Belt, SocketNames.Waist, sprites["belt_soldier"], 2, true),
                new AppearanceSlotBinding
                {
                    slot = AppearanceSlot.Back,
                    mechanism = AppearanceMechanism.SocketPrefab,
                    socketName = SocketNames.Back,
                    prefab = backpackPrefab,
                    localScale = Vector2.one,
                    sortingOrder = -2,
                    receivesTint = true,
                },
            };
            EditorUtility.SetDirty(asset);
            return asset;
        }

        static AppearanceDefinition BuildEmperorRegalia(Dictionary<string, Sprite> sprites)
        {
            var asset = LoadOrCreate<AppearanceDefinition>(DefinitionsDir + "/Appearances/emperor_regalia_01.asset");
            asset.appearanceId = "emperor_regalia_01";
            asset.displayName = "Emperor Regalia 01";
            asset.bindings = new[]
            {
                SpriteBinding(AppearanceSlot.Headwear, SocketNames.HeadTop, sprites["crown"], 3, false, 0.0f),
                SpriteBinding(AppearanceSlot.Belt, SocketNames.Waist, sprites["belt_gold"], 2, false),
            };
            EditorUtility.SetDirty(asset);
            return asset;
        }

        static CharacterVariantDefinition BuildVariant(string id, string displayName, string baseId, string appearanceId, float scaleMultiplier)
        {
            var asset = LoadOrCreate<CharacterVariantDefinition>(DefinitionsDir + "/Variants/" + id + ".asset");
            asset.variantId = id;
            asset.displayName = displayName;
            asset.baseId = baseId;
            asset.appearanceId = appearanceId;
            asset.visualOverrides = new VariantVisualOverrides
            {
                tint = Color.white,
                scaleMultiplier = scaleMultiplier,
                facingPolicy = FacingPolicy.Mirror,
            };
            EditorUtility.SetDirty(asset);
            return asset;
        }

        // ---------------------------------------------------------------- prefabs

        static GameObject BuildBackpackPrefab(Sprite sprite)
        {
            var path = PrefabDir + "/Accessory_Backpack.prefab";
            var go = new GameObject("Accessory_Backpack");
            go.AddComponent<SpriteRenderer>().sprite = sprite;
            var prefab = PrefabUtility.SaveAsPrefabAsset(go, path);
            UnityEngine.Object.DestroyImmediate(go);
            return prefab;
        }

        static RepWarsCharacterActor BuildActorPrefab()
        {
            var path = PrefabDir + "/RepWarsCharacterActor.prefab";
            var go = new GameObject("RepWarsCharacterActor");
            go.AddComponent<RepWarsCharacterActor>();
            var prefab = PrefabUtility.SaveAsPrefabAsset(go, path);
            UnityEngine.Object.DestroyImmediate(go);
            return prefab.GetComponent<RepWarsCharacterActor>();
        }

        // ---------------------------------------------------------------- scene

        static void BuildProofScene()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var cameraGo = new GameObject("Main Camera");
            cameraGo.tag = "MainCamera";
            var camera = cameraGo.AddComponent<Camera>();
            camera.orthographic = true;
            camera.orthographicSize = 3.2f;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.16f, 0.19f, 0.24f);
            cameraGo.transform.position = new Vector3(0f, 0.6f, -10f);

            var controllerGo = new GameObject("ProofController");
            controllerGo.AddComponent<RepWarsCharacterProofController>();

            EditorSceneManager.SaveScene(scene, ScenePath);
        }

        // ---------------------------------------------------------------- placeholder sprites

        static Dictionary<string, Sprite> BuildSprites()
        {
            var made = new Dictionary<string, Sprite>();

            made["human_legs"] = SaveSprite("human_legs", Legs());
            made["human_arms"] = SaveSprite("human_arms", Arms());
            made["human_torso"] = SaveSprite("human_torso", Torso());
            made["human_head"] = SaveSprite("human_head", Head());
            made["banana_body"] = SaveSprite("banana_body", BananaBody());
            made["helmet"] = SaveSprite("helmet", Helmet());
            made["crown"] = SaveSprite("crown", Crown());
            made["belt_soldier"] = SaveSprite("belt_soldier", BeltTexture(Gear, GearDark));
            made["belt_gold"] = SaveSprite("belt_gold", BeltTexture(Gold, GoldDark));
            made["backpack"] = SaveSprite("backpack", Backpack());
            return made;
        }

        static Texture2D NewTexture(int w, int h)
        {
            var texture = new Texture2D(w, h, TextureFormat.RGBA32, false);
            var clear = new Color32[w * h];
            texture.SetPixels32(clear);
            return texture;
        }

        static void Rect(Texture2D t, int x, int y, int w, int h, Color c)
        {
            for (var py = y; py < y + h; py++)
            {
                for (var px = x; px < x + w; px++)
                {
                    if (px >= 0 && py >= 0 && px < t.width && py < t.height) t.SetPixel(px, py, c);
                }
            }
        }

        static void OutlinedRect(Texture2D t, int x, int y, int w, int h, Color fill, Color line)
        {
            Rect(t, x, y, w, h, line);
            Rect(t, x + 1, y + 1, w - 2, h - 2, fill);
        }

        static Texture2D Legs()
        {
            var t = NewTexture(12, 16);
            OutlinedRect(t, 1, 0, 5, 16, Skin, Outline);
            OutlinedRect(t, 6, 0, 5, 16, SkinDark, Outline);
            return t;
        }

        static Texture2D Arms()
        {
            var t = NewTexture(24, 14);
            OutlinedRect(t, 0, 0, 5, 14, SkinDark, Outline);
            OutlinedRect(t, 19, 0, 5, 14, SkinDark, Outline);
            return t;
        }

        static Texture2D Torso()
        {
            var t = NewTexture(16, 18);
            OutlinedRect(t, 0, 0, 16, 18, Skin, Outline);
            Rect(t, 7, 3, 2, 10, SkinDark);
            return t;
        }

        static Texture2D Head()
        {
            var t = NewTexture(14, 14);
            OutlinedRect(t, 0, 0, 14, 14, Skin, Outline);
            Rect(t, 3, 7, 2, 2, Outline);
            Rect(t, 9, 7, 2, 2, Outline);
            Rect(t, 4, 3, 6, 1, Outline);
            return t;
        }

        static Texture2D BananaBody()
        {
            const int w = 24;
            const int h = 44;
            var t = NewTexture(w, h);
            for (var y = 0; y < h; y++)
            {
                var u = (y + 1f) / (h + 1f);
                var centerX = 11f + 5f * Mathf.Sin(u * Mathf.PI) - 3f;
                var half = 1.5f + 4.5f * Mathf.Sin(u * Mathf.PI);
                for (var x = 0; x < w; x++)
                {
                    var d = Mathf.Abs(x - centerX);
                    if (d > half) continue;
                    t.SetPixel(x, y, d > half - 1.2f ? BananaDark : Banana);
                }
            }
            // stem
            var stemX = Mathf.RoundToInt(11f + 5f * Mathf.Sin(0.97f * Mathf.PI) - 3f);
            Rect(t, stemX - 1, h - 4, 3, 4, Stem);
            // face
            var faceX = Mathf.RoundToInt(11f + 5f * Mathf.Sin(0.65f * Mathf.PI) - 3f);
            Rect(t, faceX - 3, 27, 2, 2, Outline);
            Rect(t, faceX + 2, 27, 2, 2, Outline);
            Rect(t, faceX - 2, 22, 5, 1, Outline);
            return t;
        }

        static Texture2D Helmet()
        {
            var t = NewTexture(18, 10);
            // Dome from row 2 (widest) up to row 9 (narrowest), with a darker brim on rows 0-1.
            for (var y = 2; y < 10; y++)
            {
                var k = (y - 2f) / 8f;
                var half = Mathf.Sqrt(Mathf.Max(0f, 1f - k * k)) * 8f + 1f;
                for (var x = 0; x < 18; x++)
                {
                    if (Mathf.Abs(x - 8.5f) <= half) t.SetPixel(x, y, Gear);
                }
            }
            Rect(t, 0, 0, 18, 2, GearDark);
            return t;
        }

        static Texture2D Crown()
        {
            var t = NewTexture(16, 9);
            Rect(t, 0, 0, 16, 4, Gold);
            Rect(t, 0, 0, 16, 1, GoldDark);
            Rect(t, 1, 4, 3, 4, Gold);
            Rect(t, 6, 4, 4, 5, Gold);
            Rect(t, 12, 4, 3, 4, Gold);
            return t;
        }

        static Texture2D BeltTexture(Color fill, Color dark)
        {
            var t = NewTexture(18, 4);
            Rect(t, 0, 0, 18, 4, fill);
            Rect(t, 0, 0, 18, 1, dark);
            Rect(t, 7, 0, 4, 4, dark);
            return t;
        }

        static Texture2D Backpack()
        {
            var t = NewTexture(10, 14);
            OutlinedRect(t, 0, 0, 10, 14, Gear, Outline);
            Rect(t, 2, 2, 6, 4, GearDark);
            return t;
        }

        static Sprite SaveSprite(string name, Texture2D texture)
        {
            var assetPath = SpriteDir + "/" + name + ".png";
            var diskPath = Path.Combine(Directory.GetCurrentDirectory(), assetPath.Replace('/', Path.DirectorySeparatorChar));
            texture.Apply();
            File.WriteAllBytes(diskPath, texture.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(texture);

            AssetDatabase.ImportAsset(assetPath, ImportAssetOptions.ForceSynchronousImport);
            var importer = (TextureImporter)AssetImporter.GetAtPath(assetPath);
            importer.textureType = TextureImporterType.Sprite;
            importer.spriteImportMode = SpriteImportMode.Single;
            importer.spritePixelsPerUnit = PixelsPerUnit;
            importer.filterMode = FilterMode.Point;
            importer.textureCompression = TextureImporterCompression.Uncompressed;
            importer.mipmapEnabled = false;
            importer.alphaIsTransparency = true;
            var settings = new TextureImporterSettings();
            importer.ReadTextureSettings(settings);
            settings.spriteAlignment = (int)SpriteAlignment.Center;
            settings.spriteMeshType = SpriteMeshType.FullRect;
            importer.SetTextureSettings(settings);
            importer.SaveAndReimport();
            return AssetDatabase.LoadAssetAtPath<Sprite>(assetPath);
        }
    }
}
