using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.U2D.Animation;

namespace RepWars.CharacterProduction.EditorTools
{
    /// <summary>Clone precisely three authored branches with native SpriteSkin references; no mirrored rig/texture duplication.</summary>
    public static class HumanoidFacingProofAssembly
    {
        public static void AssembleViews(MasterHumanoidRig rig, Func<MasterHumanoidView, string> proofPathFor,
            Func<MasterHumanoidView, HumanoidSkinConfiguration> configurationFor, Func<GameObject, IHumanoidSkin> addMetadata)
        {
            var views = new Transform[3];
            foreach (MasterHumanoidView view in Enum.GetValues(typeof(MasterHumanoidView)))
            {
                var sourceRoot = PrefabUtility.LoadPrefabContents(proofPathFor(view));
                try
                {
                    var source = HumanoidSkinBuilder.FindMetadata(sourceRoot);
                    var config = configurationFor(view);
                    var errors = HumanoidSkinValidator.Validate(source, config);
                    if (errors.Count != 0) throw new InvalidOperationException(string.Join("\n", errors.ToArray()));
                    // Clone only the authored branch, not the empty foundation branches or external root.
                    var clone = UnityEngine.Object.Instantiate(source.Rig.GetViewRoot(view).gameObject, rig.VisualRoot, false);
                    clone.name = "View_" + view;
                    clone.SetActive(false);
                    views[(int)view] = clone.transform;
                    UnityEngine.Object.DestroyImmediate(rig.GetViewRoot(view).gameObject);
                    var bindings = new List<KnightASkinSectionBinding>();
                    var mount = clone.transform.Find("SkinMount");
                    foreach (var section in config.sections)
                    {
                        var piece = mount.Find(section.id);
                        if (piece == null) throw new InvalidOperationException(view + " clone is missing " + section.id);
                        bindings.Add(new KnightASkinSectionBinding { sectionId = section.id,
                            renderer = piece.GetComponent<SpriteRenderer>(), spriteSkin = piece.GetComponent<SpriteSkin>() });
                    }
                    var metadata = addMetadata(clone);
                    if (metadata == null || metadata.CharacterId != config.CharacterId)
                        throw new InvalidOperationException("Combined proof metadata must match the source family.");
                    metadata.Configure(view, rig, source.SourceSha256, source.ConfigurationSha256, bindings.ToArray());
                }
                finally { PrefabUtility.UnloadPrefabContents(sourceRoot); }
            }
            rig.Configure(rig.VisualRoot, rig.GroundSocket, views[0], views[1], views[2]);
        }
    }
}
