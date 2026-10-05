using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace RepWars.CharacterProduction.EditorTools
{
    [Serializable]
    public sealed class TeamColorMaskPolygon
    {
        public string id;
        public float featherPixels;
        public Vector2[] points;
    }
    [Serializable]
    public sealed class TeamColorMaskSection
    {
        public string sectionId;
        public TeamColorMaskPolygon[] polygons;
        public string reviewNote;
    }
    [Serializable]
    public sealed class TeamColorMaskView
    {
        public MasterHumanoidView view;
        public string sourceSha256, skinConfigurationSha256;
        public TeamColorMaskSection[] sections;
    }

    /// <summary>Explicit polygons in original PNG top-left coordinates; no color keys or alpha-derived masks.</summary>
    [Serializable]
    public sealed class KnightATeamColorConfiguration
    {
        public const string AssetPath = MasterHumanoidRigBuilder.Root + "/Editor/KnightATeamColor.configuration.json";
        public int version;
        public string characterId;
        public TeamColorMaskView[] views;
        public string ConfigurationHash { get { return KnightASkinConfiguration.HashFile(KnightASkinConfiguration.AssetFullPath(AssetPath)); } }

        public static KnightATeamColorConfiguration Load()
        {
            var result = JsonUtility.FromJson<KnightATeamColorConfiguration>(File.ReadAllText(KnightASkinConfiguration.AssetFullPath(AssetPath)));
            if (result == null) throw new InvalidOperationException("Team-color recipe could not be parsed.");
            var errors = result.Validate();
            if (errors.Count > 0) throw new InvalidOperationException(string.Join("\n", errors.ToArray()));
            return result;
        }

        public TeamColorMaskView GetView(MasterHumanoidView view)
        { return Array.Find(views, v => v != null && v.view == view); }

        public List<string> Validate()
        {
            var errors = new List<string>();
            if (version != 1 || characterId != "KnightA") errors.Add("Expected KnightA mask recipe version 1.");
            var viewIds = new HashSet<MasterHumanoidView>();
            if (views == null || views.Length != 3) errors.Add("Exactly three authored mask views are required; never six facing masks.");
            if (views == null) return errors;
            foreach (var view in views)
            {
                if (view == null || !Enum.IsDefined(typeof(MasterHumanoidView), view.view) || !viewIds.Add(view.view))
                { errors.Add("Invalid or duplicate mask view."); continue; }
                var skin = KnightASkinConfiguration.Load(view.view);
                skin.VerifySource();
                if (view.sourceSha256 != skin.sourceSha256 || view.skinConfigurationSha256 != skin.ConfigurationHash)
                    errors.Add(view.view + ": source/calibration provenance changed; review the explicit polygons before regenerating.");
                var identities = new HashSet<string>();
                if (view.sections == null) { errors.Add(view.view + ": missing section decisions."); continue; }
                foreach (var section in view.sections)
                {
                    if (section == null || Array.IndexOf(KnightASkinConfiguration.SectionIds, section.sectionId) < 0 || !identities.Add(section.sectionId))
                    { errors.Add(view.view + ": invalid/duplicate mask section identity."); continue; }
                    if (section.polygons == null || string.IsNullOrEmpty(section.reviewNote))
                    { errors.Add(view.view + "/" + section.sectionId + ": explicit polygons (possibly empty) and review note are required."); continue; }
                    var polygonIds = new HashSet<string>();
                    foreach (var polygon in section.polygons)
                    {
                        if (polygon == null || string.IsNullOrEmpty(polygon.id) || !polygonIds.Add(polygon.id) ||
                            polygon.points == null || polygon.points.Length < 3 || polygon.points.Length > 32 ||
                            !Finite(polygon.featherPixels) || polygon.featherPixels < 0 || polygon.featherPixels > 8)
                        { errors.Add(view.view + "/" + section.sectionId + ": invalid polygon identity, geometry, or inward feather."); continue; }
                        var area = 0f;
                        for (var i = 0; i < polygon.points.Length; i++)
                        {
                            var p = polygon.points[i]; var q = polygon.points[(i + 1) % polygon.points.Length];
                            if (!Finite(p.x) || !Finite(p.y) || p.x < 0 || p.y < 0 || p.x >= skin.sourceWidth || p.y >= skin.sourceHeight)
                                errors.Add(polygon.id + ": source-coordinate point is out of bounds.");
                            if ((p - q).sqrMagnitude < 0.00001f) errors.Add(polygon.id + ": consecutive points must differ.");
                            area += p.x * q.y - q.x * p.y;
                            for (var j = i + 2; j < polygon.points.Length; j++)
                                if (!(i == 0 && j == polygon.points.Length - 1) && Crosses(p, q, polygon.points[j], polygon.points[(j + 1) % polygon.points.Length]))
                                    errors.Add(polygon.id + ": polygon edges intersect; author a simple polygon.");
                        }
                        if (Mathf.Abs(area) < 1f) errors.Add(polygon.id + ": polygon has no usable area.");
                    }
                }
                if (!identities.SetEquals(KnightASkinConfiguration.SectionIds)) errors.Add(view.view + ": all eleven section decisions must be explicit.");
            }
            return errors;
        }

        static bool Finite(float value) { return !float.IsNaN(value) && !float.IsInfinity(value); }
        static float Cross(Vector2 a, Vector2 b, Vector2 c) { return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x); }
        static bool Crosses(Vector2 a, Vector2 b, Vector2 c, Vector2 d)
        { return Cross(a,b,c)*Cross(a,b,d) <= 0f && Cross(c,d,a)*Cross(c,d,b) <= 0f &&
            Mathf.Max(Mathf.Min(a.x,b.x),Mathf.Min(c.x,d.x)) <= Mathf.Min(Mathf.Max(a.x,b.x),Mathf.Max(c.x,d.x)) &&
            Mathf.Max(Mathf.Min(a.y,b.y),Mathf.Min(c.y,d.y)) <= Mathf.Min(Mathf.Max(a.y,b.y),Mathf.Max(c.y,d.y)); }
    }

    public static class TeamColorMaskRasterizer
    {
        public static float Coverage(TeamColorMaskPolygon polygon, Vector2 point)
        {
            var inside = false;
            var distance = float.PositiveInfinity;
            for (var i = 0; i < polygon.points.Length; i++)
            {
                var a = polygon.points[i]; var b = polygon.points[(i + 1) % polygon.points.Length];
                if ((a.y > point.y) != (b.y > point.y) && point.x < (b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x) inside = !inside;
                var delta = b-a;
                var nearest = a + delta * Mathf.Clamp01(Vector2.Dot(point-a, delta) / delta.sqrMagnitude);
                distance = Mathf.Min(distance, Vector2.Distance(point, nearest));
            }
            if (!inside) return 0f;
            return polygon.featherPixels <= 0 ? 1f : Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(distance / polygon.featherPixels));
        }

        public static Color32[] Rasterize(TeamColorMaskSection section, RectInt sourceBounds)
        {
            var result = new Color32[sourceBounds.width * sourceBounds.height];
            for (var y = 0; y < sourceBounds.height; y++)
            for (var x = 0; x < sourceBounds.width; x++)
            {
                var point = new Vector2(sourceBounds.x+x+0.5f, sourceBounds.y+y+0.5f);
                var coverage = 0f;
                foreach (var polygon in section.polygons) coverage = Mathf.Max(coverage, Coverage(polygon, point));
                var value = (byte)Mathf.FloorToInt(Mathf.Clamp01(coverage)*255f + 0.5f);
                // Masks are independent of source alpha and RGB. Opaque alpha is not used by the shader.
                result[(sourceBounds.height-1-y)*sourceBounds.width+x] = new Color32(value,value,value,255);
            }
            return result;
        }
    }
}
