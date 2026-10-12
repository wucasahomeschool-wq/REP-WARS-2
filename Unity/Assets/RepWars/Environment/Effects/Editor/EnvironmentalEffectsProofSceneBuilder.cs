using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RepWars.Environment.Effects.EditorTools
{
    /// <summary>
    /// Builds the isolated Environmental Effects Phase 1 proof scene. Never touches production map scenes.
    ///
    /// Art is loaded from ProofArt/Fog, /Smoke, /Fire, and /Embers. Those are copies of the
    /// repo-root library plus one primitive ember dot. Missing folders still fall back to
    /// built-in UI sprites labelled TEMP PROOF SPRITE.
    /// </summary>
    public static class EnvironmentalEffectsProofSceneBuilder
    {
        const string Root = "Assets/RepWars/Environment/Effects";
        public const string ScenePath = Root + "/Scenes/EnvironmentalEffectsProof.unity";
        const string ProofArt = Root + "/ProofArt";

        [MenuItem("RepWars/Environment/Effects/Build Phase 1 Proof Scene")]
        public static void Build() { BuildInternal(true); }

        /// <summary>promptToSaveOpenScene is false only for an already-clean editor session so the proof build cannot discard unrelated scene edits.</summary>
        public static void BuildInternal(bool promptToSaveOpenScene)
        {
            if (promptToSaveOpenScene && !EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            bool temp;
            var fog = LoadSprites(ProofArt + "/Fog", out temp); bool anyTemp = temp;
            var smoke = LoadSprites(ProofArt + "/Smoke", out temp); anyTemp |= temp;
            var fire = LoadSprites(ProofArt + "/Fire", out temp, true); anyTemp |= temp;
            var embers = LoadSprites(ProofArt + "/Embers", out temp); anyTemp |= temp;

            var cam = new GameObject("Main Camera").AddComponent<Camera>();
            cam.tag = "MainCamera";
            cam.orthographic = true;
            cam.orthographicSize = 16f;
            cam.transform.position = new Vector3(2f, -4f, -10f);
            cam.backgroundColor = new Color(0.32f, 0.40f, 0.30f);
            cam.clearFlags = CameraClearFlags.SolidColor;

            // Required fog pair uses the same thin-sprite library. Medium stays as an extra density.
            Fog("01 Light layered fog (same thin sprites)", new Vector3(-16f, 8f), fog, 3, new FloatRange(0.10f, 0.18f), 0);
            Fog("02 Denser layered fog (same thin sprites)", new Vector3(0f, 8f), fog, 14, new FloatRange(0.22f, 0.42f), 1);
            Fog("03 Medium layered fog extra (same thin sprites)", new Vector3(16f, 8f), fog, 7, new FloatRange(0.15f, 0.28f), 2);

            var broad = Make<SmokeController>("04 Broad drifting smoke", new Vector3(-16f, 2f));
            Set(broad, "smokeSprites", smoke);
            var plume = Make<SmokePlumeController>("05 Anchored smoke plume + detached puffs", new Vector3(-4f, 1f));
            Set(plume, "smokeSprites", smoke);
            var localPlume = Make<SmokePlumeController>("15 Local-space plume (follows parent)", new Vector3(10f, 2.2f));
            Set(localPlume, "smokeSprites", smoke);
            SetInt(localPlume, "common.simulationSpace", (int)EffectSimulationSpace.Local);
            var worldPlume = Make<SmokePlumeController>("16 World-space plume (stays when parent moves)", new Vector3(22f, 2.2f));
            Set(worldPlume, "smokeSprites", smoke);
            SetInt(worldPlume, "common.simulationSpace", (int)EffectSimulationSpace.World);

            var fireOnly = Make<FireFrameController>("06 Authored-frame fire (no immediate repeat)", new Vector3(-18f, -4f));
            Set(fireOnly, "frames", fire);
            FireCombo("07 Fire + smoke", new Vector3(-8f, -4.5f), fire, smoke, embers, true, false, false, 1f);
            FireCombo("08 Fire + embers", new Vector3(2f, -4.5f), fire, smoke, embers, false, true, false, 1f);
            FireCombo("09 Fire + sparks", new Vector3(12f, -4.5f), fire, smoke, embers, false, false, true, 1f);

            // Same controllers, different serialized configuration.
            FireCombo("10 Small clean campfire", new Vector3(-8f, -11f), fire, smoke, embers, true, false, false, 0.75f);
            TunePlume(GameObject.Find("10 Small clean campfire/Smoke"), 0.7f, 8, new FloatRange(0.12f, 0.22f), 0.15f, new Color(0.72f, 0.72f, 0.74f, 1f));
            FireCombo("11 Larger smoky fire", new Vector3(8f, -11f), fire, smoke, embers, true, false, false, 1.3f);
            TunePlume(GameObject.Find("11 Larger smoky fire/Smoke"), 3.2f, 24, new FloatRange(0.35f, 0.55f), 0.9f, new Color(0.42f, 0.42f, 0.44f, 1f));

            FireCombo("12 Full campfire extra (fire + smoke + embers + sparks)", new Vector3(-16f, -16f), fire, smoke, embers, true, true, true, 1f);
            var sparks = Make<EmberSparkController>("13 Sparks only extra", new Vector3(-2f, -16f));
            Set(sparks, "sparkSprites", embers);
            Set(sparks, "emberSprites", embers);
            TuneEmbers(sparks, false, true, 2f);
            var reuse = new GameObject("14 Reuse extra - same config x4");
            reuse.transform.position = new Vector3(14f, -16f);
            for (int i = 0; i < 4; i++)
            {
                var p = new GameObject("Prop" + i);
                p.transform.SetParent(reuse.transform, false);
                p.transform.localPosition = new Vector3(-3f + i * 2f, 0f);
                var f = p.AddComponent<FireFrameController>(); Set(f, "frames", fire); Seed(f, 100 + i);
                var s = p.AddComponent<SmokePlumeController>(); Set(s, "smokeSprites", smoke); Seed(s, 200 + i);
                SetVec(s, "anchorOffset", new Vector2(0f, 1f));
            }

            var note = new GameObject(anyTemp
                ? "NOTE - TEMP PROOF SPRITES IN USE (ART ASSET REQUIRED: import /assets/Animated Pieces into ProofArt)"
                : "NOTE - Using imported ProofArt sprites. Ember dot is a proof primitive; bespoke ember art is future polish.");
            note.transform.position = new Vector3(0f, 13f);

            Directory.CreateDirectory(Path.GetDirectoryName(ScenePath));
            EditorSceneManager.SaveScene(scene, ScenePath);
            Debug.Log("[EnvironmentalEffects] Proof scene written to " + ScenePath + (anyTemp ? " (TEMP PROOF SPRITES - ART ASSET REQUIRED)" : ""));
        }

        static void Fog(string name, Vector3 pos, Sprite[] sprites, int layers, FloatRange opacity, int sortOffset)
        {
            var fog = Make<FogController>(name, pos);
            Set(fog, "fogSprites", sprites);
            var so = new SerializedObject(fog);
            so.FindProperty("settings.layerCount").intValue = layers;
            so.FindProperty("settings.opacity.min").floatValue = opacity.min;
            so.FindProperty("settings.opacity.max").floatValue = opacity.max;
            so.FindProperty("settings.areaWidth").floatValue = 10f;
            so.FindProperty("settings.areaHeight").floatValue = 3f;
            so.FindProperty("common.sortingOrder").intValue = 100 + sortOffset * 20;
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        static T Make<T>(string name, Vector3 pos) where T : Component
        {
            var go = new GameObject(name);
            go.transform.position = pos;
            return go.AddComponent<T>();
        }

        static T Child<T>(GameObject parent, string name) where T : Component
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent.transform, false);
            return go.AddComponent<T>();
        }

        static void Set(Object target, string prop, Sprite[] sprites)
        {
            var so = new SerializedObject(target);
            var p = so.FindProperty(prop);
            p.arraySize = sprites.Length;
            for (int i = 0; i < sprites.Length; i++) p.GetArrayElementAtIndex(i).objectReferenceValue = sprites[i];
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        static void SetVec(Object target, string prop, Vector2 v)
        {
            var so = new SerializedObject(target);
            so.FindProperty(prop).vector2Value = v;
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        static void Seed(Object target, int seed)
        {
            var so = new SerializedObject(target);
            so.FindProperty("common.useSeed").boolValue = true;
            so.FindProperty("common.seed").intValue = seed;
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        static void SetInt(Object target, string prop, int value)
        {
            var so = new SerializedObject(target);
            var property = so.FindProperty(prop);
            if (property.propertyType == SerializedPropertyType.Enum) property.enumValueIndex = value;
            else property.intValue = value;
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        static void FireCombo(string name, Vector3 pos, Sprite[] fire, Sprite[] smoke, Sprite[] embers, bool withSmoke, bool withEmbers, bool withSparks, float scale)
        {
            var root = new GameObject(name);
            root.transform.position = pos;
            root.transform.localScale = new Vector3(scale, scale, 1f);
            Set(Child<FireFrameController>(root, "Fire"), "frames", fire);
            if (withSmoke)
            {
                var plume = Child<SmokePlumeController>(root, "Smoke");
                Set(plume, "smokeSprites", smoke);
                SetVec(plume, "anchorOffset", new Vector2(0f, 1.15f));
            }
            if (withEmbers || withSparks)
            {
                var es = Child<EmberSparkController>(root, "EmbersSparks");
                Set(es, "emberSprites", embers);
                Set(es, "sparkSprites", embers);
                TuneEmbers(es, withEmbers, withSparks, withSparks && !withEmbers ? 1.4f : 0.55f);
            }
        }

        static void TunePlume(GameObject smokeObject, float rate, int maxParticles, FloatRange alpha, float puffChance, Color tint)
        {
            var so = new SerializedObject(smokeObject.GetComponent<SmokePlumeController>());
            so.FindProperty("settings.body.ratePerSecond").floatValue = rate;
            so.FindProperty("settings.body.maxParticles").intValue = maxParticles;
            so.FindProperty("settings.body.startAlpha.min").floatValue = alpha.min;
            so.FindProperty("settings.body.startAlpha.max").floatValue = alpha.max;
            so.FindProperty("settings.puffChancePerSecond").floatValue = puffChance;
            so.FindProperty("tint").colorValue = tint;
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        static void TuneEmbers(EmberSparkController sparks, bool embersOn, bool sparksOn, float sparkRate)
        {
            var so = new SerializedObject(sparks);
            so.FindProperty("settings.embersEnabled").boolValue = embersOn;
            so.FindProperty("settings.sparksEnabled").boolValue = sparksOn;
            so.FindProperty("settings.embers.ratePerSecond").floatValue = 1.1f;
            so.FindProperty("settings.embers.startScale.min").floatValue = 0.22f;
            so.FindProperty("settings.embers.startScale.max").floatValue = 0.38f;
            so.FindProperty("settings.sparks.ratePerSecond").floatValue = sparkRate;
            so.FindProperty("settings.sparks.startScale.min").floatValue = 0.12f;
            so.FindProperty("settings.sparks.startScale.max").floatValue = 0.22f;
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        static Sprite[] LoadSprites(string folder, out bool usedTemp, bool wantSeveral = false)
        {
            var list = new List<Sprite>();
            if (AssetDatabase.IsValidFolder(folder))
            {
                foreach (var guid in AssetDatabase.FindAssets("t:Sprite", new[] { folder }))
                {
                    var s = AssetDatabase.LoadAssetAtPath<Sprite>(AssetDatabase.GUIDToAssetPath(guid));
                    if (s != null) list.Add(s);
                }
            }
            usedTemp = list.Count == 0;
            if (usedTemp)
            {
                // TEMP PROOF SPRITE: Unity built-in UI sprites. Placeholders only; replace with authored art.
                var knob = AssetDatabase.GetBuiltinExtraResource<Sprite>("UI/Skin/Knob.psd");
                if (knob != null) list.Add(knob);
                if (wantSeveral)
                {
                    var a = AssetDatabase.GetBuiltinExtraResource<Sprite>("UI/Skin/UISprite.psd");
                    var b = AssetDatabase.GetBuiltinExtraResource<Sprite>("UI/Skin/Background.psd");
                    if (a != null) list.Add(a);
                    if (b != null) list.Add(b);
                }
                Debug.LogWarning("[EnvironmentalEffects] ART ASSET REQUIRED: no sprites in " + folder + "; using TEMP PROOF SPRITE.");
            }
            return list.ToArray();
        }
    }
}
