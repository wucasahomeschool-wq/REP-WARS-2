using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace RepWars.CharacterProduction.EditorTools
{
    [Serializable]
    public sealed class KnightBFacingViewDefinition
    {
        public MasterHumanoidView view;
        public HumanoidFacing unmirroredFacing;
        public string sourceSha256;
        public string skinConfigurationSha256;
    }

    /// <summary>Reviewed source handedness and immutable source/skin provenance; not skin calibration or gameplay data.</summary>
    [Serializable]
    public sealed class KnightBFacingConfiguration
    {
        public const string AssetPath = MasterHumanoidRigBuilder.Root + "/Editor/KnightBFacing.configuration.json";
        public int version;
        public string characterId;
        public KnightBFacingViewDefinition[] views;

        public static KnightBFacingConfiguration Load()
        {
            var config = JsonUtility.FromJson<KnightBFacingConfiguration>(File.ReadAllText(HumanoidSkinConfiguration.AssetFullPath(AssetPath)));
            if (config == null) throw new InvalidOperationException("Knight B facing configuration could not be parsed.");
            var errors = config.Validate();
            if (errors.Count > 0) throw new InvalidOperationException(string.Join("\n", errors.ToArray()));
            return config;
        }

        public List<string> Validate()
        {
            var errors = new List<string>();
            if (version != 1 || characterId != "KnightB") errors.Add("Facing recipe must be version 1 for KnightB.");
            var identities = new HashSet<MasterHumanoidView>();
            if (views == null || views.Length != 3) { errors.Add("Knight B requires exactly three authored-view facing definitions."); return errors; }
            foreach (var definition in views)
            {
                HumanoidFacingSelection selection;
                if (definition == null || !identities.Add(definition.view) ||
                    !HumanoidFacingContract.TryResolve(definition.unmirroredFacing, out selection) || selection.View != definition.view)
                { errors.Add("Each authored view must occur once and map to its own facing pair."); continue; }
                // Reviewed source evidence: Front visor, Side helmet/toes, Back rear-oblique helmet all read image-right.
                var approved = definition.view == MasterHumanoidView.Front ? HumanoidFacing.FrontRight :
                    definition.view == MasterHumanoidView.Side ? HumanoidFacing.Right : HumanoidFacing.BackRight;
                if (definition.unmirroredFacing != approved) errors.Add(definition.view + " differs from the reviewed Knight B source handedness.");
                try
                {
                    var skin = KnightBSkinConfiguration.Load(definition.view);
                    skin.VerifySource();
                    if (definition.sourceSha256 != skin.sourceSha256 || definition.skinConfigurationSha256 != skin.ConfigurationHash)
                        errors.Add(definition.view + " facing provenance is stale; reviewed skins/source must remain unchanged.");
                }
                catch (Exception exception) { errors.Add(exception.Message); }
            }
            return errors;
        }

        public HumanoidFacingDefinition ToRuntimeDefinition()
        {
            var errors = Validate();
            if (errors.Count > 0) throw new InvalidOperationException(string.Join("\n", errors.ToArray()));
            var front = Array.Find(views, v => v.view == MasterHumanoidView.Front);
            var side = Array.Find(views, v => v.view == MasterHumanoidView.Side);
            var back = Array.Find(views, v => v.view == MasterHumanoidView.Back);
            return new HumanoidFacingDefinition(front.unmirroredFacing == HumanoidFacing.FrontRight,
                side.unmirroredFacing == HumanoidFacing.Right, back.unmirroredFacing == HumanoidFacing.BackRight);
        }
    }
}
