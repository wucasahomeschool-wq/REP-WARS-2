using System;
using UnityEngine;
using UnityEngine.U2D.Animation;

namespace RepWars.CharacterProduction
{
    [Serializable]
    public sealed class KnightAFrontSectionBinding
    {
        public string sectionId;
        public SpriteRenderer renderer;
        public SpriteSkin spriteSkin;
    }

    /// <summary>Inspectable references and provenance for the Front-only skin proof. No gameplay or animation behavior.</summary>
    public sealed class KnightAFrontSkin : MonoBehaviour
    {
        [SerializeField] MasterHumanoidRig rig;
        [SerializeField] string sourceSha256;
        [SerializeField] string configurationSha256;
        [SerializeField] KnightAFrontSectionBinding[] sections = Array.Empty<KnightAFrontSectionBinding>();

        public MasterHumanoidRig Rig { get { return rig; } }
        public string SourceSha256 { get { return sourceSha256; } }
        public string ConfigurationSha256 { get { return configurationSha256; } }
        public KnightAFrontSectionBinding[] Sections { get { return sections; } }

        public void Configure(MasterHumanoidRig newRig, string sourceHash, string configurationHash,
            KnightAFrontSectionBinding[] bindings)
        {
            rig = newRig;
            sourceSha256 = sourceHash;
            configurationSha256 = configurationHash;
            sections = bindings;
        }
    }
}
