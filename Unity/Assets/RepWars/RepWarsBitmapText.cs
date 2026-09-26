using System.Collections.Generic;
using UnityEngine;

namespace RepWars
{
    /// <summary>
    /// Lays out a string from RepWarsBitmapFont sprites.
    /// Scale and spacing are presentation settings. The string is not baked into an image.
    /// </summary>
    public class RepWarsBitmapText : MonoBehaviour
    {
        public float characterScale = 0.14f;
        public float spacing = 0.04f;
        public int sortingOrder = 18;

        readonly List<SpriteRenderer> slots = new List<SpriteRenderer>();
        string shown = "";

        public void SetText(string value)
        {
            value = value ?? "";
            if (value == shown && slots.Count > 0) return;
            shown = value;
            RepWarsBitmapFont.Ensure();

            var widths = new float[value.Length];
            var sprites = new Sprite[value.Length];
            var total = 0f;
            for (var i = 0; i < value.Length; i++)
            {
                if (value[i] == ' ')
                {
                    widths[i] = RepWarsBitmapFont.EmWidth * characterScale * 0.45f;
                }
                else if (RepWarsBitmapFont.TryGet(value[i], out var sprite))
                {
                    sprites[i] = sprite;
                    widths[i] = sprite.rect.width / sprite.pixelsPerUnit * characterScale;
                }
                else
                {
                    widths[i] = RepWarsBitmapFont.EmWidth * characterScale * 0.4f;
                }
                total += widths[i];
                if (i + 1 < value.Length) total += spacing;
            }

            while (slots.Count < value.Length)
            {
                var glyph = new GameObject("Glyph");
                glyph.transform.SetParent(transform, false);
                var renderer = glyph.AddComponent<SpriteRenderer>();
                renderer.sortingOrder = sortingOrder;
                slots.Add(renderer);
            }

            var cursor = -total * 0.5f;
            for (var i = 0; i < slots.Count; i++)
            {
                var renderer = slots[i];
                if (i >= value.Length || sprites[i] == null)
                {
                    renderer.enabled = false;
                    if (i < value.Length) cursor += widths[i] + spacing;
                    continue;
                }
                renderer.enabled = true;
                renderer.sprite = sprites[i];
                renderer.sortingOrder = sortingOrder;
                var width = widths[i];
                renderer.transform.localScale = new Vector3(characterScale, characterScale, 1f);
                renderer.transform.localPosition = new Vector3(cursor + width * 0.5f, 0f, 0f);
                cursor += width + spacing;
            }
        }
    }
}
