using UnityEngine;

namespace RepWars.CharacterProduction.EditorTools
{
    public static class KnightAFrontSkinGeometry
    {
        public static KnightASkinSectionPixels Extract(KnightASkinConfiguration config, KnightASkinSectionDefinition section, Color32[] pixels)
        { return KnightASkinGeometry.Extract(config, section, pixels); }
        public static void BuildGrid(KnightASkinConfiguration config, KnightASkinSectionDefinition section, RectInt bounds,
            out Vector2[] vertices, out ushort[] triangles, out BoneWeight[] weights)
        { KnightASkinGeometry.BuildGrid(config, section, bounds, out vertices, out triangles, out weights); }
        public static BoneWeight Weights(string sectionId, float x, float y)
        { return KnightASkinGeometry.FrontWeights(sectionId, x, y); }
    }
}
