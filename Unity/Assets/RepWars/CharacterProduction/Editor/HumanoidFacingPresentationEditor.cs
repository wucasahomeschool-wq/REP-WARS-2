using UnityEditor;
using UnityEngine;

namespace RepWars.CharacterProduction.EditorTools
{
    [CustomEditor(typeof(HumanoidFacingPresentation))]
    public sealed class HumanoidFacingPresentationEditor : UnityEditor.Editor
    {
        public override void OnInspectorGUI()
        {
            var presentation = (HumanoidFacingPresentation)target;
            using (new EditorGUI.DisabledScope(true))
            {
                EditorGUILayout.ObjectField("Rig", presentation.Rig, typeof(MasterHumanoidRig), true);
                EditorGUILayout.EnumPopup("Active facing", presentation.Facing);
                EditorGUILayout.Vector3Field("Unmirrored visual scale", presentation.UnmirroredVisualScale);
            }
            EditorGUILayout.HelpBox("Presentation only. Choose a facing to activate one authored view and mirror VisualRoot. Unity visual approval remains separate.", MessageType.Info);
            if (EditorUtility.IsPersistent(presentation))
            {
                EditorGUILayout.HelpBox("Open the proof in Prefab Mode or instantiate it in an isolated scene before using direction controls.", MessageType.Info);
                return;
            }
            var requested = (HumanoidFacing)EditorGUILayout.EnumPopup("Choose facing", presentation.Facing);
            if (requested != presentation.Facing) Apply(presentation, requested);
            if (GUILayout.Button("Validate presentation structure"))
            {
                var errors = HumanoidFacingValidator.Validate(presentation);
                if (errors.Count == 0) Debug.Log("Facing structure validates; rendered mirroring remains unapproved.", presentation);
                else Debug.LogError(string.Join("\n", errors.ToArray()), presentation);
            }
        }

        static void Apply(HumanoidFacingPresentation presentation, HumanoidFacing facing)
        {
            var rig = presentation.Rig;
            if (rig == null) { Debug.LogError("Presentation rig reference is missing.", presentation); return; }
            if (rig.VisualRoot == null || rig.GetViewRoot(MasterHumanoidView.Front) == null ||
                rig.GetViewRoot(MasterHumanoidView.Side) == null || rig.GetViewRoot(MasterHumanoidView.Back) == null)
            { Debug.LogError("Presentation has missing view or VisualRoot references.", presentation); return; }
            var objects = new Object[] { presentation, rig.VisualRoot,
                rig.GetViewRoot(MasterHumanoidView.Front).gameObject,
                rig.GetViewRoot(MasterHumanoidView.Side).gameObject,
                rig.GetViewRoot(MasterHumanoidView.Back).gameObject };
            Undo.RecordObjects(objects, "Change humanoid presentation facing");
            if (!presentation.TrySetFacing(facing)) { Debug.LogError("Facing could not be applied; validate the presentation hierarchy.", presentation); return; }
            foreach (var item in objects)
            {
                EditorUtility.SetDirty(item);
                if (PrefabUtility.IsPartOfPrefabInstance(item)) PrefabUtility.RecordPrefabInstancePropertyModifications(item);
            }
        }
    }
}
