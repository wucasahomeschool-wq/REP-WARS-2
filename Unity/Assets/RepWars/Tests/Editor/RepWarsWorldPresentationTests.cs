using NUnit.Framework;
using UnityEngine;

namespace RepWars.Tests
{
    public class RepWarsWorldPresentationTests
    {
        [Test]
        public void Level1ResolvesFromItsAuthoredWorldId()
        {
            var named = RepWarsWorldPresentations.Resolve("Level 1");
            var omitted = RepWarsWorldPresentations.Resolve(null);
            var blank = RepWarsWorldPresentations.Resolve("");

            Assert.AreEqual("Level 1", named.WorldId);
            Assert.AreSame(named, omitted);
            Assert.AreSame(named, blank);
            Assert.GreaterOrEqual(named.World.territories.Count, 3);
            Assert.IsNotNull(named.Catalog);
            Assert.IsNotNull(named.TerrainFill);
            Assert.IsFalse(RepWarsWorldPresentations.RegisteredWorldIds.Contains("Level 2"));
        }

        [Test]
        public void UnknownWorldIdFailsClosed()
        {
            var error = Assert.Throws<RepWarsWorldPresentationException>(() => RepWarsWorldPresentations.Resolve("Level 2"));
            StringAssert.Contains("Level 2", error.Message);
            Assert.IsNotNull(RepWarsWorldPresentations.Resolve("Level 1"));
        }

        [Test]
        public void DuplicateTerritoryIdIsRejected()
        {
            var world = TriangleWorld("test-duplicate");
            world.territories.Add(world.territories[0]);
            var error = Assert.Throws<RepWarsWorldPresentationException>(() => RepWarsWorldPresentations.Define(world, null, null));
            StringAssert.Contains("Duplicate territory id", error.Message);
        }

        [Test]
        public void MissingRegionReferenceIsRejected()
        {
            var world = TriangleWorld("test-region");
            world.territories[0].regionId = "missing";
            var error = Assert.Throws<RepWarsWorldPresentationException>(() => RepWarsWorldPresentations.Define(world, null, null));
            StringAssert.Contains("missing", error.Message);
        }

        [Test]
        public void AWorldWithNoIdOrNoDrawableTerritoryIsRejected()
        {
            var nameless = TriangleWorld("");
            Assert.Throws<RepWarsWorldPresentationException>(() => RepWarsWorldPresentations.Define(nameless, null, null));

            var flat = TriangleWorld("test-flat");
            flat.territories[0].ring.RemoveAt(2);
            flat.territories[1].ring.Clear();
            var error = Assert.Throws<RepWarsWorldPresentationException>(() => RepWarsWorldPresentations.Define(flat, null, null));
            StringAssert.Contains("no drawable territories", error.Message);
        }

        [Test]
        public void AnUnregisteredDefinitionDoesNotBecomeResolvable()
        {
            var synthetic = RepWarsWorldPresentations.Define(TriangleWorld("test-only-world"), null, null);
            Assert.AreEqual("test-only-world", synthetic.WorldId);
            Assert.Throws<RepWarsWorldPresentationException>(() => RepWarsWorldPresentations.Resolve("test-only-world"));
        }

        static AuthoredWorld TriangleWorld(string worldId)
        {
            var world = new AuthoredWorld { worldId = worldId, name = worldId, level = 0 };
            world.regions.Add(new AuthoredRegion { id = "r", name = "Region" });
            world.territories.Add(Territory("a", "r"));
            world.territories.Add(Territory("b", "r"));
            return world;
        }

        static AuthoredTerritory Territory(string id, string regionId)
        {
            return new AuthoredTerritory
            {
                id = id,
                regionId = regionId,
                terrain = "plains",
                ring = new System.Collections.Generic.List<Vector2>
                {
                    new Vector2(0f, 0f),
                    new Vector2(3f, 0f),
                    new Vector2(0f, 3f),
                },
            };
        }
    }
}
