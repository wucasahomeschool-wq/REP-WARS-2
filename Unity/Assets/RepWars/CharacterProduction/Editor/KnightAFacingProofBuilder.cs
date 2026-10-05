using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.U2D.Animation;

namespace RepWars.CharacterProduction.EditorTools
{
    public static class KnightAFacingProofBuilder
    {
        public const string ProofPrefabPath = MasterHumanoidRigBuilder.Root + "/Proof/KnightA_SixDirectionProof.prefab";

        [MenuItem("RepWars/Character Production/Create Knight A Six Direction Proof")]
        public static void CreateMenu()
        {
            try { Debug.Log("[CharacterProduction] " + CreateProof()); }
            catch (Exception exception) { Debug.LogException(exception); }
        }

        [MenuItem("RepWars/Character Production/Validate Selected Knight A Six Direction Proof")]
        public static void ValidateMenu()
        {
            var selected = Selection.activeObject as GameObject;
            var presentation = selected != null ? selected.GetComponent<HumanoidFacingPresentation>() : null;
            var errors = Validate(presentation);
            if (errors.Count == 0) Debug.Log("Six-direction proof passed structural checks. Visual mirroring still requires human review.");
            else Debug.LogError(string.Join("\n", errors.ToArray()));
        }

        public static string CreateProof()
        {
            var existing = AssetDatabase.LoadAssetAtPath<GameObject>(ProofPrefabPath);
            if (existing != null)
            {
                var errors = Validate(existing.GetComponent<HumanoidFacingPresentation>());
                if (errors.Count != 0) throw new InvalidOperationException("Existing direction proof was not overwritten:\n" + string.Join("\n", errors.ToArray()));
                return "Existing six-direction proof validates and was left unchanged.";
            }
            if (File.Exists(KnightASkinConfiguration.AssetFullPath(ProofPrefabPath)))
                throw new InvalidOperationException("An unloadable file already exists at the direction proof path; it was not overwritten.");

            // Authored proofs are independently owned outputs. Their existing no-overwrite policy remains intact.
            foreach (MasterHumanoidView view in Enum.GetValues(typeof(MasterHumanoidView)))
                KnightASkinBuilder.CreateProof(view);
            MasterHumanoidRig rig = null;
            var wroteProof = false;
            try
            {
                MasterHumanoidRigBuilder.EnsureFolder(MasterHumanoidRigBuilder.Root + "/Proof");
                rig = MasterHumanoidRigBuilder.CreateRigObject("KnightA_SixDirectionProof");
                rig.VisualRoot.gameObject.AddComponent<SortingGroup>();
                var views = new Transform[3];
                foreach (MasterHumanoidView view in Enum.GetValues(typeof(MasterHumanoidView)))
                {
                    var sourceRoot = PrefabUtility.LoadPrefabContents(KnightASkinBuilder.ProofPrefabPathFor(view));
                    try
                    {
                        var source = sourceRoot.GetComponent<KnightASkin>();
                        var config = KnightASkinConfiguration.Load(view);
                        var errors = KnightASkinValidator.Validate(source, config);
                        if (errors.Count != 0) throw new InvalidOperationException(string.Join("\n", errors.ToArray()));
                        // Clone only the authored branch, not the two empty foundation branches or original outer root.
                        var clone = UnityEngine.Object.Instantiate(source.Rig.GetViewRoot(view).gameObject, rig.VisualRoot, false);
                        clone.name = "View_" + view;
                        clone.SetActive(false);
                        views[(int)view] = clone.transform;
                        UnityEngine.Object.DestroyImmediate(rig.GetViewRoot(view).gameObject);
                        var bindings = new List<KnightASkinSectionBinding>();
                        var mount = clone.transform.Find("SkinMount");
                        foreach (var section in config.sections)
                        {
                            var piece = mount.Find(section.id);
                            if (piece == null) throw new InvalidOperationException(view + " clone is missing " + section.id);
                            bindings.Add(new KnightASkinSectionBinding { sectionId = section.id,
                                renderer = piece.GetComponent<SpriteRenderer>(), spriteSkin = piece.GetComponent<SpriteSkin>() });
                        }
                        clone.AddComponent<KnightASkin>().Configure(view, rig, source.SourceSha256, source.ConfigurationSha256, bindings.ToArray());
                    }
                    finally { PrefabUtility.UnloadPrefabContents(sourceRoot); }
                }
                rig.Configure(rig.VisualRoot, rig.GroundSocket, views[0], views[1], views[2]);
                var presentation = rig.gameObject.AddComponent<HumanoidFacingPresentation>();
                string error;
                if (!presentation.Configure(rig, HumanoidFacing.FrontLeft, out error)) throw new InvalidOperationException(error);
                var validation = Validate(presentation);
                if (validation.Count != 0) throw new InvalidOperationException(string.Join("\n", validation.ToArray()));
                // Check every state in memory before saving; does not assert anything about visual rendering.
                foreach (HumanoidFacing facing in Enum.GetValues(typeof(HumanoidFacing)))
                {
                    if (!presentation.TrySetFacing(facing)) throw new InvalidOperationException("Cannot apply facing " + facing);
                    validation = Validate(presentation);
                    if (validation.Count != 0) throw new InvalidOperationException(string.Join("\n", validation.ToArray()));
                }
                presentation.TrySetFacing(HumanoidFacing.FrontLeft);
                wroteProof = true;
                if (PrefabUtility.SaveAsPrefabAsset(rig.gameObject, ProofPrefabPath) == null)
                    throw new InvalidOperationException("Unity could not save the six-direction proof.");
                var reloaded = PrefabUtility.LoadPrefabContents(ProofPrefabPath);
                try { validation = Validate(reloaded.GetComponent<HumanoidFacingPresentation>()); }
                finally { PrefabUtility.UnloadPrefabContents(reloaded); }
                if (validation.Count != 0) throw new InvalidOperationException("Reloaded proof failed structural checks:\n" + string.Join("\n", validation.ToArray()));
                Selection.activeObject = AssetDatabase.LoadAssetAtPath<GameObject>(ProofPrefabPath);
                return "Created " + ProofPrefabPath + ". Six mappings structurally checked; Unity visual review is still required.";
            }
            catch
            {
                // This invocation owns only the previously absent combined proof, not existing authored proofs.
                if (wroteProof) AssetDatabase.DeleteAsset(ProofPrefabPath);
                throw;
            }
            finally { if (rig != null) UnityEngine.Object.DestroyImmediate(rig.gameObject); }
        }

        public static List<string> Validate(HumanoidFacingPresentation presentation)
        {
            var errors = HumanoidFacingValidator.Validate(presentation);
            if (presentation == null || presentation.Rig == null) return errors;
            if (presentation.GetComponentsInChildren<MasterHumanoidRig>(true).Length != 1)
                errors.Add("Combined proof must contain one Master Humanoid rig component, with three authored branches.");
            if (presentation.GetComponentsInChildren<KnightASkin>(true).Length != 3)
                errors.Add("Knight A combined proof must contain exactly three authored skin metadata components.");
            if (presentation.GetComponentsInChildren<SpriteRenderer>(true).Length != 33 ||
                presentation.GetComponentsInChildren<SpriteSkin>(true).Length != 33)
                errors.Add("Combined proof must reuse exactly thirty-three authored renderer/SpriteSkin pairs, not six duplicated skins.");
            foreach (MasterHumanoidView view in Enum.GetValues(typeof(MasterHumanoidView)))
            {
                var root = presentation.Rig.GetViewRoot(view);
                if (root == null) continue;
                var skin = root.GetComponent<KnightASkin>();
                errors.AddRange(KnightASkinValidator.Validate(skin, KnightASkinConfiguration.Load(view), false));
            }
            return errors;
        }
    }
}
