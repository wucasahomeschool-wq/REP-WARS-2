using System;
using System.Collections.Generic;
using System.IO;
using Unity.Collections;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.U2D;
using UnityEngine.U2D.Animation;

namespace RepWars.CharacterProduction.EditorTools
{
    public static class KnightAFrontSkinBuilder
    {
        public const string GeneratedDirectory = MasterHumanoidRigBuilder.Root + "/Skins/KnightA/Front/Generated";
        public const string ProofPrefabPath = MasterHumanoidRigBuilder.Root + "/Proof/KnightA_Front_SkinProof.prefab";

        [MenuItem("RepWars/Character Production/Create Knight A Front Skin Proof")]
        public static void CreateMenu()
        {
            try { Debug.Log("[CharacterProduction] " + CreateProof()); }
            catch (Exception exception) { Debug.LogException(exception); }
        }

        [MenuItem("RepWars/Character Production/Validate Selected Knight A Front Skin")]
        public static void ValidateMenu()
        {
            var selected = Selection.activeObject as GameObject;
            var skin = selected != null ? selected.GetComponent<KnightAFrontSkin>() : null;
            var errors = KnightAFrontSkinValidator.Validate(skin, KnightAFrontConfiguration.Load());
            if (errors.Count == 0) Debug.Log("[CharacterProduction] Knight A Front structural checks passed. Rendering and visual quality still require review.");
            else Debug.LogError("[CharacterProduction] " + string.Join("\n", errors.ToArray()));
        }

        public static string CreateProof()
        {
            var config = KnightAFrontConfiguration.Load();
            config.VerifySource();
            var existing = AssetDatabase.LoadAssetAtPath<GameObject>(ProofPrefabPath);
            if (existing != null)
            {
                var errors = KnightAFrontSkinValidator.Validate(existing.GetComponent<KnightAFrontSkin>(), config);
                if (errors.Count != 0) throw new InvalidOperationException("Existing proof was not overwritten. Resolve these errors or explicitly remove/archive the generated proof:\n" + string.Join("\n", errors.ToArray()));
                return "Existing Knight A Front proof validates and was left unchanged.";
            }
            var generatedFullPath = KnightAFrontConfiguration.AssetFullPath(GeneratedDirectory);
            if (File.Exists(KnightAFrontConfiguration.AssetFullPath(ProofPrefabPath)) || (Directory.Exists(generatedFullPath) && Directory.GetFileSystemEntries(generatedFullPath).Length != 0))
                throw new InvalidOperationException("Existing derived outputs were not overwritten. Explicitly archive/remove them before recreating this proof.");

            var createdPaths = new List<string>();
            MasterHumanoidRig rig = null;
            var source = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            try
            {
                if (!source.LoadImage(File.ReadAllBytes(config.SourceFullPath), false) || source.width != config.sourceWidth || source.height != config.sourceHeight)
                    throw new InvalidOperationException("Unity could not decode the source PNG at the expected dimensions.");
                EnsureFolders();
                rig = MasterHumanoidRigBuilder.CreateRigObject("KnightA_Front_SkinProof");
                rig.VisualRoot.gameObject.AddComponent<SortingGroup>();
                CalibrateFront(rig, config);
                var mount = rig.GetViewRoot(MasterHumanoidView.Front).Find("SkinMount");
                var sourcePixels = source.GetPixels32();
                var transforms = new Transform[MasterHumanoidRigContract.Bones.Count];
                for (var i = 0; i < transforms.Length; i++) transforms[i] = rig.FindBone(MasterHumanoidView.Front, MasterHumanoidRigContract.Bones[i].name);
                var bindings = new List<KnightAFrontSectionBinding>();

                foreach (var section in config.sections)
                {
                    var extraction = KnightAFrontSkinGeometry.Extract(config, section, sourcePixels);
                    var texture = SaveDerivedTexture(section.id, extraction, createdPaths);
                    var sectionObject = new GameObject(section.id);
                    sectionObject.transform.SetParent(mount, false);
                    var bounds = extraction.sourceBounds;
                    sectionObject.transform.localPosition = config.ToRigPoint(bounds.x + bounds.width * 0.5f + section.offsetX,
                        bounds.y + bounds.height * 0.5f + section.offsetY);
                    var sprite = CreateSkinnedSprite(config, section, bounds, texture, sectionObject.transform, transforms);
                    var spritePath = GeneratedDirectory + "/KnightA_Front_" + section.id + ".sprite.asset";
                    createdPaths.Add(spritePath);
                    AssetDatabase.CreateAsset(sprite, spritePath);
                    AssetDatabase.SaveAssetIfDirty(sprite);
                    Resources.UnloadAsset(sprite);
                    sprite = AssetDatabase.LoadAssetAtPath<Sprite>(spritePath);
                    if (sprite == null) throw new InvalidOperationException("Native Sprite asset did not reload: " + section.id);
                    var renderer = sectionObject.AddComponent<SpriteRenderer>();
                    renderer.sprite = sprite;
                    renderer.sortingOrder = section.sortingOrder;
                    renderer.drawMode = SpriteDrawMode.Simple;
                    var spriteSkin = sectionObject.AddComponent<SpriteSkin>();
                    spriteSkin.autoRebind = false;
                    spriteSkin.boundsMode = BoundsMode.VertexBased;
                    spriteSkin.SetRootBone(transforms[0]);
                    var state = spriteSkin.SetBoneTransforms(transforms);
                    if (state != SpriteSkinState.Ready) throw new InvalidOperationException(section.id + " SpriteSkin configuration is not Ready: " + state);
                    bindings.Add(new KnightAFrontSectionBinding { sectionId = section.id, renderer = renderer, spriteSkin = spriteSkin });
                }
                var proof = rig.gameObject.AddComponent<KnightAFrontSkin>();
                proof.Configure(rig, config.sourceSha256, KnightAFrontConfiguration.ConfigurationHash, bindings.ToArray());
                config.VerifySource();
                var validation = KnightAFrontSkinValidator.Validate(proof, config);
                if (validation.Count != 0) throw new InvalidOperationException(string.Join("\n", validation.ToArray()));
                createdPaths.Add(ProofPrefabPath);
                if (PrefabUtility.SaveAsPrefabAsset(rig.gameObject, ProofPrefabPath) == null) throw new InvalidOperationException("Unity could not save the Knight A Front proof prefab.");
                var reloaded = PrefabUtility.LoadPrefabContents(ProofPrefabPath);
                try { validation = KnightAFrontSkinValidator.Validate(reloaded.GetComponent<KnightAFrontSkin>(), config); }
                finally { PrefabUtility.UnloadPrefabContents(reloaded); }
                if (validation.Count != 0) throw new InvalidOperationException("Reloaded prefab failed reference/mesh validation:\n" + string.Join("\n", validation.ToArray()));
                var saved = AssetDatabase.LoadAssetAtPath<GameObject>(ProofPrefabPath);
                Selection.activeObject = saved;
                return "Created " + ProofPrefabPath + " with eleven original-art sections. No Side/Back art or animation. Visual review is still required.";
            }
            catch
            {
                // Every listed output was absent during preflight. Never delete a pre-existing user's asset.
                for (var i = createdPaths.Count - 1; i >= 0; i--) AssetDatabase.DeleteAsset(createdPaths[i]);
                throw;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(source);
                if (rig != null) UnityEngine.Object.DestroyImmediate(rig.gameObject);
            }
        }

        static void CalibrateFront(MasterHumanoidRig rig, KnightAFrontConfiguration config)
        {
            var points = new Dictionary<string, KnightAFrontBoneCalibration>();
            foreach (var point in config.bones) points.Add(point.name, point);
            foreach (var definition in MasterHumanoidRigContract.Bones)
            {
                var point = points[definition.name];
                rig.FindBone(MasterHumanoidView.Front, definition.name).position = rig.VisualRoot.TransformPoint(config.ToRigPoint(point.x, point.y));
            }
        }

        static Texture2D SaveDerivedTexture(string sectionId, KnightAFrontSectionPixels extraction, List<string> createdPaths)
        {
            var path = GeneratedDirectory + "/KnightA_Front_" + sectionId + ".png";
            var bounds = extraction.sourceBounds;
            var temporary = new Texture2D(bounds.width, bounds.height, TextureFormat.RGBA32, false);
            try
            {
                temporary.SetPixels32(extraction.pixels);
                temporary.Apply(false, false);
                createdPaths.Add(path);
                File.WriteAllBytes(KnightAFrontConfiguration.AssetFullPath(path), temporary.EncodeToPNG());
            }
            finally { UnityEngine.Object.DestroyImmediate(temporary); }
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
            var importer = AssetImporter.GetAtPath(path) as TextureImporter;
            if (importer == null) throw new InvalidOperationException("Derived section texture importer is missing: " + path);
            importer.textureType = TextureImporterType.Default;
            importer.textureCompression = TextureImporterCompression.Uncompressed;
            importer.npotScale = TextureImporterNPOTScale.None;
            importer.maxTextureSize = 2048;
            importer.mipmapEnabled = false;
            importer.isReadable = true;
            importer.alphaSource = TextureImporterAlphaSource.FromInput;
            importer.alphaIsTransparency = false; // Do not rewrite edge RGB; keep the extracted source RGBA.
            importer.sRGBTexture = true;
            importer.filterMode = FilterMode.Bilinear;
            importer.wrapMode = TextureWrapMode.Clamp;
            importer.SaveAndReimport();
            var result = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            if (result == null || result.width != bounds.width || result.height != bounds.height)
                throw new InvalidOperationException("Derived texture was resized or failed import: " + sectionId);
            return result;
        }

        static Sprite CreateSkinnedSprite(KnightAFrontConfiguration config, KnightAFrontSectionDefinition section,
            RectInt bounds, Texture2D texture, Transform rendererTransform, Transform[] transforms)
        {
            var sprite = Sprite.Create(texture, new Rect(0, 0, texture.width, texture.height), new Vector2(0.5f, 0.5f), config.pixelsPerUnit, 0, SpriteMeshType.FullRect);
            sprite.name = "KnightA_Front_" + section.id;
            Vector2[] vertices; ushort[] triangles; BoneWeight[] weights;
            KnightAFrontSkinGeometry.BuildGrid(config, section, bounds, out vertices, out triangles, out weights);
            sprite.OverrideGeometry(vertices, triangles);
            var bones = new SpriteBone[transforms.Length];
            var bindPoses = new Matrix4x4[transforms.Length];
            for (var i = 0; i < transforms.Length; i++)
            {
                var definition = MasterHumanoidRigContract.Bones[i];
                var parent = -1;
                for (var j = 0; j < i; j++) if (MasterHumanoidRigContract.Bones[j].name == definition.parentName) parent = j;
                var length = 0.05f;
                for (var j = i + 1; j < transforms.Length; j++)
                    if (MasterHumanoidRigContract.Bones[j].parentName == definition.name)
                    { length = Vector3.Distance(transforms[i].position, transforms[j].position); break; }
                bones[i] = new SpriteBone { name = definition.name, parentId = parent,
                    position = parent < 0 ? rendererTransform.InverseTransformPoint(transforms[i].position) : transforms[i].localPosition,
                    rotation = parent < 0 ? Quaternion.Inverse(rendererTransform.rotation) * transforms[i].rotation : transforms[i].localRotation,
                    length = length };
                bindPoses[i] = transforms[i].worldToLocalMatrix * rendererTransform.localToWorldMatrix;
            }
            sprite.SetBones(bones);
            using (var nativeBindPoses = new NativeArray<Matrix4x4>(bindPoses, Allocator.Temp)) sprite.SetBindPoses(nativeBindPoses);
            using (var nativeWeights = new NativeArray<BoneWeight>(weights, Allocator.Temp)) sprite.SetVertexAttribute<BoneWeight>(VertexAttribute.BlendWeight, nativeWeights);
            return sprite;
        }

        static void EnsureFolders()
        {
            foreach (var folder in new[] { MasterHumanoidRigBuilder.Root + "/Proof", MasterHumanoidRigBuilder.Root + "/Skins",
                MasterHumanoidRigBuilder.Root + "/Skins/KnightA", MasterHumanoidRigBuilder.Root + "/Skins/KnightA/Front", GeneratedDirectory })
                MasterHumanoidRigBuilder.EnsureFolder(folder);
        }
    }
}
