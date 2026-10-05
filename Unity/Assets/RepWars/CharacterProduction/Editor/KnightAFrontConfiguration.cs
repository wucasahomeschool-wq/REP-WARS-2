namespace RepWars.CharacterProduction.EditorTools
{
    /// <summary>Preserves the accepted Front entry point while all authored views share one pipeline.</summary>
    public static class KnightAFrontConfiguration
    {
        public static string AssetPath { get { return KnightASkinConfiguration.AssetPathFor(MasterHumanoidView.Front); } }
        public static string ConfigurationHash { get { return KnightASkinConfiguration.Load(MasterHumanoidView.Front).ConfigurationHash; } }
        public static KnightASkinConfiguration Load() { return KnightASkinConfiguration.Load(MasterHumanoidView.Front); }
    }
}
