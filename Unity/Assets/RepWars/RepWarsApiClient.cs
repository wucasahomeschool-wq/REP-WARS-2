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
    public class RepWarsGameStateFields
    {
        public string playerFactionId;
        public string worldName;
        public int worldLevel;
        public int turn;
    }

    [Serializable]
    public class RepWarsCommandPayload
    {
        public RepWarsGameStateFields gameState;
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
    /// Dictionary fields on gameState are left in RawJson and are not mapped.
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

        public IEnumerator PostCommand(string commandId, string playerId, string requestId, Action<RepWarsCommandResult> onComplete)
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
                result.Response = JsonUtility.FromJson<RepWarsCommandResponse>(result.RawJson);
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
}
