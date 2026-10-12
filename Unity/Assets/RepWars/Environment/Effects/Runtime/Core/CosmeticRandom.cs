using System;

namespace RepWars.Environment.Effects
{
    /// <summary>
    /// Cosmetic-only random source. Wraps System.Random so seeded mode is deterministic and never
    /// touches UnityEngine.Random global state. Never use this for gameplay decisions.
    /// </summary>
    public sealed class CosmeticRandom
    {
        static int s_unseededCounter;
        readonly Random _random;

        public bool IsSeeded { get; }
        public int Seed { get; }

        /// <summary>Unseeded: distinct per instance, not reproducible.</summary>
        public CosmeticRandom()
        {
            Seed = unchecked(System.Environment.TickCount * 31 + ++s_unseededCounter * 7919);
            IsSeeded = false;
            _random = new Random(Seed);
        }

        /// <summary>Seeded: identical seed gives an identical sequence.</summary>
        public CosmeticRandom(int seed)
        {
            Seed = seed;
            IsSeeded = true;
            _random = new Random(seed);
        }

        public static CosmeticRandom Create(bool useSeed, int seed)
        {
            return useSeed ? new CosmeticRandom(seed) : new CosmeticRandom();
        }

        /// <summary>[0,1)</summary>
        public float Value() { return (float)_random.NextDouble(); }

        /// <summary>Inclusive min, exclusive max. Returns min when max &lt;= min.</summary>
        public int Range(int minInclusive, int maxExclusive)
        {
            return maxExclusive <= minInclusive ? minInclusive : _random.Next(minInclusive, maxExclusive);
        }

        public float Range(float min, float max)
        {
            if (max < min) { var t = min; min = max; max = t; }
            return min + (max - min) * Value();
        }

        public float Range(FloatRange range) { return Range(range.min, range.max); }

        /// <summary>Symmetric jitter in [-amount, amount].</summary>
        public float Signed(float amount) { return (Value() * 2f - 1f) * amount; }

        public bool Chance(float probability01) { return Value() < probability01; }
    }
}
