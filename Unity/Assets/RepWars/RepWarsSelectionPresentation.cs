using RepWars.WorldPresentation;
using UnityEngine;

namespace RepWars
{
    /// <summary>
    /// One reusable ground highlight and one reusable world-overlay marker for the selected territory.
    /// Both follow the existing territory outline. They do not move gameplay positions or colliders.
    /// </summary>
    public class RepWarsSelectionPresentation : MonoBehaviour
    {
        public const float HighlightWidth = 0.62f;
        public const float MarkerHalfExtent = 0.4f;
        public const float MarkerWidth = 0.16f;

        static readonly Color Ink = new Color32(0xf0, 0xe6, 0xc8, 255);

        LineRenderer highlight;
        LineRenderer marker;
        Material lineMaterial;

        public LineRenderer Highlight => highlight;
        public LineRenderer Marker => marker;
        public string ShownTerritoryId { get; private set; }
        public bool IsShown => highlight != null && highlight.enabled;

        public static RepWarsSelectionPresentation Create(Transform parent)
        {
            var root = new GameObject("Selection");
            root.transform.SetParent(parent, false);
            var presentation = root.AddComponent<RepWarsSelectionPresentation>();
            presentation.Build();
            return presentation;
        }

        public void Show(RepWarsTerritoryView view)
        {
            if (view == null || view.outline == null || view.outline.positionCount < 3)
            {
                Hide();
                return;
            }

            var outline = view.outline;
            var count = outline.positionCount;
            highlight.positionCount = count;
            var sum = Vector3.zero;
            for (var i = 0; i < count; i++)
            {
                var point = view.transform.TransformPoint(outline.GetPosition(i));
                point.z = 0f;
                highlight.SetPosition(i, point);
                sum += point;
            }

            var centroid = sum / count;
            centroid.z = 0f;
            marker.transform.position = centroid;
            highlight.enabled = true;
            marker.enabled = true;
            ShownTerritoryId = view.territoryId;
        }

        public void Hide()
        {
            if (highlight != null) highlight.enabled = false;
            if (marker != null) marker.enabled = false;
            ShownTerritoryId = null;
        }

        void Build()
        {
            lineMaterial = LineMaterial();
            highlight = CreateLine("SelectionHighlight", true, HighlightWidth);
            RepWarsWorldSorting.ApplyOrdered(
                highlight,
                RepWarsWorldSorting.LayerGroundOverlay,
                RepWarsWorldSorting.GroundOverlayOrder.Selection);
            marker = CreateLine("SelectionMarker", false, MarkerWidth);
            var extent = MarkerHalfExtent;
            marker.positionCount = 4;
            marker.SetPosition(0, new Vector3(0f, extent, 0f));
            marker.SetPosition(1, new Vector3(extent, 0f, 0f));
            marker.SetPosition(2, new Vector3(0f, -extent, 0f));
            marker.SetPosition(3, new Vector3(-extent, 0f, 0f));
            RepWarsWorldSorting.ApplyOrdered(
                marker,
                RepWarsWorldSorting.LayerWorldOverlay,
                RepWarsWorldSorting.WorldOverlayOrder.SelectionMarker);
            Hide();
        }

        LineRenderer CreateLine(string name, bool worldSpace, float width)
        {
            var lineObject = new GameObject(name);
            lineObject.transform.SetParent(transform, false);
            var line = lineObject.AddComponent<LineRenderer>();
            line.loop = true;
            line.useWorldSpace = worldSpace;
            line.widthMultiplier = width;
            line.numCornerVertices = 2;
            line.material = lineMaterial;
            line.startColor = Ink;
            line.endColor = Ink;
            line.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            line.receiveShadows = false;
            line.positionCount = 0;
            return line;
        }

        static Material LineMaterial()
        {
            var shader = Shader.Find("Universal Render Pipeline/2D/Sprite-Unlit-Default");
            if (shader == null) shader = Shader.Find("Sprites/Default");
            var material = new Material(shader);
            material.color = Color.white;
            return material;
        }

        void OnDestroy()
        {
            if (lineMaterial == null) return;
            if (Application.isPlaying) Destroy(lineMaterial);
            else DestroyImmediate(lineMaterial);
        }
    }
}
