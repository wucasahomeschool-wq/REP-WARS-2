using UnityEngine;

namespace RepWars
{
    /// <summary>
    /// A small visible group standing in for one backend army.
    /// The troop count stays the backend number. VisibleCount is only how many sprites to show.
    /// </summary>
    public class RepWarsArmyVisual : MonoBehaviour
    {
        public const int BattalionSize = 5;
        public const float SoldierScale = 0.085f;
        public const int SoldierSortingOrder = 10;

        static readonly Vector2[] Slots =
        {
            new Vector2(0f, 0.18f),
            new Vector2(-0.58f, -0.02f),
            new Vector2(0.58f, -0.02f),
            new Vector2(-0.30f, -0.40f),
            new Vector2(0.32f, -0.38f),
        };

        static Sprite[] idleFrames;
        static Sprite[] walkFrames;

        RepWarsSoldierVisual[] soldiers = System.Array.Empty<RepWarsSoldierVisual>();
        RepWarsBitmapText count;

        public static int VisibleCount(int troops)
        {
            if (troops <= 0) return 0;
            return Mathf.Min(troops, BattalionSize);
        }

        public static RepWarsArmyVisual Create(Transform parent, Vector2 worldPosition, int troops, Color factionTint)
        {
            EnsureFrames();
            var root = new GameObject("Army");
            root.transform.SetParent(parent, false);
            root.transform.position = new Vector3(worldPosition.x, worldPosition.y, 0f);
            var view = root.AddComponent<RepWarsArmyVisual>();
            view.Build(troops, factionTint);
            return view;
        }

        public void SetMarching(bool marching)
        {
            EnsureFrames();
            var clip = marching ? walkFrames : idleFrames;
            for (var i = 0; i < soldiers.Length; i++) soldiers[i].Play(clip);
        }

        void Build(int troops, Color factionTint)
        {
            var visible = VisibleCount(troops);
            soldiers = new RepWarsSoldierVisual[visible];
            var cycle = RepWarsSoldierVisual.HoldSeconds + RepWarsSoldierVisual.BlendSeconds;
            var highest = 0f;
            for (var i = 0; i < visible; i++)
            {
                var slot = Slots[i % Slots.Length];
                var body = new GameObject("Soldier_" + i);
                body.transform.SetParent(transform, false);
                body.transform.localPosition = new Vector3(slot.x, slot.y, 0f);
                body.transform.localScale = new Vector3(SoldierScale, SoldierScale, 1f);
                var visual = body.AddComponent<RepWarsSoldierVisual>();
                var phase = (i * 0.73f) % Mathf.Max(0.01f, idleFrames.Length);
                visual.Bind(idleFrames, phase, factionTint, SoldierSortingOrder);
                soldiers[i] = visual;
                if (slot.y > highest) highest = slot.y;
            }

            var label = new GameObject("TroopCount");
            label.transform.SetParent(transform, false);
            var headroom = 15.36f * SoldierScale;
            label.transform.localPosition = new Vector3(0f, highest + headroom + 0.18f, 0f);
            count = label.AddComponent<RepWarsBitmapText>();
            count.characterScale = 0.13f;
            count.spacing = 0.03f;
            count.sortingOrder = 32;
            count.SetText(troops.ToString());
        }

        static void EnsureFrames()
        {
            if (idleFrames != null) return;
            idleFrames = new[]
            {
                Resources.Load<Sprite>("Army/Soldiers/Soldier Idle Frame 1"),
                Resources.Load<Sprite>("Army/Soldiers/Soldier Idle Frame 2"),
                Resources.Load<Sprite>("Army/Soldiers/Soldier Idle Frame 3"),
            };
            walkFrames = new[]
            {
                Resources.Load<Sprite>("Army/Soldiers/Soldier Walking Frame 1"),
                Resources.Load<Sprite>("Army/Soldiers/Soldier Walking Frame 2"),
                Resources.Load<Sprite>("Army/Soldiers/Soldier Walking Frame 3"),
                Resources.Load<Sprite>("Army/Soldiers/Soldier walking frame 4"),
            };
        }
    }
}
