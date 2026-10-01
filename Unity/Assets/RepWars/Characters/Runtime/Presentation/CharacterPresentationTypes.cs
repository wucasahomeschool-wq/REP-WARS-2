namespace RepWars.Characters
{
    /// <summary>What a character is doing while moving or standing. Gameplay asks for this, never for a clip.</summary>
    public enum LocomotionKind
    {
        None = 0,
        Idle = 1,
        Walk = 2,
    }

    /// <summary>One-shot expressive reactions.</summary>
    public enum ReactionKind
    {
        Celebrate = 0,
        Defeat = 1,
    }

    /// <summary>Which way the character looks on screen.</summary>
    public enum FacingKind
    {
        Right = 0,
        Left = 1,
    }
}
