using System;

namespace RepWars.CharacterProduction.EditorTools
{
    /// <summary>Family-specific provenance and source calibration; mask DTOs/rasterization are shared.</summary>
    [Serializable]
    public sealed class KnightBTeamColorConfiguration : HumanoidTeamColorConfiguration
    {
        public const string AssetPath = MasterHumanoidRigBuilder.Root + "/Editor/KnightBTeamColor.configuration.json";
        public override string ExpectedCharacterId { get { return "KnightB"; } }
        public override string ConfigurationAssetPath { get { return AssetPath; } }
        public override HumanoidSkinConfiguration LoadSkin(MasterHumanoidView view)
        { return KnightBSkinConfiguration.Load(view); }
        public static KnightBTeamColorConfiguration Load()
        { return LoadRecipe<KnightBTeamColorConfiguration>(AssetPath); }
    }
}
