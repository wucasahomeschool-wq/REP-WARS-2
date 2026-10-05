using System;
using UnityEditor;
using UnityEngine;

namespace RepWars.CharacterProduction.EditorTools
{
    public static class KnightASkinBuilder
    {
        public static string GeneratedDirectoryFor(MasterHumanoidView view) { return MasterHumanoidRigBuilder.Root + "/Skins/KnightA/" + view + "/Generated"; }
        public static string ProofPrefabPathFor(MasterHumanoidView view) { return MasterHumanoidRigBuilder.Root + "/Proof/KnightA_" + view + "_SkinProof.prefab"; }

        [MenuItem("RepWars/Character Production/Create Knight A Side Skin Proof")]
        public static void CreateSideMenu() { RunCreate(MasterHumanoidView.Side); }
        [MenuItem("RepWars/Character Production/Create Knight A Back Skin Proof")]
        public static void CreateBackMenu() { RunCreate(MasterHumanoidView.Back); }
        static void RunCreate(MasterHumanoidView view)
        {
            try { Debug.Log("[CharacterProduction] " + CreateProof(view)); }
            catch (Exception exception) { Debug.LogException(exception); }
        }
        [MenuItem("RepWars/Character Production/Validate Selected Knight A Skin")]
        public static void ValidateMenu()
        {
            var selected = Selection.activeObject as GameObject;
            var skin = selected != null ? selected.GetComponent<KnightASkin>() : null;
            if (skin == null) { Debug.LogError("Select a Knight A skin proof root."); return; }
            var errors = KnightASkinValidator.Validate(skin, KnightASkinConfiguration.Load(skin.View));
            if (errors.Count == 0) Debug.Log("[CharacterProduction] Structural checks passed; visual review remains required.");
            else Debug.LogError(string.Join("\n", errors.ToArray()));
        }
        [MenuItem("RepWars/Character Production/Validate All Knight A Definitions")]
        public static void ValidateDefinitionsMenu()
        {
            foreach (MasterHumanoidView view in Enum.GetValues(typeof(MasterHumanoidView)))
            { var config = KnightASkinConfiguration.Load(view); config.VerifySource(); }
            Debug.Log("All three Knight A definitions and source hashes validate. Unity visuals remain unapproved.");
        }

        public static string CreateProof(MasterHumanoidView view)
        {
            return HumanoidSkinBuilder.CreateProof(KnightASkinConfiguration.Load(view), root =>
                view == MasterHumanoidView.Front ? (IHumanoidSkin)root.AddComponent<KnightAFrontSkin>() : root.AddComponent<KnightASkin>());
        }
    }
}
