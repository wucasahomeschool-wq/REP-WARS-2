using System;
using System.IO;
using NUnit.Framework;
using RepWars.CharacterProduction.EditorTools;
using UnityEngine;

namespace RepWars.CharacterProduction.Tests
{
    public sealed class KnightASkinTests
    {
        [TestCase(MasterHumanoidView.Front)]
        [TestCase(MasterHumanoidView.Side)]
        [TestCase(MasterHumanoidView.Back)]
        public void EveryAuthoredViewUsesTheFullContractAndLockedSource(MasterHumanoidView view)
        {
            var config = KnightASkinConfiguration.Load(view);
            Assert.IsEmpty(config.Validate());
            config.VerifySource();
            Assert.AreEqual(view, config.view);
            Assert.AreEqual(11, config.sections.Length);
            Assert.AreEqual(20, config.bones.Length);
            Assert.AreEqual(KnightASkinConfiguration.LockedSourcePathFor(view), config.sourcePath);
            Assert.IsTrue(KnightASkinBuilder.GeneratedDirectoryFor(view).Contains("/" + view + "/"));
            var root = Array.Find(config.bones, b => b.name == "Root");
            Assert.AreEqual(config.groundX, root.x);
            Assert.AreEqual(config.groundY, root.y);
        }

        [TestCase(MasterHumanoidView.Side, 609, 888)]
        [TestCase(MasterHumanoidView.Back, 661, 986)]
        public void NewViewMeshesPreservePaintAndUseNormalizedPermittedInfluences(
            MasterHumanoidView view, int expectedVertices, int expectedTriangles)
        {
            var config = KnightASkinConfiguration.Load(view);
            var source = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            try
            {
                Assert.IsTrue(source.LoadImage(File.ReadAllBytes(config.SourceFullPath), false));
                var sourcePixels = source.GetPixels32();
                var ownership = KnightASkinGeometry.BuildOwnership(config, sourcePixels);
                var verticesTotal = 0; var trianglesTotal = 0;
                foreach (var section in config.sections)
                {
                    var extracted = KnightASkinGeometry.Extract(config, section, sourcePixels, ownership);
                    var bounds = extracted.sourceBounds;
                    for (var y = 0; y < bounds.height; y++) for (var x = 0; x < bounds.width; x++)
                    {
                        var pixel = extracted.pixels[(bounds.height - 1 - y) * bounds.width + x];
                        if (pixel.a <= 2) continue;
                        Assert.AreEqual(sourcePixels[(config.sourceHeight - 1 - bounds.y - y) * config.sourceWidth + bounds.x + x], pixel);
                    }
                    Vector2[] vertices; ushort[] triangles; BoneWeight[] weights;
                    KnightASkinGeometry.BuildGrid(config, section, bounds, out vertices, out triangles, out weights);
                    verticesTotal += vertices.Length; trianglesTotal += triangles.Length / 3;
                    foreach (var index in triangles) Assert.Less(index, vertices.Length);
                    foreach (var weight in weights)
                    {
                        var values = new[] { weight.weight0, weight.weight1, weight.weight2, weight.weight3 };
                        var indices = new[] { weight.boneIndex0, weight.boneIndex1, weight.boneIndex2, weight.boneIndex3 };
                        Assert.AreEqual(1f, values[0] + values[1] + values[2] + values[3], 0.00001f);
                        for (var i = 0; i < 4; i++)
                        {
                            Assert.IsFalse(float.IsNaN(values[i]));
                            Assert.GreaterOrEqual(values[i], 0f);
                            if (values[i] == 0) continue;
                            Assert.That(indices[i], Is.InRange(0, 19));
                            Assert.Contains(MasterHumanoidRigContract.Bones[indices[i]].name, section.influences);
                        }
                    }
                }
                Assert.AreEqual(expectedVertices, verticesTotal);
                Assert.AreEqual(expectedTriangles, trianglesTotal);
            }
            finally { UnityEngine.Object.DestroyImmediate(source); }
            config.VerifySource();
        }

        [Test]
        public void ViewsHaveIndependentCalibrationAndOrdering()
        {
            var front = KnightASkinConfiguration.Load(MasterHumanoidView.Front);
            var side = KnightASkinConfiguration.Load(MasterHumanoidView.Side);
            var back = KnightASkinConfiguration.Load(MasterHumanoidView.Back);
            Assert.AreNotEqual(front.bones[7].x, side.bones[7].x);
            Assert.AreNotEqual(side.bones[7].x, back.bones[7].x);
            Assert.AreNotEqual(Array.Find(front.sections, s => s.id == "UpperTorso").sortingOrder,
                Array.Find(side.sections, s => s.id == "UpperTorso").sortingOrder);
            Assert.AreNotEqual(Array.Find(side.sections, s => s.id == "UpperTorso").sortingOrder,
                Array.Find(back.sections, s => s.id == "UpperTorso").sortingOrder);
        }

        [Test]
        public void InvalidOrderingWeightsAndGroundProduceActionableErrors()
        {
            var config = KnightASkinConfiguration.Load(MasterHumanoidView.Side);
            config.sections[1].sortingOrder = config.sections[0].sortingOrder;
            config.sections[0].transitions[0].maximum = float.NaN;
            config.groundY += 10;
            var errors = config.Validate();
            Assert.IsTrue(errors.Exists(e => e.Contains("sorting")));
            Assert.IsTrue(errors.Exists(e => e.Contains("transition")));
            Assert.IsTrue(errors.Exists(e => e.Contains("ground")));
        }
    }
}
