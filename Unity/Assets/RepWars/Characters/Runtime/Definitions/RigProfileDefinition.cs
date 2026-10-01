using System;
using System.Collections.Generic;
using UnityEngine;

namespace RepWars.Characters
{
    /// <summary>
    /// One named attachment point on a rig. Appearance bindings ask for a socket by name.
    /// </summary>
    [Serializable]
    public class RigSocketDefinition
    {
        public string socketName;

        /// <summary>Placeholder position in base-local units, feet at the origin. Used by the Phase A stub backend.</summary>
        public Vector2 defaultLocalPosition;

        /// <summary>Scale applied to everything attached here. Lets one appearance fit a narrower or wider body.</summary>
        public Vector2 defaultLocalScale = Vector2.one;

        /// <summary>Bone the socket follows once a skeletal backend exists (Phase B and later). Unused in Phase A.</summary>
        public string bonePath;
    }

    /// <summary>
    /// A rig family such as humanoid_v1 or banana_v1. Different families may have completely different sockets and bones.
    /// Phase A stores the data only. It does not build a skeleton.
    /// </summary>
    [CreateAssetMenu(fileName = "rig_profile", menuName = "RepWars/Characters/Rig Profile")]
    public class RigProfileDefinition : ScriptableObject
    {
        public string rigProfileId;
        public CompatibilityTier compatibilityTier;
        public RigSocketDefinition[] sockets = Array.Empty<RigSocketDefinition>();

        /// <summary>Animation profiles this rig family can play. Bases must use one of these.</summary>
        public string[] supportedAnimationProfileIds = Array.Empty<string>();

        /// <summary>Future skeleton prefab for skeletal backends. Empty in Phase A.</summary>
        public GameObject skeletonPrefab;

        public IEnumerable<string> SocketNames
        {
            get
            {
                if (sockets == null) yield break;
                foreach (var socket in sockets)
                {
                    if (socket != null && !string.IsNullOrEmpty(socket.socketName)) yield return socket.socketName;
                }
            }
        }

        public bool HasSocket(string socketName)
        {
            if (sockets == null || string.IsNullOrEmpty(socketName)) return false;
            foreach (var socket in sockets)
            {
                if (socket != null && socket.socketName == socketName) return true;
            }
            return false;
        }

        public bool SupportsAnimationProfile(string animationProfileId)
        {
            if (supportedAnimationProfileIds == null || string.IsNullOrEmpty(animationProfileId)) return false;
            return Array.IndexOf(supportedAnimationProfileIds, animationProfileId) >= 0;
        }
    }
}
