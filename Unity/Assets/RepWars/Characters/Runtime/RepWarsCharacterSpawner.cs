using UnityEngine;

namespace RepWars.Characters
{
    /// <summary>
    /// The one way to create a character. Resolves the variant, base and appearance, instantiates the actor,
    /// builds the backend, dresses the character and hands back only the presenter interface.
    /// </summary>
    public static class RepWarsCharacterSpawner
    {
        const string LogPrefix = "[RepWarsCharacters] ";

        /// <summary>Spawn using the default catalog. Returns null (and logs why) when spawning fails.</summary>
        public static IRepWarsCharacterPresenter Spawn(string variantId, Transform parent)
        {
            return Spawn(variantId, parent, 0);
        }

        public static IRepWarsCharacterPresenter Spawn(string variantId, Transform parent, int sortingOrderBase)
        {
            if (TrySpawn(variantId, parent, out var presenter, out var error, null, sortingOrderBase, null)) return presenter;
            Debug.LogError(LogPrefix + "Spawn('" + variantId + "') failed: " + error);
            return null;
        }

        public static bool TrySpawn(
            string variantId,
            Transform parent,
            out IRepWarsCharacterPresenter presenter,
            out string error,
            RepWarsCharacterCatalog catalog = null,
            int sortingOrderBase = 0,
            string sortingLayerName = null)
        {
            presenter = null;
            catalog = catalog ?? RepWarsCharacterCatalog.Default;

            if (!catalog.TryResolveVariant(variantId, out var resolved, out error)) return false;

            var actor = InstantiateActor(catalog, resolved);
            actor.gameObject.name = "Character_" + variantId;
            actor.transform.SetParent(parent, false);

            if (!actor.Initialize(catalog, resolved, sortingOrderBase, sortingLayerName, out error))
            {
                DestroyActor(actor);
                return false;
            }

            presenter = actor;
            return true;
        }

        static RepWarsCharacterActor InstantiateActor(RepWarsCharacterCatalog catalog, ResolvedCharacterVariant resolved)
        {
            var prefab = resolved.Base.actorPrefab;
            if (prefab == null && catalog.Registry != null) prefab = catalog.Registry.defaultActorPrefab;
            if (prefab != null) return Object.Instantiate(prefab);
            return new GameObject("Character").AddComponent<RepWarsCharacterActor>();
        }

        static void DestroyActor(RepWarsCharacterActor actor)
        {
            if (actor == null) return;
            if (Application.isPlaying) Object.Destroy(actor.gameObject);
            else Object.DestroyImmediate(actor.gameObject);
        }
    }
}
