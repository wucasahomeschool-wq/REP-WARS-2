using UnityEngine;

namespace RepWars.WorldPresentation
{
    /// <summary>
    /// Applies the shared sort axis once when a proof or presentation camera enables.
    /// Unity 6000.6 does not serialize Camera.transparencySortMode, so this keeps the
    /// camera matched to Renderer2D. URP 2D sorting itself reads the renderer asset.
    /// </summary>
    [DisallowMultipleComponent]
    [RequireComponent(typeof(Camera))]
    [ExecuteAlways]
    public sealed class WorldSortingCameraBinding : MonoBehaviour
    {
        void OnEnable()
        {
            RepWarsWorldSorting.ApplySortAxis(GetComponent<Camera>());
        }
    }
}
