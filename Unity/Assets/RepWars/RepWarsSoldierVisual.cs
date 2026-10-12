using RepWars.WorldPresentation;
using UnityEngine;
using UnityEngine.Rendering;

namespace RepWars
{
    /// <summary>
    /// One visible soldier. Idle and walk are frame loops with a crossfade between frames.
    /// The figure root is the feet. A presentation child holds the World sorting group and the tie z.
    /// This component does not decide when an army moves.
    /// </summary>
    public class RepWarsSoldierVisual : MonoBehaviour
    {
        public const float HoldSeconds = 0.42f;
        public const float BlendSeconds = 0.22f;
        public const int CurrentOrder = 0;
        public const int UpcomingOrder = 1;

        Sprite[] frames = System.Array.Empty<Sprite>();
        Transform presentation;
        SpriteRenderer current;
        SpriteRenderer upcoming;
        float phase;
        float elapsed;
        int index;
        Color tint = Color.white;
        bool blending;

        public void Bind(Sprite[] clip, float phaseOffset, Color factionTint, int slotIndex)
        {
            frames = clip ?? System.Array.Empty<Sprite>();
            phase = phaseOffset;
            tint = factionTint;
            EnsurePresentation(slotIndex);
            index = frames.Length == 0 ? 0 : Mathf.FloorToInt(phase) % frames.Length;
            elapsed = (phase - Mathf.Floor(phase)) * HoldSeconds;
            blending = false;
            ShowHold();
        }

        void EnsurePresentation(int slotIndex)
        {
            if (presentation == null)
            {
                var presentationObject = new GameObject("Presentation");
                presentationObject.transform.SetParent(transform, false);
                presentation = presentationObject.transform;
                RepWarsWorldSorting.ApplyWorldGroup(presentationObject.AddComponent<SortingGroup>());
                current = CreateLayer("Current", CurrentOrder);
                upcoming = CreateLayer("Upcoming", UpcomingOrder);
            }
            else
            {
                current.sortingOrder = CurrentOrder;
                upcoming.sortingOrder = UpcomingOrder;
            }
            RepWarsWorldSorting.ApplyTieOffset(presentation, slotIndex);
        }

        public void Play(Sprite[] clip)
        {
            if (clip == null || clip.Length == 0) return;
            frames = clip;
            index = Mathf.FloorToInt(phase) % frames.Length;
            elapsed = (phase - Mathf.Floor(phase)) * HoldSeconds;
            blending = false;
            ShowHold();
        }

        SpriteRenderer CreateLayer(string layerName, int sortingOrder)
        {
            var layer = new GameObject(layerName);
            layer.transform.SetParent(presentation, false);
            var renderer = layer.AddComponent<SpriteRenderer>();
            renderer.sortingLayerName = RepWarsWorldSorting.LayerWorld;
            renderer.sortingOrder = sortingOrder;
            renderer.spriteSortPoint = SpriteSortPoint.Pivot;
            return renderer;
        }

        void Update()
        {
            if (frames.Length == 0) return;
            elapsed += Time.deltaTime;
            if (!blending)
            {
                if (elapsed < HoldSeconds) return;
                elapsed = 0f;
                blending = true;
                var next = frames[(index + 1) % frames.Length];
                upcoming.sprite = next;
                upcoming.color = WithAlpha(0f);
                current.color = WithAlpha(1f);
                return;
            }

            var blend = Mathf.Clamp01(elapsed / BlendSeconds);
            current.color = WithAlpha(1f - blend);
            upcoming.color = WithAlpha(blend);
            if (blend < 1f) return;
            index = (index + 1) % frames.Length;
            elapsed = 0f;
            blending = false;
            ShowHold();
        }

        void ShowHold()
        {
            if (frames.Length == 0 || current == null) return;
            current.sprite = frames[index];
            current.color = WithAlpha(1f);
            if (upcoming != null) upcoming.color = WithAlpha(0f);
        }

        Color WithAlpha(float alpha)
        {
            return new Color(tint.r, tint.g, tint.b, alpha);
        }
    }
}
