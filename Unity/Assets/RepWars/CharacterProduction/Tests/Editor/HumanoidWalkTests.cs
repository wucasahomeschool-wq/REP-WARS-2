using System;
using System.Collections.Generic;
using NUnit.Framework;
using RepWars.CharacterProduction.EditorTools;
using UnityEditor;
using UnityEngine;

namespace RepWars.CharacterProduction.Tests
{
    public sealed class HumanoidWalkTests
    {
        [Test]
        public void SharedPhasesHaveAlternatingContactsAndNoStanceLiftOrRoll()
        {
            var recipe = KnightAWalkConfiguration.Load();
            Assert.IsEmpty(recipe.Validate()); // Actual source/calibration hashes plus dense contact checks.
            Assert.AreEqual(3,recipe.views.Length); Assert.AreEqual(1.6f,recipe.duration);
            Assert.AreEqual("LeftContact",recipe.phases[0].label); Assert.AreEqual("RightContact",recipe.phases[4].label);
            Assert.AreEqual(-1f,recipe.SampleSignal(0,"stride")); Assert.AreEqual(1f,recipe.SampleSignal(0.5,"stride"));
            for (var i = 0; i <= 128; i++)
            {
                var phase = i/256d;
                Assert.AreEqual(0f,recipe.SampleSignal(phase,"lift")); Assert.AreEqual(0f,recipe.SampleSignal(phase,"roll"));
                Assert.AreEqual(-recipe.SampleSignal(phase,"stride"),recipe.SampleSignal(phase+0.5,"stride"),0.00001f);
            }
            Assert.AreEqual(1f,recipe.SampleSignal(0.75,"lift"));
        }
        [Test]
        public void ArmsCounterTheIpsilateralStrideInAllProjectedViews()
        {
            var recipe = KnightAWalkConfiguration.Load();
            foreach (var view in recipe.views)
            {
                var left = Array.Find(view.upperMotions,m=>m.bone == "LeftUpperArm");
                var right = Array.Find(view.upperMotions,m=>m.bone == "RightUpperArm");
                // All calibrated arm chains point downward; positive Z swings the arm right, opposing left contact.
                Assert.Greater(left.strideDegrees*recipe.SampleSignal(0,"stride"),0f);
                Assert.Less(right.strideDegrees*recipe.SampleSignal(0.5,"stride"),0f);
                Assert.IsFalse(left.useRightPhase); Assert.IsTrue(right.useRightPhase);
            }
        }
        [Test]
        public void StateContractContainsOnlyIdleAndWalk()
        {
            CollectionAssert.AreEqual(new[] { HumanoidAnimationState.Idle,HumanoidAnimationState.Walk },Enum.GetValues(typeof(HumanoidAnimationState)));
        }
        [Test]
        public void NativeWalkCurvesAreViewRelativeBoundedAndLoopWithMatchingSlopes()
        {
            using (var fixture = new Fixture())
            {
                foreach (var view in fixture.recipe.views)
                {
                    var clip = fixture.walkProfile.GetClip(view.view);
                    var expected = KnightAWalkProofBuilder.CreateWalkClip(fixture.recipe,view,fixture.rig);
                    try
                    {
                        var errors = new List<string>(); KnightAWalkProofBuilder.ValidateClip(clip,expected,fixture.rig,view.view,errors);
                        Assert.IsEmpty(errors); Assert.AreEqual(17,AnimationUtility.GetCurveBindings(clip).Length);
                        foreach (var binding in AnimationUtility.GetCurveBindings(clip))
                        {
                            StringAssert.StartsWith("Skeleton/Root/Pelvis",binding.path);
                            Assert.AreEqual(typeof(Transform),binding.type);
                            var curve = AnimationUtility.GetEditorCurve(clip,binding); var keys = curve.keys;
                            Assert.AreEqual(129,keys.Length);
                            Assert.AreEqual(keys[0].value,keys[keys.Length-1].value);
                            Assert.AreEqual(keys[0].inTangent,keys[keys.Length-1].outTangent);
                            Assert.IsTrue(binding.propertyName == "localEulerAnglesRaw.z" ||
                                (binding.path.EndsWith("/Pelvis",StringComparison.Ordinal) && binding.propertyName == "m_LocalPosition.y"));
                        }
                    }
                    finally { UnityEngine.Object.DestroyImmediate(expected); }
                }
            }
        }
        [Test]
        public void ValidatorRejectsRootGroundColorAndUnexpectedPositionTracks()
        {
            using (var fixture = new Fixture())
            {
                var view = fixture.recipe.views[1];
                var reference = fixture.walkProfile.GetClip(view.view);
                foreach (var forbidden in new[] {
                    EditorCurveBinding.FloatCurve("",typeof(Transform),"m_LocalPosition.x"),
                    EditorCurveBinding.FloatCurve("Skeleton/Root",typeof(Transform),"m_LocalPosition.y"),
                    EditorCurveBinding.FloatCurve("Socket_Ground",typeof(Transform),"localEulerAnglesRaw.z"),
                    EditorCurveBinding.FloatCurve("SkinMount/LowerTorso",typeof(SpriteRenderer),"m_Color.r"),
                    EditorCurveBinding.FloatCurve("Skeleton/Root/Pelvis/LeftThigh",typeof(Transform),"m_LocalPosition.x") })
                {
                    var altered = UnityEngine.Object.Instantiate(reference);
                    try
                    {
                        AnimationUtility.SetEditorCurve(altered,forbidden,AnimationCurve.Linear(0,0,fixture.recipe.duration,1));
                        var errors = new List<string>(); KnightAWalkProofBuilder.ValidateClip(altered,reference,fixture.rig,view.view,errors);
                        Assert.IsTrue(errors.Exists(e=>e.Contains("forbidden curve")));
                    }
                    finally { UnityEngine.Object.DestroyImmediate(altered); }
                }
            }
        }
        [TestCase(HumanoidFacing.FrontLeft,MasterHumanoidView.Front,false)]
        [TestCase(HumanoidFacing.FrontRight,MasterHumanoidView.Front,true)]
        [TestCase(HumanoidFacing.Left,MasterHumanoidView.Side,false)]
        [TestCase(HumanoidFacing.Right,MasterHumanoidView.Side,true)]
        [TestCase(HumanoidFacing.BackLeft,MasterHumanoidView.Back,false)]
        [TestCase(HumanoidFacing.BackRight,MasterHumanoidView.Back,true)]
        public void FacingSwitchPreservesWalkPhaseColorAndOneActiveAnimator(HumanoidFacing facing,MasterHumanoidView view,bool mirrored)
        {
            using (var fixture = new Fixture())
            {
                fixture.color.SetTeamColor(Color.green);
                Assert.IsTrue(fixture.player.SetAnimationState(HumanoidAnimationState.Walk)); Assert.IsTrue(fixture.player.SetAnimationEnabled(true));
                Assert.IsTrue(fixture.player.TrySampleAtPhase(0.25));
                Assert.IsTrue(fixture.facing.TrySetFacing(facing));
                Assert.AreEqual(HumanoidAnimationState.Walk,fixture.player.State);
                Assert.AreEqual(0.25d,fixture.player.NormalizedPhase); Assert.AreSame(fixture.walkProfile.GetClip(view),fixture.player.CurrentClip);
                Assert.AreEqual(mirrored ? -1f : 1f,fixture.rig.VisualRoot.localScale.x);
                for (var i = 0; i < 3; i++) Assert.AreEqual(i == (int)view,fixture.animators[i].enabled);
                Assert.AreEqual(Color.green,fixture.color.TeamColor); Assert.IsTrue(fixture.color.RecolorEnabled);
                var block = new MaterialPropertyBlock(); fixture.renderer.GetPropertyBlock(block); Assert.AreEqual(1f,block.GetFloat("_TeamColorEnabled"));
                Assert.IsEmpty(HumanoidFacingValidator.Validate(fixture.facing,fixture.player));
                fixture.color.DisableTeamColor(); Assert.IsTrue(fixture.player.IsPlaying); Assert.AreEqual(0.25d,fixture.player.NormalizedPhase);
            }
        }
        [Test]
        public void SampledBonesMatchProjectedFootReferencesWithoutRootOrGroundMovement()
        {
            using (var fixture = new Fixture())
            {
                fixture.rig.transform.position = new Vector3(12,-8,0);
                var placement = fixture.rig.transform.position; var ground = fixture.rig.GroundSocket.position;
                fixture.player.SetAnimationState(HumanoidAnimationState.Walk); fixture.player.SetAnimationEnabled(true);
                foreach (var view in fixture.recipe.views)
                {
                    var skin = KnightASkinConfiguration.Load(view.view);
                    var facing = view.view == MasterHumanoidView.Front ? HumanoidFacing.FrontRight : view.view == MasterHumanoidView.Side ? HumanoidFacing.Right : HumanoidFacing.BackRight;
                    fixture.facing.TrySetFacing(facing); var mirror = fixture.rig.VisualRoot.localScale;
                    for (var i = 0; i <= 16; i++)
                    {
                        var phase = i/16d; fixture.player.TrySampleAtPhase(phase);
                        Assert.AreEqual(placement,fixture.rig.transform.position); Assert.AreEqual(ground,fixture.rig.GroundSocket.position);
                        Assert.AreEqual(mirror,fixture.rig.VisualRoot.localScale);
                        Assert.AreEqual(Vector3.zero,fixture.rig.FindBone(view.view,"Root").localPosition);
                        foreach (var side in new[] { "Left","Right" })
                        {
                            var bind = Array.Find(skin.bones,b=>b.name == side+"Foot");
                            var foot = fixture.rig.FindBone(view.view,side+"Foot");
                            var soleHeight = (skin.groundY-bind.y)/skin.pixelsPerUnit;
                            var contact = fixture.rig.VisualRoot.InverseTransformPoint(foot.TransformPoint(new Vector3(0,-soleHeight,0)));
                            var time = phase+(side == "Right" ? 0.5 : 0);
                            var expected = skin.ToRigPoint(bind.x+view.stridePixels*fixture.recipe.SampleSignal(time,"stride"),
                                skin.groundY-view.liftPixels*fixture.recipe.SampleSignal(time,"lift"));
                            Assert.Less(Vector3.Distance(expected,contact),0.001f); // Kinematic reference, not weighted sprite-pixel fidelity.
                        }
                    }
                }
            }
        }
        [Test]
        public void IdleWalkHandoffBlendsAndIdleExplicitlyRestoresLowerBody()
        {
            using (var fixture = new Fixture())
            {
                fixture.player.SetAnimationEnabled(true); fixture.player.TrySampleAtPhase(0.37);
                Assert.IsTrue(fixture.player.SetAnimationState(HumanoidAnimationState.Walk));
                Assert.AreEqual(0d,fixture.player.NormalizedPhase); Assert.AreEqual(0f,fixture.player.WalkWeight); Assert.IsTrue(fixture.player.IsTransitioning);
                fixture.player.AdvancePresentation(0.1); Assert.AreEqual(0.5f,fixture.player.WalkWeight,0.0001f);
                fixture.player.AdvancePresentation(0.1); Assert.AreEqual(1f,fixture.player.WalkWeight); Assert.IsFalse(fixture.player.IsTransitioning);
                Assert.IsTrue(fixture.player.SetAnimationState(HumanoidAnimationState.Idle)); fixture.player.AdvancePresentation(0.2);
                Assert.AreEqual(0f,fixture.player.WalkWeight);
                foreach (var binding in fixture.player.WalkBones)
                    if (!HumanoidIdleContract.IsAllowedBone(binding.boneName))
                    {
                        Assert.Less(Quaternion.Angle(binding.bone.localRotation,binding.neutralLocalRotation),0.005f);
                        Assert.Less(Vector3.Distance(binding.bone.localPosition,binding.neutralLocalPosition),0.00001f);
                    }
            }
        }
        [Test]
        public void InterruptedHandoffRetainsBothPosesAndSharedBlendWeight()
        {
            using (var fixture = new Fixture())
            {
                fixture.player.SetAnimationEnabled(true); fixture.player.TrySampleAtPhase(0.37);
                fixture.player.SetAnimationState(HumanoidAnimationState.Walk); fixture.player.AdvancePresentation(0.05);
                var weight = fixture.player.WalkWeight;
                var thigh = fixture.rig.FindBone(MasterHumanoidView.Front,"LeftThigh").localRotation;
                fixture.player.SetAnimationState(HumanoidAnimationState.Idle);
                Assert.AreEqual(weight,fixture.player.WalkWeight);
                Assert.Less(Quaternion.Angle(thigh,fixture.rig.FindBone(MasterHumanoidView.Front,"LeftThigh").localRotation),0.005f);
                fixture.player.AdvancePresentation(0.2); Assert.AreEqual(0f,fixture.player.WalkWeight);
            }
        }
        [Test]
        public void DisableRestoresEveryCalibratedBoneAndReenableKeepsWalkFacingAndPhase()
        {
            using (var fixture = new Fixture())
            {
                fixture.player.SetAnimationState(HumanoidAnimationState.Walk); fixture.player.SetAnimationEnabled(true);
                fixture.player.TrySampleAtPhase(0.75); fixture.facing.TrySetFacing(HumanoidFacing.BackRight);
                fixture.player.SetAnimationEnabled(false);
                foreach (var binding in fixture.player.WalkBones)
                {
                    Assert.AreEqual(binding.neutralLocalRotation,binding.bone.localRotation);
                    Assert.AreEqual(binding.neutralLocalPosition,binding.bone.localPosition);
                }
                Assert.AreEqual(HumanoidFacing.BackRight,fixture.facing.Facing); Assert.AreEqual(0.75d,fixture.player.NormalizedPhase);
                fixture.player.SetAnimationEnabled(true); Assert.AreEqual(HumanoidAnimationState.Walk,fixture.player.State); Assert.AreEqual(0.75d,fixture.player.NormalizedPhase);
                fixture.player.enabled = false; Assert.IsFalse(fixture.player.IsPlaying);
                fixture.player.enabled = true; Assert.AreEqual(HumanoidAnimationState.Walk,fixture.player.State); Assert.AreEqual(0.75d,fixture.player.NormalizedPhase);
            }
        }
        [Test]
        public void PausedAutomaticClockAllowsSeekingAndRejectsInvalidInput()
        {
            using (var fixture = new Fixture())
            {
                fixture.player.SetAnimationState(HumanoidAnimationState.Walk); fixture.player.SetAnimationEnabled(true);
                fixture.player.SetAutomaticAdvance(false); Assert.IsFalse(fixture.player.AutomaticAdvance);
                fixture.player.TrySampleAtPhase(0.75); fixture.player.AdvancePresentation(0.8);
                Assert.AreEqual(0.25d,fixture.player.NormalizedPhase,0.000001);
                foreach (var bad in new[] { -1d,double.NaN,double.PositiveInfinity })
                { Assert.IsFalse(fixture.player.TrySampleAtPhase(bad)); Assert.IsFalse(fixture.player.AdvancePresentation(bad)); }
                Assert.AreEqual(0.25d,fixture.player.NormalizedPhase,0.000001);
                Assert.IsFalse(fixture.player.SetAnimationState((HumanoidAnimationState)2));
                fixture.player.TrySampleAtPhase(1d); Assert.AreEqual(0d,fixture.player.NormalizedPhase);
            }
        }
        [Test]
        public void ProfileAndRecipeRejectDuplicateViewsAndUnreachableTargets()
        {
            using (var fixture = new Fixture())
            {
                var copy = KnightAWalkConfiguration.Load(); copy.views[1].pelvisDropPixels = 0f; Assert.IsNotEmpty(copy.Validate());
                copy = KnightAWalkConfiguration.Load(); copy.views[1].stridePixels = 40f; copy.views[1].pelvisDropPixels = 1f;
                Assert.IsNotEmpty(copy.Validate()); // Contact reach must fail instead of stretching bones.
                fixture.walkProfile.Configure(1.6f,0.2f,"test",new[] {
                    new HumanoidIdleViewClip { view = MasterHumanoidView.Front,clip = fixture.walkProfile.GetClip(MasterHumanoidView.Front) },
                    new HumanoidIdleViewClip { view = MasterHumanoidView.Side,clip = fixture.walkProfile.GetClip(MasterHumanoidView.Front) },
                    new HumanoidIdleViewClip { view = MasterHumanoidView.Back,clip = fixture.walkProfile.GetClip(MasterHumanoidView.Back) } });
                Assert.IsNotEmpty(fixture.player.Validate()); Assert.IsFalse(fixture.player.SetAnimationEnabled(true));
            }
        }

        sealed class Fixture : IDisposable
        {
            public readonly KnightAWalkConfiguration recipe = KnightAWalkConfiguration.Load();
            public readonly MasterHumanoidRig rig;
            public readonly HumanoidFacingPresentation facing;
            public readonly HumanoidIdlePresentation player;
            public readonly HumanoidWalkProfile walkProfile;
            public readonly Animator[] animators = new Animator[3];
            public readonly SelectiveTeamColorPresentation color;
            public readonly SpriteRenderer renderer;
            readonly HumanoidIdleProfile originalIdle,coveredIdle;
            readonly List<AnimationClip> clips = new List<AnimationClip>();
            readonly Material material;
            readonly Texture2D texture,mask;
            readonly Sprite sprite;
            public Fixture()
            {
                var idle = KnightAIdleConfiguration.Load();
                rig = MasterHumanoidRigBuilder.CreateRigObject("WalkTest"); facing = rig.gameObject.AddComponent<HumanoidFacingPresentation>();
                string error; Assert.IsTrue(facing.Configure(rig,HumanoidFacing.FrontLeft,out error),error);
                var idleBindings = new List<HumanoidIdleBoneBinding>(); var walkBindings = new List<HumanoidWalkBoneBinding>();
                var originalClips = new List<HumanoidIdleViewClip>(); var coveredClips = new List<HumanoidIdleViewClip>(); var walkClips = new List<HumanoidIdleViewClip>();
                foreach (var view in recipe.views)
                {
                    var calibration = KnightASkinConfiguration.Load(view.view);
                    foreach (var bone in calibration.bones) rig.FindBone(view.view,bone.name).position = rig.VisualRoot.TransformPoint(calibration.ToRigPoint(bone.x,bone.y));
                    var idleView = Array.Find(idle.views,v=>v.view == view.view);
                    var original = KnightAIdleProofBuilder.CreateClip(idle,idleView,rig); clips.Add(original);
                    originalClips.Add(new HumanoidIdleViewClip { view = view.view,clip = original });
                    var covered = KnightAWalkProofBuilder.CreateCoveredIdleClip(idle,idleView,rig); clips.Add(covered);
                    coveredClips.Add(new HumanoidIdleViewClip { view = view.view,clip = covered });
                    var walk = KnightAWalkProofBuilder.CreateWalkClip(recipe,view,rig); clips.Add(walk);
                    walkClips.Add(new HumanoidIdleViewClip { view = view.view,clip = walk });
                    var animator = rig.GetViewRoot(view.view).gameObject.AddComponent<Animator>();
                    animator.applyRootMotion = false; animator.cullingMode = AnimatorCullingMode.AlwaysAnimate; animator.enabled = false; animators[(int)view.view] = animator;
                    foreach (var motion in idleView.motions)
                    {
                        var bone = rig.FindBone(view.view,motion.bone);
                        idleBindings.Add(new HumanoidIdleBoneBinding { view = view.view,boneName = motion.bone,bone = bone,neutralLocalRotation = bone.localRotation });
                    }
                    foreach (var name in HumanoidWalkContract.RotationBones) Capture(walkBindings,view.view,name);
                    Capture(walkBindings,view.view,"Pelvis");
                }
                originalIdle = ScriptableObject.CreateInstance<HumanoidIdleProfile>(); originalIdle.Configure(idle.duration,idle.ConfigurationHash,originalClips.ToArray());
                coveredIdle = ScriptableObject.CreateInstance<HumanoidIdleProfile>(); coveredIdle.Configure(idle.duration,idle.ConfigurationHash,coveredClips.ToArray());
                walkProfile = ScriptableObject.CreateInstance<HumanoidWalkProfile>(); walkProfile.Configure(recipe.duration,recipe.transitionDuration,recipe.ConfigurationHash,walkClips.ToArray());
                player = rig.gameObject.AddComponent<HumanoidIdlePresentation>();
                Assert.IsTrue(player.Configure(rig,facing,originalIdle,animators,idleBindings.ToArray(),out error),error);
                Assert.IsTrue(player.ConfigureWalk(walkProfile,walkBindings.ToArray(),coveredIdle,out error),error);
                player.SetAutomaticAdvance(false);
                material = new Material(AssetDatabase.LoadAssetAtPath<Shader>(KnightATeamColorProofBuilder.ShaderPath));
                texture = new Texture2D(8,8); mask = new Texture2D(8,8); sprite = Sprite.Create(texture,new Rect(0,0,8,8),Vector2.one*0.5f);
                renderer = new GameObject("LowerTorso").AddComponent<SpriteRenderer>();
                renderer.transform.SetParent(rig.GetViewRoot(MasterHumanoidView.Front).Find("SkinMount"),false); renderer.sprite = sprite;
                color = rig.gameObject.AddComponent<SelectiveTeamColorPresentation>();
                var binding = new TeamColorSectionBinding { view = MasterHumanoidView.Front,sectionId = "LowerTorso",renderer = renderer,sourceSprite = sprite,mask = mask,sourceBounds = new RectInt(0,0,8,8) };
                Assert.IsTrue(color.Configure(material,new[] { binding },"test",out error),error);
            }
            void Capture(List<HumanoidWalkBoneBinding> bindings,MasterHumanoidView view,string name)
            {
                var bone = rig.FindBone(view,name);
                bindings.Add(new HumanoidWalkBoneBinding { view = view,boneName = name,bone = bone,neutralLocalRotation = bone.localRotation,neutralLocalPosition = bone.localPosition });
            }
            public void Dispose()
            {
                UnityEngine.Object.DestroyImmediate(rig.gameObject);
                UnityEngine.Object.DestroyImmediate(originalIdle); UnityEngine.Object.DestroyImmediate(coveredIdle); UnityEngine.Object.DestroyImmediate(walkProfile);
                foreach (var clip in clips) UnityEngine.Object.DestroyImmediate(clip);
                UnityEngine.Object.DestroyImmediate(sprite); UnityEngine.Object.DestroyImmediate(texture); UnityEngine.Object.DestroyImmediate(mask); UnityEngine.Object.DestroyImmediate(material);
            }
        }
    }
}
