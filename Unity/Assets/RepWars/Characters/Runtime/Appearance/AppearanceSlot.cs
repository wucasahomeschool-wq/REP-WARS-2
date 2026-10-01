using System;
using UnityEngine;

namespace RepWars.Characters
{
    /// <summary>What part of the character a binding dresses. A slot is meaning. The socket is where it attaches.</summary>
    public enum AppearanceSlot
    {
        Headwear = 0,
        Torso = 1,
        Back = 2,
        Belt = 3,
        Cape = 4,
    }

    /// <summary>
    /// How a binding reaches the screen. Each slot chooses the simplest mechanism that fits the asset.
    /// </summary>
    public enum AppearanceMechanism
    {
        /// <summary>Swap a category/label in a Sprite Library. Not implemented until a skeletal phase needs it.</summary>
        SpriteLibraryCategory = 0,

        /// <summary>Instantiate a prefab under a socket (rigid props such as a backpack). Implemented in Phase A.</summary>
        SocketPrefab = 1,

        /// <summary>Place one sprite under a socket (rigid hats, belts). Implemented in Phase A.</summary>
        SocketSprite = 2,

        /// <summary>Sprite that follows or deforms with bones (capes, coats). Not implemented until a skeletal phase.</summary>
        SkinnedOverlay = 3,
    }

    /// <summary>One entry of an AppearanceDefinition. Only the fields for the chosen mechanism are read.</summary>
    [Serializable]
    public class AppearanceSlotBinding
    {
        public AppearanceSlot slot;
        public AppearanceMechanism mechanism = AppearanceMechanism.SocketSprite;

        /// <summary>Socket to attach to (SocketSprite, SocketPrefab). Not used by library and skinned mechanisms.</summary>
        public string socketName;

        public Sprite sprite;
        public GameObject prefab;

        /// <summary>SpriteLibraryCategory only. Stored as text so Phase A does not depend on the 2D Animation assembly.</summary>
        public string libraryCategory;
        public string libraryLabel;

        /// <summary>Per-appearance offset from the socket. Lets one kit sit correctly on different bodies.</summary>
        public Vector2 localOffset;
        public Vector2 localScale = Vector2.one;
        public int sortingOrder;

        /// <summary>True when the faction tint should multiply this accessory.</summary>
        public bool receivesTint;

        public bool UsesSocket
        {
            get { return mechanism == AppearanceMechanism.SocketSprite || mechanism == AppearanceMechanism.SocketPrefab; }
        }
    }
}
