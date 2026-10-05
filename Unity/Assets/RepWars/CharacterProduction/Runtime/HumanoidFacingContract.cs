namespace RepWars.CharacterProduction
{
    /// <summary>Presentation intent only. Numeric values are stable; default is FrontLeft.</summary>
    public enum HumanoidFacing
    {
        FrontLeft = 0,
        FrontRight = 1,
        Left = 2,
        Right = 3,
        BackLeft = 4,
        BackRight = 5,
    }

    public readonly struct HumanoidFacingSelection
    {
        public readonly MasterHumanoidView View;
        public readonly bool Mirrored;

        public HumanoidFacingSelection(MasterHumanoidView view, bool mirrored)
        { View = view; Mirrored = mirrored; }
    }

    public static class HumanoidFacingContract
    {
        public static bool TryResolve(HumanoidFacing facing, out HumanoidFacingSelection selection)
        {
            switch (facing)
            {
                case HumanoidFacing.FrontLeft: selection = new HumanoidFacingSelection(MasterHumanoidView.Front, false); return true;
                case HumanoidFacing.FrontRight: selection = new HumanoidFacingSelection(MasterHumanoidView.Front, true); return true;
                case HumanoidFacing.Left: selection = new HumanoidFacingSelection(MasterHumanoidView.Side, false); return true;
                case HumanoidFacing.Right: selection = new HumanoidFacingSelection(MasterHumanoidView.Side, true); return true;
                case HumanoidFacing.BackLeft: selection = new HumanoidFacingSelection(MasterHumanoidView.Back, false); return true;
                case HumanoidFacing.BackRight: selection = new HumanoidFacingSelection(MasterHumanoidView.Back, true); return true;
                default: selection = default(HumanoidFacingSelection); return false;
            }
        }
    }
}
