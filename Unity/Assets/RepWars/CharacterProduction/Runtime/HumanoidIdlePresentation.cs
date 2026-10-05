using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;

namespace RepWars.CharacterProduction
{
    /// <summary>Idle-only cosmetic clock and standard Unity clip playback. Does not move roots or sprite pieces.</summary>
    [DisallowMultipleComponent]
    public sealed class HumanoidIdlePresentation : MonoBehaviour
    {
        [SerializeField] MasterHumanoidRig rig;
        [SerializeField] HumanoidFacingPresentation facing;
        [SerializeField] HumanoidIdleProfile profile;
        [SerializeField] Animator[] viewAnimators = Array.Empty<Animator>();
        [SerializeField] HumanoidIdleBoneBinding[] bones = Array.Empty<HumanoidIdleBoneBinding>();
        [SerializeField] bool idleEnabled;
        [SerializeField] double normalizedPhase;
        PlayableGraph graph;
        AnimationClipPlayable[] playables;
        HumanoidFacingPresentation subscribedFacing;

        public MasterHumanoidRig Rig { get { return rig; } }
        public HumanoidFacingPresentation Facing { get { return facing; } }
        public HumanoidIdleProfile Profile { get { return profile; } }
        public IReadOnlyList<Animator> ViewAnimators { get { return viewAnimators; } }
        public IReadOnlyList<HumanoidIdleBoneBinding> Bones { get { return bones; } }
        public bool IdleEnabled { get { return idleEnabled; } }
        public bool IsPlaying { get { return idleEnabled && graph.IsValid() && isActiveAndEnabled; } }
        public double NormalizedPhase { get { return normalizedPhase; } }
        public AnimationClip CurrentClip
        {
            get
            {
                HumanoidFacingSelection selection;
                return profile != null && facing != null && HumanoidFacingContract.TryResolve(facing.Facing,out selection)
                    ? profile.GetClip(selection.View) : null;
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

        public bool SetIdleEnabled(bool enabled)
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

        /// <summary>Useful for deterministic proof inspection. One phase is shared by all views; 1 wraps to 0.</summary>
        public bool TrySampleAtPhase(double phase)
        {
            if (!IsPlaying || double.IsNaN(phase) || double.IsInfinity(phase) || phase < 0d || phase > 1d) return false;
            normalizedPhase = phase == 1d ? 0d : phase;
            Sample();
            return true;
        }

        /// <summary>Delta is local presentation time, never server/simulation time. Invalid deltas do nothing.</summary>
        public bool AdvancePresentation(double deltaSeconds)
        {
            if (!IsPlaying || double.IsNaN(deltaSeconds) || double.IsInfinity(deltaSeconds) || deltaSeconds < 0d) return false;
            normalizedPhase = (normalizedPhase + (deltaSeconds % profile.Duration) / profile.Duration) % 1d;
            Sample();
            return true;
        }

        void Update() { if (IsPlaying) AdvancePresentation(Time.deltaTime); }
        void OnEnable()
        {
            Subscribe();
            if (idleEnabled) SetIdleEnabled(true);
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
            graph = PlayableGraph.Create("RepWarsHumanoidIdle");
            graph.SetTimeUpdateMode(DirectorUpdateMode.Manual);
            playables = new AnimationClipPlayable[3];
            for (var i = 0; i < 3; i++)
            {
                playables[i] = AnimationClipPlayable.Create(graph,profile.GetClip((MasterHumanoidView)i));
                playables[i].SetApplyFootIK(false);
                playables[i].SetApplyPlayableIK(false);
                playables[i].SetSpeed(0d);
                var output = AnimationPlayableOutput.Create(graph,"Idle_" + (MasterHumanoidView)i,viewAnimators[i]);
                output.SetSourcePlayable(playables[i]);
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
                playables[i].SetTime(normalizedPhase * profile.Duration);
                playables[i].SetDone(false);
            }
            graph.Evaluate(0f);
        }

        void StopAndRestore()
        {
            if (graph.IsValid()) graph.Destroy();
            playables = null;
            if (viewAnimators != null) foreach (var animator in viewAnimators) if (animator != null) animator.enabled = false;
            // Restore only authored animated rotations. Never write world/root/ground position, scale or sprite transforms.
            if (bones != null) foreach (var binding in bones)
            {
                if (binding == null || binding.bone == null || rig == null || !HumanoidIdleContract.IsAllowedBone(binding.boneName) ||
                    binding.bone.name != binding.boneName || !Enum.IsDefined(typeof(MasterHumanoidView),binding.view)) continue;
                var viewRoot = rig.GetViewRoot(binding.view);
                if (viewRoot != null && binding.bone.IsChildOf(viewRoot)) binding.bone.localRotation = binding.neutralLocalRotation;
            }
        }

        public List<string> Validate()
        {
            var errors = ValidateReferences(rig,facing,profile,viewAnimators,bones);
            if (double.IsNaN(normalizedPhase) || double.IsInfinity(normalizedPhase) || normalizedPhase < 0d || normalizedPhase >= 1d)
                errors.Add("Cosmetic Idle phase must be finite and in [0,1).");
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
