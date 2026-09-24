using System;

namespace RepWars
{
    /// <summary>
    /// Player-facing territory from public gameState.territories.
    /// The wire value is a map keyed by territory id; the client stores the values.
    /// </summary>
    [Serializable]
    public class PublicTerritory
    {
        public string id;
        public string regionId;
        public string regionName;
        public string owner;
        public string terrain;
    }

    /// <summary>
    /// Player-facing army from public gameState.armies.
    /// </summary>
    [Serializable]
    public class PublicArmy
    {
        public string id;
        public string owner;
        public string location;
        public int troops;
    }

    /// <summary>
    /// Fields this client currently reads from serializePublicGameState.
    /// Extra snapshot fields stay in the raw JSON and are not copied here.
    /// </summary>
    [Serializable]
    public class PublicGameState
    {
        public string worldName;
        public int worldLevel;
        public int turn;
        public string playerFactionId;
        public PublicTerritory[] territories;
        public PublicArmy[] armies;

        public int TerritoryCount
        {
            get { return territories == null ? 0 : territories.Length; }
        }

        public int ArmyCount
        {
            get { return armies == null ? 0 : armies.Length; }
        }
    }

    /// <summary>
    /// JsonUtility cannot read a JSON object used as a map. Territories are rewritten
    /// into an array of their values before FromJson. Army entries are already an array.
    /// </summary>
    public static class PublicGameStateJson
    {
        public static string AdaptTerritoriesForJsonUtility(string json)
        {
            if (string.IsNullOrEmpty(json)) return json;

            const string key = "\"territories\":";
            var index = json.IndexOf(key, StringComparison.Ordinal);
            if (index < 0) return json;

            var start = index + key.Length;
            SkipWs(json, ref start);
            if (start >= json.Length || json[start] != '{') return json;

            var end = start;
            SkipValue(json, ref end);
            var array = ObjectMapToValueArray(json.Substring(start, end - start));
            return json.Substring(0, start) + array + json.Substring(end);
        }

        static string ObjectMapToValueArray(string objectJson)
        {
            var values = new System.Text.StringBuilder();
            values.Append('[');
            var i = 1;
            var first = true;
            while (i < objectJson.Length)
            {
                SkipWs(objectJson, ref i);
                if (i >= objectJson.Length || objectJson[i] == '}') break;
                if (objectJson[i] == ',')
                {
                    i++;
                    continue;
                }

                SkipString(objectJson, ref i);
                SkipWs(objectJson, ref i);
                if (i >= objectJson.Length || objectJson[i] != ':')
                {
                    throw new FormatException("Territory map is missing a value");
                }
                i++;
                SkipWs(objectJson, ref i);
                var valueStart = i;
                SkipValue(objectJson, ref i);
                if (!first) values.Append(',');
                first = false;
                values.Append(objectJson, valueStart, i - valueStart);
            }
            values.Append(']');
            return values.ToString();
        }

        static void SkipWs(string json, ref int i)
        {
            while (i < json.Length && char.IsWhiteSpace(json[i])) i++;
        }

        static void SkipString(string json, ref int i)
        {
            if (i >= json.Length || json[i] != '"')
            {
                throw new FormatException("Expected a JSON string");
            }
            i++;
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
            throw new FormatException("Unterminated JSON string");
        }

        static void SkipValue(string json, ref int i)
        {
            if (i >= json.Length) throw new FormatException("Missing JSON value");
            var c = json[i];
            if (c == '"')
            {
                SkipString(json, ref i);
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
                        SkipString(json, ref i);
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
                throw new FormatException("Unterminated JSON value");
            }

            while (i < json.Length)
            {
                var n = json[i];
                if (n == ',' || n == '}' || n == ']' || char.IsWhiteSpace(n)) return;
                i++;
            }
        }
    }
}
