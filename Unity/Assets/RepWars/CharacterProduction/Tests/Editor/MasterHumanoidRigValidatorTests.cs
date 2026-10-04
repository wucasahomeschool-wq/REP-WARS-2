using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;

namespace RepWars.CharacterProduction.Tests
{
    public sealed class MasterHumanoidRigValidatorTests
    {
        readonly List<GameObject> objects = new List<GameObject>();

        [TearDown]
        public void TearDown()
        {
            foreach (var item in objects) if (item != null) Object.DestroyImmediate(item);
            objects.Clear();
        }

        [Test]
        public void ContractContainsFullHumanoidChainsAndThreeViews()
        {
            Assert.Greater(MasterHumanoidRigContract.Bones.Count, 11, "The skeleton must remain more detailed than the visible Soldier skin.");
            Assert.IsTrue(HasBone("Spine", "Pelvis"));
            Assert.IsTrue(HasBone("Chest", "Spine"));
            Assert.IsTrue(HasBone("LeftClavicle", "Chest"));
            Assert.IsTrue(HasBone("RightHand", "RightForearm"));
            Assert.IsTrue(HasBone("LeftFoot", "LeftShin"));
            Assert.IsTrue(HasBone("RightFoot", "RightShin"));
            Assert.AreEqual(3, System.Enum.GetValues(typeof(MasterHumanoidView)).Length);
        }

        [Test]
        public void CompleteIndependentRigViewsPassValidation()
        {
            var rig = BuildRig();
            var errors = MasterHumanoidRigValidator.Validate(rig);
            Assert.IsEmpty(errors, string.Join("\n", errors.ToArray()));
            Assert.AreNotSame(rig.GetViewRoot(MasterHumanoidView.Front), rig.GetViewRoot(MasterHumanoidView.Side));
            Assert.AreNotSame(rig.GetViewRoot(MasterHumanoidView.Side), rig.GetViewRoot(MasterHumanoidView.Back));
        }

        [Test]
        public void MissingRequiredBoneProducesActionableError()
        {
            var rig = BuildRig();
            var head = rig.FindBone(MasterHumanoidView.Front, "Head");
            Object.DestroyImmediate(head.gameObject);
            var errors = MasterHumanoidRigValidator.Validate(rig);
            CollectionAssert.Contains(errors, "Front skeleton is missing bone 'Head'.");
        }

        [Test]
        public void IncorrectParentRelationshipProducesActionableError()
        {
            var rig = BuildRig();
            var foot = rig.FindBone(MasterHumanoidView.Front, "LeftFoot");
            foot.SetParent(rig.FindBone(MasterHumanoidView.Front, "LeftThigh"), false);
            var errors = MasterHumanoidRigValidator.Validate(rig);
            CollectionAssert.Contains(errors, "Front bone 'LeftFoot' must be a direct child of 'LeftShin'.");
        }

        static bool HasBone(string name, string parent)
        {
            foreach (var bone in MasterHumanoidRigContract.Bones)
                if (bone.name == name) return bone.parentName == parent;
            return false;
        }

        MasterHumanoidRig BuildRig()
        {
            var root = New("Rig");
            var rig = root.AddComponent<MasterHumanoidRig>();
            var visual = Child("VisualRoot", root.transform);
            var ground = Child("Socket_Ground", visual);
            var views = new Transform[3];
            for (var i = 0; i < views.Length; i++)
            {
                var view = Child("View_" + (MasterHumanoidView)i, visual);
                var skeleton = Child("Skeleton", view);
                var bones = new Dictionary<string, Transform>();
                foreach (var definition in MasterHumanoidRigContract.Bones)
                {
                    var parent = definition.parentName == null ? skeleton : bones[definition.parentName];
                    bones.Add(definition.name, Child(definition.name, parent));
                }
                Child("Socket_MainHand", bones["RightHand"]);
                Child("Socket_OffHand", bones["LeftHand"]);
                Child("Socket_Head", bones["Head"]);
                Child("Socket_Back", bones["Chest"]);
                Child("SkinMount", view);
                views[i] = view;
            }
            rig.Configure(visual, ground, views[0], views[1], views[2]);
            return rig;
        }

        GameObject New(string name)
        {
            var item = new GameObject(name);
            objects.Add(item);
            return item;
        }

        Transform Child(string name, Transform parent)
        {
            var child = New(name).transform;
            child.SetParent(parent, false);
            return child;
        }
    }
}
