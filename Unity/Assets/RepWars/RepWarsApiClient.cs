using System;
using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

namespace RepWars
{
    [Serializable]
    public class RepWarsCommandRequest
    {
        public string commandId;
        public string playerId;
        public string requestId;
    }

    [Serializable]
    public class RepWarsCommandError
    {
        public string code;
        public string message;
    }

    [Serializable]
    public class RepWarsCommandPayload
    {
        public PublicGameState gameState;
    }

    [Serializable]
    public class RepWarsCommandResponse
    {
        public bool success;
        public bool idempotentReplay;
        public string commandId;
        public string requestId;
        public string playerId;
        public RepWarsCommandError[] errors;
        public RepWarsCommandPayload payload;
    }

    public class RepWarsCommandResult
    {
        public bool TransportOk;
        public bool IdempotentReplay;
        public long HttpStatus;
        public string RawJson;
        public string Failure;
        public string ServerCode;
        public RepWarsCommandResponse Response;
    }

    public class RepWarsSessionResult
    {
        public bool TransportOk;
        public bool Retryable;
        public long HttpStatus;
        public string RawJson;
        public string Failure;
        public string Outcome;
        public string SessionId;
        public long ExpiresAtMs;
    }

    /// <summary>
    /// Posts CommandRequest JSON to the Rep Wars HTTP bridge.
    /// GET_GAME_STATE is deserialized into PublicGameState. Unused snapshot fields stay in RawJson.
    /// </summary>
    public class RepWarsApiClient
    {
        public const string DefaultBaseUrl = "http://127.0.0.1:8787";

        public string BaseUrl { get; }

        public RepWarsApiClient(string baseUrl = DefaultBaseUrl)
        {
            BaseUrl = string.IsNullOrWhiteSpace(baseUrl) ? DefaultBaseUrl : baseUrl.TrimEnd('/');
        }

        public IEnumerator GetGameState(string playerId, Action<RepWarsCommandResult> onComplete)
        {
            yield return PostCommand("GET_GAME_STATE", playerId, "unity-get-game-state", onComplete);
        }

        public IEnumerator GetWorldDefinition(string playerId, Action<RepWarsCommandResult> onComplete)
        {
            yield return PostCommand("GET_WORLD_DEFINITION", playerId, "unity-get-world-definition", onComplete, false);
        }

        public IEnumerator GetVisibleWorld(string playerId, Action<VisibleWorldResult> onComplete)
        {
            RepWarsCommandResult raw = null;
            yield return PostCommand("GET_VISIBLE_WORLD", playerId, "unity-get-visible-world", result => raw = result, false);
            var parsed = new VisibleWorldResult();
            if (raw == null)
            {
                parsed.Failure = "GET_VISIBLE_WORLD returned no result";
                onComplete?.Invoke(parsed);
                yield break;
            }
            parsed.TransportOk = raw.TransportOk;
            parsed.Failure = raw.Failure;
            parsed.RawJson = raw.RawJson;
            if (!raw.TransportOk)
            {
                onComplete?.Invoke(parsed);
                yield break;
            }
            try
            {
                var adapted = PublicGameStateJson.AdaptTerritoriesForJsonUtility(raw.RawJson);
                var response = JsonUtility.FromJson<VisibleWorldResponse>(adapted);
                parsed.World = response != null && response.payload != null ? response.payload.visibleWorld : null;
            }
            catch (Exception ex)
            {
                parsed.TransportOk = false;
                parsed.Failure = "Malformed visible world: " + ex.Message;
            }
            if (parsed.TransportOk && parsed.World == null)
            {
                parsed.TransportOk = false;
                parsed.Failure = "Visible world payload was missing";
            }
            onComplete?.Invoke(parsed);
        }

        public IEnumerator PostCommand(string commandId, string playerId, string requestId, Action<RepWarsCommandResult> onComplete)
        {
            yield return PostCommand(commandId, playerId, requestId, onComplete, true);
        }

        public IEnumerator PostCommand(string commandId, string playerId, string requestId, string parametersJson, Action<RepWarsCommandResult> onComplete)
        {
            yield return PostCommand(commandId, playerId, requestId, onComplete, true, parametersJson);
        }

        public IEnumerator PostCommand(string commandId, string playerId, string requestId, Action<RepWarsCommandResult> onComplete, bool parseGameState)
        {
            yield return PostCommand(commandId, playerId, requestId, onComplete, parseGameState, null);
        }

        public IEnumerator PostCommand(string commandId, string playerId, string requestId, Action<RepWarsCommandResult> onComplete, bool parseGameState, string parametersJson)
        {
            yield return PostCommandBody(
                CommandJson(commandId, playerId, requestId, parametersJson, null, 0, 0),
                onComplete,
                parseGameState);
        }

        public IEnumerator PostBoundCommand(string playerId, RepWarsMutation mutation, Action<RepWarsCommandResult> onComplete)
        {
            if (mutation == null)
            {
                onComplete?.Invoke(new RepWarsCommandResult { Failure = "Missing gameplay command" });
                yield break;
            }
            var body = CommandJson(
                mutation.CommandId,
                playerId,
                mutation.RequestId,
                mutation.ParametersJson,
                mutation.GameplaySessionId,
                mutation.CommandSequence,
                mutation.RenewalSequence);
            yield return PostCommandBody(body, onComplete, true);
        }

        public IEnumerator PostSession(string kind, string playerId, RepWarsSessionCall call, Action<RepWarsSessionResult> onComplete)
        {
            var result = new RepWarsSessionResult();
            if (call == null)
            {
                result.Failure = "Missing session call";
                onComplete?.Invoke(result);
                yield break;
            }
            var route = kind == "heartbeat" ? "/session/heartbeat" : kind == "end" ? "/session/end" : "/session/open";
            var body = SessionJson(kind, playerId, call);
            var request = new UnityWebRequest(BaseUrl + route, UnityWebRequest.kHttpVerbPOST);
            request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body));
            request.downloadHandler = new DownloadHandlerBuffer();
            request.SetRequestHeader("Content-Type", "application/json");
            request.timeout = 15;
            yield return request.SendWebRequest();
            result.HttpStatus = request.responseCode;
            result.RawJson = request.downloadHandler != null ? request.downloadHandler.text : string.Empty;
            if (request.result == UnityWebRequest.Result.ConnectionError)
            {
                result.Retryable = true;
                result.Failure = "Connection failed: " + request.error;
                onComplete?.Invoke(result);
                request.Dispose();
                yield break;
            }
            ParseSessionBody(result.RawJson, result);
            if (request.result != UnityWebRequest.Result.Success || request.responseCode != 200)
            {
                result.Retryable = RawHas(result.RawJson, "persistence.conflict") || RawHas(result.RawJson, "STALE_RECEIPT");
                result.Failure = "HTTP " + request.responseCode + ": " + request.error;
                onComplete?.Invoke(result);
                request.Dispose();
                yield break;
            }
            result.TransportOk = !string.IsNullOrEmpty(result.SessionId) || !string.IsNullOrEmpty(result.Outcome);
            onComplete?.Invoke(result);
            request.Dispose();
        }

        public void PostSessionEndNoWait(string playerId, RepWarsSessionCall call)
        {
            if (call == null) return;
            var body = SessionJson("end", playerId, call);
            var request = new UnityWebRequest(BaseUrl + "/session/end", UnityWebRequest.kHttpVerbPOST);
            request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body));
            request.downloadHandler = new DownloadHandlerBuffer();
            request.SetRequestHeader("Content-Type", "application/json");
            request.timeout = 2;
            request.SendWebRequest();
        }

        public static string CommandJson(string commandId, string playerId, string requestId, string parametersJson, string gameplaySessionId, int commandSequence, int renewalSequence)
        {
            var parameters = string.IsNullOrEmpty(parametersJson) ? "" : ",\"parameters\":" + parametersJson;
            var session = "";
            if (!string.IsNullOrEmpty(gameplaySessionId))
            {
                session = ",\"gameplaySessionId\":" + Quote(gameplaySessionId);
                if (commandSequence > 0) session += ",\"commandSequence\":" + commandSequence.ToString();
                if (renewalSequence > 0) session += ",\"renewalSequence\":" + renewalSequence.ToString();
            }
            return "{\"commandId\":" + Quote(commandId)
                + ",\"playerId\":" + Quote(playerId)
                + ",\"requestId\":" + Quote(requestId)
                + parameters
                + session + "}";
        }

        public static string SessionJson(string kind, string playerId, RepWarsSessionCall call)
        {
            var body = "{\"playerId\":" + Quote(playerId) + ",\"requestId\":" + Quote(call.RequestId);
            if (kind != "open" && !string.IsNullOrEmpty(call.GameplaySessionId))
            {
                body += ",\"gameplaySessionId\":" + Quote(call.GameplaySessionId);
            }
            if (kind == "heartbeat") body += ",\"renewalSequence\":" + call.RenewalSequence.ToString();
            return body + "}";
        }

        public static bool IndicatesIdempotentReplay(string json)
        {
            return RawHas(json, "\"idempotentReplay\":true");
        }

        IEnumerator PostCommandBody(string body, Action<RepWarsCommandResult> onComplete, bool parseGameState)
        {
            var result = new RepWarsCommandResult();
            var request = new UnityWebRequest(BaseUrl + "/commands", UnityWebRequest.kHttpVerbPOST);
            request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body));
            request.downloadHandler = new DownloadHandlerBuffer();
            request.SetRequestHeader("Content-Type", "application/json");
            request.timeout = 15;

            yield return request.SendWebRequest();

            result.HttpStatus = request.responseCode;
            result.RawJson = request.downloadHandler != null ? request.downloadHandler.text : string.Empty;

            if (request.result == UnityWebRequest.Result.ConnectionError)
            {
                result.Failure = "Connection failed: " + request.error;
                NoteCommand(result);
                onComplete?.Invoke(result);
                request.Dispose();
                yield break;
            }

            if (request.result != UnityWebRequest.Result.Success || request.responseCode != 200)
            {
                result.Failure = "HTTP " + request.responseCode + ": " + request.error;
                NoteCommand(result);
                onComplete?.Invoke(result);
                request.Dispose();
                yield break;
            }

            try
            {
                if (parseGameState)
                {
                    var adapted = PublicGameStateJson.AdaptTerritoriesForJsonUtility(result.RawJson);
                    result.Response = JsonUtility.FromJson<RepWarsCommandResponse>(adapted);
                    if (result.Response != null && result.Response.payload != null)
                    {
                        PublicGameStateJson.NoteFitness(adapted, result.Response.payload.gameState);
                        PublicGameStateJson.NormalizeWorkout(result.Response.payload.gameState);
                    }
                }
                else
                {
                    result.Response = new RepWarsCommandResponse
                    {
                        success = result.RawJson.IndexOf("\"success\":true", System.StringComparison.Ordinal) >= 0,
                    };
                    if (!result.Response.success)
                    {
                        result.Failure = "Command failed";
                    }
                }
            }
            catch (Exception ex)
            {
                result.Failure = "Malformed JSON: " + ex.Message;
                NoteCommand(result);
                onComplete?.Invoke(result);
                request.Dispose();
                yield break;
            }

            if (result.Response == null)
            {
                result.Failure = "Malformed JSON: empty command response";
                NoteCommand(result);
                onComplete?.Invoke(result);
                request.Dispose();
                yield break;
            }

            NoteCommand(result);
            if (!result.Response.success && !result.IdempotentReplay)
            {
                result.Failure = DescribeCommandFailure(result.Response);
                onComplete?.Invoke(result);
                request.Dispose();
                yield break;
            }

            if (result.Response.success) result.TransportOk = true;
            onComplete?.Invoke(result);
            request.Dispose();
        }

        static void NoteCommand(RepWarsCommandResult result)
        {
            result.IdempotentReplay = IndicatesIdempotentReplay(result.RawJson)
                || (result.Response != null && result.Response.idempotentReplay);
            if (result.Response != null && result.Response.errors != null && result.Response.errors.Length > 0 && !string.IsNullOrEmpty(result.Response.errors[0].code))
            {
                result.ServerCode = result.Response.errors[0].code;
            }
            else if (RawHas(result.RawJson, "persistence.conflict")) result.ServerCode = "persistence.conflict";
            else if (RawHas(result.RawJson, "STALE_RECEIPT")) result.ServerCode = "STALE_RECEIPT";
            else if (RawHas(result.RawJson, "COMMAND_SEQUENCE_CONFLICT")) result.ServerCode = "COMMAND_SEQUENCE_CONFLICT";
            else if (RawHas(result.RawJson, "COMMAND_STALE")) result.ServerCode = "COMMAND_STALE";
            else if (RawHas(result.RawJson, "GAMEPLAY_SESSION_INVALID")) result.ServerCode = "GAMEPLAY_SESSION_INVALID";
        }

        static void ParseSessionBody(string json, RepWarsSessionResult result)
        {
            result.Outcome = JsonString(json, "outcome");
            result.SessionId = JsonString(json, "sessionId");
            result.ExpiresAtMs = JsonLong(json, "expiresAtMs");
            if (string.IsNullOrEmpty(result.Outcome))
            {
                var error = JsonString(json, "error");
                if (!string.IsNullOrEmpty(error)) result.Outcome = error;
            }
        }

        static bool RawHas(string json, string token)
        {
            return !string.IsNullOrEmpty(json) && json.IndexOf(token, StringComparison.Ordinal) >= 0;
        }

        static string JsonString(string json, string key)
        {
            if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(key)) return "";
            var token = "\"" + key + "\":";
            var index = json.IndexOf(token, StringComparison.Ordinal);
            if (index < 0) return "";
            index += token.Length;
            while (index < json.Length && char.IsWhiteSpace(json[index])) index++;
            if (index >= json.Length || json[index] != '"') return "";
            index++;
            var end = index;
            while (end < json.Length && json[end] != '"')
            {
                if (json[end] == '\\') end++;
                end++;
            }
            if (end <= index) return "";
            return json.Substring(index, end - index);
        }

        static long JsonLong(string json, string key)
        {
            if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(key)) return 0;
            var token = "\"" + key + "\":";
            var index = json.IndexOf(token, StringComparison.Ordinal);
            if (index < 0) return 0;
            index += token.Length;
            while (index < json.Length && char.IsWhiteSpace(json[index])) index++;
            var end = index;
            if (end < json.Length && (json[end] == '-' || json[end] == '+')) end++;
            var start = end;
            while (end < json.Length && char.IsDigit(json[end])) end++;
            if (end == start) return 0;
            long value;
            return long.TryParse(json.Substring(index, end - index), out value) ? value : 0;
        }

        static string Quote(string value)
        {
            return "\"" + (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
        }

        static string DescribeCommandFailure(RepWarsCommandResponse response)
        {
            if (response.errors == null || response.errors.Length == 0)
            {
                return "Command failed: " + response.commandId;
            }
            var first = response.errors[0];
            return "Command failed: " + first.code + " " + first.message;
        }
    }

    [Serializable]
    public class VisibleWorldSnapshot
    {
        public string worldName;
        public int worldLevel;
        public string viewerFactionId;
        public PublicTerritory[] territories;
        public PublicArmy[] armies;
    }

    [Serializable]
    public class VisibleWorldPayload
    {
        public VisibleWorldSnapshot visibleWorld;
    }

    [Serializable]
    public class VisibleWorldResponse
    {
        public bool success;
        public VisibleWorldPayload payload;
    }

    public class VisibleWorldResult
    {
        public bool TransportOk;
        public string RawJson;
        public string Failure;
        public VisibleWorldSnapshot World;
    }
}
