using UnityEngine;

namespace RepWars.CharacterProduction
{
    /// <summary>CPU reference for tests only; rendering uses the matching shader, never runtime pixel processing.</summary>
    public static class IllustratedTeamColorMath
    {
        public static float Luminance(Color linear)
        { return linear.r * 0.2126f + linear.g * 0.7152f + linear.b * 0.0722f; }

        public static Color RecolorLinear(Color original, Color team, float mask, bool enabled)
        {
            if (!enabled || mask <= 0f) return original;
            var value = Mathf.Clamp01(Luminance(original));
            var teamValue = Luminance(team);
            // Maximal in-gamut chroma at the authored luminance; highlights become naturally lighter.
            var amplitude = Mathf.Min(value / Mathf.Max(teamValue, 0.00001f),
                (1f - value) / Mathf.Max(1f - teamValue, 0.00001f));
            var target = new Color(value + (team.r - teamValue) * amplitude,
                value + (team.g - teamValue) * amplitude, value + (team.b - teamValue) * amplitude, original.a);
            return Color.LerpUnclamped(original, target, Mathf.Clamp01(mask));
        }
    }
}
