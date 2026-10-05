using UnityEngine;

namespace RepWars.CharacterProduction
{
    /// <summary>Presentation-only authored-skin metadata. Historic section-binding DTO is shared, without Knight A behavior.</summary>
    public interface IHumanoidSkin
    {
        GameObject Owner { get; }
        string CharacterId { get; }
        MasterHumanoidView View { get; }
        MasterHumanoidRig Rig { get; }
        string SourceSha256 { get; }
        string ConfigurationSha256 { get; }
        KnightASkinSectionBinding[] Sections { get; }
        void Configure(MasterHumanoidView view, MasterHumanoidRig rig, string sourceHash, string configurationHash, KnightASkinSectionBinding[] sections);
    }
}
