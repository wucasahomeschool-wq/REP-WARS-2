using UnityEngine;

namespace RepWars
{
    /// <summary>
    /// One authored territory. Hit testing uses the polygon from the world definition.
    /// The outline is the normal border. Selection is drawn by RepWarsSelectionPresentation.
    /// </summary>
    public class RepWarsTerritoryView : MonoBehaviour
    {
        public string territoryId;
        public LineRenderer outline;
        public float normalWidth = 0.35f;
        public Color normalColor = new Color(0.165f, 0.188f, 0.22f, 1f);
    }
}
