using System;
using System.Collections.Generic;
using UnityEngine;

namespace RepWars.CharacterProduction.EditorTools
{
    public sealed class KnightASkinSectionPixels
    {
        // Top-left source coordinates, including an 8+ pixel transparent gutter outside the painted island.
        public RectInt sourceBounds;
        public Color32[] pixels;
    }

    public static class KnightASkinGeometry
    {
        public static KnightASkinSectionPixels Extract(KnightASkinConfiguration config,
            KnightASkinSectionDefinition section, Color32[] source, int[] ownership = null)
        {
            var width = config.sourceWidth;
            var height = config.sourceHeight;
            if (source == null || source.Length != width * height) throw new ArgumentException("Source pixel dimensions do not match the reviewed sheet.");
            var selected = new bool[source.Length];
            var queue = new Queue<int>();
            var seed = section.seedY * width + section.seedX;
            if (source[(height - 1 - section.seedY) * width + section.seedX].a == 0)
                throw new InvalidOperationException(section.id + " source seed is transparent.");
            if (config.isolationAlpha > 0)
            {
                if (ownership == null) ownership = BuildOwnership(config, source);
                var identity = Array.IndexOf(config.sections, section) + 1;
                if (identity < 1 || ownership.Length != source.Length) throw new InvalidOperationException("Section ownership data is invalid.");
                for (var i = 0; i < ownership.Length; i++)
                    if (ownership[i] == identity) { selected[i] = true; queue.Enqueue(i); }
            }
            else { selected[seed] = true; queue.Enqueue(seed); }
            var minX = section.seedX; var maxX = minX;
            var minY = section.seedY; var maxY = minY;
            while (queue.Count > 0)
            {
                var index = queue.Dequeue(); var x = index % width; var y = index / width;
                minX = Math.Min(minX, x); maxX = Math.Max(maxX, x);
                minY = Math.Min(minY, y); maxY = Math.Max(maxY, y);
                if (config.isolationAlpha == 0)
                {
                    Visit(x - 1, y, section, source, selected, queue, width, height);
                    Visit(x + 1, y, section, source, selected, queue, width, height);
                    Visit(x, y - 1, section, source, selected, queue, width, height);
                    Visit(x, y + 1, section, source, selected, queue, width, height);
                }
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
            return new KnightASkinSectionPixels { sourceBounds = bounds, pixels = output };
        }

        /// <summary>Separate authored core islands, then assign their connected low-alpha fringe without discarding it.</summary>
        public static int[] BuildOwnership(KnightASkinConfiguration config, Color32[] source)
        {
            if (config.isolationAlpha == 0) return null;
            var width = config.sourceWidth; var height = config.sourceHeight;
            var owners = new int[source.Length];
            var queue = new Queue<int>();
            for (var sectionIndex = 0; sectionIndex < config.sections.Length; sectionIndex++)
            {
                var section = config.sections[sectionIndex];
                var seed = section.seedY * width + section.seedX;
                if (owners[seed] != 0 || source[(height - 1 - section.seedY) * width + section.seedX].a <= config.isolationAlpha)
                    throw new InvalidOperationException(section.id + " does not identify a distinct painted core island.");
                owners[seed] = sectionIndex + 1;
                queue.Enqueue(seed);
                FloodOwners(queue, owners, source, width, height, config.isolationAlpha);
            }
            // All cores are protected before low-alpha expansion. No original pixel is changed.
            for (var i = 0; i < owners.Length; i++) if (owners[i] != 0) queue.Enqueue(i);
            FloodOwners(queue, owners, source, width, height, 0);
            return owners;
        }

        static void FloodOwners(Queue<int> queue, int[] owners, Color32[] source, int width, int height, int threshold)
        {
            while (queue.Count > 0)
            {
                var index = queue.Dequeue(); var x = index % width; var y = index / width;
                Claim(x - 1, y, index, queue, owners, source, width, height, threshold);
                Claim(x + 1, y, index, queue, owners, source, width, height, threshold);
                Claim(x, y - 1, index, queue, owners, source, width, height, threshold);
                Claim(x, y + 1, index, queue, owners, source, width, height, threshold);
            }
        }

        static void Claim(int x, int y, int parent, Queue<int> queue, int[] owners, Color32[] source,
            int width, int height, int threshold)
        {
            if (x < 0 || x >= width || y < 0 || y >= height) return;
            var index = y * width + x;
            if (owners[index] != 0 || source[(height - 1 - y) * width + x].a <= threshold) return;
            owners[index] = owners[parent];
            queue.Enqueue(index);
        }

        static void Visit(int x, int y, KnightASkinSectionDefinition section, Color32[] source,
            bool[] selected, Queue<int> queue, int width, int height)
        {
            if (x < 0 || x >= width || y < section.minY || y >= section.maxY) return;
            var index = y * width + x;
            if (selected[index] || source[(height - 1 - y) * width + x].a == 0) return;
            selected[index] = true;
            queue.Enqueue(index);
        }

        public static void BuildGrid(KnightASkinConfiguration config, KnightASkinSectionDefinition section,
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
                weights[index] = Weights(config, section, bounds.x + fx * bounds.width, bounds.y + (1f - fy) * bounds.height);
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
        public static BoneWeight Weights(KnightASkinConfiguration config, KnightASkinSectionDefinition section, float x, float y)
        {
            if (config.view == MasterHumanoidView.Front) return FrontWeights(section.id, x, y);
            var names = new List<string> { section.dominantBone };
            var values = new List<float> { 1f };
            foreach (var transition in section.transitions)
            {
                var amount = transition.maximum * Smooth(transition.fromY, transition.toY, y);
                if (transition.useX) amount *= Smooth(transition.fromX, transition.toX, x);
                for (var i = 0; i < values.Count; i++) values[i] *= 1f - amount;
                var existing = names.IndexOf(transition.bone);
                if (existing < 0) { names.Add(transition.bone); values.Add(amount); }
                else values[existing] += amount;
            }
            return Pack(names.ToArray(), values.ToArray());
        }

        public static BoneWeight FrontWeights(string sectionId, float x, float y)
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
