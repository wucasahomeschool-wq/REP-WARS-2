using System;
using System.IO;
using NUnit.Framework;
using RepWars.CharacterProduction.EditorTools;
using UnityEngine;

namespace RepWars.CharacterProduction.Tests
{
    public sealed class KnightAFrontSkinTests
    {
        [Test]
        public void ReviewedConfigurationUsesElevenSectionsAndFullCanonicalRig()
        {
            var config = KnightAFrontConfiguration.Load();
            Assert.IsEmpty(config.Validate());
            Assert.AreEqual(11, config.sections.Length);
            Assert.AreEqual(MasterHumanoidRigContract.Bones.Count, config.bones.Length);
            config.VerifySource();
        }

        [Test]
        public void EditorRigFactoryUsesTheAcceptedContract()
        {
            var rig = MasterHumanoidRigBuilder.CreateRigObject("TestRig");
            try { Assert.IsEmpty(MasterHumanoidRigValidator.Validate(rig)); }
            finally { UnityEngine.Object.DestroyImmediate(rig.gameObject); }
        }

        [Test]
        public void ExtractionKeepsSourcePaintAndMeshesHaveValidCanonicalWeights()
        {
            var config = KnightAFrontConfiguration.Load();
            var source = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            try
            {
                Assert.IsTrue(source.LoadImage(File.ReadAllBytes(config.SourceFullPath), false));
                var pixels = source.GetPixels32();
                foreach (var section in config.sections)
                {
                    var extraction = KnightAFrontSkinGeometry.Extract(config, section, pixels);
                    var bounds = extraction.sourceBounds;
                    var painted = 0;
                    for (var y = 0; y < bounds.height; y++) for (var x = 0; x < bounds.width; x++)
                    {
                        var actual = extraction.pixels[(bounds.height - 1 - y) * bounds.width + x];
                        if (actual.a <= 2) continue;
                        painted++;
                        var sx = bounds.x + x; var sy = bounds.y + y;
                        Assert.AreEqual(pixels[(config.sourceHeight - 1 - sy) * config.sourceWidth + sx], actual, section.id + " changed a painted pixel.");
                        Assert.GreaterOrEqual(x, config.padding);
                        Assert.GreaterOrEqual(y, config.padding);
                        Assert.Less(x, bounds.width - config.padding);
                        Assert.Less(y, bounds.height - config.padding);
                    }
                    Assert.Greater(painted, 10000, section.id + " extracted the wrong island.");
                    Vector2[] vertices; ushort[] indices; BoneWeight[] weights;
                    KnightAFrontSkinGeometry.BuildGrid(config, section, bounds, out vertices, out indices, out weights);
                    Assert.AreEqual((section.meshColumns + 1) * (section.meshRows + 1), vertices.Length);
                    foreach (var index in indices) Assert.Less(index, vertices.Length);
                    foreach (var weight in weights)
                    {
                        Assert.AreEqual(1f, weight.weight0 + weight.weight1 + weight.weight2 + weight.weight3, 0.00001f, section.id);
                        CheckWeight(section, weight.boneIndex0, weight.weight0);
                        CheckWeight(section, weight.boneIndex1, weight.weight1);
                        CheckWeight(section, weight.boneIndex2, weight.weight2);
                        CheckWeight(section, weight.boneIndex3, weight.weight3);
                    }
                }
            }
            finally { UnityEngine.Object.DestroyImmediate(source); }
            config.VerifySource();
        }

        [Test]
        public void MajorArmorAndExtremitiesHaveStableDominantInfluences()
        {
            Assert.AreEqual(1f, Influence(KnightAFrontSkinGeometry.Weights("UpperTorso", 510, 410), "Chest"), 0.00001f);
            Assert.AreEqual(1f, Influence(KnightAFrontSkinGeometry.Weights("RightForearmHand", 100, 780), "RightHand"), 0.00001f);
            Assert.AreEqual(1f, Influence(KnightAFrontSkinGeometry.Weights("LeftLowerLegFoot", 670, 1500), "LeftFoot"), 0.00001f);
            var joint = KnightAFrontSkinGeometry.Weights("RightLowerLegFoot", 360, 1405);
            Assert.Greater(Influence(joint, "RightShin"), 0f);
            Assert.Greater(Influence(joint, "RightFoot"), 0f);
        }

        static void CheckWeight(KnightASkinSectionDefinition section, int index, float value)
        {
            Assert.IsFalse(float.IsNaN(value));
            Assert.GreaterOrEqual(value, 0f);
            if (value == 0f) return;
            Assert.Less(index, MasterHumanoidRigContract.Bones.Count);
            Assert.GreaterOrEqual(index, 0);
            Assert.Contains(MasterHumanoidRigContract.Bones[index].name, section.influences);
        }

        static float Influence(BoneWeight weight, string boneName)
        {
            var indices = new[] { weight.boneIndex0, weight.boneIndex1, weight.boneIndex2, weight.boneIndex3 };
            var values = new[] { weight.weight0, weight.weight1, weight.weight2, weight.weight3 };
            for (var i = 0; i < 4; i++) if (MasterHumanoidRigContract.Bones[indices[i]].name == boneName) return values[i];
            return 0f;
        }
    }
}
