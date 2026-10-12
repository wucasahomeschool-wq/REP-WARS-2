using System.Collections.Generic;
using NUnit.Framework;

namespace RepWars.Environment.Effects.Tests
{
    public class FramePickerTests
    {
        [Test]
        public void NeverRepeatsImmediately()
        {
            var p = new FramePicker(new CosmeticRandom(7), 6);
            int prev = p.Next();
            for (int i = 0; i < 5000; i++)
            {
                int n = p.Next();
                Assert.AreNotEqual(prev, n);
                Assert.That(n, Is.InRange(0, 5));
                prev = n;
            }
        }

        [Test]
        public void TwoFramesAlternate()
        {
            var p = new FramePicker(new CosmeticRandom(1), 2);
            int prev = p.Next();
            for (int i = 0; i < 100; i++) { int n = p.Next(); Assert.AreEqual(1 - prev, n); prev = n; }
        }

        [Test]
        public void EveryFrameIsEventuallyUsed()
        {
            var p = new FramePicker(new CosmeticRandom(3), 6);
            var seen = new HashSet<int>();
            for (int i = 0; i < 500; i++) seen.Add(p.Next());
            Assert.AreEqual(6, seen.Count);
        }

        [Test]
        public void SingleFrameAlwaysZero()
        {
            var p = new FramePicker(new CosmeticRandom(1), 1);
            for (int i = 0; i < 10; i++) Assert.AreEqual(0, p.Next());
        }

        [Test]
        public void EmptyListReturnsMinusOne()
        {
            var p = new FramePicker(new CosmeticRandom(1), 0);
            Assert.AreEqual(-1, p.Next());
            p = new FramePicker(new CosmeticRandom(1), -4);
            Assert.AreEqual(-1, p.Next());
        }

        [Test]
        public void SeededSequencesAreDeterministic()
        {
            var a = new FramePicker(new CosmeticRandom(42), 6);
            var b = new FramePicker(new CosmeticRandom(42), 6);
            for (int i = 0; i < 200; i++) Assert.AreEqual(a.Next(), b.Next());
        }

        [Test]
        public void ShrinkingFrameCountKeepsIndexValid()
        {
            var p = new FramePicker(new CosmeticRandom(5), 6);
            for (int i = 0; i < 20; i++) p.Next();
            p.SetFrameCount(2);
            for (int i = 0; i < 20; i++) Assert.That(p.Next(), Is.InRange(0, 1));
        }
    }

    public class CosmeticRandomTests
    {
        [Test]
        public void SameSeedSameValues()
        {
            var a = new CosmeticRandom(99); var b = new CosmeticRandom(99);
            for (int i = 0; i < 100; i++) Assert.AreEqual(a.Range(0f, 10f), b.Range(0f, 10f));
        }

        [Test]
        public void RangeStaysInBoundsAndHandlesReversed()
        {
            var r = new CosmeticRandom(1);
            for (int i = 0; i < 1000; i++)
            {
                float v = r.Range(5f, 2f);
                Assert.That(v, Is.InRange(2f, 5f));
                Assert.AreEqual(3, r.Range(3, 3));
            }
        }
    }

    public class ClampTests
    {
        [Test]
        public void ReversedRangeIsOrdered()
        {
            bool c;
            var r = new FloatRange(0.9f, 0.1f).Sanitized(0f, 1f, out c);
            Assert.IsTrue(c);
            Assert.AreEqual(0.1f, r.min); Assert.AreEqual(0.9f, r.max);
        }

        [Test]
        public void NaNAndInfinityAreReplaced()
        {
            bool c;
            var r = new FloatRange(float.NaN, float.PositiveInfinity).Sanitized(0f, 1f, out c);
            Assert.IsTrue(c);
            Assert.IsTrue(r.IsValid);
            Assert.That(r.min, Is.InRange(0f, 1f));
        }

        [Test]
        public void ValidRangeUnchanged()
        {
            bool c;
            var r = new FloatRange(0.2f, 0.4f).Sanitized(0f, 1f, out c);
            Assert.IsFalse(c);
            Assert.AreEqual(0.2f, r.min); Assert.AreEqual(0.4f, r.max);
        }

        [Test]
        public void InvalidFogConfigIsClamped()
        {
            var f = new FogSettings { layerCount = 999, opacity = new FloatRange(-1f, 3f), areaWidth = -5f, edgeFadeFraction = 2f };
            Assert.IsTrue(f.Sanitize());
            Assert.AreEqual(64, f.layerCount);
            Assert.AreEqual(0f, f.opacity.min); Assert.AreEqual(1f, f.opacity.max);
            Assert.Greater(f.areaWidth, 0f);
            Assert.LessOrEqual(f.edgeFadeFraction, 0.5f);
            Assert.IsFalse(f.Sanitize(), "second pass must be stable");
        }

        [Test]
        public void DefaultsAreAlreadyValid()
        {
            Assert.IsFalse(new FogSettings().Sanitize());
            Assert.IsFalse(new SpriteEmissionSettings().Sanitize());
            Assert.IsFalse(new PlumeSettings().Sanitize());
            Assert.IsFalse(new FireSettings().Sanitize());
            Assert.IsFalse(new EmberSparkSettings().Sanitize());
            Assert.IsFalse(new EffectCommonSettings().Sanitize());
        }

        [Test]
        public void FireFrameTimeIsBounded()
        {
            var f = new FireSettings { frameTime = new FloatRange(0f, 100f) };
            Assert.IsTrue(f.Sanitize());
            Assert.GreaterOrEqual(f.frameTime.min, 0.02f);
            Assert.LessOrEqual(f.frameTime.max, 2f);
        }

        [Test]
        public void EmissionFadeFractionsNeverExceedLifetime()
        {
            var s = new SpriteEmissionSettings { fadeInFraction = 0.8f, fadeOutFraction = 0.8f, maxParticles = -3 };
            Assert.IsTrue(s.Sanitize());
            Assert.LessOrEqual(s.fadeInFraction + s.fadeOutFraction, 1f + 1e-6f);
            Assert.AreEqual(0, s.maxParticles);
        }

        [Test]
        public void NullNestedSettingsRecover()
        {
            var e = new EmberSparkSettings { embers = null, sparks = null };
            Assert.IsTrue(e.Sanitize());
            Assert.IsNotNull(e.embers); Assert.IsNotNull(e.sparks);
            var p = new PlumeSettings { body = null };
            Assert.IsTrue(p.Sanitize());
            Assert.IsNotNull(p.body);
        }
    }

    public class ObjectPoolTests
    {
        class Item { }

        [Test]
        public void ReusesReleasedItemsWithoutCreatingNew()
        {
            int created = 0;
            var pool = new ObjectPool<Item>(4, () => { created++; return new Item(); });
            pool.Prewarm();
            Assert.AreEqual(4, created);
            var a = pool.Get();
            pool.Release(a);
            var b = pool.Get();
            Assert.AreSame(a, b);
            for (int i = 0; i < 100; i++) { var x = pool.Get(); pool.Release(x); }
            Assert.AreEqual(4, created);
        }

        [Test]
        public void ExhaustedPoolReturnsNullAndNeverGrows()
        {
            var pool = new ObjectPool<Item>(2, () => new Item());
            pool.Prewarm();
            Assert.IsNotNull(pool.Get()); Assert.IsNotNull(pool.Get());
            Assert.IsNull(pool.Get());
            Assert.AreEqual(2, pool.CreatedCount);
            Assert.AreEqual(2, pool.ActiveCount);
        }

        [Test]
        public void CallbacksFire()
        {
            int gets = 0, releases = 0;
            var pool = new ObjectPool<Item>(1, () => new Item(), _ => gets++, _ => releases++);
            pool.Prewarm();
            var i = pool.Get(); pool.Release(i);
            Assert.AreEqual(1, gets); Assert.AreEqual(2, releases); // prewarm release + explicit
        }
    }

    public class EffectFadeTests
    {
        [Test]
        public void FadesLinearlyAndStops()
        {
            var f = new EffectFade();
            f.Set(0f);
            f.FadeTo(1f, 1f);
            f.Tick(0.5f);
            Assert.AreEqual(0.5f, f.Value, 1e-4f);
            f.Tick(10f);
            Assert.AreEqual(1f, f.Value);
            Assert.IsFalse(f.IsFading);
        }

        [Test]
        public void ZeroDurationSnaps()
        {
            var f = new EffectFade();
            f.Set(1f);
            f.FadeTo(0f, 0f);
            Assert.AreEqual(0f, f.Value);
        }
    }
}
