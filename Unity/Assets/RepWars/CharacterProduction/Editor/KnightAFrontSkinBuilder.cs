using System;
using UnityEditor;
using UnityEngine;

namespace RepWars.CharacterProduction.EditorTools
{
    public static class KnightAFrontSkinBuilder
    {
        public static string GeneratedDirectory { get { return KnightASkinBuilder.GeneratedDirectoryFor(MasterHumanoidView.Front); } }
        public static string ProofPrefabPath { get { return KnightASkinBuilder.ProofPrefabPathFor(MasterHumanoidView.Front); } }
        [MenuItem("RepWars/Character Production/Create Knight A Front Skin Proof")]
        public static void CreateMenu()
        {
            try { Debug.Log("[CharacterProduction] " + CreateProof()); }
            catch (Exception exception) { Debug.LogException(exception); }
        }
        [MenuItem("RepWars/Character Production/Validate Selected Knight A Front Skin")]
        public static void ValidateMenu() { KnightASkinBuilder.ValidateMenu(); }
        public static string CreateProof() { return KnightASkinBuilder.CreateProof(MasterHumanoidView.Front); }
    }
}
