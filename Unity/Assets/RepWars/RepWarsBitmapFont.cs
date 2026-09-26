using System.Collections.Generic;
using UnityEngine;

namespace RepWars
{
    /// <summary>
    /// Builds character sprites from the supplied Rep Wars font sheets.
    /// Rects are the measured glyph cells. The source PNGs are not modified.
    /// </summary>
    public static class RepWarsBitmapFont
    {
        const float PixelsPerUnit = 100f;

        static Dictionary<char, Sprite> glyphs;
        static float emWidth = 1f;

        public static float EmWidth
        {
            get
            {
                Ensure();
                return emWidth;
            }
        }

        public static bool TryGet(char character, out Sprite sprite)
        {
            Ensure();
            return glyphs.TryGetValue(char.ToUpperInvariant(character), out sprite);
        }

        public static void Ensure()
        {
            if (glyphs != null && glyphs.Count > 0)
            {
                foreach (var pair in glyphs)
                {
                    if (pair.Value != null) return;
                }
            }
            glyphs = new Dictionary<char, Sprite>();
            Slice("Army/Font/Rep Wars Font Numbers", "0123456789", NumberCells);
            Slice("Army/Font/Rep Wars Font A-M", "ABCDEFGHIJKLM", AmCells);
            Slice("Army/Font/Rep Wars Font N-Z", "NOPQRSTUVWXYZ", NzCells);
            Slice("Army/Font/Rep Wars Font Special Characters", "!?.,:;-+()[]{}/\\#@$&%*", SpecialCells);
            if (glyphs.TryGetValue('0', out var zero)) emWidth = zero.rect.width / PixelsPerUnit;
        }

        static void Slice(string resourcePath, string characters, Rect[] cells)
        {
            var sheet = Resources.Load<Sprite>(resourcePath);
            if (sheet == null)
            {
                Debug.LogWarning("[RepWars] missing font sheet " + resourcePath);
                return;
            }
            var count = Mathf.Min(characters.Length, cells.Length);
            for (var i = 0; i < count; i++)
            {
                var cell = cells[i];
                var sprite = Sprite.Create(
                    sheet.texture,
                    cell,
                    new Vector2(0.5f, 0f),
                    PixelsPerUnit,
                    0,
                    SpriteMeshType.FullRect);
                sprite.name = characters[i].ToString();
                glyphs[characters[i]] = sprite;
            }
        }

        // Bottom-left rects in sheet pixels. Order matches the character strings above.
        static readonly Rect[] NumberCells =
        {
            new Rect(148, 376, 287, 336),
            new Rect(583, 376, 185, 336),
            new Rect(914, 376, 264, 336),
            new Rect(1326, 376, 265, 336),
            new Rect(1725, 376, 298, 336),
            new Rect(156, 11, 271, 339),
            new Rect(551, 11, 277, 339),
            new Rect(941, 11, 264, 339),
            new Rect(1326, 11, 283, 339),
            new Rect(1752, 11, 271, 339),
        };

        static readonly Rect[] AmCells =
        {
            new Rect(42, 682, 291, 277),
            new Rect(363, 682, 249, 277),
            new Rect(648, 682, 236, 277),
            new Rect(939, 682, 267, 277),
            new Rect(1236, 682, 241, 277),
            new Rect(67, 367, 239, 276),
            new Rect(343, 367, 259, 276),
            new Rect(632, 367, 289, 276),
            new Rect(1000, 367, 152, 276),
            new Rect(1236, 367, 227, 276),
            new Rect(191, 57, 307, 275),
            new Rect(565, 57, 265, 275),
            new Rect(899, 57, 372, 275),
        };

        static readonly Rect[] NzCells =
        {
            new Rect(31, 650, 289, 302),
            new Rect(340, 650, 280, 302),
            new Rect(649, 650, 258, 302),
            new Rect(917, 650, 271, 302),
            new Rect(1230, 650, 277, 302),
            new Rect(44, 356, 238, 280),
            new Rect(304, 356, 242, 280),
            new Rect(558, 356, 274, 280),
            new Rect(839, 356, 302, 280),
            new Rect(1155, 356, 361, 280),
            new Rect(250, 66, 304, 268),
            new Rect(571, 66, 280, 268),
            new Rect(870, 66, 259, 268),
        };

        static readonly Rect[] SpecialCells =
        {
            new Rect(54, 674, 118, 292),
            new Rect(224, 674, 204, 292),
            new Rect(462, 674, 112, 292),
            new Rect(640, 674, 110, 292),
            new Rect(816, 674, 96, 292),
            new Rect(978, 674, 98, 292),
            new Rect(1124, 674, 170, 292),
            new Rect(1318, 674, 188, 292),
            new Rect(38, 356, 140, 286),
            new Rect(216, 356, 138, 286),
            new Rect(404, 356, 114, 286),
            new Rect(586, 356, 114, 286),
            new Rect(766, 356, 132, 286),
            new Rect(962, 356, 130, 286),
            new Rect(1114, 356, 200, 286),
            new Rect(1324, 356, 188, 286),
            new Rect(26, 52, 228, 268),
            new Rect(278, 52, 252, 268),
            new Rect(558, 52, 198, 268),
            new Rect(786, 52, 236, 268),
            new Rect(1040, 52, 238, 268),
            new Rect(1284, 52, 240, 268),
        };
    }
}
