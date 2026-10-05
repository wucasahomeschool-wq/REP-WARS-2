using System;
using System.IO;
using UnityEngine;

namespace RepWars.CharacterProduction.EditorTools
{
    [Serializable]
    public sealed class KnightASkinConfiguration : HumanoidSkinConfiguration
    {
        public static string AssetPathFor(MasterHumanoidView view) { return MasterHumanoidRigBuilder.Root + "/Editor/KnightA" + view + ".configuration.json"; }
        public static string LockedSourcePathFor(MasterHumanoidView view)
        {
            switch (view)
            {
                case MasterHumanoidView.Front: return "assets/misc/Character Skin PNG pieces/ChatGPT Image Sep 30, 2026, 09_27_22 AM.png";
                case MasterHumanoidView.Side: return "assets/misc/Character Skin PNG pieces/ChatGPT Image Sep 30, 2026, 09_27_29 AM.png";
                case MasterHumanoidView.Back: return "assets/misc/Character Skin PNG pieces/Disassembled Knight Armor Sprite Sheet (1).png";
                default: throw new ArgumentOutOfRangeException("view");
            }
        }
        public override string CharacterId { get { return "KnightA"; } }
        public override string ConfigurationAssetPath { get { return AssetPathFor(view); } }
        public override string LockedSourcePath { get { return LockedSourcePathFor(view); } }
        public override int ExpectedSourceWidth { get { return 1024; } }
        public override int ExpectedSourceHeight { get { return 1536; } }
        public override bool UseLegacyKnightAFrontWeights { get { return view == MasterHumanoidView.Front; } }

        public static KnightASkinConfiguration Load(MasterHumanoidView view)
        {
            var result = JsonUtility.FromJson<KnightASkinConfiguration>(File.ReadAllText(AssetFullPath(AssetPathFor(view))));
            if (result == null) throw new InvalidOperationException("Knight A authored-view configuration could not be parsed.");
            if (result.view != view) throw new InvalidOperationException("Configuration view does not match requested view.");
            var errors = result.Validate();
            if (errors.Count > 0) throw new InvalidOperationException(string.Join("\n", errors.ToArray()));
            return result;
        }

    }
}
