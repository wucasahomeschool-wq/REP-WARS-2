using System;
using System.Collections.Generic;
using UnityEngine;

namespace RepWars.CharacterProduction.EditorTools
{
    public sealed class KnightAFrontSectionPixels
    {
        // Top-left source coordinates, including an 8+ pixel transparent gutter outside the painted island.
        public RectInt sourceBounds;
        public Color32[] pixels;
    }

    public static class KnightAFrontSkinGeometry
    {
        public static KnightAFrontSectionPixels Extract(KnightAFrontConfiguration config,
            KnightAFrontSectionDefinition section, Color32[] source)
        {
            var width = config.sourceWidth;
            var height = config.sourceHeight;
            if (source == null || source.Length != width * height) throw new ArgumentException("Source pixel dimensions do not match the reviewed sheet.");
            var selected = new bool[source.Length];
            var queue = new Queue<int>();
            var seed = section.seedY * width + section.seedX;
            if (source[(height - 1 - section.seedY) * width + section.seedX].a == 0)
                throw new InvalidOperationException(section.id + " source seed is transparent.");
            selected[seed] = true;
            queue.Enqueue(seed);
            var minX = section.seedX; var maxX = minX;
            var minY = section.seedY; var maxY = minY;
            while (queue.Count > 0)
            {
                var index = queue.Dequeue(); var x = index % width; var y = index / width;
                minX = Math.Min(minX, x); maxX = Math.Max(maxX, x);
                minY = Math.Min(minY, y); maxY = Math.Max(maxY, y);
                Visit(x - 1, y, section, source, selected, queue, width, height);
                Visit(x + 1, y, section, source, selected, queue, width, height);
                Visit(x, y - 1, section, source, selected, queue, width, height);
                Visit(x, y + 1, section, source, selected, queue, width, height);
            }
            var bounds = new RectInt(minX - config.padding, minY - config.padding,
                maxX - minX + 1 + config.padding * 2, maxY - minY + 1 + config.padding * 2);
            var output = new Color32[bounds.width * bounds.height];
            for (var y = 0; y < bounds.height; y++) for (var x = 0; x < bounds.width; x++)
            {
                var sx = bounds.x + x; var sy = bounds.y + y;
                if (sx < 0 || sx >= width || sy < section.minY || sy >= section.maxY) continue;
                var pixel = source[(height - 1 - sy) * width + sx];
                // Preserve exact source RGBA and faint disconnected edge pixels. Exclude neighboring painted islands.
                if (selected[sy * width + sx] || pixel.a <= 2) output[(bounds.height - 1 - y) * bounds.width + x] = pixel;
            }
            return new KnightAFrontSectionPixels { sourceBounds = bounds, pixels = output };
        }

        static void Visit(int x, int y, KnightAFrontSectionDefinition section, Color32[] source,
            bool[] selected, Queue<int> queue, int width, int height)
        {
            if (x < 0 || x >= width || y < section.minY || y >= section.maxY) return;
            var index = y * width + x;
            if (selected[index] || source[(height - 1 - y) * width + x].a == 0) return;
            selected[index] = true;
            queue.Enqueue(index);
        }

        public static void BuildGrid(KnightAFrontConfiguration config, KnightAFrontSectionDefinition section,
            RectInt bounds, out Vector2[] vertices, out ushort[] triangles, out BoneWeight[] weights)
        {
            var columns = section.meshColumns; var rows = section.meshRows;
            vertices = new Vector2[(columns + 1) * (rows + 1)];
            weights = new BoneWeight[vertices.Length];
            triangles = new ushort[columns * rows * 6];
            for (var y = 0; y <= rows; y++) for (var x = 0; x <= columns; x++)
            {
                var fx = (float)x / columns; var fy = (float)y / rows;
                var index = y * (columns + 1) + x;
                vertices[index] = new Vector2((fx - 0.5f) * bounds.width / config.pixelsPerUnit,
                    (fy - 0.5f) * bounds.height / config.pixelsPerUnit);
                weights[index] = Weights(section.id, bounds.x + fx * bounds.width, bounds.y + (1f - fy) * bounds.height);
            }
            var t = 0;
            for (var y = 0; y < rows; y++) for (var x = 0; x < columns; x++)
            {
                var a = y * (columns + 1) + x; var b = a + columns + 1;
                triangles[t++] = (ushort)a; triangles[t++] = (ushort)b; triangles[t++] = (ushort)(a + 1);
                triangles[t++] = (ushort)(a + 1); triangles[t++] = (ushort)b; triangles[t++] = (ushort)(b + 1);
            }
        }

        /// <summary>Initial controlled weights in source-pixel coordinates. These are technical starting weights, not visually approved weights.</summary>
        public static BoneWeight Weights(string sectionId, float x, float y)
        {
            if (sectionId == "HeadNeck")
            {
                var neck = 0.9f * Smooth(160, 215, y);
                return Pack(new[] { "Head", "Neck" }, new[] { 1f - neck, neck });
            }
            if (sectionId == "UpperTorso")
            {
                var side = x < 510 ? "Right" : "Left";
                var spine = 0.15f * Smooth(460, 565, y);
                var shoulder = 0.10f * Smooth(420, 315, y) * (side == "Right" ? Smooth(480, 360, x) : Smooth(560, 675, x));
                return Pack(new[] { "Chest", "Spine", side + "Clavicle", side + "UpperArm" },
                    new[] { 1f - spine - shoulder, spine, shoulder * 0.6f, shoulder * 0.4f });
            }
            if (sectionId == "LowerTorso")
            {
                var spine = 0.08f * Smooth(660, 590, y);
                var cloth = 0.10f * Smooth(635, 780, y) * Mathf.Clamp01(1f - Mathf.Abs(x - 520) / 55f);
                return Pack(new[] { "Pelvis", "Spine", "LeftThigh", "RightThigh" },
                    new[] { 1f - spine - cloth, spine, cloth * 0.5f, cloth * 0.5f });
            }
            var limb = sectionId.StartsWith("Left", StringComparison.Ordinal) ? "Left" : "Right";
            if (sectionId.EndsWith("UpperArm", StringComparison.Ordinal))
            {
                var forearm = 0.8f * Smooth(460, 515, y);
                var clavicle = 0.08f * Smooth(405, 310, y) * (1f - forearm);
                return Pack(new[] { limb + "Clavicle", limb + "UpperArm", limb + "Forearm" }, new[] { clavicle, 1f - clavicle - forearm, forearm });
            }
            if (sectionId.EndsWith("ForearmHand", StringComparison.Ordinal))
            {
                var wrist = limb == "Right" ? 715f : 735f;
                var hand = Smooth(wrist - 18f, wrist + 20f, y);
                var upper = 0.08f * Smooth(580, 510, y) * (1f - hand);
                return Pack(new[] { limb + "UpperArm", limb + "Forearm", limb + "Hand" }, new[] { upper, 1f - upper - hand, hand });
            }
            if (sectionId.EndsWith("UpperLeg", StringComparison.Ordinal))
            {
                var shin = Smooth(990, 1045, y);
                var pelvis = 0.06f * Smooth(920, 835, y) * (1f - shin);
                return Pack(new[] { "Pelvis", limb + "Thigh", limb + "Shin" }, new[] { pelvis, 1f - pelvis - shin, shin });
            }
            if (sectionId.EndsWith("LowerLegFoot", StringComparison.Ordinal))
            {
                var foot = Smooth(1378, 1425, y);
                return Pack(new[] { limb + "Shin", limb + "Foot" }, new[] { 1f - foot, foot });
            }
            throw new ArgumentException("Unsupported body section " + sectionId);
        }

        static float Smooth(float from, float to, float value) { return Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(from, to, value)); }

        static BoneWeight Pack(string[] names, float[] values)
        {
            var indices = new int[4]; var result = new float[4]; var count = 0; var sum = 0f;
            for (var i = 0; i < names.Length; i++)
            {
                if (values[i] <= 0) continue;
                if (count == 4) throw new InvalidOperationException("A vertex exceeds four bone influences.");
                var index = -1;
                for (var j = 0; j < MasterHumanoidRigContract.Bones.Count; j++)
                    if (MasterHumanoidRigContract.Bones[j].name == names[i]) { index = j; break; }
                if (index < 0) throw new InvalidOperationException("Weight references noncanonical bone " + names[i]);
                indices[count] = index; result[count++] = values[i]; sum += values[i];
            }
            if (sum <= 0) throw new InvalidOperationException("A vertex has no positive bone weight.");
            return new BoneWeight { boneIndex0 = indices[0], boneIndex1 = indices[1], boneIndex2 = indices[2], boneIndex3 = indices[3],
                weight0 = result[0] / sum, weight1 = result[1] / sum, weight2 = result[2] / sum, weight3 = result[3] / sum };
        }
    }
}
