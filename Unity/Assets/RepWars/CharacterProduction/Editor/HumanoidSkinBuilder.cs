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
    /// <summary>One native SpriteSkin construction path for all configured humanoid skin families.</summary>
    public static class HumanoidSkinBuilder
    {
        public static string GeneratedDirectoryFor(HumanoidSkinConfiguration config)
        { return MasterHumanoidRigBuilder.Root + "/Skins/" + config.CharacterId + "/" + config.view + "/Generated"; }
        public static string ProofPrefabPathFor(HumanoidSkinConfiguration config)
        { return MasterHumanoidRigBuilder.Root + "/Proof/" + config.CharacterId + "_" + config.view + "_SkinProof.prefab"; }
        public static IHumanoidSkin FindMetadata(GameObject root)
        {
            if (root != null) foreach (var component in root.GetComponents<MonoBehaviour>())
                if (component is IHumanoidSkin) return (IHumanoidSkin)component;
            return null;
        }

        public static string CreateProof(HumanoidSkinConfiguration config, Func<GameObject, IHumanoidSkin> addMetadata)
        {
            if (config == null || addMetadata == null) throw new ArgumentNullException("config/addMetadata");
            var errorsBeforeGeneration = config.Validate();
            if (errorsBeforeGeneration.Count > 0) throw new InvalidOperationException(string.Join("\n", errorsBeforeGeneration.ToArray()));
            var view = config.view;
            var GeneratedDirectory = GeneratedDirectoryFor(config);
            var ProofPrefabPath = ProofPrefabPathFor(config);
            config.VerifySource();
            var existing = AssetDatabase.LoadAssetAtPath<GameObject>(ProofPrefabPath);
            if (existing != null)
            {
                var errors = HumanoidSkinValidator.Validate(FindMetadata(existing), config);
                if (errors.Count != 0) throw new InvalidOperationException("Existing proof was not overwritten. Resolve these errors or explicitly remove/archive the generated proof:\n" + string.Join("\n", errors.ToArray()));
                return "Existing " + config.CharacterId + " " + view +" proof validates and was left unchanged.";
            }
            var generatedFullPath = HumanoidSkinConfiguration.AssetFullPath(GeneratedDirectory);
            if (File.Exists(HumanoidSkinConfiguration.AssetFullPath(ProofPrefabPath)) || (Directory.Exists(generatedFullPath) && Directory.GetFileSystemEntries(generatedFullPath).Length != 0))
                throw new InvalidOperationException("Existing derived outputs were not overwritten. Explicitly archive/remove them before recreating this proof.");

            var createdPaths = new List<string>();
            MasterHumanoidRig rig = null;
            var source = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            try
            {
                if (!source.LoadImage(File.ReadAllBytes(config.SourceFullPath), false) || source.width != config.sourceWidth || source.height != config.sourceHeight)
                    throw new InvalidOperationException("Unity could not decode the source PNG at the expected dimensions.");
                EnsureFolders(config);
                rig = MasterHumanoidRigBuilder.CreateRigObject(config.CharacterId + "_" + view + "_SkinProof");
                rig.VisualRoot.gameObject.AddComponent<SortingGroup>();
                CalibrateView(rig, config);
                foreach (MasterHumanoidView authored in Enum.GetValues(typeof(MasterHumanoidView)))
                    rig.GetViewRoot(authored).gameObject.SetActive(authored == view);
                var mount = rig.GetViewRoot(view).Find("SkinMount");
                var sourcePixels = source.GetPixels32();
                var ownership = HumanoidSkinGeometry.BuildOwnership(config, sourcePixels);
                var transforms = new Transform[MasterHumanoidRigContract.Bones.Count];
                for (var i = 0; i < transforms.Length; i++) transforms[i] = rig.FindBone(view, MasterHumanoidRigContract.Bones[i].name);
                var bindings = new List<KnightASkinSectionBinding>();

                foreach (var section in config.sections)
                {
                    var extraction = HumanoidSkinGeometry.Extract(config, section, sourcePixels, ownership);
                    var texture = SaveDerivedTexture(config, section.id, extraction, createdPaths);
                    var sectionObject = new GameObject(section.id);
                    sectionObject.transform.SetParent(mount, false);
                    var bounds = extraction.sourceBounds;
                    sectionObject.transform.localPosition = config.ToRigPoint(bounds.x + bounds.width * 0.5f + section.offsetX,
                        bounds.y + bounds.height * 0.5f + section.offsetY);
                    var sprite = CreateSkinnedSprite(config, section, bounds, texture, sectionObject.transform, transforms);
                    var spritePath = GeneratedDirectory + "/" + config.CharacterId + "_" + view + "_" + section.id + ".sprite.asset";
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
                    bindings.Add(new KnightASkinSectionBinding { sectionId = section.id, renderer = renderer, spriteSkin = spriteSkin });
                }
                var proof = addMetadata(rig.gameObject);
                if (proof == null || proof.CharacterId != config.CharacterId) throw new InvalidOperationException("Metadata factory returned the wrong character family.");
                proof.Configure(view, rig, config.sourceSha256, config.ConfigurationHash, bindings.ToArray());
                config.VerifySource();
                var validation = HumanoidSkinValidator.Validate(proof, config);
                if (validation.Count != 0) throw new InvalidOperationException(string.Join("\n", validation.ToArray()));
                createdPaths.Add(ProofPrefabPath);
                if (PrefabUtility.SaveAsPrefabAsset(rig.gameObject, ProofPrefabPath) == null) throw new InvalidOperationException("Unity could not save the " + config.CharacterId + " " + view +" proof prefab.");
                var reloaded = PrefabUtility.LoadPrefabContents(ProofPrefabPath);
                try { validation = HumanoidSkinValidator.Validate(FindMetadata(reloaded), config); }
                finally { PrefabUtility.UnloadPrefabContents(reloaded); }
                if (validation.Count != 0) throw new InvalidOperationException("Reloaded prefab failed reference/mesh validation:\n" + string.Join("\n", validation.ToArray()));
                var saved = AssetDatabase.LoadAssetAtPath<GameObject>(ProofPrefabPath);
                Selection.activeObject = saved;
                return "Created " + ProofPrefabPath + " with eleven original-art sections. Other views remain empty in this proof; no animation. Visual review is still required.";
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

        static void CalibrateView(MasterHumanoidRig rig, HumanoidSkinConfiguration config)
        {
            var points = new Dictionary<string, KnightASkinBoneCalibration>();
            foreach (var point in config.bones) points.Add(point.name, point);
            foreach (var definition in MasterHumanoidRigContract.Bones)
            {
                var point = points[definition.name];
                rig.FindBone(config.view, definition.name).position = rig.VisualRoot.TransformPoint(config.ToRigPoint(point.x, point.y));
            }
        }

        static Texture2D SaveDerivedTexture(HumanoidSkinConfiguration config, string sectionId, KnightASkinSectionPixels extraction, List<string> createdPaths)
        {
            var path = GeneratedDirectoryFor(config) + "/" + config.CharacterId + "_" + config.view + "_" + sectionId + ".png";
            var bounds = extraction.sourceBounds;
            var temporary = new Texture2D(bounds.width, bounds.height, TextureFormat.RGBA32, false);
            try
            {
                temporary.SetPixels32(extraction.pixels);
                temporary.Apply(false, false);
                createdPaths.Add(path);
                File.WriteAllBytes(HumanoidSkinConfiguration.AssetFullPath(path), temporary.EncodeToPNG());
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

        static Sprite CreateSkinnedSprite(HumanoidSkinConfiguration config, KnightASkinSectionDefinition section,
            RectInt bounds, Texture2D texture, Transform rendererTransform, Transform[] transforms)
        {
            Vector2[] vertices; ushort[] triangles; BoneWeight[] weights;
            HumanoidSkinGeometry.BuildGrid(config, section, bounds, out vertices, out triangles, out weights);
            // Unity 6000 rejects a vertex that lands exactly on the sprite's max edge. The inset stays inside mesh validation tolerance.
            var contained = new Vector2[vertices.Length];
            var maxX = bounds.width * 0.5f / config.pixelsPerUnit - 0.000004f;
            var maxY = bounds.height * 0.5f / config.pixelsPerUnit - 0.000004f;
            for (var i = 0; i < vertices.Length; i++)
            {
                var vertex = vertices[i];
                if (vertex.x > maxX) vertex.x = maxX;
                if (vertex.y > maxY) vertex.y = maxY;
                contained[i] = vertex;
            }
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
            // Unity 6000 rejects Sprite.OverrideGeometry in the editor. Vertex data access authors the same grid.
            var sprite = Sprite.Create(texture, new Rect(0, 0, texture.width, texture.height), new Vector2(0.5f, 0.5f), config.pixelsPerUnit, 0, SpriteMeshType.FullRect);
            sprite.name = config.CharacterId + "_" + config.view + "_" + section.id;
            sprite.SetVertexCount(contained.Length);
            using (var indices = new NativeArray<ushort>(triangles, Allocator.Temp)) sprite.SetIndices(indices);
            var positions = new NativeArray<Vector3>(contained.Length, Allocator.Temp);
            var uvs = new NativeArray<Vector2>(contained.Length, Allocator.Temp);
            try
            {
                for (var n = 0; n < contained.Length; n++)
                {
                    positions[n] = contained[n];
                    uvs[n] = new Vector2(contained[n].x * config.pixelsPerUnit / bounds.width + 0.5f, contained[n].y * config.pixelsPerUnit / bounds.height + 0.5f);
                }
                sprite.SetVertexAttribute(VertexAttribute.Position, positions);
                sprite.SetVertexAttribute(VertexAttribute.TexCoord0, uvs);
            }
            finally
            {
                positions.Dispose();
                uvs.Dispose();
            }
            sprite.SetBones(bones);
            using (var nativeBindPoses = new NativeArray<Matrix4x4>(bindPoses, Allocator.Temp)) sprite.SetBindPoses(nativeBindPoses);
            using (var nativeWeights = new NativeArray<BoneWeight>(weights, Allocator.Temp)) sprite.SetVertexAttribute<BoneWeight>(VertexAttribute.BlendWeight, nativeWeights);
            if (sprite.vertices.Length != vertices.Length) throw new InvalidOperationException(section.id + " sprite mesh was not authored. vertices=" + sprite.vertices.Length);
            return sprite;
        }

        static void EnsureFolders(HumanoidSkinConfiguration config)
        {
            foreach (var folder in new[] { MasterHumanoidRigBuilder.Root + "/Proof", MasterHumanoidRigBuilder.Root + "/Skins",
                MasterHumanoidRigBuilder.Root + "/Skins/" + config.CharacterId, MasterHumanoidRigBuilder.Root + "/Skins/" + config.CharacterId + "/" + config.view, GeneratedDirectoryFor(config) })
                MasterHumanoidRigBuilder.EnsureFolder(folder);
        }
    }
}
