using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace RepWars.CharacterProduction.EditorTools
{
    [Serializable]
    public sealed class HumanoidIdlePhase
    {
        public float normalizedTime, breath, settle;
    }
    [Serializable]
    public sealed class HumanoidIdleBoneMotion
    {
        public string bone;
        public float breathDegrees, settleDegrees;
    }
    [Serializable]
    public sealed class KnightAIdleViewDefinition
    {
        public MasterHumanoidView view;
        public string sourceSha256, skinConfigurationSha256;
        public HumanoidIdleBoneMotion[] motions;
    }

    /// <summary>Shared semantic phases plus view-specific rotation offsets, never arbitrary transform curves.</summary>
    [Serializable]
    public sealed class KnightAIdleConfiguration
    {
        public const string AssetPath = MasterHumanoidRigBuilder.Root + "/Editor/KnightAIdle.configuration.json";
        public int version;
        public string characterId, state;
        public float duration;
        public HumanoidIdlePhase[] phases;
        public KnightAIdleViewDefinition[] views;
        public string ConfigurationHash { get { return KnightASkinConfiguration.HashFile(KnightASkinConfiguration.AssetFullPath(AssetPath)); } }

        public static KnightAIdleConfiguration Load()
        {
            var recipe = JsonUtility.FromJson<KnightAIdleConfiguration>(File.ReadAllText(KnightASkinConfiguration.AssetFullPath(AssetPath)));
            if (recipe == null) throw new InvalidOperationException("Idle recipe could not be parsed.");
            var errors = recipe.Validate();
            if (errors.Count > 0) throw new InvalidOperationException(string.Join("\n",errors.ToArray()));
            return recipe;
        }

        public List<string> Validate()
        {
            var errors = new List<string>();
            if (version != 1 || characterId != "KnightA" || state != "Idle") errors.Add("Expected KnightA Idle recipe version 1.");
            if (!Finite(duration) || duration < 3f || duration > 8f) errors.Add("Idle duration must be a restrained finite 3-8 seconds.");
            if (phases == null || phases.Length < 6 || phases.Length > 12) errors.Add("Use 6-12 deliberate semantic phases, not two-pose rocking or noisy micro-keys.");
            else
            {
                for (var i = 0; i < phases.Length; i++)
                {
                    var phase = phases[i];
                    if (phase == null || !Finite(phase.normalizedTime) || phase.normalizedTime < 0f || phase.normalizedTime > 1f ||
                        !Finite(phase.breath) || !Finite(phase.settle) || Mathf.Abs(phase.breath) > 1f || Mathf.Abs(phase.settle) > 1f)
                    { errors.Add("Idle phases require finite normalized time and restrained semantic signals."); continue; }
                    if (i > 0 && phases[i-1] != null && phase.normalizedTime-phases[i-1].normalizedTime < 0.05f)
                        errors.Add("Idle phases must increase with at least 0.05 normalized spacing.");
                }
                var first = phases[0]; var last = phases[phases.Length-1];
                if (first == null || last == null || first.normalizedTime != 0f || last.normalizedTime != 1f ||
                    first.breath != 0f || first.settle != 0f || last.breath != first.breath || last.settle != first.settle)
                    errors.Add("Idle loop must start/end exactly at the neutral pose with matching semantic values.");
            }
            var identities = new HashSet<MasterHumanoidView>();
            if (views == null || views.Length != 3) { errors.Add("Exactly Front/Side/Back Idle definitions are required."); return errors; }
            foreach (var view in views)
            {
                if (view == null || !Enum.IsDefined(typeof(MasterHumanoidView),view.view) || !identities.Add(view.view))
                { errors.Add("Idle view is invalid or duplicated."); continue; }
                var skin = KnightASkinConfiguration.Load(view.view);
                skin.VerifySource();
                if (view.sourceSha256 != skin.sourceSha256 || view.skinConfigurationSha256 != skin.ConfigurationHash)
                    errors.Add(view.view + ": reviewed source/neutral calibration provenance changed.");
                var names = new HashSet<string>();
                if (view.motions == null) { errors.Add(view.view + ": bone motion definitions are missing."); continue; }
                foreach (var motion in view.motions)
                    if (motion == null || !HumanoidIdleContract.IsAllowedBone(motion.bone) || !names.Add(motion.bone) ||
                        !Finite(motion.breathDegrees) || !Finite(motion.settleDegrees) || Mathf.Abs(motion.breathDegrees)+Mathf.Abs(motion.settleDegrees) > 0.75f)
                        errors.Add(view.view + ": only restrained, unique canonical upper-body Z-rotation offsets are allowed.");
                if (!names.SetEquals(HumanoidIdleContract.AnimatedBones)) errors.Add(view.view + ": all eight upper-body semantic bindings must be defined.");
            }
            return errors;
        }

        public AnimationCurve BuildCurve(HumanoidIdleBoneMotion motion, float neutralZ)
        {
            var keys = new Keyframe[phases.Length];
            for (var i = 0; i < keys.Length; i++)
                keys[i] = new Keyframe(phases[i].normalizedTime*duration,
                    neutralZ+motion.breathDegrees*phases[i].breath+motion.settleDegrees*phases[i].settle,0f,0f);
            // Unweighted zero tangents give bounded smooth Hermite easing, including identical zero slopes at the seam.
            return new AnimationCurve(keys) { preWrapMode = WrapMode.Loop, postWrapMode = WrapMode.Loop };
        }
        static bool Finite(float value) { return !float.IsNaN(value) && !float.IsInfinity(value); }
    }
}
