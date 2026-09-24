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
        public string commandId;
        public string requestId;
        public string playerId;
        public RepWarsCommandError[] errors;
        public RepWarsCommandPayload payload;
    }

    public class RepWarsCommandResult
    {
        public bool TransportOk;
        public long HttpStatus;
        public string RawJson;
        public string Failure;
        public RepWarsCommandResponse Response;
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

        public IEnumerator PostCommand(string commandId, string playerId, string requestId, Action<RepWarsCommandResult> onComplete, bool parseGameState)
        {
            var result = new RepWarsCommandResult();
            var body = JsonUtility.ToJson(new RepWarsCommandRequest
            {
                commandId = commandId,
                playerId = playerId,
                requestId = requestId,
            });
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
                onComplete?.Invoke(result);
                request.Dispose();
                yield break;
            }

            if (request.result != UnityWebRequest.Result.Success || request.responseCode != 200)
            {
                result.Failure = "HTTP " + request.responseCode + ": " + request.error;
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
                onComplete?.Invoke(result);
                request.Dispose();
                yield break;
            }

            if (result.Response == null)
            {
                result.Failure = "Malformed JSON: empty command response";
                onComplete?.Invoke(result);
                request.Dispose();
                yield break;
            }

            if (!result.Response.success)
            {
                result.Failure = DescribeCommandFailure(result.Response);
                onComplete?.Invoke(result);
                request.Dispose();
                yield break;
            }

            result.TransportOk = true;
            onComplete?.Invoke(result);
            request.Dispose();
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
