using UnityEngine;

namespace RepWars.Characters
{
    /// <summary>Everything a backend needs to build a body. Passed once at Initialize.</summary>
    public sealed class CharacterBackendContext
    {
        public Transform ActorRoot;
        public CharacterBaseDefinition Base;
        public RigProfileDefinition Rig;
        public AnimationProfileDefinition Animation;
        public int SortingOrderBase;
        public string SortingLayerName;
    }

    /// <summary>
    /// The one seam between the character system and a particular animation technology.
    /// The actor talks only to this interface. Humanoid skeletal, banana skeletal, segments and flipbooks
    /// all sit behind it in later phases. Only the stub exists in Phase A.
    /// </summary>
    public interface ICharacterAnimationBackend
    {
        CharacterBackendKind Kind { get; }

        /// <summary>Sockets provided by this backend. Valid after Initialize.</summary>
        SocketRegistry Sockets { get; }

        /// <summary>Build the body and sockets. Returns false and fills error when the body cannot be built.</summary>
        bool Initialize(CharacterBackendContext context, out string error);

        /// <summary>Request a locomotion state. Returns false with a reason if the animation profile cannot do it.</summary>
        bool SetLocomotion(LocomotionKind kind, out string error);

        void SetFacing(FacingKind facing);

        /// <summary>Start a one-shot reaction. Returns false with a reason if the animation profile has no such reaction.</summary>
        bool PlayReaction(ReactionKind kind, out string error);

        /// <summary>Tint the base body layers marked receivesTint.</summary>
        void SetTint(Color tint);

        /// <summary>Called every frame by the actor.</summary>
        void Tick(float deltaTime);

        /// <summary>Release everything the backend made.</summary>
        void Teardown();
    }
}
