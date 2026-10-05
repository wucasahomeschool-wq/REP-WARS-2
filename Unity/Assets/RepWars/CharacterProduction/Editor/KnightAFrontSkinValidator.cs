using System.Collections.Generic;

namespace RepWars.CharacterProduction.EditorTools
{
    public static class KnightAFrontSkinValidator
    {
        public static List<string> Validate(KnightAFrontSkin skin, KnightASkinConfiguration config)
        { return KnightASkinValidator.Validate(skin, config); }
    }
}
