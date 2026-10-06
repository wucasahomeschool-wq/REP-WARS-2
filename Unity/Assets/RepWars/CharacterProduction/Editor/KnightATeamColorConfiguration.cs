using System;

namespace RepWars.CharacterProduction.EditorTools
{
    /// <summary>Family-specific provenance and source calibration; mask DTOs/rasterization are shared.</summary>
    [Serializable]
    public sealed class KnightATeamColorConfiguration : HumanoidTeamColorConfiguration
    {
        public const string AssetPath = MasterHumanoidRigBuilder.Root + "/Editor/KnightATeamColor.configuration.json";
        public override string ExpectedCharacterId { get { return "KnightA"; } }
        public override string ConfigurationAssetPath { get { return AssetPath; } }
        public override HumanoidSkinConfiguration LoadSkin(MasterHumanoidView view)
        { return KnightASkinConfiguration.Load(view); }
        public static KnightATeamColorConfiguration Load()
        { return LoadRecipe<KnightATeamColorConfiguration>(AssetPath); }
    }
}
