using System;

namespace RepWars.Environment.Effects
{
    /// <summary>Serializable bounded min/max pair with fail-safe sanitising.</summary>
    [Serializable]
    public struct FloatRange
    {
        public float min;
        public float max;

        public FloatRange(float min, float max) { this.min = min; this.max = max; }

        public bool IsValid => !float.IsNaN(min) && !float.IsNaN(max) && !float.IsInfinity(min) && !float.IsInfinity(max) && min <= max;

        public float Clamp(float v) { return v < min ? min : (v > max ? max : v); }

        public float Lerp(float t) { return min + (max - min) * t; }

        /// <summary>
        /// Returns a range that is finite, ordered, and inside [floor, ceiling].
        /// changed is true if anything had to be corrected, so the caller can log once.
        /// </summary>
        public FloatRange Sanitized(float floor, float ceiling, out bool changed)
        {
            changed = false;
            float a = min, b = max;
            if (float.IsNaN(a) || float.IsInfinity(a)) { a = floor; changed = true; }
            if (float.IsNaN(b) || float.IsInfinity(b)) { b = a; changed = true; }
            if (a > b) { var t = a; a = b; b = t; changed = true; }
            if (a < floor) { a = floor; changed = true; }
            if (b > ceiling) { b = ceiling; changed = true; }
            if (a > ceiling) { a = ceiling; changed = true; }
            if (b < floor) { b = floor; changed = true; }
            return new FloatRange(a, b);
        }

        public override string ToString() { return "[" + min + ", " + max + "]"; }
    }

    /// <summary>Scalar clamp helpers that report whether a correction occurred.</summary>
    public static class EffectClamp
    {
        public static float Clamp(float value, float floor, float ceiling, ref bool changed)
        {
            if (float.IsNaN(value) || float.IsInfinity(value)) { changed = true; return floor; }
            if (value < floor) { changed = true; return floor; }
            if (value > ceiling) { changed = true; return ceiling; }
            return value;
        }

        public static int Clamp(int value, int floor, int ceiling, ref bool changed)
        {
            if (value < floor) { changed = true; return floor; }
            if (value > ceiling) { changed = true; return ceiling; }
            return value;
        }

        public static FloatRange Clamp(FloatRange range, float floor, float ceiling, ref bool changed)
        {
            bool c;
            var r = range.Sanitized(floor, ceiling, out c);
            changed |= c;
            return r;
        }
    }
}
