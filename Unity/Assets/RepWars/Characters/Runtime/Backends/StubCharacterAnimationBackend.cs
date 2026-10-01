using System.Collections.Generic;
using UnityEngine;

namespace RepWars.Characters
{
    /// <summary>
    /// Phase A backend. Draws the base body as flat sprite layers and fakes locomotion and reactions
    /// with simple transform motion so the common API can be seen working. No skeleton, no Animator.
    /// It exists to prove the seam, not to look good.
    /// </summary>
    public sealed class StubCharacterAnimationBackend : ICharacterAnimationBackend
    {
        const float WalkBobHeight = 0.06f;
        const float WalkBobSpeed = 9f;
        const float ReactionDuration = 0.8f;

        readonly SocketRegistry sockets = new SocketRegistry();
        readonly List<SpriteRenderer> tintedLayers = new List<SpriteRenderer>();

        CharacterBackendContext context;
        Transform visualRoot;
        Transform bodyRoot;
        LocomotionKind locomotion = LocomotionKind.None;
        FacingKind facing = FacingKind.Right;

        ReactionKind? activeReaction;
        float reactionTime;
        float walkClock;

        public CharacterBackendKind Kind { get { return CharacterBackendKind.Stub; } }
        public SocketRegistry Sockets { get { return sockets; } }

        /// <summary>Root that is mirrored for facing. Sockets and accessories live below it.</summary>
        public Transform VisualRoot { get { return visualRoot; } }

        public bool Initialize(CharacterBackendContext ctx, out string error)
        {
            if (ctx == null || ctx.ActorRoot == null || ctx.Base == null || ctx.Rig == null)
            {
                error = "Stub backend needs an actor root, a base and a rig profile";
                return false;
            }
            Teardown();
            context = ctx;

            visualRoot = new GameObject("VisualRoot").transform;
            visualRoot.SetParent(ctx.ActorRoot, false);
            bodyRoot = new GameObject("Body").transform;
            bodyRoot.SetParent(visualRoot, false);

            var layers = ctx.Base.intrinsicVisuals;
            if (layers != null)
            {
                foreach (var layer in layers)
                {
                    if (layer == null || layer.sprite == null)
                    {
                        error = "Base '" + ctx.Base.baseId + "' has an intrinsic layer without a sprite";
                        Teardown();
                        return false;
                    }
                    var go = new GameObject(string.IsNullOrEmpty(layer.layerId) ? "Layer" : layer.layerId);
                    go.transform.SetParent(bodyRoot, false);
                    go.transform.localPosition = layer.localPosition;
                    go.transform.localScale = new Vector3(layer.localScale.x, layer.localScale.y, 1f);
                    var renderer = go.AddComponent<SpriteRenderer>();
                    renderer.sprite = layer.sprite;
                    renderer.sortingOrder = ctx.SortingOrderBase + layer.sortingOrder;
                    if (!string.IsNullOrEmpty(ctx.SortingLayerName)) renderer.sortingLayerName = ctx.SortingLayerName;
                    if (layer.receivesTint) tintedLayers.Add(renderer);
                }
            }

            if (ctx.Rig.sockets != null)
            {
                foreach (var socket in ctx.Rig.sockets)
                {
                    if (socket == null || string.IsNullOrEmpty(socket.socketName)) continue;
                    var go = new GameObject("Socket_" + socket.socketName);
                    go.transform.SetParent(bodyRoot, false);
                    go.transform.localPosition = socket.defaultLocalPosition;
                    go.transform.localScale = new Vector3(socket.defaultLocalScale.x, socket.defaultLocalScale.y, 1f);
                    if (!sockets.Register(socket.socketName, go.transform))
                    {
                        error = "Rig '" + ctx.Rig.rigProfileId + "' declares socket '" + socket.socketName + "' more than once";
                        Teardown();
                        return false;
                    }
                }
            }

            locomotion = LocomotionKind.None;
            SetFacing(FacingKind.Right);
            error = null;
            return true;
        }

        public bool SetLocomotion(LocomotionKind kind, out string error)
        {
            if (context == null)
            {
                error = "Stub backend is not initialized";
                return false;
            }
            if (context.Animation == null || !context.Animation.TryGetLocomotionClip(kind, out _))
            {
                var profile = context.Animation != null ? context.Animation.animationProfileId : "(none)";
                error = "Animation profile '" + profile + "' has no locomotion binding for " + kind;
                return false;
            }
            locomotion = kind;
            // Choosing a locomotion state stands a defeated character back up.
            if (activeReaction == ReactionKind.Defeat) activeReaction = null;
            error = null;
            return true;
        }

        public void SetFacing(FacingKind newFacing)
        {
            facing = newFacing;
            if (visualRoot != null)
            {
                visualRoot.localScale = new Vector3(facing == FacingKind.Left ? -1f : 1f, 1f, 1f);
            }
        }

        public bool PlayReaction(ReactionKind kind, out string error)
        {
            if (context == null)
            {
                error = "Stub backend is not initialized";
                return false;
            }
            if (context.Animation == null || !context.Animation.TryGetReactionClip(kind, out _))
            {
                var profile = context.Animation != null ? context.Animation.animationProfileId : "(none)";
                error = "Animation profile '" + profile + "' has no reaction binding for " + kind;
                return false;
            }
            activeReaction = kind;
            reactionTime = 0f;
            error = null;
            return true;
        }

        public void SetTint(Color tint)
        {
            foreach (var renderer in tintedLayers)
            {
                if (renderer != null) renderer.color = tint;
            }
        }

        public void Tick(float deltaTime)
        {
            if (bodyRoot == null) return;

            var offset = Vector3.zero;
            var rotation = 0f;

            if (locomotion == LocomotionKind.Walk)
            {
                walkClock += deltaTime * WalkBobSpeed;
                offset.y += Mathf.Abs(Mathf.Sin(walkClock)) * WalkBobHeight;
            }

            if (activeReaction.HasValue)
            {
                reactionTime += deltaTime;
                var t = Mathf.Clamp01(reactionTime / ReactionDuration);
                if (activeReaction.Value == ReactionKind.Celebrate)
                {
                    offset.y += Mathf.Abs(Mathf.Sin(t * Mathf.PI * 2f)) * 0.25f;
                }
                else
                {
                    // Defeat: tip over toward the back and stay down.
                    rotation = Mathf.SmoothStep(0f, 80f, t);
                }
                if (t >= 1f && activeReaction.Value == ReactionKind.Celebrate) activeReaction = null;
            }

            bodyRoot.localPosition = offset;
            bodyRoot.localRotation = Quaternion.Euler(0f, 0f, rotation);
        }

        public void Teardown()
        {
            sockets.Clear();
            tintedLayers.Clear();
            activeReaction = null;
            if (visualRoot != null)
            {
                if (Application.isPlaying) Object.Destroy(visualRoot.gameObject);
                else Object.DestroyImmediate(visualRoot.gameObject);
            }
            visualRoot = null;
            bodyRoot = null;
            context = null;
        }
    }
}
