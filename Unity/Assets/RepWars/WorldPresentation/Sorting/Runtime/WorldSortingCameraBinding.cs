using UnityEngine;

namespace RepWars.WorldPresentation
{
    /// <summary>
    /// Applies the shared sort axis once when the camera enables.
    /// The sorting proof and the live map both use this so the camera matches Renderer2D.
    /// Unity 6000.6 does not serialize Camera.transparencySortMode. URP 2D sorting
    /// itself reads the renderer asset.
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
