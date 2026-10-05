using UnityEditor;
using UnityEngine;

namespace RepWars.CharacterProduction.EditorTools
{
    [CustomEditor(typeof(SelectiveTeamColorPresentation))]
    public sealed class SelectiveTeamColorPresentationEditor : UnityEditor.Editor
    {
        public override void OnInspectorGUI()
        {
            var presentation = (SelectiveTeamColorPresentation)target;
            using (new EditorGUI.DisabledScope(true))
            {
                EditorGUILayout.ObjectField("Shared material",presentation.SharedMaterial,typeof(Material),false);
                EditorGUILayout.Toggle("Recolor active",presentation.RecolorEnabled);
                EditorGUILayout.IntField("Authored section bindings",presentation.Sections.Count);
            }
            EditorGUILayout.HelpBox("Technical proof colors only; no faction palette is defined. Facing controls are on HumanoidFacingPresentation. Mask coverage/artwork fidelity require human review.",MessageType.Info);
            if (EditorUtility.IsPersistent(presentation))
            { EditorGUILayout.HelpBox("Open in Prefab Mode or instantiate in an isolated scene to test colors.",MessageType.Info); return; }
            var requested = EditorGUILayout.ColorField("Technical sample color (sRGB)",presentation.TeamColor);
            if (requested != presentation.TeamColor) Apply(presentation,requested);
            if (GUILayout.Button("Apply current sample")) Apply(presentation,presentation.TeamColor);
            if (GUILayout.Button("Technical red sample")) Apply(presentation,new Color(0.8f,0.12f,0.1f));
            if (GUILayout.Button("Technical blue sample")) Apply(presentation,new Color(0.1f,0.35f,0.85f));
            if (GUILayout.Button("Technical green sample")) Apply(presentation,new Color(0.15f,0.6f,0.25f));
            if (GUILayout.Button("Original authored colors / disable recolor"))
            { Undo.RecordObject(presentation,"Disable selective team color"); presentation.DisableTeamColor(); Record(presentation); }
            if (GUILayout.Button("Validate team-color proof data"))
            {
                var idle = presentation.GetComponent<HumanoidIdlePresentation>();
                if (idle != null && idle.IdleEnabled)
                { Debug.LogWarning("Turn animation OFF before bind-pose/team-color proof validation. Color controls remain usable during Idle or Walk.",presentation); return; }
                var errors = KnightATeamColorProofBuilder.Validate(presentation,idle);
                if (errors.Count == 0) Debug.Log("Team-color proof data validates; visual review remains required.",presentation);
                else Debug.LogError(string.Join("\n",errors.ToArray()),presentation);
            }
        }
        static void Apply(SelectiveTeamColorPresentation presentation,Color color)
        {
            Undo.RecordObject(presentation,"Change technical team color");
            if (!presentation.SetTeamColor(color)) Debug.LogError("Color must have finite RGB in [0,1].",presentation);
            Record(presentation);
        }
        static void Record(SelectiveTeamColorPresentation presentation)
        {
            EditorUtility.SetDirty(presentation);
            if (PrefabUtility.IsPartOfPrefabInstance(presentation)) PrefabUtility.RecordPrefabInstancePropertyModifications(presentation);
        }
        void OnEnable() { Undo.undoRedoPerformed += Reapply; }
        void OnDisable() { Undo.undoRedoPerformed -= Reapply; }
        void Reapply() { if (target != null) ((SelectiveTeamColorPresentation)target).ApplyStoredColor(); }
    }
}
