using System;
using System.Collections.Generic;
using UnityEngine;

namespace RepWars.CharacterProduction
{
    public static class HumanoidFacingValidator
    {
        public static List<string> Validate(HumanoidFacingPresentation presentation, HumanoidIdlePresentation allowedIdle = null)
        {
            var errors = new List<string>();
            var facings = (HumanoidFacing[])Enum.GetValues(typeof(HumanoidFacing));
            if (facings.Length != 6) errors.Add("Facing contract must contain exactly six values.");
            foreach (var facing in facings)
            {
                HumanoidFacingSelection mapped;
                if (!HumanoidFacingContract.TryResolve(facing, out mapped) || !Enum.IsDefined(typeof(MasterHumanoidView), mapped.View))
                    errors.Add(facing + " has no valid authored-view mapping.");
            }
            if (presentation == null) { errors.Add("HumanoidFacingPresentation is missing."); return errors; }
            var rig = presentation.Rig;
            errors.AddRange(MasterHumanoidRigValidator.Validate(rig));
            if (rig == null || rig.VisualRoot == null) return errors;
            if (rig.gameObject != presentation.gameObject) errors.Add("Presentation must reference its own rig root.");
            if (!HumanoidFacingPresentation.HasValidScale(presentation.UnmirroredVisualScale))
                errors.Add("Unmirrored visual scale must be finite and positive.");
            HumanoidFacingSelection selection;
            if (!HumanoidFacingContract.TryResolve(presentation.Facing, out selection))
            { errors.Add("Presentation facing is invalid."); return errors; }
            var expectedScale = presentation.UnmirroredVisualScale;
            if (selection.Mirrored) expectedScale.x = -expectedScale.x;
            var actualScale = rig.VisualRoot.localScale;
            if (!HumanoidFacingPresentation.HasValidScale(new Vector3(Mathf.Abs(actualScale.x), actualScale.y, actualScale.z)))
                errors.Add("VisualRoot mirror scale must be finite and nonzero, with positive Y/Z.");
            if (Vector3.Distance(expectedScale, rig.VisualRoot.localScale) > 0.00001f)
                errors.Add("Mirror must be applied only as the expected X sign on VisualRoot.");
            var active = 0;
            var distinct = new HashSet<Transform>();
            foreach (MasterHumanoidView view in Enum.GetValues(typeof(MasterHumanoidView)))
            {
                var root = rig.GetViewRoot(view);
                if (root == null) continue;
                if (!distinct.Add(root)) errors.Add("Authored-view references must be distinct.");
                if (root.name != "View_" + view) errors.Add(view + " references the wrong authored-view root.");
                if (root.localScale != Vector3.one) errors.Add(view + " must not be independently mirrored or rescaled.");
                if (root.gameObject.activeSelf) active++;
                if (root.gameObject.activeSelf != (view == selection.View)) errors.Add(view + " activation differs from the selected facing.");
                foreach (var renderer in root.GetComponentsInChildren<SpriteRenderer>(true))
                    if (renderer.flipX || renderer.flipY || renderer.transform.localScale != Vector3.one)
                        errors.Add(renderer.name + " uses an independent sprite flip or scale.");
            }
            if (active != 1) errors.Add("Exactly one authored view must be active.");
            if (rig.GroundSocket != null && rig.GroundSocket.localPosition != Vector3.zero)
                errors.Add("Ground socket must stay at the visual origin.");
            foreach (var component in presentation.GetComponentsInChildren<Component>(true))
            {
                if (component == null) { errors.Add("Proof has a missing component reference."); continue; }
                var name = component.GetType().Name;
                if (component is Animation) errors.Add("Legacy animation components are forbidden.");
                var animator = component as Animator;
                if (animator != null)
                {
                    var permitted = false;
                    if (allowedIdle != null && allowedIdle.gameObject == presentation.gameObject && allowedIdle.Rig == rig)
                        for (var i = 0; i < allowedIdle.ViewAnimators.Count; i++)
                            if (allowedIdle.ViewAnimators[i] == animator && i < 3 && animator.transform == rig.GetViewRoot((MasterHumanoidView)i) &&
                                !animator.applyRootMotion && animator.runtimeAnimatorController == null && animator.avatar == null) permitted = true;
                    if (!permitted) errors.Add("Only the explicitly supplied Idle proof's view-local Animators are permitted; static proofs remain animation-free.");
                }
                if (name == "RepWarsArmyVisual" || name == "RepWarsSoldierVisual" || name == "RepWarsMapScreen")
                    errors.Add("Production army component is forbidden: " + name);
            }
            if (rig.VisualRoot.GetComponentsInChildren<Collider>(true).Length > 0 ||
                rig.VisualRoot.GetComponentsInChildren<Collider2D>(true).Length > 0 ||
                rig.VisualRoot.GetComponentsInChildren<Canvas>(true).Length > 0)
                errors.Add("Keep collider and UI roots outside the mirrored VisualRoot.");
            return errors;
        }
    }
}
