using System;
using UnityEngine;
using UnityEngine.U2D.Animation;

namespace RepWars.CharacterProduction
{
    [Serializable]
    public sealed class KnightASkinSectionBinding
    {
        public string sectionId;
        public SpriteRenderer renderer;
        public SpriteSkin spriteSkin;
    }

    /// <summary>Inspectable references and provenance for the authored-view skin proof. No gameplay or animation behavior.</summary>
    public class KnightASkin : MonoBehaviour
    {
        [SerializeField] MasterHumanoidView view;
        [SerializeField] MasterHumanoidRig rig;
        [SerializeField] string sourceSha256;
        [SerializeField] string configurationSha256;
        [SerializeField] KnightASkinSectionBinding[] sections = Array.Empty<KnightASkinSectionBinding>();

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
