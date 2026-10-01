using UnityEngine;

namespace RepWars.Characters
{
    /// <summary>
    /// Common runtime root for every character. Owns one animation backend (chosen from the base definition)
    /// and one appearance composer, and exposes them through IRepWarsCharacterPresenter.
    /// This class contains no humanoid or banana specific logic. Everything body-specific lives behind the backend.
    /// </summary>
    public sealed class RepWarsCharacterActor : MonoBehaviour, IRepWarsCharacterPresenter
    {
        const string LogPrefix = "[RepWarsCharacters] ";

        RepWarsCharacterCatalog catalog;
        ResolvedCharacterVariant current;
        ICharacterAnimationBackend backend;
        AppearanceComposer composer = new AppearanceComposer();

        int sortingOrderBase;
        string sortingLayerName;

        LocomotionKind locomotion = LocomotionKind.None;
        FacingKind facing = FacingKind.Right;
        Color requestedTint = Color.white;

        public string VariantId { get { return current != null ? current.Variant.variantId : null; } }
        public string BaseId { get { return current != null ? current.Base.baseId : null; } }
        public string AppearanceId { get { return composer.AppliedAppearanceId; } }
        public Transform Transform { get { return transform; } }
        public LocomotionKind Locomotion { get { return locomotion; } }
        public FacingKind Facing { get { return facing; } }
        public Color Tint { get { return requestedTint; } }
        public string LastError { get; private set; }

        /// <summary>Backend kind in use. Read only diagnostic for tools and tests.</summary>
        public CharacterBackendKind BackendKind { get { return backend != null ? backend.Kind : CharacterBackendKind.Stub; } }

        /// <summary>Sockets on the live body. Read only diagnostic for tools and tests.</summary>
        public SocketRegistry Sockets { get { return backend != null ? backend.Sockets : null; } }

        /// <summary>Called once by the spawner. Builds the body and dresses it.</summary>
        public bool Initialize(
            RepWarsCharacterCatalog owningCatalog,
            ResolvedCharacterVariant resolved,
            int sortingBase,
            string sortingLayer,
            out string error)
        {
            catalog = owningCatalog;
            sortingOrderBase = sortingBase;
            sortingLayerName = sortingLayer;
            return Build(resolved, out error);
        }

        public bool TrySetVariant(string variantId, out string error)
        {
            if (catalog == null) return Fail("Actor is not initialized", out error);
            if (!catalog.TryResolveVariant(variantId, out var resolved, out var resolveError)) return Reject(resolveError, out error);
            return Build(resolved, out error);
        }

        public bool TrySetAppearance(string appearanceId, out string error)
        {
            if (current == null || catalog == null) return Fail("Actor is not initialized", out error);
            if (!catalog.TryResolveAppearanceFor(appearanceId, current.Rig, out var appearance, out var resolveError))
            {
                return Reject(resolveError, out error);
            }

            var result = composer.Apply(appearance, backend.Sockets, sortingOrderBase, sortingLayerName, EffectiveTint());
            if (!result.Success) return Fail(result.Error, out error);

            current = new ResolvedCharacterVariant
            {
                Variant = current.Variant,
                Base = current.Base,
                Appearance = appearance,
                Rig = current.Rig,
                Animation = current.Animation,
            };
            ReportSkipped(result);
            return Succeed(out error);
        }

        public bool SetLocomotion(LocomotionKind kind)
        {
            if (backend == null) return Fail("Actor is not initialized", out _);
            if (!backend.SetLocomotion(kind, out var error)) return Fail(error, out _);
            locomotion = kind;
            LastError = null;
            return true;
        }

        public void SetFacing(FacingKind newFacing)
        {
            facing = newFacing;
            ApplyFacing();
        }

        public bool PlayReaction(ReactionKind kind)
        {
            if (backend == null) return Fail("Actor is not initialized", out _);
            if (!backend.PlayReaction(kind, out var error)) return Fail(error, out _);
            LastError = null;
            return true;
        }

        public void SetTint(Color tint)
        {
            requestedTint = tint;
            ApplyTint();
        }

        public void Release()
        {
            TeardownBackend();
            if (this == null) return;
            if (Application.isPlaying) Destroy(gameObject);
            else DestroyImmediate(gameObject);
        }

        void Update()
        {
            if (backend != null) backend.Tick(Time.deltaTime);
        }

        void OnDestroy()
        {
            TeardownBackend();
        }

        // Builds the new body first. The old one is only replaced once the new one is fully working.
        bool Build(ResolvedCharacterVariant resolved, out string error)
        {
            if (resolved == null) return Fail("No resolved variant to build", out error);

            if (!CharacterBackendRegistry.TryCreate(resolved.Base.backendKind, out var newBackend, out var backendError))
            {
                return Fail("Base '" + resolved.Base.baseId + "': " + backendError, out error);
            }

            var context = new CharacterBackendContext
            {
                ActorRoot = transform,
                Base = resolved.Base,
                Rig = resolved.Rig,
                Animation = resolved.Animation,
                SortingOrderBase = sortingOrderBase,
                SortingLayerName = sortingLayerName,
            };
            if (!newBackend.Initialize(context, out var initError))
            {
                return Fail("Base '" + resolved.Base.baseId + "' failed to initialize: " + initError, out error);
            }

            var overrides = resolved.Variant.visualOverrides ?? new VariantVisualOverrides();
            var newComposer = new AppearanceComposer();
            var tint = requestedTint * overrides.tint;
            var applied = newComposer.Apply(resolved.Appearance, newBackend.Sockets, sortingOrderBase, sortingLayerName, tint);
            if (!applied.Success)
            {
                newBackend.Teardown();
                return Fail("Variant '" + resolved.Variant.variantId + "': " + applied.Error, out error);
            }

            // Success. Swap.
            TeardownBackend();
            backend = newBackend;
            composer = newComposer;
            current = resolved;
            transform.localScale = Vector3.one * (resolved.Base.defaultScale * Mathf.Max(0.0001f, overrides.scaleMultiplier));

            ApplyFacing();
            ApplyTint();
            if (locomotion != LocomotionKind.None && !backend.SetLocomotion(locomotion, out var locomotionError))
            {
                Debug.LogWarning(LogPrefix + "Variant '" + resolved.Variant.variantId + "' cannot keep locomotion " + locomotion + ": " + locomotionError);
                locomotion = LocomotionKind.None;
            }

            ReportSkipped(applied);
            return Succeed(out error);
        }

        void ApplyFacing()
        {
            if (backend == null || current == null) return;
            var policy = current.Variant.visualOverrides != null ? current.Variant.visualOverrides.facingPolicy : FacingPolicy.Mirror;
            backend.SetFacing(policy == FacingPolicy.Ignore ? FacingKind.Right : facing);
        }

        void ApplyTint()
        {
            if (backend == null) return;
            var tint = EffectiveTint();
            backend.SetTint(tint);
            composer.SetTint(tint);
        }

        Color EffectiveTint()
        {
            var overrides = current != null ? current.Variant.visualOverrides : null;
            return overrides != null ? requestedTint * overrides.tint : requestedTint;
        }

        void TeardownBackend()
        {
            composer.Clear();
            if (backend != null) backend.Teardown();
            backend = null;
        }

        void ReportSkipped(AppearanceApplyResult result)
        {
            foreach (var skipped in result.Skipped) Debug.LogWarning(LogPrefix + skipped);
        }

        bool Succeed(out string error)
        {
            LastError = null;
            error = null;
            return true;
        }

        /// <summary>
        /// The caller asked for an id the catalog rejects. The failure is the return value.
        /// It is not logged, so a negative test can inspect it without a console error.
        /// </summary>
        bool Reject(string message, out string error)
        {
            LastError = message;
            error = message;
            return false;
        }

        /// <summary>Something that should have worked did not: missing backend, broken body, uninitialized actor.</summary>
        bool Fail(string message, out string error)
        {
            LastError = message;
            error = message;
            Debug.LogError(LogPrefix + message, this);
            return false;
        }
    }
}
