using UnityEngine;

namespace RepWars
{
    /// <summary>
    /// One visible soldier. Idle and walk are frame loops with a crossfade between frames.
    /// Future movement calls PlayWalk. This component does not decide when an army moves.
    /// </summary>
    public class RepWarsSoldierVisual : MonoBehaviour
    {
        public const float HoldSeconds = 0.42f;
        public const float BlendSeconds = 0.22f;

        Sprite[] frames = System.Array.Empty<Sprite>();
        SpriteRenderer current;
        SpriteRenderer upcoming;
        float phase;
        float elapsed;
        int index;
        Color tint = Color.white;
        bool blending;

        public void Bind(Sprite[] clip, float phaseOffset, Color factionTint, int sortingOrder)
        {
            frames = clip ?? System.Array.Empty<Sprite>();
            phase = phaseOffset;
            tint = factionTint;
            if (current == null)
            {
                current = CreateLayer("Current", sortingOrder);
                upcoming = CreateLayer("Upcoming", sortingOrder);
            }
            else
            {
                current.sortingOrder = sortingOrder;
                upcoming.sortingOrder = sortingOrder;
            }
            index = frames.Length == 0 ? 0 : Mathf.FloorToInt(phase) % frames.Length;
            elapsed = (phase - Mathf.Floor(phase)) * HoldSeconds;
            blending = false;
            ShowHold();
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
            layer.transform.SetParent(transform, false);
            var renderer = layer.AddComponent<SpriteRenderer>();
            renderer.sortingOrder = sortingOrder;
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
