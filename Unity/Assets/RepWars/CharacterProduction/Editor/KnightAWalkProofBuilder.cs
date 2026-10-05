using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace RepWars.CharacterProduction.EditorTools
{
    public static class KnightAWalkProofBuilder
    {
        public const string GeneratedDirectory = MasterHumanoidRigBuilder.Root + "/Animation/WalkGenerated";
        public const string WalkProfilePath = GeneratedDirectory + "/KnightA_Walk.profile.asset";
        public const string IdleProfilePath = GeneratedDirectory + "/KnightA_IdleCoverage.profile.asset";
        public const string ProofPath = MasterHumanoidRigBuilder.Root + "/Proof/KnightA_WalkProof.prefab";
        public static string ClipPath(MasterHumanoidView view,HumanoidAnimationState state)
        { return GeneratedDirectory + "/KnightA_" + view + "_" + (state == HumanoidAnimationState.Idle ? "IdleCoverage" : "Walk") + ".anim"; }

        [MenuItem("RepWars/Character Production/Create Knight A Walk Proof")]
        public static void CreateMenu()
        { try { Debug.Log("[CharacterProduction] " + CreateProof()); } catch (Exception exception) { Debug.LogException(exception); } }
        [MenuItem("RepWars/Character Production/Validate Selected Knight A Walk Proof")]
        public static void ValidateMenu()
        {
            try
            {
                var root = Selection.activeObject as GameObject;
                var errors = Validate(root != null ? root.GetComponent<HumanoidIdlePresentation>() : null);
                if (errors.Count == 0) Debug.Log("Walk proof data validates; Unity playback, foot appearance and performance need separate review.");
                else Debug.LogError(string.Join("\n",errors.ToArray()));
            }
            catch (Exception exception) { Debug.LogException(exception); }
        }
        public static string CreateProof()
        {
            var walkRecipe = KnightAWalkConfiguration.Load(); var idleRecipe = KnightAIdleConfiguration.Load();
            var existing = AssetDatabase.LoadAssetAtPath<GameObject>(ProofPath);
            if (existing != null)
            {
                var errors = Validate(existing.GetComponent<HumanoidIdlePresentation>());
                if (errors.Count != 0) throw new InvalidOperationException("Existing Walk outputs were not overwritten:\n" + string.Join("\n",errors.ToArray()));
                return "Existing Walk proof validates and was left unchanged.";
            }
            var full = KnightASkinConfiguration.AssetFullPath(GeneratedDirectory);
            if (File.Exists(KnightASkinConfiguration.AssetFullPath(ProofPath)) || (Directory.Exists(full) && Directory.GetFileSystemEntries(full).Length != 0))
                throw new InvalidOperationException("Partial/stale Walk outputs were not overwritten. Explicitly archive only WalkGenerated and the Walk proof before regeneration.");
            KnightAIdleProofBuilder.CreateProof();
            GameObject root = null; var owned = new List<string>();
            try
            {
                MasterHumanoidRigBuilder.EnsureFolder(GeneratedDirectory);
                root = PrefabUtility.LoadPrefabContents(KnightAIdleProofBuilder.ProofPath);
                root.name = "KnightA_WalkProof";
                var player = root.GetComponent<HumanoidIdlePresentation>(); var rig = player.Rig;
                var idleClips = new List<HumanoidIdleViewClip>(); var walkClips = new List<HumanoidIdleViewClip>();
                var bindings = new List<HumanoidWalkBoneBinding>();
                foreach (var view in walkRecipe.views)
                {
                    var walkClip = CreateWalkClip(walkRecipe,view,rig);
                    owned.Add(ClipPath(view.view,HumanoidAnimationState.Walk)); AssetDatabase.CreateAsset(walkClip,owned[owned.Count-1]);
                    walkClips.Add(new HumanoidIdleViewClip { view = view.view,clip = walkClip });
                    var idleView = Array.Find(idleRecipe.views,v=>v.view == view.view);
                    var idleClip = CreateCoveredIdleClip(idleRecipe,idleView,rig);
                    owned.Add(ClipPath(view.view,HumanoidAnimationState.Idle)); AssetDatabase.CreateAsset(idleClip,owned[owned.Count-1]);
                    idleClips.Add(new HumanoidIdleViewClip { view = view.view,clip = idleClip });
                    foreach (var name in HumanoidWalkContract.RotationBones) Capture(bindings,rig,view.view,name);
                    Capture(bindings,rig,view.view,"Pelvis");
                }
                var coveredIdle = ScriptableObject.CreateInstance<HumanoidIdleProfile>(); coveredIdle.name = "KnightA_IdleCoverage";
                coveredIdle.Configure(idleRecipe.duration,idleRecipe.ConfigurationHash,idleClips.ToArray());
                owned.Add(IdleProfilePath); AssetDatabase.CreateAsset(coveredIdle,IdleProfilePath);
                var profile = ScriptableObject.CreateInstance<HumanoidWalkProfile>(); profile.name = "KnightA_Walk";
                profile.Configure(walkRecipe.duration,walkRecipe.transitionDuration,walkRecipe.ConfigurationHash,walkClips.ToArray());
                owned.Add(WalkProfilePath); AssetDatabase.CreateAsset(profile,WalkProfilePath);
                string error;
                if (!player.ConfigureWalk(profile,bindings.ToArray(),coveredIdle,out error)) throw new InvalidOperationException(error);
                var validation = Validate(player);
                if (validation.Count != 0) throw new InvalidOperationException(string.Join("\n",validation.ToArray()));
                AssetDatabase.SaveAssets(); owned.Add(ProofPath);
                if (PrefabUtility.SaveAsPrefabAsset(root,ProofPath) == null) throw new InvalidOperationException("Unity could not save Walk proof.");
                var reload = PrefabUtility.LoadPrefabContents(ProofPath);
                try { validation = Validate(reload.GetComponent<HumanoidIdlePresentation>()); }
                finally { PrefabUtility.UnloadPrefabContents(reload); }
                if (validation.Count != 0) throw new InvalidOperationException("Reloaded Walk proof failed:\n" + string.Join("\n",validation.ToArray()));
                Selection.activeObject = AssetDatabase.LoadAssetAtPath<GameObject>(ProofPath);
                return "Created " + ProofPath + ". Animation starts OFF/neutral. Play Mode controls support Idle/Walk, six facings, phase seek/pause and selective color.";
            }
            catch
            {
                for (var i = owned.Count-1; i >= 0; i--)
                {
                    if (AssetDatabase.DeleteAsset(owned[i])) continue;
                    var path = KnightASkinConfiguration.AssetFullPath(owned[i]);
                    if (File.Exists(path)) File.Delete(path);
                    if (File.Exists(path+".meta")) File.Delete(path+".meta");
                }
                throw;
            }
            finally { if (root != null) PrefabUtility.UnloadPrefabContents(root); }
        }
        static void Capture(List<HumanoidWalkBoneBinding> bindings,MasterHumanoidRig rig,MasterHumanoidView view,string name)
        {
            var bone = rig.FindBone(view,name);
            bindings.Add(new HumanoidWalkBoneBinding { view = view,boneName = name,bone = bone,
                neutralLocalRotation = bone.localRotation,neutralLocalPosition = bone.localPosition });
        }
        public static AnimationClip CreateWalkClip(KnightAWalkConfiguration recipe,KnightAWalkViewDefinition view,MasterHumanoidRig rig)
        {
            var clip = NewClip("KnightA_" + view.view + "_Walk");
            var curves = recipe.BuildCurves(view,KnightASkinConfiguration.Load(view.view));
            foreach (var pair in curves)
            {
                var name = pair.Key == "PelvisY" ? "Pelvis" : pair.Key;
                if (name != "Pelvis" && !HumanoidWalkContract.IsRotationBone(name)) throw new InvalidOperationException("Forbidden Walk bone " + name);
                var bone = rig.FindBone(view.view,name); var curve = pair.Value;
                var neutral = name == "Pelvis" ? bone.localPosition.y : SignedNeutral(bone);
                var keys = curve.keys;
                for (var i = 0; i < keys.Length; i++) keys[i].value += neutral;
                curve.keys = keys;
                AnimationUtility.SetEditorCurve(clip,Binding(rig,view.view,name),curve);
            }
            SetLoop(clip); return clip;
        }
        // Explicit neutral tracks match the Walk target set. No dependence on implicit Animator default-value recovery.
        public static AnimationClip CreateCoveredIdleClip(KnightAIdleConfiguration recipe,KnightAIdleViewDefinition view,MasterHumanoidRig rig)
        {
            var clip = KnightAIdleProofBuilder.CreateClip(recipe,view,rig); clip.name = "KnightA_" + view.view + "_IdleCoverage";
            foreach (var name in HumanoidWalkContract.RotationBones)
                if (!HumanoidIdleContract.IsAllowedBone(name))
                {
                    var neutral = SignedNeutral(rig.FindBone(view.view,name));
                    AnimationUtility.SetEditorCurve(clip,Binding(rig,view.view,name),AnimationCurve.Linear(0f,neutral,recipe.duration,neutral));
                }
            var y = rig.FindBone(view.view,"Pelvis").localPosition.y;
            AnimationUtility.SetEditorCurve(clip,Binding(rig,view.view,"Pelvis"),AnimationCurve.Linear(0f,y,recipe.duration,y));
            SetLoop(clip); return clip;
        }
        static AnimationClip NewClip(string name) { return new AnimationClip { name = name,legacy = false,frameRate = 30f,wrapMode = WrapMode.Loop }; }
        static void SetLoop(AnimationClip clip)
        { var settings = AnimationUtility.GetAnimationClipSettings(clip); settings.loopTime = true; settings.loopBlend = false; AnimationUtility.SetAnimationClipSettings(clip,settings); }
        public static EditorCurveBinding Binding(MasterHumanoidRig rig,MasterHumanoidView view,string name)
        { return EditorCurveBinding.FloatCurve(AnimationUtility.CalculateTransformPath(rig.FindBone(view,name),rig.GetViewRoot(view)),typeof(Transform),name == "Pelvis" ? "m_LocalPosition.y" : "localEulerAnglesRaw.z"); }
        static float SignedNeutral(Transform bone) { return Mathf.DeltaAngle(0f,bone.localEulerAngles.z); }

        public static List<string> Validate(HumanoidIdlePresentation player)
        {
            var errors = new List<string>();
            if (player == null) { errors.Add("Select the Knight A Walk proof root."); return errors; }
            var recipe = KnightAWalkConfiguration.Load(); var idleRecipe = KnightAIdleConfiguration.Load();
            errors.AddRange(player.Validate());
            if (player.AnimationEnabled || player.IsPlaying) { errors.Add("Disable animation to restore calibrated neutral before full skin/bind validation."); return errors; }
            errors.AddRange(KnightATeamColorProofBuilder.Validate(player.GetComponent<SelectiveTeamColorPresentation>(),player));
            if (player.WalkProfile == null || player.Profile == null || player.Rig == null) { errors.Add("Both Idle and Walk profiles are required."); return errors; }
            if (player.GetComponentsInChildren<Animator>(true).Length != 3) errors.Add("Exactly three view-local Animators are required, no extra controller/outer-root/mirrored targets.");
            if (AssetDatabase.GetAssetPath(player.WalkProfile) != WalkProfilePath || player.WalkProfile.ConfigurationSha256 != recipe.ConfigurationHash ||
                player.WalkProfile.Duration != recipe.duration || player.WalkProfile.TransitionDuration != recipe.transitionDuration ||
                AssetDatabase.GetAssetPath(player.Profile) != IdleProfilePath || player.Profile.ConfigurationSha256 != idleRecipe.ConfigurationHash || player.Profile.Duration != idleRecipe.duration)
                errors.Add("Walk/covered Idle native profile paths/provenance/durations are stale.");
            foreach (var view in recipe.views)
            {
                var idleView = Array.Find(idleRecipe.views,v=>v.view == view.view);
                var expectedWalk = CreateWalkClip(recipe,view,player.Rig); var expectedIdle = CreateCoveredIdleClip(idleRecipe,idleView,player.Rig);
                try
                {
                    foreach (var state in new[] { HumanoidAnimationState.Idle,HumanoidAnimationState.Walk })
                    {
                        var actual = state == HumanoidAnimationState.Walk ? player.WalkProfile.GetClip(view.view) : player.Profile.GetClip(view.view);
                        if (actual == null || AssetDatabase.GetAssetPath(actual) != ClipPath(view.view,state)) { errors.Add(view.view + ": missing authored clip path for " + state); continue; }
                        ValidateClip(actual,state == HumanoidAnimationState.Walk ? expectedWalk : expectedIdle,player.Rig,view.view,errors);
                    }
                }
                finally { UnityEngine.Object.DestroyImmediate(expectedWalk); UnityEngine.Object.DestroyImmediate(expectedIdle); }
            }
            foreach (var binding in player.WalkBones)
            {
                if (binding == null || binding.bone == null) continue;
                if (Quaternion.Angle(binding.bone.localRotation,binding.neutralLocalRotation) > 0.0001f || Quaternion.Angle(binding.neutralLocalRotation,Quaternion.identity) > 0.0001f ||
                    Vector3.Distance(binding.bone.localPosition,binding.neutralLocalPosition) > 0.00001f) errors.Add(binding.view + "/" + binding.boneName + ": calibrated neutral was not preserved/restored.");
            }
            return errors;
        }
        public static void ValidateClip(AnimationClip clip,AnimationClip expected,MasterHumanoidRig rig,MasterHumanoidView view,List<string> errors)
        {
            if (clip == null || expected == null) { errors.Add("Missing animation clip for structural validation."); return; }
            var curves = AnimationUtility.GetCurveBindings(clip);
            if (curves.Length != 17 || AnimationUtility.GetObjectReferenceCurveBindings(clip).Length != 0 || clip.events.Length != 0 ||
                clip.legacy || !AnimationUtility.GetAnimationClipSettings(clip).loopTime || Mathf.Abs(clip.length-expected.length) > 0.00001f)
                errors.Add(view + ": expected 16 bone rotations plus local Pelvis Y, matching duration/loop, no objects/events.");
            var allowed = new HashSet<string>();
            foreach (var binding in AnimationUtility.GetCurveBindings(expected))
            {
                allowed.Add(binding.path + "/" + binding.propertyName);
                var actual = AnimationUtility.GetEditorCurve(clip,binding); var reference = AnimationUtility.GetEditorCurve(expected,binding);
                if (actual == null || actual.length != reference.length) { errors.Add(view + ": missing/altered curve for " + binding.path); continue; }
                var keys = actual.keys; var referenceKeys = reference.keys;
                for (var i = 0; i < keys.Length; i++)
                    if (Mathf.Abs(keys[i].time-referenceKeys[i].time) > 0.00001f || Mathf.Abs(keys[i].value-referenceKeys[i].value) > 0.00001f ||
                        Mathf.Abs(keys[i].inTangent-referenceKeys[i].inTangent) > 0.0001f || Mathf.Abs(keys[i].outTangent-referenceKeys[i].outTangent) > 0.0001f || keys[i].weightedMode != WeightedMode.None)
                    { errors.Add(view + ": curve differs from deterministic gait/neutral coverage recipe: " + binding.path); break; }
                if (keys[0].value != keys[keys.Length-1].value || keys[0].inTangent != keys[keys.Length-1].outTangent)
                    errors.Add(view + ": loop endpoints/slopes do not match.");
            }
            foreach (var binding in curves)
                if (binding.type != typeof(Transform) || !allowed.Contains(binding.path + "/" + binding.propertyName))
                    errors.Add(view + ": forbidden curve " + binding.path + "/" + binding.propertyName + ". No Root/VisualRoot/world/Ground/sprite/color/scale tracks.");
        }
    }
}
