using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace RepWars.CharacterProduction.EditorTools
{
    public static class KnightAIdleProofBuilder
    {
        public const string GeneratedDirectory = MasterHumanoidRigBuilder.Root + "/Animation/Generated";
        public const string ProfilePath = GeneratedDirectory + "/KnightA_Idle.profile.asset";
        public const string ProofPath = MasterHumanoidRigBuilder.Root + "/Proof/KnightA_IdleProof.prefab";
        public static string ClipPath(MasterHumanoidView view) { return GeneratedDirectory + "/KnightA_" + view + "_Idle.anim"; }

        [MenuItem("RepWars/Character Production/Create Knight A Idle Proof")]
        public static void CreateMenu()
        {
            try { Debug.Log("[CharacterProduction] " + CreateProof()); }
            catch (Exception exception) { Debug.LogException(exception); }
        }

        [MenuItem("RepWars/Character Production/Validate Selected Knight A Idle Proof")]
        public static void ValidateMenu()
        {
            try
            {
                var root = Selection.activeObject as GameObject;
                var errors = Validate(root != null ? root.GetComponent<HumanoidIdlePresentation>() : null);
                if (errors.Count != 0) Debug.LogError(string.Join("\n",errors.ToArray()));
                else Debug.Log("Idle proof structure/data validates. Motion quality, rendering and mobile performance remain separate checks.");
            }
            catch (Exception exception) { Debug.LogException(exception); }
        }

        public static string CreateProof()
        {
            var recipe = KnightAIdleConfiguration.Load();
            var existing = AssetDatabase.LoadAssetAtPath<GameObject>(ProofPath);
            if (existing != null)
            {
                var errors = Validate(existing.GetComponent<HumanoidIdlePresentation>());
                if (errors.Count != 0) throw new InvalidOperationException("Existing Idle proof was not overwritten:\n" + string.Join("\n",errors.ToArray()));
                return "Existing Idle proof validates and was left unchanged.";
            }
            var full = KnightASkinConfiguration.AssetFullPath(GeneratedDirectory);
            if (File.Exists(KnightASkinConfiguration.AssetFullPath(ProofPath)) || (Directory.Exists(full) && Directory.GetFileSystemEntries(full).Length != 0))
                throw new InvalidOperationException("Partial/stale Idle outputs were not overwritten. Explicitly archive/remove only Idle generated outputs and the Idle proof before regeneration.");
            KnightATeamColorProofBuilder.CreateProof();
            var owned = new List<string>();
            GameObject root = null;
            try
            {
                MasterHumanoidRigBuilder.EnsureFolder(MasterHumanoidRigBuilder.Root + "/Animation");
                MasterHumanoidRigBuilder.EnsureFolder(GeneratedDirectory);
                root = PrefabUtility.LoadPrefabContents(KnightATeamColorProofBuilder.ProofPath);
                root.name = "KnightA_IdleProof";
                var rig = root.GetComponent<MasterHumanoidRig>();
                var facing = root.GetComponent<HumanoidFacingPresentation>();
                var animators = new Animator[3];
                var bindings = new List<HumanoidIdleBoneBinding>();
                var clips = new List<HumanoidIdleViewClip>();
                foreach (var view in recipe.views)
                {
                    var viewRoot = rig.GetViewRoot(view.view);
                    var clip = CreateClip(recipe,view,rig);
                    owned.Add(ClipPath(view.view));
                    AssetDatabase.CreateAsset(clip,ClipPath(view.view));
                    clips.Add(new HumanoidIdleViewClip { view = view.view, clip = clip });
                    var animator = viewRoot.gameObject.AddComponent<Animator>();
                    animator.applyRootMotion = false;
                    animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
                    animator.updateMode = AnimatorUpdateMode.Normal;
                    animator.enabled = false;
                    animators[(int)view.view] = animator;
                    foreach (var motion in view.motions)
                    {
                        var bone = rig.FindBone(view.view,motion.bone);
                        bindings.Add(new HumanoidIdleBoneBinding { view = view.view,boneName = motion.bone,
                            bone = bone,neutralLocalRotation = bone.localRotation });
                    }
                }
                var profile = ScriptableObject.CreateInstance<HumanoidIdleProfile>();
                profile.name = "KnightA_Idle";
                profile.Configure(recipe.duration,recipe.ConfigurationHash,clips.ToArray());
                owned.Add(ProfilePath);
                AssetDatabase.CreateAsset(profile,ProfilePath);
                var idle = root.AddComponent<HumanoidIdlePresentation>();
                string error;
                if (!idle.Configure(rig,facing,profile,animators,bindings.ToArray(),out error)) throw new InvalidOperationException(error);
                var validation = Validate(idle);
                if (validation.Count != 0) throw new InvalidOperationException(string.Join("\n",validation.ToArray()));
                AssetDatabase.SaveAssets();
                owned.Add(ProofPath);
                if (PrefabUtility.SaveAsPrefabAsset(root,ProofPath) == null) throw new InvalidOperationException("Unity could not save Idle proof.");
                var reloaded = PrefabUtility.LoadPrefabContents(ProofPath);
                try { validation = Validate(reloaded.GetComponent<HumanoidIdlePresentation>()); }
                finally { PrefabUtility.UnloadPrefabContents(reloaded); }
                if (validation.Count != 0) throw new InvalidOperationException("Reloaded Idle proof failed:\n" + string.Join("\n",validation.ToArray()));
                Selection.activeObject = AssetDatabase.LoadAssetAtPath<GameObject>(ProofPath);
                return "Created " + ProofPath + ". Idle starts OFF/neutral; enter Play Mode and enable Idle to review all six facings.";
            }
            catch
            {
                for (var i = owned.Count-1; i >= 0; i--)
                {
                    if (AssetDatabase.DeleteAsset(owned[i])) continue;
                    var path = KnightASkinConfiguration.AssetFullPath(owned[i]);
                    if (File.Exists(path)) File.Delete(path);
                    if (File.Exists(path + ".meta")) File.Delete(path + ".meta");
                }
                throw;
            }
            finally { if (root != null) PrefabUtility.UnloadPrefabContents(root); }
        }

        public static AnimationClip CreateClip(KnightAIdleConfiguration recipe,KnightAIdleViewDefinition view,MasterHumanoidRig rig)
        {
            var clip = new AnimationClip { name = "KnightA_" + view.view + "_Idle", frameRate = 30f, wrapMode = WrapMode.Loop, legacy = false };
            foreach (var motion in view.motions)
            {
                if (!HumanoidIdleContract.IsAllowedBone(motion.bone)) throw new InvalidOperationException("Idle cannot author a track for " + motion.bone);
                var bone = rig.FindBone(view.view,motion.bone);
                var path = AnimationUtility.CalculateTransformPath(bone,rig.GetViewRoot(view.view));
                var binding = EditorCurveBinding.FloatCurve(path,typeof(Transform),"localEulerAnglesRaw.z");
                AnimationUtility.SetEditorCurve(clip,binding,recipe.BuildCurve(motion,bone.localEulerAngles.z));
            }
            var settings = AnimationUtility.GetAnimationClipSettings(clip);
            settings.loopTime = true;
            settings.loopBlend = false;
            AnimationUtility.SetAnimationClipSettings(clip,settings);
            return clip;
        }

        public static List<string> Validate(HumanoidIdlePresentation idle)
        {
            var errors = new List<string>();
            if (idle == null) { errors.Add("Select the Knight A Idle proof root."); return errors; }
            var recipe = KnightAIdleConfiguration.Load();
            errors.AddRange(idle.Validate());
            if (idle.IdleEnabled || idle.IsPlaying)
            { errors.Add("Turn Idle OFF before bind-pose/skin integrity validation. This restores neutral without changing facing or color."); return errors; }
            errors.AddRange(KnightATeamColorProofBuilder.Validate(idle.GetComponent<SelectiveTeamColorPresentation>(),idle));
            if (idle.Profile == null || idle.Rig == null) return errors;
            if (idle.Profile.ConfigurationSha256 != recipe.ConfigurationHash || Mathf.Abs(idle.Profile.Duration-recipe.duration) > 0.0001f)
                errors.Add("Idle profile provenance/duration is stale.");
            if (AssetDatabase.GetAssetPath(idle.Profile) != ProfilePath) errors.Add("Proof must reference its generated Idle profile.");
            if (idle.GetComponentsInChildren<Animator>(true).Length != 3) errors.Add("Idle proof needs exactly three view-local Animators, never six or an outer-root Animator.");
            foreach (var view in recipe.views)
            {
                var clip = idle.Profile.GetClip(view.view);
                if (clip == null || AssetDatabase.GetAssetPath(clip) != ClipPath(view.view))
                { errors.Add(view.view + ": expected authored Idle clip path."); continue; }
                ValidateClip(clip,recipe,view,idle.Rig,errors);
            }
            foreach (var binding in idle.Bones)
            {
                if (binding == null || binding.bone == null) continue;
                // Current Knight A calibration has identity rotations; neutral must not be captured from a posed rig.
                if (Quaternion.Angle(binding.neutralLocalRotation,Quaternion.identity) > 0.0001f ||
                    Quaternion.Angle(binding.bone.localRotation,binding.neutralLocalRotation) > 0.0001f)
                    errors.Add(binding.view + "/" + binding.boneName + ": neutral rotation differs from the established Knight A bind pose.");
            }
            return errors;
        }

        public static void ValidateClip(AnimationClip clip,KnightAIdleConfiguration recipe,KnightAIdleViewDefinition view,
            MasterHumanoidRig rig,List<string> errors)
        {
            var curves = AnimationUtility.GetCurveBindings(clip);
            if (curves.Length != view.motions.Length || AnimationUtility.GetObjectReferenceCurveBindings(clip).Length != 0 || clip.events.Length != 0)
                errors.Add(view.view + ": exactly eight bone-rotation curves, no object/material/color/event tracks, are required.");
            if (clip.legacy || !AnimationUtility.GetAnimationClipSettings(clip).loopTime || Mathf.Abs(clip.length-recipe.duration) > 0.0001f)
                errors.Add(view.view + ": clip must be a non-legacy loop with the semantic duration.");
            var paths = new HashSet<string>();
            foreach (var motion in view.motions)
            {
                var bone = rig.FindBone(view.view,motion.bone);
                if (bone == null) { errors.Add("Missing Idle bone " + motion.bone); continue; }
                var path = AnimationUtility.CalculateTransformPath(bone,rig.GetViewRoot(view.view));
                paths.Add(path);
                var binding = EditorCurveBinding.FloatCurve(path,typeof(Transform),"localEulerAnglesRaw.z");
                var actual = AnimationUtility.GetEditorCurve(clip,binding);
                var expected = recipe.BuildCurve(motion,bone.localEulerAngles.z);
                if (actual == null || actual.length != expected.length) { errors.Add(view.view + "/" + motion.bone + ": missing or altered curve keys."); continue; }
                var keys = actual.keys; var reference = expected.keys;
                for (var i = 0; i < keys.Length; i++)
                    if (Mathf.Abs(keys[i].time-reference[i].time) > 0.00001f || Mathf.Abs(keys[i].value-reference[i].value) > 0.00001f ||
                        keys[i].inTangent != 0f || keys[i].outTangent != 0f || keys[i].weightedMode != WeightedMode.None)
                        errors.Add(view.view + "/" + motion.bone + ": curve differs from bounded zero-tangent semantic recipe.");
                if (keys[0].value != keys[keys.Length-1].value || keys[0].inTangent != keys[keys.Length-1].outTangent)
                    errors.Add(view.view + "/" + motion.bone + ": loop endpoints/slopes must match exactly.");
            }
            foreach (var curve in curves)
                if (curve.type != typeof(Transform) || curve.propertyName != "localEulerAnglesRaw.z" || !paths.Contains(curve.path))
                    errors.Add(view.view + ": forbidden curve " + curve.path + "/" + curve.propertyName + ". Roots, legs, sprites, sockets, colors and materials cannot be animated.");
        }
    }
}
