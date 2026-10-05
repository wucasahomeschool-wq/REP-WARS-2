using System;
using System.IO;
using UnityEngine;

namespace RepWars.CharacterProduction.EditorTools
{
    /// <summary>Locked Knight B provenance; all three views use their own data-driven calibration/weight bands.</summary>
    [Serializable]
    public sealed class KnightBSkinConfiguration : HumanoidSkinConfiguration
    {
        public static string AssetPathFor(MasterHumanoidView view)
        { return MasterHumanoidRigBuilder.Root + "/Editor/KnightB" + view + ".configuration.json"; }
        public static string LockedSourcePathFor(MasterHumanoidView view)
        {
            const string root = "assets/misc/Character Skin PNG pieces/";
            switch (view)
            {
                case MasterHumanoidView.Front: return root + "Disassembled Dark Knight Armor Set (1).png";
                case MasterHumanoidView.Side: return root + "ChatGPT Image Oct 3, 2026, 08_01_25 AM.png";
                case MasterHumanoidView.Back: return root + "ChatGPT Image Oct 3, 2026, 08_06_16 AM.png";
                default: throw new ArgumentOutOfRangeException("view");
            }
        }
        public override string CharacterId { get { return "KnightB"; } }
        public override string ConfigurationAssetPath { get { return AssetPathFor(view); } }
        public override string LockedSourcePath { get { return LockedSourcePathFor(view); } }
        public override int ExpectedSourceWidth { get { return view == MasterHumanoidView.Front ? 1254 : 1024; } }
        public override int ExpectedSourceHeight { get { return view == MasterHumanoidView.Front ? 1254 : 1536; } }

        public static KnightBSkinConfiguration Load(MasterHumanoidView view)
        {
            var config = JsonUtility.FromJson<KnightBSkinConfiguration>(File.ReadAllText(AssetFullPath(AssetPathFor(view))));
            if (config == null || config.view != view) throw new InvalidOperationException("Knight B configuration does not match the requested view.");
            var errors = config.Validate();
            if (errors.Count > 0) throw new InvalidOperationException(string.Join("\n", errors.ToArray()));
            return config;
        }
    }
}
