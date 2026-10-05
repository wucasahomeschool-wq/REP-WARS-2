using System;
using UnityEngine;

namespace RepWars.CharacterProduction
{
    /// <summary>Chooses one authored view and mirrors VisualRoot only. Does not move, animate, or query gameplay.</summary>
    [DisallowMultipleComponent]
    public sealed class HumanoidFacingPresentation : MonoBehaviour
    {
        [SerializeField] MasterHumanoidRig rig;
        [SerializeField] HumanoidFacing facing = HumanoidFacing.FrontLeft;
        [SerializeField] Vector3 unmirroredVisualScale = Vector3.one;

        public MasterHumanoidRig Rig { get { return rig; } }
        public HumanoidFacing Facing { get { return facing; } }
        public Vector3 UnmirroredVisualScale { get { return unmirroredVisualScale; } }
        /// <summary>Optional presentation notification after view selection and mirroring are applied.</summary>
        public event Action<HumanoidFacing> FacingChanged;

        public bool Configure(MasterHumanoidRig newRig, HumanoidFacing initialFacing, out string error)
        {
            HumanoidFacingSelection selection;
            if (!HumanoidFacingContract.TryResolve(initialFacing, out selection))
            { error = "Initial facing must be one of the six HumanoidFacing values."; return false; }
            if (!HasSafeHierarchy(newRig))
            { error = "Facing presentation requires its own rig, a child VisualRoot, and three distinct authored views with SkinMount."; return false; }
            var scale = newRig.VisualRoot.localScale;
            scale.x = Mathf.Abs(scale.x);
            if (!HasValidScale(scale))
            { error = "VisualRoot scale must have finite, nonzero X and positive Y/Z."; return false; }
            rig = newRig;
            unmirroredVisualScale = scale;
            Apply(selection);
            facing = initialFacing;
            FacingChanged?.Invoke(facing);
            error = null;
            return true;
        }

        /// <summary>Invalid intent or broken references leave the last valid state unchanged.</summary>
        public bool TrySetFacing(HumanoidFacing intent)
        {
            HumanoidFacingSelection selection;
            if (!HumanoidFacingContract.TryResolve(intent, out selection) || !HasSafeHierarchy(rig) || !HasValidScale(unmirroredVisualScale))
                return false;
            Apply(selection);
            facing = intent;
            FacingChanged?.Invoke(facing);
            return true;
        }

        /// <summary>A stationary caller supplies no new intent; null preserves the previous facing.</summary>
        public bool TryApplyFacingIntent(HumanoidFacing? intent)
        { return intent.HasValue && TrySetFacing(intent.Value); }

        public Transform GetActiveSocket(MasterHumanoidSocket socket)
        {
            HumanoidFacingSelection selection;
            return rig != null && HumanoidFacingContract.TryResolve(facing, out selection)
                ? rig.FindSocket(selection.View, socket) : null;
        }

        void OnEnable()
        { TryApplyStoredFacing(); }

        /// <summary>Reapplies serialized state on enable/load; a corrupt stored enum uses FrontLeft if the rig is valid.</summary>
        public bool TryApplyStoredFacing()
        {
            // A corrupt serialized initial enum gets a documented safe startup default.
            // Runtime invalid requests are rejected, rather than changing the established facing.
            HumanoidFacingSelection selection;
            var stored = HumanoidFacingContract.TryResolve(facing, out selection) ? facing : HumanoidFacing.FrontLeft;
            return TrySetFacing(stored);
        }

        void Apply(HumanoidFacingSelection selection)
        {
            // Disable the other branches first; never enable a second authored view.
            for (var i = 0; i < 3; i++)
            {
                var view = (MasterHumanoidView)i;
                if (view != selection.View) rig.GetViewRoot(view).gameObject.SetActive(false);
            }
            var scale = unmirroredVisualScale;
            scale.x = selection.Mirrored ? -scale.x : scale.x;
            rig.VisualRoot.localScale = scale;
            rig.GetViewRoot(selection.View).gameObject.SetActive(true);
        }

        bool HasSafeHierarchy(MasterHumanoidRig candidate)
        {
            if (candidate == null || candidate.gameObject != gameObject || candidate.VisualRoot == null ||
                candidate.VisualRoot.parent != transform) return false;
            var front = candidate.GetViewRoot(MasterHumanoidView.Front);
            var side = candidate.GetViewRoot(MasterHumanoidView.Side);
            var back = candidate.GetViewRoot(MasterHumanoidView.Back);
            if (front == null || side == null || back == null || front == side || front == back || side == back) return false;
            if (front.name != "View_Front" || side.name != "View_Side" || back.name != "View_Back") return false;
            foreach (var view in new[] { front, side, back })
                if (view.parent != candidate.VisualRoot || view.Find("SkinMount") == null) return false;
            return true;
        }

        internal static bool HasValidScale(Vector3 scale)
        {
            return FinitePositive(scale.x) && FinitePositive(scale.y) && FinitePositive(scale.z);
        }

        static bool FinitePositive(float value)
        { return !float.IsNaN(value) && !float.IsInfinity(value) && value > 0f; }
    }
}
