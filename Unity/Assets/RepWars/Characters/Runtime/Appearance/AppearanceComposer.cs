using System.Collections.Generic;
using UnityEngine;

namespace RepWars.Characters
{
    /// <summary>What happened when an appearance was applied.</summary>
    public sealed class AppearanceApplyResult
    {
        public readonly List<string> Applied = new List<string>();
        public readonly List<string> Skipped = new List<string>();
        public string Error;

        public bool Success { get { return Error == null; } }
    }

    /// <summary>
    /// Puts an AppearanceDefinition onto a character by asking a SocketRegistry for attachment points.
    /// Knows nothing about rigs or backends. Each slot uses its own mechanism.
    /// Application is all-or-nothing: on error the previous appearance stays in place.
    /// </summary>
    public sealed class AppearanceComposer
    {
        readonly List<GameObject> spawned = new List<GameObject>();
        readonly List<SpriteRenderer> tintedRenderers = new List<SpriteRenderer>();

        public string AppliedAppearanceId { get; private set; }

        public int SpawnedObjectCount { get { return spawned.Count; } }

        public AppearanceApplyResult Apply(
            AppearanceDefinition appearance,
            SocketRegistry sockets,
            int sortingOrderBase,
            string sortingLayerName,
            Color tint)
        {
            var result = new AppearanceApplyResult();
            if (appearance == null) { result.Error = "Appearance is null"; return result; }
            if (sockets == null) { result.Error = "No socket registry to attach appearance '" + appearance.appearanceId + "' to"; return result; }

            var newObjects = new List<GameObject>();
            var newTinted = new List<SpriteRenderer>();

            var bindings = appearance.bindings;
            if (bindings != null)
            {
                for (var i = 0; i < bindings.Length; i++)
                {
                    var binding = bindings[i];
                    var label = appearance.appearanceId + "/" + (binding != null ? binding.slot.ToString() : "binding" + i);
                    if (binding == null)
                    {
                        result.Error = "Appearance '" + appearance.appearanceId + "' binding " + i + " is empty";
                        break;
                    }
                    if (!TryApplyBinding(binding, label, sockets, sortingOrderBase, sortingLayerName, tint, newObjects, newTinted, result))
                    {
                        break;
                    }
                }
            }

            if (!result.Success)
            {
                foreach (var go in newObjects) DestroyObject(go);
                return result;
            }

            Clear();
            spawned.AddRange(newObjects);
            tintedRenderers.AddRange(newTinted);
            AppliedAppearanceId = appearance.appearanceId;
            return result;
        }

        bool TryApplyBinding(
            AppearanceSlotBinding binding,
            string label,
            SocketRegistry sockets,
            int sortingOrderBase,
            string sortingLayerName,
            Color tint,
            List<GameObject> newObjects,
            List<SpriteRenderer> newTinted,
            AppearanceApplyResult result)
        {
            switch (binding.mechanism)
            {
                case AppearanceMechanism.SocketSprite:
                {
                    if (binding.sprite == null) { result.Error = label + ": SocketSprite has no sprite"; return false; }
                    if (!sockets.TryGet(binding.socketName, out var socket))
                    {
                        result.Error = label + ": rig has no socket '" + binding.socketName + "'";
                        return false;
                    }
                    var go = new GameObject("Appearance_" + binding.slot);
                    go.transform.SetParent(socket, false);
                    go.transform.localPosition = binding.localOffset;
                    go.transform.localScale = new Vector3(binding.localScale.x, binding.localScale.y, 1f);
                    newObjects.Add(go);
                    var renderer = go.AddComponent<SpriteRenderer>();
                    renderer.sprite = binding.sprite;
                    ConfigureRenderer(renderer, binding, sortingOrderBase, sortingLayerName, tint, newTinted);
                    result.Applied.Add(label + " (SocketSprite @ " + binding.socketName + ")");
                    return true;
                }
                case AppearanceMechanism.SocketPrefab:
                {
                    if (binding.prefab == null) { result.Error = label + ": SocketPrefab has no prefab"; return false; }
                    if (!sockets.TryGet(binding.socketName, out var socket))
                    {
                        result.Error = label + ": rig has no socket '" + binding.socketName + "'";
                        return false;
                    }
                    var go = Object.Instantiate(binding.prefab, socket, false);
                    go.name = "Appearance_" + binding.slot;
                    go.transform.localPosition = binding.localOffset;
                    go.transform.localScale = new Vector3(binding.localScale.x, binding.localScale.y, 1f);
                    newObjects.Add(go);
                    foreach (var renderer in go.GetComponentsInChildren<SpriteRenderer>(true))
                    {
                        ConfigureRenderer(renderer, binding, sortingOrderBase, sortingLayerName, tint, newTinted);
                    }
                    result.Applied.Add(label + " (SocketPrefab @ " + binding.socketName + ")");
                    return true;
                }
                case AppearanceMechanism.SpriteLibraryCategory:
                case AppearanceMechanism.SkinnedOverlay:
                    // Reserved for skeletal phases. Reported, not silently dropped.
                    result.Skipped.Add(label + " uses " + binding.mechanism + ", which is not implemented in Phase A");
                    return true;
                default:
                    result.Error = label + ": unknown mechanism " + binding.mechanism;
                    return false;
            }
        }

        static void ConfigureRenderer(
            SpriteRenderer renderer,
            AppearanceSlotBinding binding,
            int sortingOrderBase,
            string sortingLayerName,
            Color tint,
            List<SpriteRenderer> newTinted)
        {
            renderer.sortingOrder = sortingOrderBase + binding.sortingOrder;
            if (!string.IsNullOrEmpty(sortingLayerName)) renderer.sortingLayerName = sortingLayerName;
            if (binding.receivesTint)
            {
                renderer.color = tint;
                newTinted.Add(renderer);
            }
        }

        public void SetTint(Color tint)
        {
            foreach (var renderer in tintedRenderers)
            {
                if (renderer != null) renderer.color = tint;
            }
        }

        /// <summary>Remove everything this composer added.</summary>
        public void Clear()
        {
            foreach (var go in spawned) DestroyObject(go);
            spawned.Clear();
            tintedRenderers.Clear();
            AppliedAppearanceId = null;
        }

        static void DestroyObject(GameObject go)
        {
            if (go == null) return;
            if (Application.isPlaying) Object.Destroy(go);
            else Object.DestroyImmediate(go);
        }
    }
}
