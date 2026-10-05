using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace RepWars.CharacterProduction.EditorTools
{
    /// <summary>Thin Knight B entry points; extraction, SpriteSkin construction and native validation are shared.</summary>
    public static class KnightBSkinBuilder
    {
        public static string ProofPrefabPathFor(MasterHumanoidView view)
        { return MasterHumanoidRigBuilder.Root + "/Proof/KnightB_" + view + "_SkinProof.prefab"; }
        public static string CreateProof(MasterHumanoidView view)
        { return HumanoidSkinBuilder.CreateProof(KnightBSkinConfiguration.Load(view), root => root.AddComponent<KnightBSkin>()); }

        [MenuItem("RepWars/Character Production/Create Knight B Front Skin Proof")]
        public static void CreateFrontMenu() { RunCreate(MasterHumanoidView.Front); }
        [MenuItem("RepWars/Character Production/Create Knight B Side Skin Proof")]
        public static void CreateSideMenu() { RunCreate(MasterHumanoidView.Side); }
        [MenuItem("RepWars/Character Production/Create Knight B Back Skin Proof")]
        public static void CreateBackMenu() { RunCreate(MasterHumanoidView.Back); }
        static void RunCreate(MasterHumanoidView view)
        {
            try { Debug.Log("[CharacterProduction] " + CreateProof(view)); }
            catch (Exception exception) { Debug.LogException(exception); }
        }
        [MenuItem("RepWars/Character Production/Validate All Knight B Definitions")]
        public static void ValidateDefinitionsMenu()
        {
            foreach (MasterHumanoidView view in Enum.GetValues(typeof(MasterHumanoidView)))
            { var config = KnightBSkinConfiguration.Load(view); config.VerifySource(); }
            Debug.Log("Knight B's three definitions/source hashes validate; generated assets and visual quality require separate checks.");
        }
        [MenuItem("RepWars/Character Production/Validate Selected Knight B Skin")]
        public static void ValidateMenu()
        {
            var selected = Selection.activeObject as GameObject;
            var skin = selected != null ? selected.GetComponent<KnightBSkin>() : null;
            if (skin == null) { Debug.LogError("Select an isolated Knight B skin proof root."); return; }
            var errors = Validate(skin, KnightBSkinConfiguration.Load(skin.View));
            if (errors.Count == 0) Debug.Log("Knight B structural validation passed; human visual review is still required.");
            else Debug.LogError(string.Join("\n", errors.ToArray()));
        }
        public static List<string> Validate(KnightBSkin skin, KnightBSkinConfiguration config)
        {
            var errors = HumanoidSkinValidator.Validate(skin, config);
            if (skin == null) return errors;
            if (skin.GetComponentsInChildren<HumanoidFacingPresentation>(true).Length != 0 ||
                skin.GetComponentsInChildren<SelectiveTeamColorPresentation>(true).Length != 0 ||
                skin.GetComponentsInChildren<HumanoidIdlePresentation>(true).Length != 0)
                errors.Add("Knight B skin proofs must not integrate facing, team color or animation presentation yet.");
            return errors;
        }
    }
}
