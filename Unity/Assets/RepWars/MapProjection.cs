using System.Collections.Generic;
using UnityEngine;

namespace RepWars
{
    /// <summary>
    /// Renderer-side oblique projection. Authored coordinates stay +x right, +y up.
    /// The contract says the WorldDefinition is strategic geometry, not a pre-projected mesh.
    /// </summary>
    public static class MapProjection
    {
        public const float VerticalScale = 0.62f;
        public const float Shear = 0.32f;

        public static Vector2 Project(Vector2 point)
        {
            return new Vector2(point.x + point.y * Shear, point.y * VerticalScale);
        }

        public static List<Vector2> Project(IList<Vector2> ring)
        {
            var projected = new List<Vector2>(ring.Count);
            for (var i = 0; i < ring.Count; i++) projected.Add(Project(ring[i]));
            return projected;
        }
    }
}
