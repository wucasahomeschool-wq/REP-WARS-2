using UnityEditor;
using UnityEngine;

namespace RepWars.CharacterProduction.EditorTools
{
    [CustomEditor(typeof(HumanoidIdlePresentation))]
    public sealed class HumanoidIdlePresentationEditor : UnityEditor.Editor
    {
        public override void OnInspectorGUI()
        {
            var player = (HumanoidIdlePresentation)target;
            var hasWalk = player.WalkProfile != null;
            using (new EditorGUI.DisabledScope(true))
            {
                EditorGUILayout.ObjectField("Idle profile",player.Profile,typeof(HumanoidIdleProfile),false);
                EditorGUILayout.ObjectField("Walk profile",player.WalkProfile,typeof(HumanoidWalkProfile),false);
                EditorGUILayout.ObjectField("Visible authored clip",player.CurrentClip,typeof(AnimationClip),false);
                EditorGUILayout.Toggle("Animation enabled",player.AnimationEnabled);
                EditorGUILayout.DoubleField("Shared cosmetic phase",player.NormalizedPhase);
                EditorGUILayout.Toggle("Transition in progress",player.IsTransitioning);
                EditorGUILayout.FloatField("Walk blend weight",player.WalkWeight);
            }
            EditorGUILayout.HelpBox("Presentation-only Idle/Walk. Facing and selective color stay on their existing components. Disable animation for bind-pose validation. Phase seek completes a handoff; turn automatic advance OFF for a held pose. Foot appearance and performance need review.",MessageType.Info);
            using (new EditorGUI.DisabledScope(!Application.isPlaying || EditorUtility.IsPersistent(player)))
            {
                using (new EditorGUI.DisabledScope(!hasWalk))
                {
                    var state = (HumanoidAnimationState)EditorGUILayout.EnumPopup("Animation state",player.State);
                    if (state != player.State && !player.SetAnimationState(state)) Debug.LogError("Invalid animation state/profile.",player);
                }
                if (GUILayout.Button(player.AnimationEnabled ? "Disable animation / restore neutral" : "Enable animation"))
                    if (!player.SetAnimationEnabled(!player.AnimationEnabled)) Debug.LogError("Animation references are invalid; validate the proof.",player);
                var automatic = EditorGUILayout.Toggle("Automatic advance",player.AutomaticAdvance);
                if (automatic != player.AutomaticAdvance) player.SetAutomaticAdvance(automatic);
                using (new EditorGUI.DisabledScope(!player.IsPlaying))
                {
                    var phase = EditorGUILayout.Slider("Inspect normalized phase",(float)player.NormalizedPhase,0f,1f);
                    if (Mathf.Abs(phase-(float)player.NormalizedPhase) > 0.00001f) player.TrySampleAtPhase(phase);
                }
            }
            if (!Application.isPlaying) EditorGUILayout.HelpBox("Enter Play Mode for live animation controls. Generation and structure validation use the Editor menu.",MessageType.Info);
            if (GUILayout.Button("Validate animation proof (OFF / neutral)"))
            {
                var errors = hasWalk ? KnightAWalkProofBuilder.Validate(player) : KnightAIdleProofBuilder.Validate(player);
                if (errors.Count == 0) Debug.Log("Animation proof data validates. Unity playback, visual and mobile approval remain required.",player);
                else Debug.LogError(string.Join("\n",errors.ToArray()),player);
            }
            if (Application.isPlaying && player.IsPlaying && player.AutomaticAdvance) Repaint();
        }
    }
}
