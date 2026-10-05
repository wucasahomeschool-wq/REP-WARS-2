using System;
using System.Collections.Generic;
using NUnit.Framework;
using RepWars.CharacterProduction.EditorTools;
using UnityEditor;
using UnityEngine;

namespace RepWars.CharacterProduction.Tests
{
    public sealed class HumanoidIdleTests
    {
        [Test]
        public void RecipeHasThreeCalibratedDefinitionsAndBoundedMatchingLoopEndpoints()
        {
            var recipe = KnightAIdleConfiguration.Load();
            Assert.IsEmpty(recipe.Validate()); // Verifies actual source and skin-calibration provenance.
            Assert.AreEqual(3,recipe.views.Length);
            Assert.AreEqual(4.8f,recipe.duration);
            Assert.AreEqual(6,recipe.phases.Length);
            foreach (var view in recipe.views)
            foreach (var motion in view.motions)
            {
                var curve = recipe.BuildCurve(motion,0f);
                Assert.AreEqual(0f,curve.keys[0].value);
                Assert.AreEqual(curve.keys[0].value,curve.keys[curve.length-1].value);
                foreach (var key in curve.keys) { Assert.AreEqual(0f,key.inTangent); Assert.AreEqual(0f,key.outTangent); }
                for (var i = 0; i <= 100; i++) Assert.LessOrEqual(Mathf.Abs(curve.Evaluate(recipe.duration*i/100f)),0.75f);
                Assert.IsTrue(HumanoidIdleContract.IsAllowedBone(motion.bone));
            }
        }

        [Test]
        public void GeneratedClipsContainOnlyAllowedViewRelativeZRotationCurves()
        {
            using (var fixture = new Fixture())
            {
                Assert.IsEmpty(fixture.profile.Validate());
                var recipe = KnightAIdleConfiguration.Load();
                foreach (var view in recipe.views)
                {
                    var clip = fixture.profile.GetClip(view.view);
                    var errors = new List<string>();
                    KnightAIdleProofBuilder.ValidateClip(clip,recipe,view,fixture.rig,errors);
                    Assert.IsEmpty(errors);
                    Assert.AreEqual(8,AnimationUtility.GetCurveBindings(clip).Length);
                    foreach (var curve in AnimationUtility.GetCurveBindings(clip))
                    {
                        Assert.AreEqual(typeof(Transform),curve.type);
                        Assert.AreEqual("localEulerAnglesRaw.z",curve.propertyName);
                        StringAssert.StartsWith("Skeleton/Root/Pelvis/Spine",curve.path);
                        StringAssert.DoesNotContain("SkinMount",curve.path);
                        StringAssert.DoesNotContain("VisualRoot",curve.path);
                    }
                }
            }
        }

        [Test]
        public void ValidatorRejectsWorldGroundColorAndLowerBodyTracks()
        {
            using (var fixture = new Fixture())
            {
                var recipe = KnightAIdleConfiguration.Load();
                var view = recipe.views[0];
                foreach (var forbidden in new[] {
                    EditorCurveBinding.FloatCurve("",typeof(Transform),"m_LocalPosition.x"),
                    EditorCurveBinding.FloatCurve("Socket_Ground",typeof(Transform),"localEulerAnglesRaw.z"),
                    EditorCurveBinding.FloatCurve("SkinMount/LowerTorso",typeof(SpriteRenderer),"m_Color.r"),
                    EditorCurveBinding.FloatCurve("Skeleton/Root/Pelvis/LeftThigh",typeof(Transform),"localEulerAnglesRaw.z") })
                {
                    var clip = KnightAIdleProofBuilder.CreateClip(recipe,view,fixture.rig);
                    try
                    {
                        AnimationUtility.SetEditorCurve(clip,forbidden,AnimationCurve.Linear(0f,0f,recipe.duration,1f));
                        var errors = new List<string>();
                        KnightAIdleProofBuilder.ValidateClip(clip,recipe,view,fixture.rig,errors);
                        Assert.IsTrue(errors.Exists(e=>e.Contains("forbidden curve")));
                    }
                    finally { UnityEngine.Object.DestroyImmediate(clip); }
                }
            }
        }

        [TestCase(HumanoidFacing.FrontLeft,MasterHumanoidView.Front)]
        [TestCase(HumanoidFacing.FrontRight,MasterHumanoidView.Front)]
        [TestCase(HumanoidFacing.Left,MasterHumanoidView.Side)]
        [TestCase(HumanoidFacing.Right,MasterHumanoidView.Side)]
        [TestCase(HumanoidFacing.BackLeft,MasterHumanoidView.Back)]
        [TestCase(HumanoidFacing.BackRight,MasterHumanoidView.Back)]
        public void SixFacingsReuseThreeClipsAndPreservePhaseColorAndMirror(HumanoidFacing facing,MasterHumanoidView view)
        {
            using (var fixture = new Fixture())
            {
                var color = new Color(0.2f,0.5f,0.8f);
                fixture.color.SetTeamColor(color);
                Assert.IsTrue(fixture.idle.SetIdleEnabled(true));
                Assert.IsTrue(fixture.idle.TrySampleAtPhase(0.37d));
                Assert.IsTrue(fixture.facing.TrySetFacing(facing));
                Assert.AreEqual(0.37d,fixture.idle.NormalizedPhase);
                Assert.AreSame(fixture.profile.GetClip(view),fixture.idle.CurrentClip);
                var recipe = KnightAIdleConfiguration.Load();
                var viewDefinition = Array.Find(recipe.views,v=>v.view == view);
                var chestMotion = Array.Find(viewDefinition.motions,m=>m.bone == "Chest");
                var expectedChest = chestMotion.breathDegrees + chestMotion.settleDegrees*0.2f;
                Assert.AreEqual(expectedChest,Mathf.DeltaAngle(0f,fixture.rig.FindBone(view,"Chest").localEulerAngles.z),0.005f);
                HumanoidFacingSelection selection;
                Assert.IsTrue(HumanoidFacingContract.TryResolve(facing,out selection));
                Assert.AreEqual(selection.Mirrored ? -1f : 1f,fixture.rig.VisualRoot.localScale.x);
                var activeAnimators = 0;
                for (var i = 0; i < 3; i++)
                {
                    Assert.AreEqual(i == (int)view,fixture.animators[i].enabled);
                    if (fixture.animators[i].enabled) activeAnimators++;
                    Assert.IsFalse(fixture.animators[i].applyRootMotion);
                    Assert.IsNull(fixture.animators[i].runtimeAnimatorController);
                }
                Assert.AreEqual(1,activeAnimators);
                Assert.IsEmpty(HumanoidFacingValidator.Validate(fixture.facing,fixture.idle));
                Assert.IsNotEmpty(HumanoidFacingValidator.Validate(fixture.facing)); // Static-proof policy remains strict.
                Assert.AreEqual(color,fixture.color.TeamColor);
                Assert.IsTrue(fixture.color.RecolorEnabled);
                Assert.AreEqual(1f,ReadBlock(fixture.colorBinding).GetFloat("_TeamColorEnabled"));
                fixture.color.DisableTeamColor();
                Assert.IsTrue(fixture.idle.IsPlaying);
                Assert.AreEqual(0.37d,fixture.idle.NormalizedPhase);
                fixture.idle.SetIdleEnabled(false);
                Assert.AreEqual(facing,fixture.facing.Facing);
                Assert.AreEqual(selection.Mirrored ? -1f : 1f,fixture.rig.VisualRoot.localScale.x);
            }
        }

        [Test]
        public void IdleChangesUpperRotationWithoutMovingRootsFeetOrSpritePieces()
        {
            using (var fixture = new Fixture())
            {
                fixture.rig.transform.position = new Vector3(12f,-8f,0f);
                fixture.facing.TrySetFacing(HumanoidFacing.FrontRight);
                var placement = fixture.rig.transform.position;
                var scale = fixture.rig.VisualRoot.localScale;
                var ground = fixture.rig.GroundSocket.position;
                var foot = fixture.rig.FindBone(MasterHumanoidView.Front,"LeftFoot").position;
                var transforms = fixture.rig.GetComponentsInChildren<Transform>(true);
                var positions = Array.ConvertAll(transforms,t=>t.localPosition);
                var scales = Array.ConvertAll(transforms,t=>t.localScale);
                Assert.IsTrue(fixture.idle.SetIdleEnabled(true));
                Assert.IsTrue(fixture.idle.TrySampleAtPhase(0.37d));
                var chest = fixture.rig.FindBone(MasterHumanoidView.Front,"Chest");
                Assert.AreEqual(0.335f,Mathf.DeltaAngle(0f,chest.localEulerAngles.z),0.005f);
                Assert.AreEqual(placement,fixture.rig.transform.position);
                Assert.AreEqual(scale,fixture.rig.VisualRoot.localScale);
                Assert.AreEqual(ground,fixture.rig.GroundSocket.position);
                Assert.Less(Vector3.Distance(foot,fixture.rig.FindBone(MasterHumanoidView.Front,"LeftFoot").position),0.00001f);
                for (var i = 0; i < transforms.Length; i++)
                { Assert.Less(Vector3.Distance(positions[i],transforms[i].localPosition),0.00001f); Assert.AreEqual(scales[i],transforms[i].localScale); }
                foreach (var definition in MasterHumanoidRigContract.Bones)
                    if (!HumanoidIdleContract.IsAllowedBone(definition.name))
                        Assert.AreEqual(Quaternion.identity,fixture.rig.FindBone(MasterHumanoidView.Front,definition.name).localRotation);
            }
        }

        [Test]
        public void DisablingRestoresAllNeutralRotationsAndReenableRetainsPhase()
        {
            using (var fixture = new Fixture())
            {
                Assert.IsFalse(fixture.idle.IdleEnabled);
                fixture.color.SetTeamColor(Color.blue);
                Assert.IsTrue(fixture.idle.SetIdleEnabled(true));
                Assert.IsTrue(fixture.idle.TrySampleAtPhase(0.6d));
                fixture.facing.TrySetFacing(HumanoidFacing.BackRight);
                Assert.IsTrue(fixture.idle.SetIdleEnabled(false));
                Assert.IsFalse(fixture.idle.IsPlaying);
                foreach (var binding in fixture.idle.Bones) Assert.AreEqual(binding.neutralLocalRotation,binding.bone.localRotation);
                Assert.AreEqual(0.6d,fixture.idle.NormalizedPhase);
                Assert.AreEqual(Color.blue,fixture.color.TeamColor);
                Assert.AreEqual(1f,ReadBlock(fixture.colorBinding).GetFloat("_TeamColorEnabled"));
                Assert.IsTrue(fixture.idle.SetIdleEnabled(true));
                Assert.AreEqual(0.6d,fixture.idle.NormalizedPhase);
                fixture.idle.enabled = false;
                Assert.IsFalse(fixture.idle.IsPlaying);
                foreach (var binding in fixture.idle.Bones) Assert.AreEqual(binding.neutralLocalRotation,binding.bone.localRotation);
                fixture.idle.enabled = true;
                Assert.IsTrue(fixture.idle.IsPlaying);
                Assert.AreEqual(0.6d,fixture.idle.NormalizedPhase);
            }
        }

        [Test]
        public void PresentationClockWrapsAndRejectsInvalidInputWithoutStateChange()
        {
            using (var fixture = new Fixture())
            {
                Assert.IsFalse(fixture.idle.AdvancePresentation(1d));
                fixture.idle.SetIdleEnabled(true);
                fixture.idle.TrySampleAtPhase(0.81d);
                Assert.IsTrue(fixture.idle.AdvancePresentation(fixture.profile.Duration*1.4d));
                Assert.AreEqual(0.21d,fixture.idle.NormalizedPhase,0.000001d);
                var previous = fixture.idle.NormalizedPhase;
                foreach (var invalid in new[] { -1d,double.NaN,double.PositiveInfinity })
                { Assert.IsFalse(fixture.idle.AdvancePresentation(invalid)); Assert.IsFalse(fixture.idle.TrySampleAtPhase(invalid)); }
                Assert.AreEqual(previous,fixture.idle.NormalizedPhase);
                Assert.IsTrue(fixture.idle.TrySampleAtPhase(1d));
                Assert.AreEqual(0d,fixture.idle.NormalizedPhase);
            }
        }

        [Test]
        public void InvalidOwnerRootBindingRootMotionAndDuplicateViewClipAreRejected()
        {
            using (var fixture = new Fixture())
            {
                var other = new GameObject("ForeignOwner").AddComponent<HumanoidIdlePresentation>();
                try
                {
                    string error;
                    var bindings = new List<HumanoidIdleBoneBinding>(fixture.idle.Bones).ToArray();
                    Assert.IsFalse(other.Configure(fixture.rig,fixture.facing,fixture.profile,fixture.animators,bindings,out error));
                    bindings[0] = new HumanoidIdleBoneBinding { view = MasterHumanoidView.Front,boneName = "Root",
                        bone = fixture.rig.FindBone(MasterHumanoidView.Front,"Root"),neutralLocalRotation = Quaternion.identity };
                    // Even a foreign-owner request must diagnose the forbidden Root binding, without accepting it.
                    Assert.IsFalse(other.Configure(fixture.rig,fixture.facing,fixture.profile,fixture.animators,bindings,out error));
                    Assert.IsTrue(error.Contains("upper-body bone"));
                    fixture.animators[0].applyRootMotion = true;
                    Assert.IsNotEmpty(fixture.idle.Validate());
                    Assert.IsFalse(fixture.idle.SetIdleEnabled(true));
                    fixture.profile.Configure(fixture.profile.Duration,"test",new[] {
                        new HumanoidIdleViewClip { view = MasterHumanoidView.Front,clip = fixture.profile.GetClip(MasterHumanoidView.Front) },
                        new HumanoidIdleViewClip { view = MasterHumanoidView.Side,clip = fixture.profile.GetClip(MasterHumanoidView.Front) },
                        new HumanoidIdleViewClip { view = MasterHumanoidView.Back,clip = fixture.profile.GetClip(MasterHumanoidView.Back) } });
                    Assert.IsNotEmpty(fixture.profile.Validate());
                }
                finally { UnityEngine.Object.DestroyImmediate(other.gameObject); }
            }
        }

        static MaterialPropertyBlock ReadBlock(TeamColorSectionBinding binding)
        { var block = new MaterialPropertyBlock(); binding.renderer.GetPropertyBlock(block); return block; }

        sealed class Fixture : IDisposable
        {
            public readonly MasterHumanoidRig rig;
            public readonly HumanoidFacingPresentation facing;
            public readonly HumanoidIdlePresentation idle;
            public readonly HumanoidIdleProfile profile;
            public readonly Animator[] animators = new Animator[3];
            public readonly SelectiveTeamColorPresentation color;
            public readonly TeamColorSectionBinding colorBinding;
            readonly List<AnimationClip> clips = new List<AnimationClip>();
            readonly Material material;
            readonly Texture2D texture,mask;
            readonly Sprite sprite;
            public Fixture()
            {
                var recipe = KnightAIdleConfiguration.Load();
                rig = MasterHumanoidRigBuilder.CreateRigObject("IdleTest");
                facing = rig.gameObject.AddComponent<HumanoidFacingPresentation>();
                string error;
                Assert.IsTrue(facing.Configure(rig,HumanoidFacing.FrontLeft,out error),error);
                var bindings = new List<HumanoidIdleBoneBinding>();
                var viewClips = new List<HumanoidIdleViewClip>();
                foreach (var view in recipe.views)
                {
                    var calibration = KnightASkinConfiguration.Load(view.view);
                    foreach (var bone in calibration.bones)
                        rig.FindBone(view.view,bone.name).position = rig.VisualRoot.TransformPoint(calibration.ToRigPoint(bone.x,bone.y));
                    var clip = KnightAIdleProofBuilder.CreateClip(recipe,view,rig);
                    clips.Add(clip); viewClips.Add(new HumanoidIdleViewClip { view = view.view,clip = clip });
                    var animator = rig.GetViewRoot(view.view).gameObject.AddComponent<Animator>();
                    animator.applyRootMotion = false; animator.cullingMode = AnimatorCullingMode.AlwaysAnimate; animator.enabled = false;
                    animators[(int)view.view] = animator;
                    foreach (var motion in view.motions)
                    {
                        var bone = rig.FindBone(view.view,motion.bone);
                        bindings.Add(new HumanoidIdleBoneBinding { view = view.view,boneName = motion.bone,bone = bone,neutralLocalRotation = bone.localRotation });
                    }
                }
                profile = ScriptableObject.CreateInstance<HumanoidIdleProfile>();
                profile.Configure(recipe.duration,recipe.ConfigurationHash,viewClips.ToArray());
                idle = rig.gameObject.AddComponent<HumanoidIdlePresentation>();
                Assert.IsTrue(idle.Configure(rig,facing,profile,animators,bindings.ToArray(),out error),error);
                var shader = AssetDatabase.LoadAssetAtPath<Shader>(KnightATeamColorProofBuilder.ShaderPath);
                Assert.IsNotNull(shader);
                material = new Material(shader); texture = new Texture2D(8,8); mask = new Texture2D(8,8);
                sprite = Sprite.Create(texture,new Rect(0,0,8,8),Vector2.one*0.5f);
                var renderer = new GameObject("LowerTorso").AddComponent<SpriteRenderer>();
                renderer.transform.SetParent(rig.GetViewRoot(MasterHumanoidView.Front).Find("SkinMount"),false);
                renderer.sprite = sprite;
                colorBinding = new TeamColorSectionBinding { view = MasterHumanoidView.Front,sectionId = "LowerTorso",renderer = renderer,
                    sourceSprite = sprite,mask = mask,sourceBounds = new RectInt(0,0,8,8) };
                color = rig.gameObject.AddComponent<SelectiveTeamColorPresentation>();
                Assert.IsTrue(color.Configure(material,new[] { colorBinding },"test",out error),error);
            }
            public void Dispose()
            {
                UnityEngine.Object.DestroyImmediate(rig.gameObject);
                UnityEngine.Object.DestroyImmediate(profile);
                foreach (var clip in clips) UnityEngine.Object.DestroyImmediate(clip);
                UnityEngine.Object.DestroyImmediate(sprite); UnityEngine.Object.DestroyImmediate(texture);
                UnityEngine.Object.DestroyImmediate(mask); UnityEngine.Object.DestroyImmediate(material);
            }
        }
    }
}
