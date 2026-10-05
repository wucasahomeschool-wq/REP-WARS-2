using System.Collections.Generic;
using UnityEngine;

namespace RepWars.CharacterProduction.EditorTools
{
    public static class KnightASkinValidator
    {
        public static List<string> Validate(KnightASkin skin, KnightASkinConfiguration config, bool isolatedViewProof = true, Animator allowedIdleAnimator = null)
        { return HumanoidSkinValidator.Validate(skin, config, isolatedViewProof, allowedIdleAnimator); }
    }
}
