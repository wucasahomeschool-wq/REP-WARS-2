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
        public int fortification;
        public int garrison;
        public bool farm;
        public bool mine;
        public bool lumber;
        public PublicResources resourceOutput;
    }

    [Serializable]
    public class PublicResources
    {
        public int gold;
        public int food;
        public int iron;
        public int wood;
        public int stone;
    }

    [Serializable]
    public class PublicFaction
    {
        public string id;
        public string name;
    }

    [Serializable]
    public class PublicCity
    {
        public string id;
        public string territoryId;
    }

    [Serializable]
    public class PublicConstruction
    {
        public string id;
        public string territoryId;
        public string projectType;
        public int remainingTicks;
        public string status;
    }

    [Serializable]
    public class PublicProgression
    {
        public string currentBandId;
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

    [Serializable]
    public class PublicPrescription
    {
        public string kind;
        public int repetitions;
        public int durationSeconds;
    }

    [Serializable]
    public class PublicExerciseStep
    {
        public string exerciseId;
        public int order;
        public string exerciseType;
        public bool isRest;
        public bool skippable;
        public PublicPrescription prescription;
    }

    [Serializable]
    public class PublicActiveWorkout
    {
        public string sessionId;
        public string workoutId;
        public string purpose;
        public string state;
        public string feedbackState;
        public PublicExerciseStep currentExercise;
        public PublicExerciseStep[] prescribedExercises;
    }

    [Serializable]
    public class PublicTutorial
    {
        public bool active;
        public string beat;
        public string expectedAction;
        public string expectedPurpose;
        public string expectedWorkoutId;
        public bool nextActionAllowed;
        public string scriptedInvasionId;
        public string[] firstAttackTerritoryIds;
        public string[] finalAttackTerritoryIds;
    }

    [Serializable]
    public class PublicInvasion
    {
        public string invasionId;
        public string status;
        public string territoryId;
        public string attackerFactionId;
        public int remainingResponseTicks;
        public bool defenseInProgress;
    }

    [Serializable]
    public class PublicGameplay
    {
        public int bankedTroops;
        public PublicResources resources;
        public int fitnessLevel;
        public bool fitnessKnown;
        public PublicProgression progression;
        public PublicCity[] cities;
        public PublicConstruction[] constructions;
        public PublicActiveWorkout activeWorkout;
        public PublicTutorial tutorial;
        public PublicInvasion[] activeInvasionsAgainstPlayer;
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
        public PublicFaction[] factions;
        public PublicTutorial tutorial;
        public PublicGameplay playerGameplay;

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

        public static void NoteFitness(string json, PublicGameState state)
        {
            if (state == null || state.playerGameplay == null || string.IsNullOrEmpty(json)) return;
            var gameplay = ObjectSlice(json, "playerGameplay");
            state.playerGameplay.fitnessKnown = gameplay.IndexOf("\"fitnessLevel\":null", StringComparison.Ordinal) < 0
                && gameplay.IndexOf("\"fitnessLevel\":", StringComparison.Ordinal) >= 0;
        }

        /// <summary>
        /// JsonUtility replaces a JSON null object with an empty instance.
        /// A finished exercise and a cleared session must stay absent.
        /// </summary>
        public static void NormalizeWorkout(PublicGameState state)
        {
            if (state == null || state.playerGameplay == null) return;
            var workout = state.playerGameplay.activeWorkout;
            if (workout == null) return;
            if (string.IsNullOrEmpty(workout.sessionId))
            {
                state.playerGameplay.activeWorkout = null;
                return;
            }
            var step = workout.currentExercise;
            if (step != null && string.IsNullOrEmpty(step.exerciseId)) workout.currentExercise = null;
        }

        static string ObjectSlice(string json, string key)
        {
            var token = "\"" + key + "\":";
            var index = json.IndexOf(token, StringComparison.Ordinal);
            if (index < 0) return "";
            index += token.Length;
            while (index < json.Length && char.IsWhiteSpace(json[index])) index++;
            if (index >= json.Length || json[index] != '{') return "";
            var depth = 0;
            var start = index;
            for (var i = index; i < json.Length; i++)
            {
                if (json[i] == '"')
                {
                    i++;
                    while (i < json.Length && json[i] != '"')
                    {
                        if (json[i] == '\\') i++;
                        i++;
                    }
                    continue;
                }
                if (json[i] == '{') depth++;
                else if (json[i] == '}')
                {
                    depth--;
                    if (depth == 0) return json.Substring(start, i - start + 1);
                }
            }
            return "";
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
