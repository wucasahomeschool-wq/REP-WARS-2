using System.Collections.Generic;
using System.Text;
using UnityEngine;

namespace RepWars.Characters
{
    /// <summary>
    /// Proof scene driver. Spawns characters from different bases and drives them only through
    /// IRepWarsCharacterPresenter and the catalog. It touches no renderer, animator or bone.
    /// Lives in the Runtime assembly so the scene needs no editor code.
    /// </summary>
    public sealed class RepWarsCharacterProofController : MonoBehaviour
    {
        static readonly string[] SpawnVariantIds = { "generic_soldier", "generic_emperor", "banana_soldier", "banana_emperor" };
        static readonly string[] AppearanceIds = { "soldier_gear_01", "emperor_regalia_01" };
        static readonly Color[] TintChoices =
        {
            Color.white,
            new Color(1f, 0.45f, 0.45f),
            new Color(0.45f, 0.65f, 1f),
            new Color(0.5f, 1f, 0.55f),
        };

        public float spacing = 2.4f;

        readonly List<IRepWarsCharacterPresenter> characters = new List<IRepWarsCharacterPresenter>();
        int selected;
        int tintIndex;
        string status = "";
        Camera cachedCamera;

        void Start()
        {
            SpawnAll();
        }

        void SpawnAll()
        {
            ReleaseAll();
            var catalog = RepWarsCharacterCatalog.Default;
            if (!catalog.Report.IsValid)
            {
                status = "Catalog invalid: " + catalog.Report.Errors.Count + " error(s). See console.";
                return;
            }
            var count = SpawnVariantIds.Length;
            for (var i = 0; i < count; i++)
            {
                var presenter = RepWarsCharacterSpawner.Spawn(SpawnVariantIds[i], transform, i * 10);
                if (presenter == null) continue;
                presenter.Transform.localPosition = new Vector3((i - (count - 1) * 0.5f) * spacing, -1f, 0f);
                presenter.SetLocomotion(LocomotionKind.Idle);
                characters.Add(presenter);
            }
            selected = 0;
            status = "Spawned " + characters.Count + " characters through RepWarsCharacterSpawner";
        }

        void ReleaseAll()
        {
            foreach (var character in characters)
            {
                if (character != null && character.Transform != null) character.Release();
            }
            characters.Clear();
        }

        IRepWarsCharacterPresenter Selected
        {
            get { return characters.Count == 0 ? null : characters[Mathf.Clamp(selected, 0, characters.Count - 1)]; }
        }

        void OnGUI()
        {
            const float w = 210f;
            GUILayout.BeginArea(new Rect(10, 10, w, Screen.height - 20));
            GUILayout.Label("Character System Proof (Phase A)");
            GUILayout.Label(status);

            for (var i = 0; i < characters.Count; i++)
            {
                var label = (i == selected ? "> " : "  ") + characters[i].VariantId;
                if (GUILayout.Button(label)) selected = i;
            }

            var current = Selected;
            if (current != null)
            {
                GUILayout.Space(6);
                GUILayout.Label("base=" + current.BaseId + "  appearance=" + current.AppearanceId);
                GUILayout.Label(current.Locomotion + " / " + current.Facing);

                if (GUILayout.Button("Next catalog variant")) CycleVariant(current);
                if (GUILayout.Button("Next appearance")) CycleAppearance(current);
                if (GUILayout.Button("Next tint")) CycleTint(current);
                if (GUILayout.Button("Face " + (current.Facing == FacingKind.Right ? "Left" : "Right"))) ToggleFacing(current);
                if (GUILayout.Button("Idle")) Report(current.SetLocomotion(LocomotionKind.Idle), current);
                if (GUILayout.Button("Walk")) Report(current.SetLocomotion(LocomotionKind.Walk), current);
                if (GUILayout.Button("Celebrate")) Report(current.PlayReaction(ReactionKind.Celebrate), current);
                if (GUILayout.Button("Defeat")) Report(current.PlayReaction(ReactionKind.Defeat), current);
            }

            GUILayout.Space(6);
            if (GUILayout.Button("Respawn all")) SpawnAll();
            GUILayout.EndArea();

            DrawWorldLabels();
        }

        void DrawWorldLabels()
        {
            if (cachedCamera == null) cachedCamera = Camera.main;
            if (cachedCamera == null) return;
            foreach (var character in characters)
            {
                if (character == null || character.Transform == null) continue;
                var screen = cachedCamera.WorldToScreenPoint(character.Transform.position);
                var rect = new Rect(screen.x - 70f, Screen.height - screen.y + 8f, 140f, 22f);
                GUI.Label(rect, character.VariantId);
            }
        }

        void CycleVariant(IRepWarsCharacterPresenter presenter)
        {
            var entries = new List<CharacterCatalogEntry>();
            entries.AddRange(RepWarsCharacterCatalog.Default.ListInfantry());
            entries.AddRange(RepWarsCharacterCatalog.Default.ListEmperor());
            if (entries.Count == 0) return;
            var index = entries.FindIndex(e => e.variantId == presenter.VariantId);
            var next = entries[(index + 1) % entries.Count];
            Report(presenter.TrySetVariant(next.variantId, out _), presenter);
        }

        void CycleAppearance(IRepWarsCharacterPresenter presenter)
        {
            var index = System.Array.IndexOf(AppearanceIds, presenter.AppearanceId);
            var next = AppearanceIds[(index + 1) % AppearanceIds.Length];
            Report(presenter.TrySetAppearance(next, out _), presenter);
        }

        void CycleTint(IRepWarsCharacterPresenter presenter)
        {
            tintIndex = (tintIndex + 1) % TintChoices.Length;
            presenter.SetTint(TintChoices[tintIndex]);
        }

        void ToggleFacing(IRepWarsCharacterPresenter presenter)
        {
            presenter.SetFacing(presenter.Facing == FacingKind.Right ? FacingKind.Left : FacingKind.Right);
        }

        void Report(bool ok, IRepWarsCharacterPresenter presenter)
        {
            status = ok ? "OK: " + presenter.VariantId : "FAILED: " + presenter.LastError;
        }

        /// <summary>
        /// Drives every step of the common API on every spawned character and logs a PASS/FAIL line for each.
        /// Callable from an editor script during Play Mode for a quick end-to-end check.
        /// </summary>
        public string RunSelfTest()
        {
            var log = new StringBuilder();
            var failures = 0;
            void Check(string name, bool condition)
            {
                if (!condition) failures++;
                log.Append(condition ? "PASS  " : "FAIL  ").Append(name).Append('\n');
            }

            Check("spawned all four proof characters", characters.Count == SpawnVariantIds.Length);
            foreach (var character in characters)
            {
                var id = character.VariantId;
                Check(id + ": SetLocomotion(Walk)", character.SetLocomotion(LocomotionKind.Walk) && character.Locomotion == LocomotionKind.Walk);
                character.SetFacing(FacingKind.Left);
                Check(id + ": SetFacing(Left)", character.Facing == FacingKind.Left);
                character.SetFacing(FacingKind.Right);
                character.SetTint(TintChoices[1]);
                Check(id + ": SetTint", character.Tint == TintChoices[1]);
                character.SetTint(Color.white);
                Check(id + ": PlayReaction(Celebrate)", character.PlayReaction(ReactionKind.Celebrate));
                Check(id + ": SetLocomotion(Idle)", character.SetLocomotion(LocomotionKind.Idle));
            }

            // Change variant and appearance on a banana and a human through the same calls.
            foreach (var character in characters)
            {
                var originalVariant = character.VariantId;
                var originalAppearance = character.AppearanceId;
                var other = originalAppearance == "soldier_gear_01" ? "emperor_regalia_01" : "soldier_gear_01";
                var swapped = character.TrySetAppearance(other, out var appearanceError);
                Check(originalVariant + ": TrySetAppearance(" + other + ")" + (swapped ? "" : " -> " + appearanceError), swapped && character.AppearanceId == other);
                var restored = character.TrySetAppearance(originalAppearance, out _);
                Check(originalVariant + ": TrySetAppearance(restore)", restored && character.AppearanceId == originalAppearance);
            }

            var first = characters.Count > 0 ? characters[0] : null;
            if (first != null)
            {
                var originalVariant = first.VariantId;
                Check("TrySetVariant(banana_emperor) from human", first.TrySetVariant("banana_emperor", out _) && first.BaseId == "banana");
                Check("TrySetVariant(does_not_exist) fails and changes nothing",
                    !first.TrySetVariant("does_not_exist", out var error) && !string.IsNullOrEmpty(error) && first.VariantId == "banana_emperor");
                Check("TrySetVariant(restore)", first.TrySetVariant(originalVariant, out _) && first.VariantId == originalVariant);
            }

            log.Append(failures == 0 ? "SELF TEST PASSED" : "SELF TEST FAILED (" + failures + ")");
            return log.ToString();
        }

        void OnDestroy()
        {
            ReleaseAll();
        }
    }
}
