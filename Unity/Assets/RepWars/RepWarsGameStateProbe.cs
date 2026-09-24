using UnityEngine;

namespace RepWars
{
    /// <summary>
    /// Temporary Play Mode probe. Loads GET_GAME_STATE once and draws the deserialized snapshot.
    /// Not the game interface.
    /// </summary>
    public class RepWarsGameStateProbe : MonoBehaviour
    {
        public string baseUrl = RepWarsApiClient.DefaultBaseUrl;
        public string playerId = "player_local";

        PublicGameState gameState;
        string status = "Requesting GET_GAME_STATE...";
        TextMesh readout;

        void Start()
        {
            EnsureReadout();
            readout.text = status;
            var client = new RepWarsApiClient(baseUrl);
            StartCoroutine(client.GetGameState(playerId, LogResult));
        }

        void EnsureReadout()
        {
            if (readout != null) return;
            var labelObject = new GameObject("RepWarsDebugReadout");
            labelObject.transform.position = new Vector3(-7.2f, 3.6f, 0f);
            readout = labelObject.AddComponent<TextMesh>();
            readout.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            readout.fontSize = 64;
            readout.characterSize = 0.045f;
            readout.anchor = TextAnchor.UpperLeft;
            readout.alignment = TextAlignment.Left;
            readout.color = Color.white;
        }

        void LogResult(RepWarsCommandResult result)
        {
            if (!result.TransportOk)
            {
                status = result.Failure ?? "GET_GAME_STATE failed";
                Debug.LogError("[RepWars] " + status);
                EnsureReadout();
                readout.text = status;
                return;
            }

            gameState = result.Response.payload != null ? result.Response.payload.gameState : null;
            if (gameState == null)
            {
                status = "Command succeeded but payload.gameState was missing";
                Debug.LogError("[RepWars] " + status);
                EnsureReadout();
                readout.text = status;
                return;
            }

            status = null;
            EnsureReadout();
            readout.text = FormatReadout();
            Debug.Log(
                "[RepWars] model worldName=" + gameState.worldName
                + " worldLevel=" + gameState.worldLevel
                + " turn=" + gameState.turn
                + " playerFactionId=" + gameState.playerFactionId
                + " territories=" + gameState.TerritoryCount
                + " armies=" + gameState.ArmyCount);
        }

        string FormatReadout()
        {
            return "Rep Wars debug\n"
                + "World name: " + gameState.worldName + "\n"
                + "World level: " + gameState.worldLevel + "\n"
                + "Turn: " + gameState.turn + "\n"
                + "Player faction ID: " + gameState.playerFactionId + "\n"
                + "Territories: " + gameState.TerritoryCount + "\n"
                + "Armies: " + gameState.ArmyCount + "\n"
                + "Source: GET_GAME_STATE";
        }
    }
}
