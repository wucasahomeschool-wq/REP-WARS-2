using UnityEngine;

namespace RepWars.CharacterProduction.EditorTools
{
    /// <summary>Compatibility facade for the accepted Knight A pipeline; all generation is shared.</summary>
    public static class KnightASkinGeometry
    {
        public static KnightASkinSectionPixels Extract(KnightASkinConfiguration config, KnightASkinSectionDefinition section, Color32[] source, int[] ownership = null)
        { return HumanoidSkinGeometry.Extract(config, section, source, ownership); }
        public static int[] BuildOwnership(KnightASkinConfiguration config, Color32[] source)
        { return HumanoidSkinGeometry.BuildOwnership(config, source); }
        public static void BuildGrid(KnightASkinConfiguration config, KnightASkinSectionDefinition section, RectInt bounds,
            out Vector2[] vertices, out ushort[] triangles, out BoneWeight[] weights)
        { HumanoidSkinGeometry.BuildGrid(config, section, bounds, out vertices, out triangles, out weights); }
        public static BoneWeight Weights(KnightASkinConfiguration config, KnightASkinSectionDefinition section, float x, float y)
        { return HumanoidSkinGeometry.Weights(config, section, x, y); }
        public static BoneWeight FrontWeights(string sectionId, float x, float y)
        { return HumanoidSkinGeometry.FrontWeights(sectionId, x, y); }
    }
}
