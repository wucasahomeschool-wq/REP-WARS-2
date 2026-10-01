using UnityEngine;

namespace RepWars.Characters
{
    /// <summary>
    /// The only surface gameplay code uses to drive a character.
    /// It is identical for every rig family. Callers never see SpriteRenderers, SpriteSkin, Animators or bones.
    /// Methods that can fail return false and explain why through an error string and LastError.
    /// A rejected id is that return value. Unexpected runtime or configuration failures are also logged.
    /// </summary>
    public interface IRepWarsCharacterPresenter
    {
        string VariantId { get; }
        string BaseId { get; }
        string AppearanceId { get; }

        /// <summary>Root transform for placing the character in the world.</summary>
        Transform Transform { get; }

        LocomotionKind Locomotion { get; }
        FacingKind Facing { get; }
        Color Tint { get; }

        /// <summary>Most recent failure message from any call on this presenter. Null after a success.</summary>
        string LastError { get; }

        /// <summary>Switch to another variant (a different base, appearance, or both). On failure nothing changes.</summary>
        bool TrySetVariant(string variantId, out string error);

        /// <summary>Change only the appearance while keeping the base. On failure nothing changes.</summary>
        bool TrySetAppearance(string appearanceId, out string error);

        bool SetLocomotion(LocomotionKind kind);
        void SetFacing(FacingKind facing);
        bool PlayReaction(ReactionKind kind);
        void SetTint(Color tint);

        /// <summary>Destroy the character.</summary>
        void Release();
    }
}
