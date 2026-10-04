using System.Collections.Generic;
using UnityEngine;

namespace RepWars.CharacterProduction
{
    public static class MasterHumanoidRigValidator
    {
        static readonly MasterHumanoidView[] Views = { MasterHumanoidView.Front, MasterHumanoidView.Side, MasterHumanoidView.Back };

        public static List<string> Validate(MasterHumanoidRig rig)
        {
            var errors = new List<string>();
            if (rig == null)
            {
                errors.Add("Rig component is missing.");
                return errors;
            }
            if (rig.ContractVersion != MasterHumanoidRigContract.Version)
                errors.Add("Rig contract version " + rig.ContractVersion + " does not match required version " + MasterHumanoidRigContract.Version + ".");
            if (rig.VisualRoot == null) errors.Add("VisualRoot reference is missing; keep world movement on the external parent.");
            else if (rig.VisualRoot.parent != rig.transform) errors.Add("VisualRoot must be a direct child of the rig component transform.");
            if (rig.GroundSocket == null) errors.Add("Ground socket reference is missing.");
            else if (rig.GroundSocket.name != MasterHumanoidRigContract.SocketName(MasterHumanoidSocket.Ground))
                errors.Add("Ground socket must be named '" + MasterHumanoidRigContract.SocketName(MasterHumanoidSocket.Ground) + "'.");
            else if (rig.VisualRoot != null && rig.GroundSocket.parent != rig.VisualRoot)
                errors.Add("Ground socket must be parented directly to VisualRoot.");

            var distinctViews = new HashSet<Transform>();
            foreach (var view in Views)
            {
                var viewRoot = rig.GetViewRoot(view);
                if (viewRoot == null)
                {
                    errors.Add(view + " view root reference is missing.");
                    continue;
                }
                if (!distinctViews.Add(viewRoot)) errors.Add(view + " view reuses another view root; view calibration must be independent.");
                if (rig.VisualRoot != null && viewRoot.parent != rig.VisualRoot) errors.Add(view + " view root must be a direct child of VisualRoot.");
                var skeleton = FindDirectChild(viewRoot, "Skeleton");
                if (skeleton == null) errors.Add(view + " view is missing Skeleton.");
                if (FindDirectChild(viewRoot, "SkinMount") == null) errors.Add(view + " view is missing SkinMount for future SpriteRenderer/SpriteSkin integration.");
                if (skeleton == null) continue;

                var byName = new Dictionary<string, Transform>();
                foreach (var item in skeleton.GetComponentsInChildren<Transform>(true))
                {
                    if (byName.ContainsKey(item.name)) errors.Add(view + " skeleton has duplicate transform name '" + item.name + "'.");
                    else byName.Add(item.name, item);
                }
                foreach (var bone in MasterHumanoidRigContract.Bones)
                {
                    Transform found;
                    if (!byName.TryGetValue(bone.name, out found))
                    {
                        errors.Add(view + " skeleton is missing bone '" + bone.name + "'.");
                        continue;
                    }
                    if (bone.parentName == null)
                    {
                        if (found.parent != skeleton) errors.Add(view + " bone '" + bone.name + "' must be directly beneath Skeleton.");
                    }
                    else
                    {
                        Transform parent;
                        if (!byName.TryGetValue(bone.parentName, out parent)) errors.Add(view + " bone '" + bone.name + "' has missing parent '" + bone.parentName + "'.");
                        else if (found.parent != parent) errors.Add(view + " bone '" + bone.name + "' must be a direct child of '" + bone.parentName + "'.");
                    }
                }
                RequireSocket(rig, view, MasterHumanoidSocket.MainHand, "RightHand", errors);
                RequireSocket(rig, view, MasterHumanoidSocket.OffHand, "LeftHand", errors);
                RequireSocket(rig, view, MasterHumanoidSocket.Head, "Head", errors);
                RequireSocket(rig, view, MasterHumanoidSocket.Back, "Chest", errors);
            }
            return errors;
        }

        static Transform FindDirectChild(Transform parent, string name)
        {
            for (var i = 0; i < parent.childCount; i++) if (parent.GetChild(i).name == name) return parent.GetChild(i);
            return null;
        }

        static void RequireSocket(MasterHumanoidRig rig, MasterHumanoidView view, MasterHumanoidSocket socket,
            string expectedParentBone, List<string> errors)
        {
            var item = rig.FindSocket(view, socket);
            if (item == null) errors.Add(view + " view is missing the " + socket + " socket.");
            else
            {
                var expected = rig.FindBone(view, expectedParentBone);
                if (expected != null && item.parent != expected) errors.Add(view + " " + socket + " socket must follow '" + expectedParentBone + "'.");
            }
        }
    }
}
