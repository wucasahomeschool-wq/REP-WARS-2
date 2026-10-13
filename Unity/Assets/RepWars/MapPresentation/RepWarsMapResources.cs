using System.Collections.Generic;
using UnityEngine;

namespace RepWars
{
    /// <summary>
    /// Sits on the map root and owns the meshes and materials the map presenters create at runtime.
    /// Destroying the map root releases them. Project assets (sprites, textures, fonts) are never tracked here.
    /// </summary>
    public class RepWarsMapResources : MonoBehaviour
    {
        readonly List<Object> owned = new List<Object>();

        public int OwnedCount => owned.Count;

        public static RepWarsMapResources Create(GameObject mapRoot)
        {
            return mapRoot.AddComponent<RepWarsMapResources>();
        }

        /// <summary>Registers a runtime-created object so it is destroyed with the map.</summary>
        public T Own<T>(T runtimeObject) where T : Object
        {
            if (runtimeObject != null) owned.Add(runtimeObject);
            return runtimeObject;
        }

        /// <summary>A new unlit sprite-style material with the shader's default color.</summary>
        public Material NewSpriteMaterial()
        {
            var shader = Shader.Find("Universal Render Pipeline/2D/Sprite-Unlit-Default");
            if (shader == null) shader = Shader.Find("Sprites/Default");
            return Own(new Material(shader));
        }

        void OnDestroy()
        {
            for (var i = 0; i < owned.Count; i++)
            {
                var item = owned[i];
                if (item == null) continue;
                if (Application.isPlaying) Destroy(item);
                else DestroyImmediate(item);
            }
            owned.Clear();
        }
    }
}
