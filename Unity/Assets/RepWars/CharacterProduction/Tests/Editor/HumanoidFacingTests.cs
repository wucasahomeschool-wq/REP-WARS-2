using System;
using NUnit.Framework;
using RepWars.CharacterProduction.EditorTools;
using UnityEditor;
using UnityEngine;

namespace RepWars.CharacterProduction.Tests
{
    public sealed class HumanoidFacingTests
    {
        [TestCase(HumanoidFacing.FrontLeft, MasterHumanoidView.Front, false)]
        [TestCase(HumanoidFacing.FrontRight, MasterHumanoidView.Front, true)]
        [TestCase(HumanoidFacing.Left, MasterHumanoidView.Side, false)]
        [TestCase(HumanoidFacing.Right, MasterHumanoidView.Side, true)]
        [TestCase(HumanoidFacing.BackLeft, MasterHumanoidView.Back, false)]
        [TestCase(HumanoidFacing.BackRight, MasterHumanoidView.Back, true)]
        public void LockedContractMapsExactlySixFacings(HumanoidFacing facing, MasterHumanoidView view, bool mirrored)
        {
            Assert.AreEqual(6, Enum.GetValues(typeof(HumanoidFacing)).Length);
            HumanoidFacingSelection selection;
            Assert.IsTrue(HumanoidFacingContract.TryResolve(facing, out selection));
            Assert.AreEqual(view, selection.View);
            Assert.AreEqual(mirrored, selection.Mirrored);
        }

        [TestCase(HumanoidFacing.FrontLeft, MasterHumanoidView.Front, false)]
        [TestCase(HumanoidFacing.FrontRight, MasterHumanoidView.Front, true)]
        [TestCase(HumanoidFacing.Left, MasterHumanoidView.Side, false)]
        [TestCase(HumanoidFacing.Right, MasterHumanoidView.Side, true)]
        [TestCase(HumanoidFacing.BackLeft, MasterHumanoidView.Back, false)]
        [TestCase(HumanoidFacing.BackRight, MasterHumanoidView.Back, true)]
        public void ApplyingFacingSelectsOneViewAndOnlyMirrorsVisualRoot(HumanoidFacing facing, MasterHumanoidView selected, bool mirrored)
        {
            var external = new GameObject("ExternalPlacement");
            var rig = MasterHumanoidRigBuilder.CreateRigObject("FacingTest");
            rig.transform.SetParent(external.transform, false);
            external.transform.position = new Vector3(43f, -12f, 0f);
            rig.transform.localPosition = new Vector3(5f, 6f, 0f);
            rig.transform.localScale = new Vector3(1.5f, 1.5f, 1f);
            rig.VisualRoot.localScale = new Vector3(2f, 3f, 1f);
            var label = new GameObject("UnrelatedLabel");
            label.transform.SetParent(rig.transform, false);
            label.transform.localPosition = new Vector3(1f, 2f, 0f);
            label.AddComponent<BoxCollider2D>();
            var presentation = rig.gameObject.AddComponent<HumanoidFacingPresentation>();
            try
            {
                string error;
                Assert.IsTrue(presentation.Configure(rig, HumanoidFacing.FrontLeft, out error), error);
                var renderers = new SpriteRenderer[3];
                var orders = new[] { 10, 20, 30 };
                for (var i = 0; i < 3; i++)
                {
                    var piece = new GameObject("TestRenderer");
                    piece.transform.SetParent(rig.GetViewRoot((MasterHumanoidView)i).Find("SkinMount"), false);
                    renderers[i] = piece.AddComponent<SpriteRenderer>();
                    renderers[i].sortingOrder = orders[i];
                }
                var localBone = rig.FindBone(selected, "RightHand").localPosition;
                var bindRelation = rig.FindBone(selected, "RightHand").worldToLocalMatrix * renderers[(int)selected].transform.localToWorldMatrix;
                Assert.IsTrue(presentation.TrySetFacing(facing));
                Assert.AreEqual(facing, presentation.Facing);
                Assert.AreEqual(new Vector3(mirrored ? -2f : 2f, 3f, 1f), rig.VisualRoot.localScale);
                var count = 0;
                for (var i = 0; i < 3; i++)
                {
                    var active = rig.GetViewRoot((MasterHumanoidView)i).gameObject.activeSelf;
                    if (active) count++;
                    Assert.AreEqual(i == (int)selected, active);
                    Assert.AreEqual(orders[i], renderers[i].sortingOrder);
                    Assert.IsFalse(renderers[i].flipX);
                    Assert.IsFalse(renderers[i].flipY);
                }
                Assert.AreEqual(1, count);
                Assert.AreEqual(localBone, rig.FindBone(selected, "RightHand").localPosition);
                var after = rig.FindBone(selected, "RightHand").worldToLocalMatrix * renderers[(int)selected].transform.localToWorldMatrix;
                for (var i = 0; i < 16; i++) Assert.AreEqual(bindRelation[i], after[i], 0.0001f);
                Assert.AreEqual(new Vector3(43f, -12f, 0f), external.transform.position);
                Assert.AreEqual(new Vector3(5f, 6f, 0f), rig.transform.localPosition);
                Assert.AreEqual(new Vector3(1.5f, 1.5f, 1f), rig.transform.localScale);
                Assert.AreEqual(new Vector3(1f, 2f, 0f), label.transform.localPosition);
                Assert.IsEmpty(HumanoidFacingValidator.Validate(presentation));
            }
            finally { UnityEngine.Object.DestroyImmediate(external); }
        }

        [Test]
        public void StationaryAndInvalidIntentPreserveLastFacing()
        {
            var rig = MasterHumanoidRigBuilder.CreateRigObject("StationaryTest");
            var presentation = rig.gameObject.AddComponent<HumanoidFacingPresentation>();
            try
            {
                string error;
                Assert.IsTrue(presentation.Configure(rig, HumanoidFacing.BackRight, out error), error);
                Assert.IsFalse(presentation.TryApplyFacingIntent(null));
                Assert.IsFalse(presentation.TrySetFacing((HumanoidFacing)99));
                Assert.IsFalse(presentation.TrySetFacing((HumanoidFacing)(-1)));
                Assert.AreEqual(HumanoidFacing.BackRight, presentation.Facing);
                Assert.AreEqual(-1f, rig.VisualRoot.localScale.x);
                Assert.IsEmpty(HumanoidFacingValidator.Validate(presentation));
                UnityEngine.Object.DestroyImmediate(rig.GetViewRoot(MasterHumanoidView.Side).gameObject);
                Assert.IsFalse(presentation.TrySetFacing(HumanoidFacing.Left));
                Assert.AreEqual(HumanoidFacing.BackRight, presentation.Facing);
                Assert.AreEqual(-1f, rig.VisualRoot.localScale.x);
            }
            finally { UnityEngine.Object.DestroyImmediate(rig.gameObject); }
        }

        [Test]
        public void DefaultAndCorruptSerializedStartupUseFrontLeft()
        {
            Assert.AreEqual(HumanoidFacing.FrontLeft, default(HumanoidFacing));
            HumanoidFacingSelection ignored;
            Assert.IsFalse(HumanoidFacingContract.TryResolve((HumanoidFacing)6, out ignored));
            var rig = MasterHumanoidRigBuilder.CreateRigObject("StartupTest");
            var presentation = rig.gameObject.AddComponent<HumanoidFacingPresentation>();
            try
            {
                string error;
                Assert.IsTrue(presentation.Configure(rig, HumanoidFacing.BackRight, out error), error);
                var serialized = new SerializedObject(presentation);
                serialized.FindProperty("facing").intValue = 99;
                serialized.ApplyModifiedPropertiesWithoutUndo();
                Assert.IsTrue(presentation.TryApplyStoredFacing());
                Assert.AreEqual(HumanoidFacing.FrontLeft, presentation.Facing);
                Assert.AreEqual(1f, rig.VisualRoot.localScale.x);
                Assert.IsEmpty(HumanoidFacingValidator.Validate(presentation));
            }
            finally { UnityEngine.Object.DestroyImmediate(rig.gameObject); }
        }

        [TestCase(HumanoidFacing.FrontLeft, HumanoidFacing.FrontRight)]
        [TestCase(HumanoidFacing.Left, HumanoidFacing.Right)]
        [TestCase(HumanoidFacing.BackLeft, HumanoidFacing.BackRight)]
        public void SocketsMirrorWithTheRigWithoutSwappingTheirIdentity(HumanoidFacing normal, HumanoidFacing mirrored)
        {
            var rig = MasterHumanoidRigBuilder.CreateRigObject("SocketTest");
            var presentation = rig.gameObject.AddComponent<HumanoidFacingPresentation>();
            try
            {
                string error;
                Assert.IsTrue(presentation.Configure(rig, normal, out error), error);
                var main = presentation.GetActiveSocket(MasterHumanoidSocket.MainHand);
                var off = presentation.GetActiveSocket(MasterHumanoidSocket.OffHand);
                var before = rig.transform.InverseTransformPoint(main.position);
                Assert.IsTrue(presentation.TrySetFacing(mirrored));
                Assert.AreSame(main, presentation.GetActiveSocket(MasterHumanoidSocket.MainHand));
                Assert.AreSame(off, presentation.GetActiveSocket(MasterHumanoidSocket.OffHand));
                var after = rig.transform.InverseTransformPoint(main.position);
                Assert.AreEqual(-before.x, after.x, 0.00001f);
                Assert.AreEqual(before.y, after.y, 0.00001f);
                Assert.AreSame(rig.GroundSocket, presentation.GetActiveSocket(MasterHumanoidSocket.Ground));
                Assert.AreEqual(Vector3.zero, rig.GroundSocket.localPosition);
            }
            finally { UnityEngine.Object.DestroyImmediate(rig.gameObject); }
        }

        [Test]
        public void ConfigurationRejectsForeignRigAndInvalidInitialFacingWithoutMutation()
        {
            var rig = MasterHumanoidRigBuilder.CreateRigObject("Owner");
            var other = MasterHumanoidRigBuilder.CreateRigObject("Other");
            var presentation = rig.gameObject.AddComponent<HumanoidFacingPresentation>();
            try
            {
                string error;
                Assert.IsFalse(presentation.Configure(other, HumanoidFacing.Left, out error));
                Assert.IsNull(presentation.Rig);
                Assert.IsFalse(presentation.Configure(rig, (HumanoidFacing)99, out error));
                Assert.IsNull(presentation.Rig);
                Assert.IsFalse(presentation.TrySetFacing(HumanoidFacing.Right));
                Assert.AreEqual(HumanoidFacing.FrontLeft, presentation.Facing);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(rig.gameObject);
                UnityEngine.Object.DestroyImmediate(other.gameObject);
            }
        }
    }
}
