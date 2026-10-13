using System;
using System.Collections.Generic;
using UnityEngine;

namespace RepWars
{
    /// <summary>
    /// One authored world the map can draw: geometry, props, and the current terrain fill.
    /// Ownership, troops, and selection are not stored here.
    /// </summary>
    public sealed class RepWarsWorldPresentationDefinition
    {
        public RepWarsWorldPresentationDefinition(string worldId, AuthoredWorld world, RepWarsPropCatalog catalog, Sprite terrainFill)
        {
            WorldId = worldId;
            World = world;
            Catalog = catalog;
            TerrainFill = terrainFill;
        }

        public string WorldId { get; }
        public AuthoredWorld World { get; }
        public RepWarsPropCatalog Catalog { get; }
        public Sprite TerrainFill { get; }
    }

    public class RepWarsWorldPresentationException : Exception
    {
        public RepWarsWorldPresentationException(string message) : base(message) { }
    }

    /// <summary>
    /// Checks an authored presentation before it is drawn.
    /// Snapshot mismatches are reported by <see cref="RepWarsWorldPresentations.WarnOnSnapshotGaps"/> and do not reject the world.
    /// </summary>
    public static class RepWarsWorldPresentationValidation
    {
        public static void RequireDrawable(AuthoredWorld world)
        {
            if (world == null) throw new RepWarsWorldPresentationException("The authored world is missing.");
            var problems = new List<string>();
            if (string.IsNullOrEmpty(world.worldId)) problems.Add("The authored world has no worldId.");

            var territoryIds = new HashSet<string>();
            var drawable = 0;
            foreach (var territory in world.territories)
            {
                if (territory == null || string.IsNullOrEmpty(territory.id))
                {
                    problems.Add("An authored territory has no id.");
                    continue;
                }
                if (!territoryIds.Add(territory.id)) problems.Add("Duplicate territory id '" + territory.id + "'.");
                if (territory.ring != null && territory.ring.Count >= 3) drawable++;
            }
            if (drawable == 0) problems.Add("The authored world has no drawable territories.");

            var regionIds = new HashSet<string>();
            foreach (var region in world.regions)
            {
                if (region == null || string.IsNullOrEmpty(region.id))
                {
                    problems.Add("An authored region has no id.");
                    continue;
                }
                if (!regionIds.Add(region.id)) problems.Add("Duplicate region id '" + region.id + "'.");
            }
            foreach (var territory in world.territories)
            {
                if (territory == null || string.IsNullOrEmpty(territory.regionId)) continue;
                if (!regionIds.Contains(territory.regionId))
                    problems.Add("Territory '" + territory.id + "' references missing region '" + territory.regionId + "'.");
            }

            if (problems.Count > 0) throw new RepWarsWorldPresentationException(string.Join("\n", problems));
        }
    }

    /// <summary>
    /// Selects the Unity presentation bundle for a backend <c>definitionWorldId</c>.
    /// Bundles are prop catalogs under Resources. The world id is read from each catalog's authored JSON.
    /// An empty id uses the only registered bundle. An unknown id fails. Territory contents are never used to guess.
    /// </summary>
    public static class RepWarsWorldPresentations
    {
        static Dictionary<string, RepWarsWorldPresentationDefinition> byId;

        public static ICollection<string> RegisteredWorldIds
        {
            get { return Index().Keys; }
        }

        public static RepWarsWorldPresentationDefinition Resolve(string definitionWorldId)
        {
            var index = Index();
            if (string.IsNullOrEmpty(definitionWorldId))
            {
                if (index.Count == 1)
                {
                    foreach (var only in index.Values) return only;
                }
                if (index.Count == 0)
                    throw new RepWarsWorldPresentationException("No authored world presentation is registered.");
                throw new RepWarsWorldPresentationException(
                    "The snapshot has no definitionWorldId, and more than one presentation is registered.");
            }
            if (!index.TryGetValue(definitionWorldId, out var found))
                throw new RepWarsWorldPresentationException(
                    "No presentation definition is registered for world '" + definitionWorldId + "'.");
            return found;
        }

        /// <summary>A definition that is not registered, used by tests and by the resource index.</summary>
        public static RepWarsWorldPresentationDefinition Define(AuthoredWorld world, RepWarsPropCatalog catalog, Sprite terrainFill)
        {
            RepWarsWorldPresentationValidation.RequireDrawable(world);
            return new RepWarsWorldPresentationDefinition(world.worldId, world, catalog, terrainFill);
        }

        public static void WarnOnSnapshotGaps(AuthoredWorld world, PublicGameState state)
        {
            if (world == null || state == null || state.territories == null) return;
            var authored = new HashSet<string>();
            foreach (var territory in world.territories)
            {
                if (territory != null && !string.IsNullOrEmpty(territory.id)) authored.Add(territory.id);
            }
            var canonical = new HashSet<string>();
            foreach (var territory in state.territories)
            {
                if (territory != null && !string.IsNullOrEmpty(territory.id)) canonical.Add(territory.id);
            }
            foreach (var id in canonical)
            {
                if (!authored.Contains(id))
                    Debug.LogWarning("[RepWars] snapshot territory " + id + " has no authored presentation.");
            }
            foreach (var id in authored)
            {
                if (!canonical.Contains(id))
                    Debug.LogWarning("[RepWars] authored territory " + id + " has no snapshot territory.");
            }
        }

        static Dictionary<string, RepWarsWorldPresentationDefinition> Index()
        {
            if (byId != null) return byId;
            var index = new Dictionary<string, RepWarsWorldPresentationDefinition>();
            var catalogs = Resources.LoadAll<RepWarsPropCatalog>("");
            foreach (var catalog in catalogs)
            {
                if (catalog == null) continue;
                if (catalog.authoredWorld == null)
                    throw new RepWarsWorldPresentationException(
                        "Presentation catalog '" + catalog.name + "' has no authored world.");
                AuthoredWorld world;
                try
                {
                    world = WorldDefinitionReader.Read(catalog.authoredWorld.text);
                }
                catch (Exception ex)
                {
                    throw new RepWarsWorldPresentationException(
                        "Authored world '" + catalog.name + "' could not be read: " + ex.Message);
                }
                var definition = Define(world, catalog, catalog.terrainFill);
                if (index.ContainsKey(definition.WorldId))
                    throw new RepWarsWorldPresentationException(
                        "More than one presentation is registered for world '" + definition.WorldId + "'.");
                index.Add(definition.WorldId, definition);
            }
            byId = index;
            return byId;
        }
    }
}
