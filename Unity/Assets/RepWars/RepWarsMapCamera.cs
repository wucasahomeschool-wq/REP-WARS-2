using UnityEngine;
using UnityEngine.InputSystem;

namespace RepWars
{
    /// <summary>
    /// Orthographic map camera. Pan and zoom stay near the framed world.
    /// </summary>
    public class RepWarsMapCamera : MonoBehaviour
    {
        public float minSize = 5f;
        public float maxSize = 40f;
        public Vector2 homeCenter;
        public Vector2 panLimit = new Vector2(20f, 20f);

        Camera mapCamera;
        Vector3 pointerDown;
        Vector3 pointerLast;
        bool pressing;
        bool dragged;
        public float DragPixels = 8f;

        public bool ConsumedPress { get; private set; }

        void Awake()
        {
            mapCamera = GetComponent<Camera>();
            if (mapCamera == null) mapCamera = Camera.main;
        }

        public void Frame(Vector3 center, float orthographicSize, float aspect)
        {
            if (mapCamera == null) mapCamera = GetComponent<Camera>();
            homeCenter = center;
            var fit = Mathf.Max(1f, orthographicSize);
            minSize = fit * 0.38f;
            maxSize = fit * 1.25f;
            panLimit = new Vector2(fit * Mathf.Max(0.6f, aspect), fit) * 0.55f;
            mapCamera.orthographic = true;
            mapCamera.orthographicSize = Mathf.Clamp(fit, minSize, maxSize);
            mapCamera.transform.position = new Vector3(center.x, center.y, -10f);
        }

        public void Tick()
        {
            if (mapCamera == null) return;
            var mouse = Mouse.current;
            if (mouse == null) return;
            var scroll = mouse.scroll.ReadValue().y;
            if (Mathf.Abs(scroll) > 0.01f)
            {
                var before = ScreenToMap(mouse.position.ReadValue());
                mapCamera.orthographicSize = Mathf.Clamp(mapCamera.orthographicSize * (scroll > 0f ? 0.9f : 1.1f), minSize, maxSize);
                var after = ScreenToMap(mouse.position.ReadValue());
                mapCamera.transform.position += new Vector3(before.x - after.x, before.y - after.y, 0f);
                Clamp();
            }

            if (mouse.leftButton.wasPressedThisFrame)
            {
                pressing = true;
                dragged = false;
                ConsumedPress = false;
                pointerDown = mouse.position.ReadValue();
                pointerLast = ScreenToMap(pointerDown);
            }
            else if (pressing && mouse.leftButton.isPressed)
            {
                var screen = mouse.position.ReadValue();
                if ((screen - (Vector2)pointerDown).sqrMagnitude > DragPixels * DragPixels) dragged = true;
                if (dragged)
                {
                    var now = ScreenToMap(screen);
                    mapCamera.transform.position += new Vector3(pointerLast.x - now.x, pointerLast.y - now.y, 0f);
                    pointerLast = ScreenToMap(mouse.position.ReadValue());
                    Clamp();
                    ConsumedPress = true;
                }
            }
            else if (pressing && mouse.leftButton.wasReleasedThisFrame)
            {
                pressing = false;
                ConsumedPress = dragged;
            }
        }

        public bool TryPick(out Vector2 worldPoint)
        {
            var mouse = Mouse.current;
            worldPoint = mouse != null ? ScreenToMap(mouse.position.ReadValue()) : Vector2.zero;
            return mouse != null && mouse.leftButton.wasReleasedThisFrame && !ConsumedPress;
        }

        public Vector2 ScreenToMap(Vector3 screen)
        {
            if (mapCamera == null) return Vector2.zero;
            var world = mapCamera.ScreenToWorldPoint(screen);
            return new Vector2(world.x, world.y);
        }

        void Clamp()
        {
            var position = mapCamera.transform.position;
            position.x = Mathf.Clamp(position.x, homeCenter.x - panLimit.x, homeCenter.x + panLimit.x);
            position.y = Mathf.Clamp(position.y, homeCenter.y - panLimit.y, homeCenter.y + panLimit.y);
            position.z = -10f;
            mapCamera.transform.position = position;
        }
    }
}
