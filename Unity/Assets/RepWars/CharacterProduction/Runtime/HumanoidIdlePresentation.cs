using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;

namespace RepWars.CharacterProduction
{
    /// <summary>Idle/Walk cosmetic clock and standard Unity clip playback. Does not move roots or sprite pieces.</summary>
    [DisallowMultipleComponent]
    public sealed class HumanoidIdlePresentation : MonoBehaviour
    {
        [SerializeField] MasterHumanoidRig rig;
        [SerializeField] HumanoidFacingPresentation facing;
        [SerializeField] HumanoidIdleProfile profile;
        [SerializeField] Animator[] viewAnimators = Array.Empty<Animator>();
        [SerializeField] HumanoidIdleBoneBinding[] bones = Array.Empty<HumanoidIdleBoneBinding>();
        [SerializeField] HumanoidWalkProfile walkProfile;
        [SerializeField] HumanoidWalkBoneBinding[] walkBones = Array.Empty<HumanoidWalkBoneBinding>();
        [SerializeField] HumanoidAnimationState state;
        [SerializeField] bool automaticAdvance = true;
        [SerializeField] bool idleEnabled; // Legacy serialized name: now the animation enable flag.
        double otherPhase, blendElapsed;
        float walkWeight, blendStartWeight;
        bool transitioning;
        [SerializeField] double normalizedPhase;
        PlayableGraph graph;
        AnimationClipPlayable[] playables;
        AnimationClipPlayable[] walkPlayables;
        AnimationMixerPlayable[] mixers;
        HumanoidFacingPresentation subscribedFacing;

        public MasterHumanoidRig Rig { get { return rig; } }
        public HumanoidFacingPresentation Facing { get { return facing; } }
        public HumanoidIdleProfile Profile { get { return profile; } }
        public IReadOnlyList<Animator> ViewAnimators { get { return viewAnimators; } }
        public IReadOnlyList<HumanoidIdleBoneBinding> Bones { get { return bones; } }
        public bool IdleEnabled { get { return idleEnabled; } } // Kept for Phase 7 compatibility.
        public bool AnimationEnabled { get { return idleEnabled; } }
        public HumanoidAnimationState State { get { return state; } }
        public HumanoidWalkProfile WalkProfile { get { return walkProfile; } }
        public IReadOnlyList<HumanoidWalkBoneBinding> WalkBones { get { return walkBones; } }
        public bool AutomaticAdvance { get { return automaticAdvance; } }
        public bool IsTransitioning { get { return transitioning; } }
        public float WalkWeight { get { return walkWeight; } }
        public float CurrentDuration { get { return state == HumanoidAnimationState.Walk && walkProfile != null ? walkProfile.Duration : profile != null ? profile.Duration : 0f; } }
        public bool IsPlaying { get { return idleEnabled && graph.IsValid() && isActiveAndEnabled; } }
        public double NormalizedPhase { get { return normalizedPhase; } }
        public AnimationClip CurrentClip
        {
            get
            {
                HumanoidFacingSelection selection;
                return profile != null && facing != null && HumanoidFacingContract.TryResolve(facing.Facing,out selection)
                    ? (state == HumanoidAnimationState.Walk && walkProfile != null ? walkProfile.GetClip(selection.View) : profile.GetClip(selection.View)) : null;
            }
        }

        public bool Configure(MasterHumanoidRig newRig, HumanoidFacingPresentation newFacing, HumanoidIdleProfile newProfile,
            Animator[] animators, HumanoidIdleBoneBinding[] bindings, out string error)
        {
            if (rig != null || graph.IsValid()) { error = "Idle is already configured; create a separate proof instead of rebinding a live player."; return false; }
            var errors = ValidateReferences(newRig,newFacing,newProfile,animators,bindings);
            if (errors.Count != 0) { error = string.Join("\n",errors.ToArray()); return false; }
            rig = newRig; facing = newFacing; profile = newProfile;
            viewAnimators = (Animator[])animators.Clone(); bones = (HumanoidIdleBoneBinding[])bindings.Clone();
            idleEnabled = false;
            normalizedPhase = 0d;
            StopAndRestore();
            Subscribe();
            error = null;
            return true;
        }

        /// <summary>Add Walk once, while OFF/neutral. Existing Idle-only proofs keep their original graph.</summary>
        public bool ConfigureWalk(HumanoidWalkProfile newProfile, HumanoidWalkBoneBinding[] bindings, HumanoidIdleProfile coveredIdleProfile, out string error)
        {
            if (rig == null || idleEnabled || graph.IsValid() || walkProfile != null)
            { error = "Configure Walk once on a configured neutral/off animation player."; return false; }
            var errors = ValidateWalkReferences(newProfile,bindings);
            if (coveredIdleProfile == null) errors.Add("Walk requires neutral lower-body track coverage in its companion Idle clips.");
            else
            {
                errors.AddRange(coveredIdleProfile.Validate());
                if (profile == null || coveredIdleProfile.Duration != profile.Duration || coveredIdleProfile.ConfigurationSha256 != profile.ConfigurationSha256)
                    errors.Add("Companion Idle must retain the accepted Idle duration and semantic provenance.");
            }
            if (errors.Count != 0) { error = string.Join("\n",errors.ToArray()); return false; }
            profile = coveredIdleProfile; walkProfile = newProfile; walkBones = (HumanoidWalkBoneBinding[])bindings.Clone();
            error = null; return true;
        }

        public bool SetIdleEnabled(bool enabled)
        {
            if (enabled && !SetAnimationState(HumanoidAnimationState.Idle)) return false;
            return SetAnimationEnabled(enabled);
        }
        public bool SetAnimationEnabled(bool enabled)
        {
            if (!enabled) { idleEnabled = false; StopAndRestore(); return true; }
            if (Validate().Count != 0) return false;
            idleEnabled = true;
            Subscribe();
            if (isActiveAndEnabled)
            {
                try { StartGraph(); Sample(); }
                catch (Exception exception) { idleEnabled = false; StopAndRestore(); Debug.LogException(exception,this); return false; }
            }
            return true;
        }

        /// <summary>Presentation state only. New state starts at phase zero; reversing a live blend keeps both phases.</summary>
        public bool SetAnimationState(HumanoidAnimationState intent)
        {
            if (!Enum.IsDefined(typeof(HumanoidAnimationState),intent) || (intent == HumanoidAnimationState.Walk && walkProfile == null)) return false;
            if (intent == state) return true;
            var previous = normalizedPhase;
            normalizedPhase = IsPlaying && transitioning ? otherPhase : 0d;
            otherPhase = previous;
            state = intent;
            blendStartWeight = walkWeight; blendElapsed = 0d;
            transitioning = IsPlaying && walkProfile != null;
            if (!transitioning) walkWeight = state == HumanoidAnimationState.Walk ? 1f : 0f;
            if (IsPlaying) Sample();
            return true;
        }
        public void SetAutomaticAdvance(bool enabled) { automaticAdvance = enabled; }

        /// <summary>Useful for deterministic proof inspection. One phase is shared by all views; 1 wraps to 0.</summary>
        public bool TrySampleAtPhase(double phase)
        {
            if (!IsPlaying || double.IsNaN(phase) || double.IsInfinity(phase) || phase < 0d || phase > 1d) return false;
            normalizedPhase = phase == 1d ? 0d : phase;
            transitioning = false; walkWeight = state == HumanoidAnimationState.Walk ? 1f : 0f;
            Sample();
            return true;
        }

        /// <summary>Delta is local presentation time, never server/simulation time. Invalid deltas do nothing.</summary>
        public bool AdvancePresentation(double deltaSeconds)
        {
            if (!IsPlaying || double.IsNaN(deltaSeconds) || double.IsInfinity(deltaSeconds) || deltaSeconds < 0d) return false;
            normalizedPhase = (normalizedPhase + (deltaSeconds % CurrentDuration) / CurrentDuration) % 1d;
            if (transitioning)
            {
                var duration = state == HumanoidAnimationState.Walk ? profile.Duration : walkProfile.Duration;
                otherPhase = (otherPhase + (deltaSeconds % duration) / duration) % 1d;
                blendElapsed = Math.Min(walkProfile.TransitionDuration,blendElapsed + deltaSeconds);
                var t = (float)(blendElapsed / walkProfile.TransitionDuration);
                walkWeight = Mathf.Lerp(blendStartWeight,state == HumanoidAnimationState.Walk ? 1f : 0f,t*t*(3f-2f*t));
                if (t >= 1f) transitioning = false;
            }
            Sample();
            return true;
        }

        void Update() { if (IsPlaying && automaticAdvance) AdvancePresentation(Time.deltaTime); }
        void OnEnable()
        {
            Subscribe();
            if (idleEnabled) SetAnimationEnabled(true);
        }
        void OnDisable() { Unsubscribe(); StopAndRestore(); }
        void OnDestroy() { Unsubscribe(); StopAndRestore(); }
        void Subscribe()
        {
            if (subscribedFacing == facing) return;
            Unsubscribe();
            subscribedFacing = facing;
            if (subscribedFacing != null) subscribedFacing.FacingChanged += OnFacingChanged;
        }
        void Unsubscribe()
        {
            if (subscribedFacing != null) subscribedFacing.FacingChanged -= OnFacingChanged;
            subscribedFacing = null;
        }
        void OnFacingChanged(HumanoidFacing intent) { if (IsPlaying) Sample(); }

        void StartGraph()
        {
            if (graph.IsValid()) return;
            // Three standard clip outputs; Animator roots are BELOW VisualRoot, outside mirror/placement authority.
            graph = PlayableGraph.Create("RepWarsHumanoidAnimation");
            graph.SetTimeUpdateMode(DirectorUpdateMode.Manual);
            playables = new AnimationClipPlayable[3];
            if (walkProfile != null) { walkPlayables = new AnimationClipPlayable[3]; mixers = new AnimationMixerPlayable[3]; }
            transitioning = false; walkWeight = state == HumanoidAnimationState.Walk ? 1f : 0f;
            for (var i = 0; i < 3; i++)
            {
                playables[i] = AnimationClipPlayable.Create(graph,profile.GetClip((MasterHumanoidView)i));
                playables[i].SetApplyFootIK(false);
                playables[i].SetApplyPlayableIK(false);
                playables[i].SetSpeed(0d);
                var output = AnimationPlayableOutput.Create(graph,"Animation_" + (MasterHumanoidView)i,viewAnimators[i]);
                if (walkProfile == null) output.SetSourcePlayable(playables[i]);
                else
                {
                    walkPlayables[i] = AnimationClipPlayable.Create(graph,walkProfile.GetClip((MasterHumanoidView)i));
                    walkPlayables[i].SetApplyFootIK(false); walkPlayables[i].SetApplyPlayableIK(false); walkPlayables[i].SetSpeed(0d);
                    mixers[i] = AnimationMixerPlayable.Create(graph,2);
                    graph.Connect(playables[i],0,mixers[i],0); graph.Connect(walkPlayables[i],0,mixers[i],1);
                    output.SetSourcePlayable(mixers[i]);
                }
            }
            graph.Play();
        }

        void Sample()
        {
            HumanoidFacingSelection selected;
            if (!graph.IsValid() || facing == null || !HumanoidFacingContract.TryResolve(facing.Facing,out selected)) return;
            for (var i = 0; i < 3; i++)
            {
                if (viewAnimators[i] == null) { SetIdleEnabled(false); return; }
                var active = i == (int)selected.View;
                if (viewAnimators[i].enabled != active) viewAnimators[i].enabled = active;
                playables[i].SetTime((state == HumanoidAnimationState.Idle ? normalizedPhase : otherPhase) * profile.Duration);
                if (walkProfile != null)
                {
                    walkPlayables[i].SetTime((state == HumanoidAnimationState.Walk ? normalizedPhase : otherPhase) * walkProfile.Duration);
                    walkPlayables[i].SetDone(false);
                    mixers[i].SetInputWeight(0,1f-walkWeight); mixers[i].SetInputWeight(1,walkWeight);
                }
                playables[i].SetDone(false);
            }
            graph.Evaluate(0f);
        }

        void StopAndRestore()
        {
            if (graph.IsValid()) graph.Destroy();
            playables = null; walkPlayables = null; mixers = null;
            transitioning = false; walkWeight = state == HumanoidAnimationState.Walk ? 1f : 0f;
            if (viewAnimators != null) foreach (var animator in viewAnimators) if (animator != null) animator.enabled = false;
            // Restore owned bone offsets only. Pelvis local recovery below never changes Root/VisualRoot/Ground or sprite transforms.
            if (bones != null) foreach (var binding in bones)
            {
                if (binding == null || binding.bone == null || rig == null || !HumanoidIdleContract.IsAllowedBone(binding.boneName) ||
                    binding.bone.name != binding.boneName || !Enum.IsDefined(typeof(MasterHumanoidView),binding.view)) continue;
                var viewRoot = rig.GetViewRoot(binding.view);
                if (viewRoot != null && binding.bone.IsChildOf(viewRoot)) binding.bone.localRotation = binding.neutralLocalRotation;
            }
            if (walkBones != null) foreach (var binding in walkBones)
            {
                if (binding == null || binding.bone == null || rig == null || !HumanoidWalkContract.IsBindingBone(binding.boneName) ||
                    binding.bone.name != binding.boneName || !Enum.IsDefined(typeof(MasterHumanoidView),binding.view)) continue;
                var viewRoot = rig.GetViewRoot(binding.view);
                if (viewRoot == null || !binding.bone.IsChildOf(viewRoot)) continue;
                if (HumanoidWalkContract.IsRotationBone(binding.boneName)) binding.bone.localRotation = binding.neutralLocalRotation;
                if (binding.boneName == "Pelvis") binding.bone.localPosition = binding.neutralLocalPosition;
            }
        }

        public List<string> Validate()
        {
            var errors = ValidateReferences(rig,facing,profile,viewAnimators,bones);
            if (walkProfile != null) errors.AddRange(ValidateWalkReferences(walkProfile,walkBones));
            if (!Enum.IsDefined(typeof(HumanoidAnimationState),state) || (state == HumanoidAnimationState.Walk && walkProfile == null))
                errors.Add("Animation state must be Idle, or Walk with a configured Walk profile.");
            if (double.IsNaN(normalizedPhase) || double.IsInfinity(normalizedPhase) || normalizedPhase < 0d || normalizedPhase >= 1d)
                errors.Add("Cosmetic animation phase must be finite and in [0,1).");
            return errors;
        }

        List<string> ValidateWalkReferences(HumanoidWalkProfile candidate, HumanoidWalkBoneBinding[] bindings)
        {
            var errors = candidate != null ? candidate.Validate() : new List<string> { "Three-view Walk profile is missing." };
            var identities = new HashSet<string>();
            if (bindings == null) { errors.Add("Walk neutral bindings are missing."); return errors; }
            foreach (var binding in bindings)
            {
                if (binding == null || !Enum.IsDefined(typeof(MasterHumanoidView),binding.view) || !HumanoidWalkContract.IsBindingBone(binding.boneName) ||
                    !identities.Add(binding.view + "/" + binding.boneName) || binding.bone == null || rig == null || binding.bone != rig.FindBone(binding.view,binding.boneName))
                { errors.Add("Walk bindings must reference sixteen canonical rotation bones plus Pelvis once per view."); continue; }
                var q = binding.neutralLocalRotation;
                var norm = q.x*q.x+q.y*q.y+q.z*q.z+q.w*q.w;
                var p = binding.neutralLocalPosition;
                if (!HumanoidWalkContract.Finite(norm) || Mathf.Abs(norm-1f) > 0.0001f || !HumanoidWalkContract.Finite(p.x) || !HumanoidWalkContract.Finite(p.y) || !HumanoidWalkContract.Finite(p.z))
                    errors.Add(binding.boneName + ": finite calibrated neutral transform is required.");
                if (bones != null && HumanoidIdleContract.IsAllowedBone(binding.boneName))
                    foreach (var idleBone in bones)
                        if (idleBone != null && idleBone.view == binding.view && idleBone.boneName == binding.boneName &&
                            Quaternion.Angle(idleBone.neutralLocalRotation,binding.neutralLocalRotation) > 0.0001f)
                            errors.Add(binding.boneName + ": Walk neutral must match the accepted Idle binding.");
            }
            if (identities.Count != (HumanoidWalkContract.RotationBones.Count+1)*3) errors.Add("Exactly 51 Walk neutral bindings are required.");
            return errors;
        }

        List<string> ValidateReferences(MasterHumanoidRig candidate,HumanoidFacingPresentation facingCandidate,
            HumanoidIdleProfile profileCandidate,Animator[] animators,HumanoidIdleBoneBinding[] bindings)
        {
            var errors = MasterHumanoidRigValidator.Validate(candidate);
            if (candidate == null || candidate.gameObject != gameObject || facingCandidate == null ||
                facingCandidate.gameObject != gameObject || facingCandidate.Rig != candidate)
                errors.Add("Idle requires this object's own Master Humanoid and facing presentation.");
            if (profileCandidate == null) errors.Add("Three-view Idle profile is missing.");
            else errors.AddRange(profileCandidate.Validate());
            if (animators == null || animators.Length != 3) errors.Add("Exactly three view-local Animators are required.");
            else for (var i = 0; i < 3; i++)
            {
                var animator = animators[i];
                if (animator == null || candidate == null || animator.transform != candidate.GetViewRoot((MasterHumanoidView)i) ||
                    animator.applyRootMotion || animator.runtimeAnimatorController != null || animator.avatar != null ||
                    animator.cullingMode != AnimatorCullingMode.AlwaysAnimate)
                    errors.Add((MasterHumanoidView)i + ": Idle Animator must be on its authored view root, with no root motion/controller/avatar and AlwaysAnimate culling.");
            }
            var identities = new HashSet<string>();
            if (bindings == null) { errors.Add("Neutral animated-bone bindings are missing."); return errors; }
            foreach (var binding in bindings)
            {
                if (binding == null || !Enum.IsDefined(typeof(MasterHumanoidView),binding.view) ||
                    !HumanoidIdleContract.IsAllowedBone(binding.boneName) || !identities.Add(binding.view + "/" + binding.boneName) ||
                    binding.bone == null || candidate == null || binding.bone != candidate.FindBone(binding.view,binding.boneName))
                { errors.Add("Idle bindings must reference each allowed canonical upper-body bone once per authored view."); continue; }
                var q = binding.neutralLocalRotation;
                var norm = q.x*q.x + q.y*q.y + q.z*q.z + q.w*q.w;
                if (float.IsNaN(norm) || float.IsInfinity(norm) || Mathf.Abs(norm-1f) > 0.0001f)
                    errors.Add(binding.boneName + ": neutral rotation must be a finite unit quaternion.");
            }
            if (identities.Count != HumanoidIdleContract.AnimatedBones.Count * 3) errors.Add("All three views need the same eight animated-bone semantic bindings.");
            return errors;
        }
    }
}
