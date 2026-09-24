using UnityEngine;

namespace RepWars
{
    /// <summary>
    /// One authored territory. Hit testing uses the polygon from the world definition.
    /// </summary>
    public class RepWarsTerritoryView : MonoBehaviour
    {
        public string territoryId;
        public LineRenderer outline;
        public float normalWidth = 0.35f;
        public float selectedWidth = 1.15f;
        public Color normalColor = new Color(0.165f, 0.188f, 0.22f, 1f);
        public Color selectedColor = new Color(0.941f, 0.902f, 0.784f, 1f);

        public void SetSelected(bool selected)
        {
            if (outline == null) return;
            var color = selected ? selectedColor : normalColor;
            outline.startColor = color;
            outline.endColor = color;
            outline.widthMultiplier = selected ? selectedWidth : normalWidth;
        }
    }
}
