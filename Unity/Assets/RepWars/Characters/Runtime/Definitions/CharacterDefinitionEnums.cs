namespace RepWars.Characters
{
    /// <summary>
    /// How much rig and animation a base can share with others.
    /// The tier describes reuse, not a required skeleton. Every tier is driven through the same presenter API.
    /// </summary>
    public enum CompatibilityTier
    {
        /// <summary>T0. Shared humanoid rig family (human male, human female, generic soldier and emperor).</summary>
        T0SharedHumanoid = 0,

        /// <summary>T1. Non-human rig family with its own short skeleton (banana, mushroom).</summary>
        T1NonHumanRigFamily = 1,

        /// <summary>T2. Mechanical or segmented bodies (robot, toy soldier). Not implemented in Phase A.</summary>
        T2Mechanical = 2,

        /// <summary>T3. Specialty bodies (chicken, frog). Not implemented in Phase A.</summary>
        T3Specialty = 3,
    }

    /// <summary>
    /// Which animation/presentation backend a base uses.
    /// Only Stub exists in Phase A. The other kinds are reserved names for later phases.
    /// </summary>
    public enum CharacterBackendKind
    {
        Stub = 0,
        HumanoidSkeletal = 1,
        CustomSkeletal = 2,
        SegmentRigid = 3,
        Flipbook = 4,
    }

    /// <summary>Whether a variant follows the requested facing or ignores it (front-facing art, portraits).</summary>
    public enum FacingPolicy
    {
        Mirror = 0,
        Ignore = 1,
    }
}
