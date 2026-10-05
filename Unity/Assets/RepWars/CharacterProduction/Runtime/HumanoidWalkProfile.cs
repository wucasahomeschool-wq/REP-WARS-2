using System;
using System.Collections.Generic;
using UnityEngine;

namespace RepWars.CharacterProduction
{
    public enum HumanoidAnimationState { Idle = 0, Walk = 1 }

    /// <summary>Three authored in-place Walk clips; no mirrored content or movement authority.</summary>
    public sealed class HumanoidWalkProfile : ScriptableObject
    {
        [SerializeField] float duration, transitionDuration;
        [SerializeField] string configurationSha256;
        [SerializeField] HumanoidIdleViewClip[] views = Array.Empty<HumanoidIdleViewClip>();
        public float Duration { get { return duration; } }
        public float TransitionDuration { get { return transitionDuration; } }
        public string ConfigurationSha256 { get { return configurationSha256; } }
        public IReadOnlyList<HumanoidIdleViewClip> Views { get { return views; } }
        public AnimationClip GetClip(MasterHumanoidView view)
        {
            if (views != null) foreach (var entry in views) if (entry != null && entry.view == view) return entry.clip;
            return null;
        }
        public void Configure(float cycleDuration, float blendSeconds, string hash, HumanoidIdleViewClip[] clips)
        { duration = cycleDuration; transitionDuration = blendSeconds; configurationSha256 = hash; views = clips != null ? (HumanoidIdleViewClip[])clips.Clone() : Array.Empty<HumanoidIdleViewClip>(); }
        public List<string> Validate()
        {
            var errors = new List<string>();
            if (!HumanoidWalkContract.Finite(duration) || duration < 1f || duration > 2f) errors.Add("Walk duration must be a finite deliberate 1-2 second cycle.");
            if (!HumanoidWalkContract.Finite(transitionDuration) || transitionDuration < 0.1f || transitionDuration > 0.4f) errors.Add("Use a finite short 0.1-0.4 second presentation handoff.");
            var identities = new HashSet<MasterHumanoidView>(); var clips = new HashSet<AnimationClip>();
            if (views == null || views.Length != 3) { errors.Add("Exactly three authored Walk clips are required."); return errors; }
            foreach (var entry in views)
            {
                if (entry == null || !Enum.IsDefined(typeof(MasterHumanoidView),entry.view) || !identities.Add(entry.view))
                { errors.Add("Walk view identity is invalid or duplicated."); continue; }
                if (entry.clip == null || !clips.Add(entry.clip)) { errors.Add(entry.view + ": missing or duplicated Walk clip."); continue; }
                if (entry.clip.legacy || !entry.clip.isLooping || Mathf.Abs(entry.clip.length-duration) > 0.0001f || entry.clip.events.Length != 0)
                    errors.Add(entry.view + ": Walk must be a non-legacy event-free loop of the shared duration.");
            }
            return errors;
        }
    }

    public static class HumanoidWalkContract
    {
        static readonly string[] Allowed = { "Spine","Chest","Neck","Head","LeftClavicle","RightClavicle","LeftUpperArm","RightUpperArm",
            "LeftForearm","RightForearm","LeftThigh","RightThigh","LeftShin","RightShin","LeftFoot","RightFoot" };
        static readonly IReadOnlyList<string> ReadOnlyBones = Array.AsReadOnly(Allowed);
        public static IReadOnlyList<string> RotationBones { get { return ReadOnlyBones; } }
        public static bool IsRotationBone(string name) { return Array.IndexOf(Allowed,name) >= 0; }
        public static bool IsBindingBone(string name) { return name == "Pelvis" || IsRotationBone(name); }
        public static bool Finite(float value) { return !float.IsNaN(value) && !float.IsInfinity(value); }
    }
    [Serializable]
    public sealed class HumanoidWalkBoneBinding
    {
        public MasterHumanoidView view;
        public string boneName;
        public Transform bone;
        public Quaternion neutralLocalRotation;
        public Vector3 neutralLocalPosition;
    }
}
