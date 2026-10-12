using System.Collections;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace RepWars.Environment.Effects.PlayModeTests
{
    /// <summary>Lightweight lifecycle checks: start/stop, pooled reuse, and no orphaned objects.</summary>
    public class EffectsLifecyclePlayModeTests
    {
        Texture2D _tex;
        Sprite _sprite;

        [SetUp]
        public void SetUp()
        {
            _tex = new Texture2D(4, 4); // test-only stand-in, never shipped
            _sprite = Sprite.Create(_tex, new Rect(0, 0, 4, 4), new Vector2(0.5f, 0f), 4f);
        }

        [TearDown]
        public void TearDown()
        {
            Object.Destroy(_sprite);
            Object.Destroy(_tex);
        }

        static int CountTransforms(Transform t) { int n = 1; foreach (Transform c in t) n += CountTransforms(c); return n; }

        [UnityTest]
        public IEnumerator PlumeStartsStopsAndReusesPool()
        {
            var go = new GameObject("PlumeTest");
            go.SetActive(false);
            var plume = go.AddComponent<SmokePlumeController>();
            plume.SetSprites(new[] { _sprite, _sprite });
            go.SetActive(true);
            plume.Play();
            int transformsAfterInit = CountTransforms(go.transform);
            yield return new WaitForSeconds(1.5f);
            Assert.IsTrue(plume.IsPlaying);
            Assert.Greater(plume.AliveCount, 0);
            Assert.LessOrEqual(plume.AliveCount, plume.Capacity);

            plume.Stop();
            Assert.IsFalse(plume.IsPlaying);
            Assert.AreEqual(0, plume.AliveCount);

            plume.Play();
            yield return new WaitForSeconds(1.5f);
            Assert.AreEqual(transformsAfterInit, CountTransforms(go.transform), "pool must not create objects after init");
            Object.Destroy(go);
            yield return null;
        }

        [UnityTest]
        public IEnumerator FadeOutEndsInStoppedState()
        {
            var go = new GameObject("FireTest");
            go.SetActive(false);
            var fire = go.AddComponent<FireFrameController>();
            go.SetActive(true);
            fire.SetFrames(new[] { _sprite, _sprite, _sprite });
            fire.Play();
            for (int i = 0; i < 30; i++) yield return null;
            Assert.Greater(fire.FrameChanges, 0);
            fire.FadeOut(0.1f);
            float t = 0f;
            while (fire.IsPlaying && t < 2f) { t += Time.deltaTime; yield return null; }
            Assert.IsFalse(fire.IsPlaying);
            Object.Destroy(go);
            yield return null;
        }

        [UnityTest]
        public IEnumerator DestroyingEffectsLeavesNoOrphans()
        {
            int before = Object.FindObjectsByType<SpriteRenderer>().Length;
            var root = new GameObject("OrphanTest");
            root.SetActive(false);
            var fog = root.AddComponent<FogController>();
            fog.SetSprites(new[] { _sprite });
            root.AddComponent<EmberSparkController>().SetSprites(new[] { _sprite }, new[] { _sprite });
            root.SetActive(true);
            for (int i = 0; i < 30; i++) yield return null;
            Object.Destroy(root);
            yield return null;
            int after = Object.FindObjectsByType<SpriteRenderer>().Length;
            Assert.AreEqual(before, after);
        }
    }
}
