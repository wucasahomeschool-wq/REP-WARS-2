using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace RepWars.CharacterProduction.EditorTools
{
    public static class KnightBTeamColorProofBuilder
    {
        public const string GeneratedDirectory = MasterHumanoidRigBuilder.Root + "/TeamColor/KnightB/Generated";
        public const string MaterialPath = HumanoidTeamColorProofBuilder.MaterialPath;
        public const string ShaderPath = HumanoidTeamColorProofBuilder.ShaderPath;
        public const string ProofPath = MasterHumanoidRigBuilder.Root + "/Proof/KnightB_TeamColorProof.prefab";
        public static string MaskPath(MasterHumanoidView view, string sectionId)
        { return HumanoidTeamColorProofBuilder.MaskPath("KnightB", view, sectionId); }

        [MenuItem("RepWars/Character Production/Create Knight B Team Color Proof")]
        public static void CreateMenu()
        {
            try { Debug.Log("[CharacterProduction] " + CreateProof()); }
            catch (Exception exception) { Debug.LogException(exception); }
        }
        [MenuItem("RepWars/Character Production/Validate Selected Knight B Team Color Proof")]
        public static void ValidateMenu()
        {
            try
            {
                var selected = Selection.activeObject as GameObject;
                var errors = Validate(selected != null ? selected.GetComponent<SelectiveTeamColorPresentation>() : null);
                if (errors.Count != 0) Debug.LogError(string.Join("\n", errors.ToArray()));
                else Debug.Log("Team-color data checks passed. Unity rendering and human mask approval remain separate.");
            }
            catch (Exception exception) { Debug.LogException(exception); }
        }
        public static string CreateProof()
        { return HumanoidTeamColorProofBuilder.CreateProof(KnightBTeamColorConfiguration.Load(),
            KnightBFacingProofBuilder.ProofPrefabPath, KnightBFacingProofBuilder.CreateProof, ValidateFacing); }
        public static List<string> Validate(SelectiveTeamColorPresentation presentation)
        { return HumanoidTeamColorProofBuilder.Validate(presentation, KnightBTeamColorConfiguration.Load(), ValidateFacing); }
        static List<string> ValidateFacing(HumanoidFacingPresentation facing, HumanoidIdlePresentation idle, SelectiveTeamColorPresentation color)
        { return KnightBFacingProofBuilder.Validate(facing, color); }
        public static string Provenance(KnightBTeamColorConfiguration recipe, TeamColorMaskView view, TeamColorMaskSection section, RectInt bounds)
        { return HumanoidTeamColorProofBuilder.Provenance(recipe, view, section, bounds); }
    }
}
