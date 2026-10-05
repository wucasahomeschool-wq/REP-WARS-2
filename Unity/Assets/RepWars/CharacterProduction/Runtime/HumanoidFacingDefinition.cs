using System;
using UnityEngine;

namespace RepWars.CharacterProduction
{
    /// <summary>Per-authored-view handedness only. Default/all-false preserves the accepted Knight A mapping.
    /// Each pair still selects its canonical view; one value copy owns the three mirror reversals.</summary>
    [Serializable]
    public struct HumanoidFacingDefinition
    {
        [SerializeField] bool frontLeftMirrored;
        [SerializeField] bool leftMirrored;
        [SerializeField] bool backLeftMirrored;

        public bool FrontLeftMirrored { get { return frontLeftMirrored; } }
        public bool LeftMirrored { get { return leftMirrored; } }
        public bool BackLeftMirrored { get { return backLeftMirrored; } }

        public HumanoidFacingDefinition(bool frontLeftMirrored, bool leftMirrored, bool backLeftMirrored)
        { this.frontLeftMirrored = frontLeftMirrored; this.leftMirrored = leftMirrored; this.backLeftMirrored = backLeftMirrored; }

        public bool TryResolve(HumanoidFacing facing, out HumanoidFacingSelection selection)
        {
            HumanoidFacingSelection canonical;
            if (!HumanoidFacingContract.TryResolve(facing, out canonical))
            { selection = default(HumanoidFacingSelection); return false; }
            var reverse = canonical.View == MasterHumanoidView.Front ? frontLeftMirrored :
                canonical.View == MasterHumanoidView.Side ? leftMirrored : backLeftMirrored;
            selection = new HumanoidFacingSelection(canonical.View, canonical.Mirrored ^ reverse);
            return true;
        }
    }
}
