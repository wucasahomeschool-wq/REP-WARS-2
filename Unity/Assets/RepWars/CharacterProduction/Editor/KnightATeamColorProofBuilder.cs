using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace RepWars.CharacterProduction.EditorTools
{
    public static class KnightATeamColorProofBuilder
    {
        public const string GeneratedDirectory = MasterHumanoidRigBuilder.Root + "/TeamColor/Generated";
        public const string MaterialPath = GeneratedDirectory + "/IllustratedTeamColor.mat";
        public const string ShaderPath = MasterHumanoidRigBuilder.Root + "/Rendering/SelectiveTeamColorUnlit.shader";
        public const string ProofPath = MasterHumanoidRigBuilder.Root + "/Proof/KnightA_TeamColorProof.prefab";
        public static string MaskPath(MasterHumanoidView view, string sectionId)
        { return GeneratedDirectory + "/KnightA_" + view + "_" + sectionId + ".mask.png"; }

        [MenuItem("RepWars/Character Production/Create Knight A Team Color Proof")]
        public static void CreateMenu()
        {
            try { Debug.Log("[CharacterProduction] " + CreateProof()); }
            catch (Exception exception) { Debug.LogException(exception); }
        }

        [MenuItem("RepWars/Character Production/Validate Selected Knight A Team Color Proof")]
        public static void ValidateMenu()
        {
            try
            {
                var selected = Selection.activeObject as GameObject;
                var errors = Validate(selected != null ? selected.GetComponent<SelectiveTeamColorPresentation>() : null);
                if (errors.Count != 0) Debug.LogError(string.Join("\n", errors.ToArray()));
                else Debug.Log("Team-color structural/data checks passed. Rendered illustration and mask approval require human review.");
            }
            catch (Exception exception) { Debug.LogException(exception); }
        }

        public static string CreateProof()
        {
            var recipe = KnightATeamColorConfiguration.Load();
            var pipeline = GraphicsSettings.currentRenderPipeline;
            if (pipeline == null || pipeline.GetType().FullName != "UnityEngine.Rendering.Universal.UniversalRenderPipelineAsset")
                throw new InvalidOperationException("This proof requires the project's configured URP 2D rendering path. No settings were changed.");
            var shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            if (shader == null || shader.name != SelectiveTeamColorPresentation.ShaderName || ShaderUtil.ShaderHasError(shader))
                throw new InvalidOperationException("Selective team-color shader is missing or has Unity compiler errors; no tint fallback is allowed.");
            var existing = AssetDatabase.LoadAssetAtPath<GameObject>(ProofPath);
            if (existing != null)
            {
                var errors = Validate(existing.GetComponent<SelectiveTeamColorPresentation>());
                if (errors.Count != 0) throw new InvalidOperationException("Existing team-color proof was not overwritten:\n" + string.Join("\n", errors.ToArray()));
                return "Existing team-color proof validates and was left unchanged.";
            }
            var fullDirectory = KnightASkinConfiguration.AssetFullPath(GeneratedDirectory);
            if (File.Exists(KnightASkinConfiguration.AssetFullPath(ProofPath)) ||
                (Directory.Exists(fullDirectory) && Directory.GetFileSystemEntries(fullDirectory).Length != 0))
                throw new InvalidOperationException("Partial/stale outputs were not overwritten. Explicitly archive/remove only the team-color generated directory and team-color proof before regeneration.");
            KnightAFacingProofBuilder.CreateProof();
            var created = new List<string>();
            GameObject root = null;
            try
            {
                MasterHumanoidRigBuilder.EnsureFolder(MasterHumanoidRigBuilder.Root + "/TeamColor");
                MasterHumanoidRigBuilder.EnsureFolder(GeneratedDirectory);
                root = PrefabUtility.LoadPrefabContents(KnightAFacingProofBuilder.ProofPrefabPath);
                root.name = "KnightA_TeamColorProof";
                var facing = root.GetComponent<HumanoidFacingPresentation>();
                var errors = KnightAFacingProofBuilder.Validate(facing);
                if (errors.Count != 0) throw new InvalidOperationException(string.Join("\n", errors.ToArray()));
                var material = new Material(shader) { name = "IllustratedTeamColor" };
                material.SetColor("_Color", Color.white);
                material.SetFloat("_TeamColorEnabled", 0f);
                created.Add(MaterialPath);
                AssetDatabase.CreateAsset(material, MaterialPath);
                var bindings = new List<TeamColorSectionBinding>();
                foreach (var view in recipe.views)
                {
                    var skinConfig = KnightASkinConfiguration.Load(view.view);
                    var pixels = Decode(skinConfig);
                    var ownership = KnightASkinGeometry.BuildOwnership(skinConfig, pixels);
                    var skin = facing.Rig.GetViewRoot(view.view).GetComponent<KnightASkin>();
                    foreach (var section in view.sections)
                    {
                        var definition = Array.Find(skinConfig.sections, s => s.id == section.sectionId);
                        var extraction = KnightASkinGeometry.Extract(skinConfig, definition, pixels, ownership);
                        var renderer = Array.Find(skin.Sections, s => s.sectionId == section.sectionId).renderer;
                        Texture2D mask = null;
                        if (section.polygons.Length != 0)
                        {
                            var path = MaskPath(view.view, section.sectionId);
                            created.Add(path);
                            mask = SaveMask(path, section, extraction.sourceBounds, Provenance(recipe, view, section, extraction.sourceBounds));
                        }
                        bindings.Add(new TeamColorSectionBinding { view = view.view, sectionId = section.sectionId,
                            renderer = renderer, sourceSprite = renderer.sprite, mask = mask, sourceBounds = extraction.sourceBounds });
                    }
                }
                var presentation = root.AddComponent<SelectiveTeamColorPresentation>();
                string error;
                if (!presentation.Configure(material, bindings.ToArray(), recipe.ConfigurationHash, out error)) throw new InvalidOperationException(error);
                errors = Validate(presentation);
                if (errors.Count != 0) throw new InvalidOperationException(string.Join("\n", errors.ToArray()));
                // Structural interaction check: a single color state survives all six view/mirror choices.
                presentation.SetTeamColor(new Color(0.15f,0.6f,0.25f)); // Technical sample, not a faction palette.
                foreach (HumanoidFacing direction in Enum.GetValues(typeof(HumanoidFacing)))
                {
                    if (!facing.TrySetFacing(direction) || !presentation.RecolorEnabled || presentation.TeamColor != new Color(0.15f,0.6f,0.25f))
                        throw new InvalidOperationException("Team-color/facing state interaction failed.");
                }
                presentation.DisableTeamColor();
                facing.TrySetFacing(HumanoidFacing.FrontLeft);
                AssetDatabase.SaveAssets();
                created.Add(ProofPath);
                if (PrefabUtility.SaveAsPrefabAsset(root, ProofPath) == null) throw new InvalidOperationException("Unity could not save team-color proof.");
                var reloaded = PrefabUtility.LoadPrefabContents(ProofPath);
                try { errors = Validate(reloaded.GetComponent<SelectiveTeamColorPresentation>()); }
                finally { PrefabUtility.UnloadPrefabContents(reloaded); }
                if (errors.Count != 0) throw new InvalidOperationException("Reloaded team-color proof failed:\n" + string.Join("\n", errors.ToArray()));
                Selection.activeObject = AssetDatabase.LoadAssetAtPath<GameObject>(ProofPath);
                return "Created " + ProofPath + ". Original mode is default. Human mask/render review remains required.";
            }
            catch
            {
                for (var i = created.Count-1; i >= 0; i--)
                {
                    // A failed import can leave a newly written file not yet known to AssetDatabase.
                    if (AssetDatabase.DeleteAsset(created[i])) continue;
                    var full = KnightASkinConfiguration.AssetFullPath(created[i]);
                    if (File.Exists(full)) File.Delete(full);
                    if (File.Exists(full + ".meta")) File.Delete(full + ".meta");
                }
                throw;
            }
            finally { if (root != null) PrefabUtility.UnloadPrefabContents(root); }
        }

        public static List<string> Validate(SelectiveTeamColorPresentation presentation)
        {
            var errors = new List<string>();
            if (presentation == null) { errors.Add("Select the team-color proof root."); return errors; }
            var recipe = KnightATeamColorConfiguration.Load();
            errors.AddRange(presentation.Validate());
            errors.AddRange(KnightAFacingProofBuilder.Validate(presentation.GetComponent<HumanoidFacingPresentation>()));
            if (presentation.ConfigurationSha256 != recipe.ConfigurationHash) errors.Add("Mask recipe provenance is stale; explicit regeneration is required.");
            if (presentation.Sections.Count != 33) errors.Add("Exactly 33 section bindings across three authored views are required.");
            if (AssetDatabase.GetAssetPath(presentation.SharedMaterial) != MaterialPath) errors.Add("Proof must use the one generated shared material asset.");
            if (presentation.SharedMaterial != null && presentation.SharedMaterial.shader != null && ShaderUtil.ShaderHasError(presentation.SharedMaterial.shader))
                errors.Add("Unity reports team-color shader compiler errors; no render or tint fallback is permitted.");
            if (presentation.SharedMaterial != null && (presentation.SharedMaterial.GetColor("_Color") != Color.white || presentation.SharedMaterial.GetFloat("_TeamColorEnabled") != 0f))
                errors.Add("Shared material must default to original mode with no global tint.");
            var maskPaths = new HashSet<string>();
            foreach (var view in recipe.views)
            {
                var config = KnightASkinConfiguration.Load(view.view);
                var pixels = Decode(config);
                var ownership = KnightASkinGeometry.BuildOwnership(config, pixels);
                var rig = presentation.GetComponent<MasterHumanoidRig>();
                var viewRoot = rig != null ? rig.GetViewRoot(view.view) : null;
                var skin = viewRoot != null ? viewRoot.GetComponent<KnightASkin>() : null;
                foreach (var section in view.sections)
                {
                    TeamColorSectionBinding binding = null;
                    foreach (var candidate in presentation.Sections)
                        if (candidate != null && candidate.view == view.view && candidate.sectionId == section.sectionId) binding = candidate;
                    var label = view.view + "/" + section.sectionId;
                    if (binding == null) { errors.Add(label + ": missing section binding."); continue; }
                    var original = skin != null ? Array.Find(skin.Sections, s => s.sectionId == section.sectionId) : null;
                    if (original == null || original.renderer != binding.renderer) errors.Add(label + ": binding must reference its actual authored-view skin renderer.");
                    var extraction = KnightASkinGeometry.Extract(config, Array.Find(config.sections,s=>s.id==section.sectionId),pixels,ownership);
                    if (binding.sourceBounds != extraction.sourceBounds) errors.Add(label + ": mask origin/alignment does not match source extraction.");
                    if (section.polygons.Length == 0)
                    { if (binding.mask != null) errors.Add(label + ": explicitly empty mask must not acquire recolorable pixels."); continue; }
                    var path = MaskPath(view.view,section.sectionId);
                    if (binding.mask == null || AssetDatabase.GetAssetPath(binding.mask) != path || !maskPaths.Add(path))
                    { errors.Add(label + ": expected one shared mask for this authored section, without facing duplicates."); continue; }
                    var importer = AssetImporter.GetAtPath(path) as TextureImporter;
                    if (importer == null || importer.userData != Provenance(recipe,view,section,extraction.sourceBounds) ||
                        importer.sRGBTexture || !importer.isReadable || importer.mipmapEnabled || importer.textureCompression != TextureImporterCompression.Uncompressed ||
                        importer.npotScale != TextureImporterNPOTScale.None || importer.wrapMode != TextureWrapMode.Clamp || importer.filterMode != FilterMode.Bilinear)
                    { errors.Add(label + ": mask import settings/provenance changed (linear, readable, no mips/resize, uncompressed, clamp/bilinear required)."); continue; }
                    var expected = TeamColorMaskRasterizer.Rasterize(section,extraction.sourceBounds);
                    var actual = binding.mask.GetPixels32();
                    if (actual.Length != expected.Length) { errors.Add(label + ": generated mask dimensions differ."); continue; }
                    for (var i = 0; i < expected.Length; i++)
                    {
                        if (!actual[i].Equals(expected[i])) { errors.Add(label + ": generated mask differs from deterministic polygon recipe; do not paint generated PNGs."); break; }
                        if (expected[i].r != 0 && extraction.pixels[i].a == 0)
                        { errors.Add(label + ": polygon covers pixels outside this section's painted content; review alignment/extent."); break; }
                    }
                }
            }
            return errors;
        }

        public static string Provenance(KnightATeamColorConfiguration recipe, TeamColorMaskView view, TeamColorMaskSection section, RectInt bounds)
        { return "RepWarsTeamColorMask/v1|" + recipe.ConfigurationHash + "|" + view.view + "|" + section.sectionId + "|" + view.sourceSha256 + "|" + view.skinConfigurationSha256 + "|" + bounds.x + "," + bounds.y + "," + bounds.width + "," + bounds.height; }

        static Color32[] Decode(KnightASkinConfiguration config)
        {
            config.VerifySource();
            var texture = new Texture2D(2,2,TextureFormat.RGBA32,false);
            try
            {
                if (!texture.LoadImage(File.ReadAllBytes(config.SourceFullPath), false) || texture.width != config.sourceWidth || texture.height != config.sourceHeight)
                    throw new InvalidOperationException("Cannot decode locked source dimensions.");
                return texture.GetPixels32();
            }
            finally { UnityEngine.Object.DestroyImmediate(texture); }
        }

        static Texture2D SaveMask(string path, TeamColorMaskSection section, RectInt bounds, string provenance)
        {
            var texture = new Texture2D(bounds.width,bounds.height,TextureFormat.RGBA32,false,true);
            try
            {
                texture.SetPixels32(TeamColorMaskRasterizer.Rasterize(section,bounds));
                texture.Apply(false,false);
                File.WriteAllBytes(KnightASkinConfiguration.AssetFullPath(path),texture.EncodeToPNG());
            }
            finally { UnityEngine.Object.DestroyImmediate(texture); }
            AssetDatabase.ImportAsset(path,ImportAssetOptions.ForceSynchronousImport);
            var importer = (TextureImporter)AssetImporter.GetAtPath(path);
            importer.textureType = TextureImporterType.Default;
            importer.sRGBTexture = false;
            importer.alphaSource = TextureImporterAlphaSource.FromInput;
            importer.alphaIsTransparency = false;
            importer.mipmapEnabled = false;
            importer.isReadable = true; // Editor reproducibility checks; no runtime pixel processing.
            importer.npotScale = TextureImporterNPOTScale.None;
            importer.maxTextureSize = 2048;
            importer.textureCompression = TextureImporterCompression.Uncompressed;
            importer.wrapMode = TextureWrapMode.Clamp;
            importer.filterMode = FilterMode.Bilinear;
            importer.userData = provenance;
            var settings = importer.GetDefaultPlatformTextureSettings();
            settings.format = TextureImporterFormat.RGBA32;
            settings.textureCompression = TextureImporterCompression.Uncompressed;
            importer.SetPlatformTextureSettings(settings);
            importer.SaveAndReimport();
            return AssetDatabase.LoadAssetAtPath<Texture2D>(path);
        }
    }
}
