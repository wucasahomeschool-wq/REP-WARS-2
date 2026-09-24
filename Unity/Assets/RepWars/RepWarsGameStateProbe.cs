using UnityEngine;

namespace RepWars
{
    /// <summary>
    /// Play Mode probe. Requests GET_GAME_STATE once and logs the raw response plus a few scalar fields.
    /// Dictionary fields stay in the raw JSON.
    /// </summary>
    public class RepWarsGameStateProbe : MonoBehaviour
    {
        public string baseUrl = RepWarsApiClient.DefaultBaseUrl;
        public string playerId = "player_local";

        void Start()
        {
            var client = new RepWarsApiClient(baseUrl);
            StartCoroutine(client.GetGameState(playerId, LogResult));
        }

        static void LogResult(RepWarsCommandResult result)
        {
            if (!string.IsNullOrEmpty(result.RawJson))
            {
                Debug.Log("[RepWars] CommandResponse\n" + result.RawJson);
            }

            if (!result.TransportOk)
            {
                Debug.LogError("[RepWars] " + result.Failure);
                return;
            }

            var state = result.Response.payload != null ? result.Response.payload.gameState : null;
            if (state == null)
            {
                Debug.LogError("[RepWars] Command succeeded but payload.gameState was missing");
                return;
            }

            Debug.Log(
                "[RepWars] gameState playerFactionId=" + state.playerFactionId
                + " worldName=" + state.worldName
                + " worldLevel=" + state.worldLevel
                + " turn=" + state.turn);
        }
    }
}
