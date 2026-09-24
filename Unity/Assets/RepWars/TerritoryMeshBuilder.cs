using System.Collections.Generic;
using UnityEngine;

namespace RepWars
{
    public static class TerritoryMeshBuilder
    {
        public static Mesh Build(IList<Vector2> ring)
        {
            var points = new List<Vector2>(ring.Count);
            for (var i = 0; i < ring.Count; i++)
            {
                if (points.Count > 0 && (points[points.Count - 1] - ring[i]).sqrMagnitude < 0.000001f) continue;
                points.Add(ring[i]);
            }
            if (points.Count > 1 && (points[0] - points[points.Count - 1]).sqrMagnitude < 0.000001f)
            {
                points.RemoveAt(points.Count - 1);
            }

            var mesh = new Mesh();
            mesh.name = "Territory";
            if (points.Count < 3) return mesh;

            var vertices = new Vector3[points.Count];
            for (var i = 0; i < points.Count; i++) vertices[i] = points[i];
            mesh.vertices = vertices;
            mesh.triangles = Triangulate(points);
            mesh.RecalculateBounds();
            mesh.RecalculateNormals();
            return mesh;
        }

        static int[] Triangulate(List<Vector2> points)
        {
            var index = new List<int>(points.Count);
            for (var i = 0; i < points.Count; i++) index.Add(i);
            if (SignedArea(points) < 0f) index.Reverse();

            var triangles = new List<int>();
            var guard = points.Count * points.Count;
            while (index.Count > 3 && guard-- > 0)
            {
                var clipped = false;
                for (var i = 0; i < index.Count; i++)
                {
                    var prev = index[(i + index.Count - 1) % index.Count];
                    var curr = index[i];
                    var next = index[(i + 1) % index.Count];
                    if (!IsEar(points, index, prev, curr, next)) continue;
                    triangles.Add(prev);
                    triangles.Add(curr);
                    triangles.Add(next);
                    index.RemoveAt(i);
                    clipped = true;
                    break;
                }
                if (!clipped) break;
            }
            if (index.Count == 3)
            {
                triangles.Add(index[0]);
                triangles.Add(index[1]);
                triangles.Add(index[2]);
            }
            return triangles.ToArray();
        }

        static bool IsEar(List<Vector2> points, List<int> index, int prev, int curr, int next)
        {
            var a = points[prev];
            var b = points[curr];
            var c = points[next];
            if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) <= 0f) return false;
            for (var i = 0; i < index.Count; i++)
            {
                var p = index[i];
                if (p == prev || p == curr || p == next) continue;
                if (PointInTriangle(points[p], a, b, c)) return false;
            }
            return true;
        }

        static bool PointInTriangle(Vector2 p, Vector2 a, Vector2 b, Vector2 c)
        {
            var ab = Cross(p, a, b);
            var bc = Cross(p, b, c);
            var ca = Cross(p, c, a);
            var hasNeg = ab < 0f || bc < 0f || ca < 0f;
            var hasPos = ab > 0f || bc > 0f || ca > 0f;
            return !(hasNeg && hasPos);
        }

        static float Cross(Vector2 p, Vector2 a, Vector2 b)
        {
            return (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
        }

        static float SignedArea(List<Vector2> points)
        {
            float sum = 0f;
            for (var i = 0; i < points.Count; i++)
            {
                var a = points[i];
                var b = points[(i + 1) % points.Count];
                sum += a.x * b.y - b.x * a.y;
            }
            return sum * 0.5f;
        }
    }
}
