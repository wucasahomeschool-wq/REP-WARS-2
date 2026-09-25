using System;
using System.Collections.Generic;
using UnityEngine;

namespace RepWars
{
    public class AuthoredRegion
    {
        public string id;
        public string name;
    }

    public class AuthoredTerritory
    {
        public string id;
        public string regionId;
        public string terrain;
        public List<Vector2> ring = new List<Vector2>();
    }

    public class AuthoredProp
    {
        public string instanceId;
        public string assetId;
        public string territoryId;
        public Vector2 position;
        public float rotationDegrees;
        public float scale;
        public bool hasScale;
        public string anchor;
        public float depth;
    }

    public class AuthoredLocation
    {
        public string territoryId;
        public string name;
        public string visualAssetId;
        public Vector2 position;
        public bool hasPosition;
    }

    public class AuthoredWorld
    {
        public string worldId;
        public string name;
        public int level;
        public string playerFactionId;
        public readonly List<string> factionIds = new List<string>();
        public readonly List<AuthoredRegion> regions = new List<AuthoredRegion>();
        public readonly List<AuthoredTerritory> territories = new List<AuthoredTerritory>();
        public readonly List<AuthoredProp> props = new List<AuthoredProp>();
        public readonly List<AuthoredLocation> locations = new List<AuthoredLocation>();
    }

    /// <summary>
    /// Reads the geometry the map needs from a GET_WORLD_DEFINITION body.
    /// Polygons stay on the world definition; ownership comes from the live snapshot.
    /// </summary>
    public static class WorldDefinitionReader
    {
        public static AuthoredWorld Read(string json)
        {
            var world = new AuthoredWorld();
            if (string.IsNullOrEmpty(json)) return world;
            var cursor = new JsonCursor(json);
            ReadObject(cursor, world, null);
            return world;
        }

        static void ReadObject(JsonCursor cursor, AuthoredWorld world, AuthoredTerritory territory)
        {
            cursor.Expect('{');
            if (cursor.Peek() == '}')
            {
                cursor.Next();
                return;
            }
            while (true)
            {
                var key = cursor.ReadString();
                cursor.Expect(':');
                ReadValue(cursor, world, territory, key);
                if (cursor.Peek() == ',')
                {
                    cursor.Next();
                    continue;
                }
                cursor.Expect('}');
                return;
            }
        }

        static void ReadValue(JsonCursor cursor, AuthoredWorld world, AuthoredTerritory territory, string key)
        {
            var c = cursor.Peek();
            if (c == '{')
            {
                if (key == "polygon")
                {
                    ReadPolygon(cursor, territory);
                    return;
                }
                if (key == "composition")
                {
                    ReadComposition(cursor, world);
                    return;
                }
                ReadObject(cursor, world, territory);
                return;
            }
            if (c == '[')
            {
                if (key == "regions") ReadRegions(cursor, world);
                else if (key == "factions") ReadFactions(cursor, world);
                else if (key == "territories" && cursor.LooksLikeArray()) ReadTerritories(cursor, world);
                else if (key == "locations") ReadLocations(cursor, world);
                else if (key == "rings" && territory != null) ReadRings(cursor, territory);
                else cursor.SkipValue();
                return;
            }
            if (c == '"')
            {
                var text = cursor.ReadString();
                if (territory != null)
                {
                    if (key == "id") territory.id = text;
                    else if (key == "regionId") territory.regionId = text;
                    else if (key == "terrain") territory.terrain = text;
                }
                else if (key == "worldId") world.worldId = text;
                else if (key == "name" && string.IsNullOrEmpty(world.name)) world.name = text;
                else if (key == "playerFactionId") world.playerFactionId = text;
                return;
            }
            if (key == "level" && territory == null)
            {
                world.level = (int)cursor.ReadNumber();
                return;
            }
            cursor.SkipValue();
        }

        static void ReadRegions(JsonCursor cursor, AuthoredWorld world)
        {
            cursor.Expect('[');
            if (cursor.Peek() == ']')
            {
                cursor.Next();
                return;
            }
            while (true)
            {
                var region = new AuthoredRegion();
                cursor.Expect('{');
                while (true)
                {
                    var key = cursor.ReadString();
                    cursor.Expect(':');
                    if (key == "id") region.id = cursor.ReadString();
                    else if (key == "name") region.name = cursor.ReadString();
                    else cursor.SkipValue();
                    if (cursor.Peek() == ',')
                    {
                        cursor.Next();
                        continue;
                    }
                    cursor.Expect('}');
                    break;
                }
                world.regions.Add(region);
                if (cursor.Peek() == ',')
                {
                    cursor.Next();
                    continue;
                }
                cursor.Expect(']');
                return;
            }
        }

        static void ReadFactions(JsonCursor cursor, AuthoredWorld world)
        {
            cursor.Expect('[');
            if (cursor.Peek() == ']')
            {
                cursor.Next();
                return;
            }
            while (true)
            {
                string id = null;
                cursor.Expect('{');
                while (true)
                {
                    var key = cursor.ReadString();
                    cursor.Expect(':');
                    if (key == "id") id = cursor.ReadString();
                    else cursor.SkipValue();
                    if (cursor.Peek() == ',')
                    {
                        cursor.Next();
                        continue;
                    }
                    cursor.Expect('}');
                    break;
                }
                if (!string.IsNullOrEmpty(id)) world.factionIds.Add(id);
                if (cursor.Peek() == ',')
                {
                    cursor.Next();
                    continue;
                }
                cursor.Expect(']');
                return;
            }
        }

        static void ReadTerritories(JsonCursor cursor, AuthoredWorld world)
        {
            cursor.Expect('[');
            if (cursor.Peek() == ']')
            {
                cursor.Next();
                return;
            }
            while (true)
            {
                var territory = new AuthoredTerritory();
                ReadObject(cursor, world, territory);
                world.territories.Add(territory);
                if (cursor.Peek() == ',')
                {
                    cursor.Next();
                    continue;
                }
                cursor.Expect(']');
                return;
            }
        }

        static void ReadPolygon(JsonCursor cursor, AuthoredTerritory territory)
        {
            cursor.Expect('{');
            if (cursor.Peek() == '}')
            {
                cursor.Next();
                return;
            }
            while (true)
            {
                var key = cursor.ReadString();
                cursor.Expect(':');
                if (key == "rings" && territory != null) ReadRings(cursor, territory);
                else cursor.SkipValue();
                if (cursor.Peek() == ',')
                {
                    cursor.Next();
                    continue;
                }
                cursor.Expect('}');
                return;
            }
        }

        static void ReadRings(JsonCursor cursor, AuthoredTerritory territory)
        {
            cursor.Expect('[');
            if (cursor.Peek() == ']')
            {
                cursor.Next();
                return;
            }
            var first = true;
            while (true)
            {
                if (first) ReadRing(cursor, territory);
                else cursor.SkipValue();
                first = false;
                if (cursor.Peek() == ',')
                {
                    cursor.Next();
                    continue;
                }
                cursor.Expect(']');
                return;
            }
        }

        static void ReadRing(JsonCursor cursor, AuthoredTerritory territory)
        {
            cursor.Expect('[');
            if (cursor.Peek() == ']')
            {
                cursor.Next();
                return;
            }
            while (true)
            {
                cursor.Expect('{');
                float x = 0f;
                float y = 0f;
                while (true)
                {
                    var key = cursor.ReadString();
                    cursor.Expect(':');
                    var number = cursor.ReadNumber();
                    if (key == "x") x = number;
                    else if (key == "y") y = number;
                    if (cursor.Peek() == ',')
                    {
                        cursor.Next();
                        continue;
                    }
                    cursor.Expect('}');
                    break;
                }
                territory.ring.Add(new Vector2(x, y));
                if (cursor.Peek() == ',')
                {
                    cursor.Next();
                    continue;
                }
                cursor.Expect(']');
                return;
            }
        }

        static void ReadComposition(JsonCursor cursor, AuthoredWorld world)
        {
            cursor.Expect('{');
            if (cursor.Peek() == '}')
            {
                cursor.Next();
                return;
            }
            while (true)
            {
                var key = cursor.ReadString();
                cursor.Expect(':');
                if (key == "instances" && cursor.Peek() == '[') ReadPropArray(cursor, world);
                else cursor.SkipValue();
                if (cursor.Peek() == ',')
                {
                    cursor.Next();
                    continue;
                }
                cursor.Expect('}');
                return;
            }
        }

        static void ReadPropArray(JsonCursor cursor, AuthoredWorld world)
        {
            cursor.Expect('[');
            if (cursor.Peek() == ']')
            {
                cursor.Next();
                return;
            }
            while (true)
            {
                if (cursor.Peek() == '{') world.props.Add(ReadProp(cursor));
                else cursor.SkipValue();
                if (cursor.Peek() == ',')
                {
                    cursor.Next();
                    continue;
                }
                cursor.Expect(']');
                return;
            }
        }

        static AuthoredProp ReadProp(JsonCursor cursor)
        {
            var prop = new AuthoredProp();
            cursor.Expect('{');
            if (cursor.Peek() == '}')
            {
                cursor.Next();
                return prop;
            }
            while (true)
            {
                var key = cursor.ReadString();
                cursor.Expect(':');
                if (key == "instanceId" && cursor.Peek() == '"') prop.instanceId = cursor.ReadString();
                else if (key == "assetId" && cursor.Peek() == '"') prop.assetId = cursor.ReadString();
                else if (key == "territoryId" && cursor.Peek() == '"') prop.territoryId = cursor.ReadString();
                else if (key == "rotationDegrees" && cursor.Peek() != 'n') prop.rotationDegrees = cursor.ReadNumber();
                else if (key == "scale" && cursor.Peek() != 'n')
                {
                    prop.scale = cursor.ReadNumber();
                    prop.hasScale = true;
                }
                else if (key == "anchor" && cursor.Peek() == '"') prop.anchor = cursor.ReadString();
                else if (key == "depth" && cursor.Peek() != 'n') prop.depth = cursor.ReadNumber();
                else if (key == "position" && cursor.Peek() == '{') prop.position = ReadPoint(cursor);
                else cursor.SkipValue();
                if (cursor.Peek() == ',')
                {
                    cursor.Next();
                    continue;
                }
                cursor.Expect('}');
                return prop;
            }
        }

        static void ReadLocations(JsonCursor cursor, AuthoredWorld world)
        {
            cursor.Expect('[');
            if (cursor.Peek() == ']')
            {
                cursor.Next();
                return;
            }
            while (true)
            {
                if (cursor.Peek() == '{') world.locations.Add(ReadLocation(cursor));
                else cursor.SkipValue();
                if (cursor.Peek() == ',')
                {
                    cursor.Next();
                    continue;
                }
                cursor.Expect(']');
                return;
            }
        }

        static AuthoredLocation ReadLocation(JsonCursor cursor)
        {
            var location = new AuthoredLocation();
            cursor.Expect('{');
            if (cursor.Peek() == '}')
            {
                cursor.Next();
                return location;
            }
            while (true)
            {
                var key = cursor.ReadString();
                cursor.Expect(':');
                if (key == "territoryId" && cursor.Peek() == '"') location.territoryId = cursor.ReadString();
                else if (key == "name" && cursor.Peek() == '"') location.name = cursor.ReadString();
                else if (key == "visualAssetId" && cursor.Peek() == '"') location.visualAssetId = cursor.ReadString();
                else if (key == "position" && cursor.Peek() == '{')
                {
                    location.position = ReadPoint(cursor);
                    location.hasPosition = true;
                }
                else cursor.SkipValue();
                if (cursor.Peek() == ',')
                {
                    cursor.Next();
                    continue;
                }
                cursor.Expect('}');
                return location;
            }
        }

        static Vector2 ReadPoint(JsonCursor cursor)
        {
            float x = 0f;
            float y = 0f;
            cursor.Expect('{');
            if (cursor.Peek() == '}')
            {
                cursor.Next();
                return Vector2.zero;
            }
            while (true)
            {
                var key = cursor.ReadString();
                cursor.Expect(':');
                var number = cursor.ReadNumber();
                if (key == "x") x = number;
                else if (key == "y") y = number;
                if (cursor.Peek() == ',')
                {
                    cursor.Next();
                    continue;
                }
                cursor.Expect('}');
                return new Vector2(x, y);
            }
        }

        sealed class JsonCursor
        {
            readonly string json;
            int i;

            public JsonCursor(string json)
            {
                this.json = json;
            }

            public char Peek()
            {
                SkipWs();
                return i < json.Length ? json[i] : '\0';
            }

            public void Next()
            {
                SkipWs();
                if (i < json.Length) i++;
            }

            public void Expect(char c)
            {
                if (Peek() != c) throw new FormatException("Expected '" + c + "' in world definition");
                i++;
            }

            public bool LooksLikeArray()
            {
                return Peek() == '[';
            }

            public string ReadString()
            {
                Expect('"');
                var start = i;
                while (i < json.Length)
                {
                    if (json[i] == '\\')
                    {
                        i += 2;
                        continue;
                    }
                    if (json[i] == '"')
                    {
                        var text = json.Substring(start, i - start);
                        i++;
                        return text;
                    }
                    i++;
                }
                throw new FormatException("Unterminated string in world definition");
            }

            public float ReadNumber()
            {
                SkipWs();
                var start = i;
                if (i < json.Length && (json[i] == '-' || json[i] == '+')) i++;
                while (i < json.Length && ("0123456789.eE+-".IndexOf(json[i]) >= 0)) i++;
                return float.Parse(json.Substring(start, i - start), System.Globalization.CultureInfo.InvariantCulture);
            }

            public void SkipValue()
            {
                var c = Peek();
                if (c == '"')
                {
                    ReadString();
                    return;
                }
                if (c == '{' || c == '[')
                {
                    var open = c;
                    var close = c == '{' ? '}' : ']';
                    var depth = 0;
                    while (i < json.Length)
                    {
                        if (json[i] == '"')
                        {
                            i++;
                            ReadStringBody();
                            continue;
                        }
                        if (json[i] == open) depth++;
                        else if (json[i] == close)
                        {
                            depth--;
                            i++;
                            if (depth == 0) return;
                            continue;
                        }
                        i++;
                    }
                    throw new FormatException("Unterminated value in world definition");
                }
                while (i < json.Length)
                {
                    var n = json[i];
                    if (n == ',' || n == '}' || n == ']' || char.IsWhiteSpace(n)) return;
                    i++;
                }
            }

            void ReadStringBody()
            {
                while (i < json.Length)
                {
                    if (json[i] == '\\')
                    {
                        i += 2;
                        continue;
                    }
                    if (json[i] == '"')
                    {
                        i++;
                        return;
                    }
                    i++;
                }
            }

            void SkipWs()
            {
                while (i < json.Length && char.IsWhiteSpace(json[i])) i++;
            }
        }
    }
}
