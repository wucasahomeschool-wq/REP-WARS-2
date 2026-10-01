using System;
using UnityEngine;

namespace RepWars.Characters
{
    [Serializable]
    public class LocomotionBinding
    {
        public LocomotionKind kind;

        /// <summary>Backend-specific key for a future clip or frame set. The Phase A stub ignores it.</summary>
        public string clipId;
    }

    [Serializable]
    public class ReactionBinding
    {
        public ReactionKind kind;

        /// <summary>Backend-specific key for a future clip or frame set. The Phase A stub ignores it.</summary>
        public string clipId;
    }

    /// <summary>
    /// Maps the shared locomotion and reaction vocabulary to one rig family's own animation content.
    /// Humanoid and banana profiles are separate assets. They share the vocabulary, not the clips.
    /// </summary>
    [CreateAssetMenu(fileName = "animation_profile", menuName = "RepWars/Characters/Animation Profile")]
    public class AnimationProfileDefinition : ScriptableObject
    {
        public string animationProfileId;
        public LocomotionBinding[] locomotion = Array.Empty<LocomotionBinding>();
        public ReactionBinding[] reactions = Array.Empty<ReactionBinding>();

        public bool TryGetLocomotionClip(LocomotionKind kind, out string clipId)
        {
            clipId = null;
            if (locomotion == null) return false;
            foreach (var binding in locomotion)
            {
                if (binding == null || binding.kind != kind) continue;
                clipId = binding.clipId;
                return true;
            }
            return false;
        }

        public bool TryGetReactionClip(ReactionKind kind, out string clipId)
        {
            clipId = null;
            if (reactions == null) return false;
            foreach (var binding in reactions)
            {
                if (binding == null || binding.kind != kind) continue;
                clipId = binding.clipId;
                return true;
            }
            return false;
        }
    }
}
