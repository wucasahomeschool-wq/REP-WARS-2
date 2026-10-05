using System;
using UnityEngine;

namespace RepWars.CharacterProduction
{
    /// <summary>Inspectable references and provenance for the authored-view skin proof. No gameplay or animation behavior.</summary>
    public sealed class KnightBSkin : MonoBehaviour, IHumanoidSkin
    {
        [SerializeField] MasterHumanoidView view;
        [SerializeField] MasterHumanoidRig rig;
        [SerializeField] string sourceSha256;
        [SerializeField] string configurationSha256;
        [SerializeField] KnightASkinSectionBinding[] sections = Array.Empty<KnightASkinSectionBinding>();

        public GameObject Owner { get { return gameObject; } }
        public string CharacterId { get { return "KnightB"; } }
        public MasterHumanoidView View { get { return view; } }
        public MasterHumanoidRig Rig { get { return rig; } }
        public string SourceSha256 { get { return sourceSha256; } }
        public string ConfigurationSha256 { get { return configurationSha256; } }
        public KnightASkinSectionBinding[] Sections { get { return sections; } }

        public void Configure(MasterHumanoidView authoredView, MasterHumanoidRig newRig, string sourceHash, string configurationHash,
            KnightASkinSectionBinding[] bindings)
        {
            view = authoredView;
            rig = newRig;
            sourceSha256 = sourceHash;
            configurationSha256 = configurationHash;
            sections = bindings;
        }
    }
}
