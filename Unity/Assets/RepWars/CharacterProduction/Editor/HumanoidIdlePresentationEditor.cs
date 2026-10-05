using UnityEditor;
using UnityEngine;

namespace RepWars.CharacterProduction.EditorTools
{
    [CustomEditor(typeof(HumanoidIdlePresentation))]
    public sealed class HumanoidIdlePresentationEditor : UnityEditor.Editor
    {
        public override void OnInspectorGUI()
        {
            var idle = (HumanoidIdlePresentation)target;
            using (new EditorGUI.DisabledScope(true))
            {
                EditorGUILayout.ObjectField("Idle profile",idle.Profile,typeof(HumanoidIdleProfile),false);
                EditorGUILayout.ObjectField("Visible authored clip",idle.CurrentClip,typeof(AnimationClip),false);
                EditorGUILayout.Toggle("Idle enabled",idle.IdleEnabled);
                EditorGUILayout.DoubleField("Shared cosmetic phase",idle.NormalizedPhase);
            }
            EditorGUILayout.HelpBox("Idle only. Use the facing and team-color components to test all six facings and cosmetic colors. Turn Idle OFF before full bind-pose validation. Motion and mobile performance are not approved by data validation.",MessageType.Info);
            using (new EditorGUI.DisabledScope(!Application.isPlaying || EditorUtility.IsPersistent(idle)))
            {
                if (GUILayout.Button(idle.IdleEnabled ? "Disable Idle / restore neutral" : "Enable Idle"))
                    if (!idle.SetIdleEnabled(!idle.IdleEnabled)) Debug.LogError("Idle references are invalid; validate the proof.",idle);
                using (new EditorGUI.DisabledScope(!idle.IsPlaying))
                {
                    var phase = EditorGUILayout.Slider("Inspect normalized phase",(float)idle.NormalizedPhase,0f,1f);
                    if (Mathf.Abs(phase-(float)idle.NormalizedPhase) > 0.00001f) idle.TrySampleAtPhase(phase);
                }
            }
            if (!Application.isPlaying) EditorGUILayout.HelpBox("Enter Play Mode for live Idle controls. Clip generation and structure validation use the Editor menu.",MessageType.Info);
            if (GUILayout.Button("Validate Idle proof (OFF / neutral)"))
            {
                var errors = KnightAIdleProofBuilder.Validate(idle);
                if (errors.Count == 0) Debug.Log("Idle proof data validates. Visual and mobile approval remain required.",idle);
                else Debug.LogError(string.Join("\n",errors.ToArray()),idle);
            }
            if (Application.isPlaying && idle.IsPlaying) Repaint();
        }
    }
}
