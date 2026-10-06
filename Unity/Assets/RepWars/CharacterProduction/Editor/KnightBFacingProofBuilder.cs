using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.U2D.Animation;

namespace RepWars.CharacterProduction.EditorTools
{
    public static class KnightBFacingProofBuilder
    {
        public const string ProofPrefabPath = MasterHumanoidRigBuilder.Root + "/Proof/KnightB_SixDirectionProof.prefab";

        [MenuItem("RepWars/Character Production/Create Knight B Six Direction Proof")]
        public static void CreateMenu()
        {
            try { Debug.Log("[CharacterProduction] " + CreateProof()); }
            catch (Exception exception) { Debug.LogException(exception); }
        }

        [MenuItem("RepWars/Character Production/Validate Selected Knight B Six Direction Proof")]
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
            var mapping = KnightBFacingConfiguration.Load().ToRuntimeDefinition();
            var existing = AssetDatabase.LoadAssetAtPath<GameObject>(ProofPrefabPath);
            if (existing != null)
            {
                var errors = Validate(existing.GetComponent<HumanoidFacingPresentation>());
                if (errors.Count != 0) throw new InvalidOperationException("Existing direction proof was not overwritten:\n" + string.Join("\n", errors.ToArray()));
                return "Existing six-direction proof validates and was left unchanged.";
            }
            if (File.Exists(HumanoidSkinConfiguration.AssetFullPath(ProofPrefabPath)))
                throw new InvalidOperationException("An unloadable file already exists at the direction proof path; it was not overwritten.");

            // Authored proofs are independently owned outputs. Their existing no-overwrite policy remains intact.
            foreach (MasterHumanoidView view in Enum.GetValues(typeof(MasterHumanoidView)))
                KnightBSkinBuilder.CreateProof(view);
            MasterHumanoidRig rig = null;
            var wroteProof = false;
            try
            {
                MasterHumanoidRigBuilder.EnsureFolder(MasterHumanoidRigBuilder.Root + "/Proof");
                rig = MasterHumanoidRigBuilder.CreateRigObject("KnightB_SixDirectionProof");
                rig.VisualRoot.gameObject.AddComponent<SortingGroup>();
                HumanoidFacingProofAssembly.AssembleViews(rig, KnightBSkinBuilder.ProofPrefabPathFor,
                    view => KnightBSkinConfiguration.Load(view), root => root.AddComponent<KnightBSkin>());
                var presentation = rig.gameObject.AddComponent<HumanoidFacingPresentation>();
                string error;
                if (!presentation.Configure(rig, HumanoidFacing.FrontLeft, mapping, out error)) throw new InvalidOperationException(error);
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

        public static List<string> Validate(HumanoidFacingPresentation presentation, SelectiveTeamColorPresentation allowedTeamColor = null)
        {
            var errors = HumanoidFacingValidator.Validate(presentation);
            if (presentation == null || presentation.Rig == null) return errors;
            try
            {
                var expected = KnightBFacingConfiguration.Load().ToRuntimeDefinition();
                if (presentation.Definition.FrontLeftMirrored != expected.FrontLeftMirrored ||
                    presentation.Definition.LeftMirrored != expected.LeftMirrored ||
                    presentation.Definition.BackLeftMirrored != expected.BackLeftMirrored)
                    errors.Add("Knight B facing definition differs from reviewed authored handedness.");
            }
            catch (Exception exception) { errors.Add(exception.Message); }
            if (presentation.GetComponentsInChildren<MasterHumanoidRig>(true).Length != 1)
                errors.Add("Combined proof must contain one canonical rig with three authored branches.");
            if (presentation.GetComponentsInChildren<KnightBSkin>(true).Length != 3 ||
                presentation.GetComponentsInChildren<KnightASkin>(true).Length != 0)
                errors.Add("Knight B proof requires exactly three Knight B skin metadata components and no Knight A skins.");
            if (presentation.GetComponentsInChildren<SpriteRenderer>(true).Length != 33 ||
                presentation.GetComponentsInChildren<SpriteSkin>(true).Length != 33)
                errors.Add("Knight B proof must reuse exactly 33 renderer/SpriteSkin pairs, not six duplicated rigs.");
            var colors = presentation.GetComponentsInChildren<SelectiveTeamColorPresentation>(true);
            if (colors.Length != 0 && (allowedTeamColor == null || allowedTeamColor.gameObject != presentation.gameObject ||
                colors.Length != 1 || colors[0] != allowedTeamColor))
                errors.Add("Static Knight B facing proofs cannot contain team color; only the explicitly supplied root color proof is permitted.");
            if (presentation.GetComponentsInChildren<HumanoidIdlePresentation>(true).Length != 0 ||
                presentation.GetComponentsInChildren<Animator>(true).Length != 0)
                errors.Add("Knight B proof remains animation-free in this phase.");
            foreach (MasterHumanoidView view in Enum.GetValues(typeof(MasterHumanoidView)))
            {
                var root = presentation.Rig.GetViewRoot(view);
                if (root == null) continue;
                errors.AddRange(HumanoidSkinValidator.Validate(root.GetComponent<KnightBSkin>(), KnightBSkinConfiguration.Load(view), false));
            }
            return errors;
        }
    }
}
