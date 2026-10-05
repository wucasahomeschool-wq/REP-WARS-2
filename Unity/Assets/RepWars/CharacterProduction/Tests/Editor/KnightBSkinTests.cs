using System;
using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using RepWars.CharacterProduction.EditorTools;
using UnityEngine;

namespace RepWars.CharacterProduction.Tests
{
    /// <summary>Native Editor checks for the shared pipeline. These are authored, not executed in Codex Cloud.</summary>
    public sealed class KnightBSkinTests
    {
        [TestCase(MasterHumanoidView.Front, 1254, 1254)]
        [TestCase(MasterHumanoidView.Side, 1024, 1536)]
        [TestCase(MasterHumanoidView.Back, 1024, 1536)]
        public void DefinitionsLockTheCorrectArtAndCompleteCanonicalContract(MasterHumanoidView view, int width, int height)
        {
            var config = KnightBSkinConfiguration.Load(view);
            config.VerifySource();
            Assert.IsEmpty(config.Validate());
            Assert.AreEqual("KnightB", config.CharacterId);
            Assert.IsFalse(config.UseLegacyKnightAFrontWeights, "Knight B Front must not inherit Knight A Front source-pixel constants.");
            Assert.AreEqual(width, config.sourceWidth); Assert.AreEqual(height, config.sourceHeight);
            Assert.AreEqual(11, config.sections.Length); Assert.AreEqual(20, config.bones.Length);
            Assert.AreEqual(config.LockedSourcePath, config.sourcePath);
            var ids = new HashSet<string>(); var orders = new HashSet<int>();
            foreach (var section in config.sections)
            { Assert.IsTrue(ids.Add(section.id)); Assert.IsTrue(orders.Add(section.sortingOrder)); }
            CollectionAssert.AreEquivalent(HumanoidSkinConfiguration.SectionIds, ids);
            foreach (var bone in MasterHumanoidRigContract.Bones)
                Assert.IsNotNull(Array.Find(config.bones, point => point.name == bone.name));
            var root = Array.Find(config.bones, b => b.name == "Root");
            Assert.AreEqual(config.groundX, root.x); Assert.AreEqual(config.groundY, root.y);
        }

        [TestCase(MasterHumanoidView.Front)]
        [TestCase(MasterHumanoidView.Side)]
        [TestCase(MasterHumanoidView.Back)]
        public void ExtractionRetainsPaintAndMeshesHaveNormalizedMultiBoneWeights(MasterHumanoidView view)
        {
            var config = KnightBSkinConfiguration.Load(view);
            var source = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            try
            {
                Assert.IsTrue(source.LoadImage(File.ReadAllBytes(config.SourceFullPath), false));
                var pixels = source.GetPixels32(); var width = source.width; var height = source.height;
                var owners = HumanoidSkinGeometry.BuildOwnership(config, pixels);
                for (var y = 0; y < height; y++) for (var x = 0; x < width; x++)
                    if (pixels[(height - 1 - y) * width + x].a > 2)
                        Assert.That(owners[y * width + x], Is.InRange(1, 11), "Unassigned painted source pixel at " + x + "," + y);
                var vertexTotal = 0; var triangleTotal = 0;
                foreach (var section in config.sections)
                {
                    var extracted = HumanoidSkinGeometry.Extract(config, section, pixels, owners);
                    var bounds = extracted.sourceBounds; var maxPaintY = int.MinValue;
                    for (var y = 0; y < bounds.height; y++) for (var x = 0; x < bounds.width; x++)
                    {
                        var pixel = extracted.pixels[(bounds.height - 1 - y) * bounds.width + x];
                        if (pixel.a == 0) continue;
                        var sx = bounds.x + x; var sy = bounds.y + y;
                        Assert.That(sx, Is.InRange(0, width - 1)); Assert.That(sy, Is.InRange(0, height - 1));
                        Assert.AreEqual(pixels[(height - 1 - sy) * width + sx], pixel, "Extraction changed source RGBA.");
                        if (owners[sy * width + sx] == Array.IndexOf(config.sections, section) + 1) maxPaintY = Math.Max(maxPaintY, sy);
                    }
                    if (section.id.EndsWith("LowerLegFoot", StringComparison.Ordinal))
                        Assert.That(config.groundY - maxPaintY - section.offsetY, Is.InRange(0f, 1f));
                    Vector2[] vertices; ushort[] indices; BoneWeight[] weights;
                    HumanoidSkinGeometry.BuildGrid(config, section, bounds, out vertices, out indices, out weights);
                    vertexTotal += vertices.Length; triangleTotal += indices.Length / 3;
                    foreach (var index in indices) Assert.Less(index, vertices.Length);
                    var hasBlendedVertex = false;
                    foreach (var weight in weights)
                    {
                        var values = new[] { weight.weight0, weight.weight1, weight.weight2, weight.weight3 };
                        var boneIndices = new[] { weight.boneIndex0, weight.boneIndex1, weight.boneIndex2, weight.boneIndex3 };
                        Assert.AreEqual(1f, values[0] + values[1] + values[2] + values[3], 0.00001f);
                        var active = 0;
                        for (var i = 0; i < 4; i++)
                        {
                            Assert.IsFalse(float.IsNaN(values[i])); Assert.GreaterOrEqual(values[i], 0f);
                            if (values[i] <= 0) continue;
                            active++; Assert.That(boneIndices[i], Is.InRange(0, 19));
                            Assert.Contains(MasterHumanoidRigContract.Bones[boneIndices[i]].name, section.influences);
                        }
                        hasBlendedVertex |= active > 1;
                    }
                    Assert.IsTrue(hasBlendedVertex, section.id + " must not be a rigid-only recipe.");
                }
                Assert.AreEqual(629, vertexTotal); Assert.AreEqual(926, triangleTotal);
            }
            finally { UnityEngine.Object.DestroyImmediate(source); }
            config.VerifySource();
        }

        [TestCase(MasterHumanoidView.Front, 470f, 810f, 260f)]
        [TestCase(MasterHumanoidView.Side, 400f, 635f, 300f)]
        [TestCase(MasterHumanoidView.Back, 660f, 360f, 305f)]
        public void ShoulderWeightGatesRespectEachViewsAnatomicalAssignment(MasterHumanoidView view, float rightX, float leftX, float y)
        {
            var config = KnightBSkinConfiguration.Load(view);
            var torso = Array.Find(config.sections, section => section.id == "UpperTorso");
            var rightIndex = 10; var leftIndex = 6;
            Assert.AreEqual("RightClavicle", MasterHumanoidRigContract.Bones[rightIndex].name);
            Assert.AreEqual("LeftClavicle", MasterHumanoidRigContract.Bones[leftIndex].name);
            var right = HumanoidSkinGeometry.Weights(config, torso, rightX, y);
            var left = HumanoidSkinGeometry.Weights(config, torso, leftX, y);
            Assert.Greater(WeightFor(right, rightIndex), 0.02f);
            Assert.AreEqual(0f, WeightFor(right, leftIndex), 0.000001f);
            Assert.Greater(WeightFor(left, leftIndex), 0.02f);
            Assert.AreEqual(0f, WeightFor(left, rightIndex), 0.000001f);
        }

        static float WeightFor(BoneWeight weight, int index)
        {
            return (weight.boneIndex0 == index ? weight.weight0 : 0f) + (weight.boneIndex1 == index ? weight.weight1 : 0f) +
                (weight.boneIndex2 == index ? weight.weight2 : 0f) + (weight.boneIndex3 == index ? weight.weight3 : 0f);
        }

        [Test]
        public void DisconnectedFrontFringeIsExplicitAndNeverSplitsTheVisibleArtwork()
        {
            var config = KnightBSkinConfiguration.Load(MasterHumanoidView.Front);
            var count = 0;
            foreach (var section in config.sections) count += section.secondarySeeds == null ? 0 : section.secondarySeeds.Length;
            Assert.AreEqual(48, count); Assert.AreEqual(11, config.sections.Length);
            foreach (var view in new[] { MasterHumanoidView.Side, MasterHumanoidView.Back })
                foreach (var section in KnightBSkinConfiguration.Load(view).sections) Assert.IsNull(section.secondarySeeds);
        }

        [Test]
        public void InvalidContractSortingBandsAndFringeSeedsAreRejected()
        {
            var config = KnightBSkinConfiguration.Load(MasterHumanoidView.Front);
            config.sections[1].sortingOrder = config.sections[0].sortingOrder;
            config.sections[0].transitions[0].maximum = float.NaN;
            config.sections[0].secondarySeeds = new[] { new HumanoidSkinPixelSeed { x = -1, y = 0 } };
            config.bones[0].x += 1;
            var errors = config.Validate();
            Assert.IsTrue(errors.Exists(e => e.Contains("sorting")));
            Assert.IsTrue(errors.Exists(e => e.Contains("transition")));
            Assert.IsTrue(errors.Exists(e => e.Contains("secondary")));
            Assert.IsTrue(errors.Exists(e => e.Contains("ground")));
        }

        [TestCase(MasterHumanoidView.Front)]
        [TestCase(MasterHumanoidView.Side)]
        [TestCase(MasterHumanoidView.Back)]
        public void KnightBSkinMetadataAndRigRemainPresentationOnly(MasterHumanoidView view)
        {
            var rig = MasterHumanoidRigBuilder.CreateRigObject("KnightB_MetadataContractTest");
            try
            {
                var metadata = rig.gameObject.AddComponent<KnightBSkin>();
                var config = KnightBSkinConfiguration.Load(view);
                metadata.Configure(view, rig, config.sourceSha256, config.ConfigurationHash, Array.Empty<KnightASkinSectionBinding>());
                Assert.AreSame(metadata, HumanoidSkinBuilder.FindMetadata(rig.gameObject));
                Assert.IsEmpty(MasterHumanoidRigValidator.Validate(rig));
                Assert.IsNotNull(rig.GetViewRoot(view).Find("SkinMount"));
                Assert.AreEqual(Vector3.zero, rig.GroundSocket.localPosition);
                Assert.AreEqual("RightHand", rig.FindSocket(view, MasterHumanoidSocket.MainHand).parent.name);
                Assert.AreEqual("LeftHand", rig.FindSocket(view, MasterHumanoidSocket.OffHand).parent.name);
                Assert.IsNotNull(rig.FindSocket(view, MasterHumanoidSocket.Head));
                Assert.IsNotNull(rig.FindSocket(view, MasterHumanoidSocket.Back));
                Assert.IsNull(rig.GetComponent<KnightASkin>());
                Assert.IsEmpty(rig.GetComponentsInChildren<Animator>(true));
                Assert.IsEmpty(rig.GetComponentsInChildren<HumanoidFacingPresentation>(true));
                Assert.IsEmpty(rig.GetComponentsInChildren<SelectiveTeamColorPresentation>(true));
                Assert.IsEmpty(rig.GetComponentsInChildren<HumanoidIdlePresentation>(true));
            }
            finally { UnityEngine.Object.DestroyImmediate(rig.gameObject); }
        }

        [TestCase(MasterHumanoidView.Front, "1b83fa5ef56a01acff6186edef2d94e3b18b8451521ae923a657421fda150fb9")]
        [TestCase(MasterHumanoidView.Side, "5b52d1d3b2095cb950aec3cef7c9aefac40307011422b1314c98b85202b663d6")]
        [TestCase(MasterHumanoidView.Back, "f1ae92eae2c52d6e10dd6d9fa88e6ce84195ee570ef3a8127dab3bc53cd42734")]
        public void KnightAAcceptedRecipesAndNativeMeshFacadesRemainEquivalent(MasterHumanoidView view, string acceptedHash)
        {
            var config = KnightASkinConfiguration.Load(view);
            Assert.AreEqual(acceptedHash, config.ConfigurationHash);
            Assert.AreEqual(view == MasterHumanoidView.Front, config.UseLegacyKnightAFrontWeights);
            config.VerifySource();
            var section = config.sections[0]; var bounds = new RectInt(100, 100, 200, 200);
            Vector2[] a, b; ushort[] ai, bi; BoneWeight[] aw, bw;
            KnightASkinGeometry.BuildGrid(config, section, bounds, out a, out ai, out aw);
            HumanoidSkinGeometry.BuildGrid(config, section, bounds, out b, out bi, out bw);
            CollectionAssert.AreEqual(a, b); CollectionAssert.AreEqual(ai, bi); CollectionAssert.AreEqual(aw, bw);
            Assert.AreEqual(KnightASkinBuilder.GeneratedDirectoryFor(view), HumanoidSkinBuilder.GeneratedDirectoryFor(config));
            Assert.AreEqual(KnightASkinBuilder.ProofPrefabPathFor(view), HumanoidSkinBuilder.ProofPrefabPathFor(config));
        }
    }
}
