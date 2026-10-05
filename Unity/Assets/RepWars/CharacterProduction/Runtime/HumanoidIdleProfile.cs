using System;
using System.Collections.Generic;
using UnityEngine;

namespace RepWars.CharacterProduction
{
    [Serializable]
    public sealed class HumanoidIdleViewClip
    {
        public MasterHumanoidView view;
        public AnimationClip clip;
    }

    /// <summary>Three authored clips, relative to their View roots. Facing/mirroring is not animation content.</summary>
    public sealed class HumanoidIdleProfile : ScriptableObject
    {
        [SerializeField] float duration;
        [SerializeField] string configurationSha256;
        [SerializeField] HumanoidIdleViewClip[] views = Array.Empty<HumanoidIdleViewClip>();
        public float Duration { get { return duration; } }
        public string ConfigurationSha256 { get { return configurationSha256; } }
        public IReadOnlyList<HumanoidIdleViewClip> Views { get { return views; } }
        public AnimationClip GetClip(MasterHumanoidView view)
        {
            if (views == null) return null;
            foreach (var entry in views) if (entry != null && entry.view == view) return entry.clip;
            return null;
        }
        public void Configure(float cycleDuration, string recipeHash, HumanoidIdleViewClip[] clips)
        { duration = cycleDuration; configurationSha256 = recipeHash; views = clips != null ? (HumanoidIdleViewClip[])clips.Clone() : Array.Empty<HumanoidIdleViewClip>(); }
        public List<string> Validate()
        {
            var errors = new List<string>();
            if (float.IsNaN(duration) || float.IsInfinity(duration) || duration < 3f || duration > 8f)
                errors.Add("Idle duration must be a restrained, finite 3-8 second cycle.");
            var identities = new HashSet<MasterHumanoidView>();
            var clips = new HashSet<AnimationClip>();
            if (views == null || views.Length != 3) { errors.Add("Exactly three authored Idle clips are required, never six mirrored clips."); return errors; }
            foreach (var entry in views)
            {
                if (entry == null || !Enum.IsDefined(typeof(MasterHumanoidView),entry.view) || !identities.Add(entry.view))
                { errors.Add("Idle authored-view identity is invalid or duplicated."); continue; }
                if (entry.clip == null || !clips.Add(entry.clip)) { errors.Add(entry.view + ": missing or duplicated Idle clip."); continue; }
                if (entry.clip.legacy || !entry.clip.isLooping || Mathf.Abs(entry.clip.length-duration) > 0.0001f)
                    errors.Add(entry.view + ": use a non-legacy looping clip with the shared cycle duration.");
                if (entry.clip.events.Length != 0) errors.Add(entry.view + ": Idle has no animation events or gameplay callbacks.");
            }
            return errors;
        }
    }

    public static class HumanoidIdleContract
    {
        static readonly string[] Allowed = { "Spine","Chest","Neck","Head","LeftClavicle","RightClavicle","LeftUpperArm","RightUpperArm" };
        static readonly IReadOnlyList<string> ReadOnlyBones = Array.AsReadOnly(Allowed);
        public static IReadOnlyList<string> AnimatedBones { get { return ReadOnlyBones; } }
        public static bool IsAllowedBone(string name) { return Array.IndexOf(Allowed,name) >= 0; }
    }

    [Serializable]
    public sealed class HumanoidIdleBoneBinding
    {
        public MasterHumanoidView view;
        public string boneName;
        public Transform bone;
        public Quaternion neutralLocalRotation;
    }
}
