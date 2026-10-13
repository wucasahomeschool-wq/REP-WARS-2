using System.Collections;
using System.Collections.Generic;
using RepWars.WorldPresentation;
using UnityEngine;

namespace RepWars
{
    /// <summary>
    /// First playable map screen. Geometry comes from the authored world definition.
    /// Ownership, armies, and turn come from the live public snapshot.
    /// This class coordinates the map: boot, the full rebuild, selection, picking, and camera framing.
    /// The world it draws is a resolved presentation definition. Territories, armies, props, and labels
    /// are built by the presenters in MapPresentation.
    /// </summary>
    public class RepWarsMapScreen : MonoBehaviour
    {
        public const string MapRootName = "WorldMap";
        public string baseUrl = RepWarsApiClient.DefaultBaseUrl;
        public string playerId = "player_local";
        bool heartbeatStarted;
        bool quitting;

        public RepWarsApiClient Client { get; private set; }
        public RepWarsGameplaySession GameplaySession { get; private set; }

        static readonly Color Sea = new Color32(0x1b, 0x1f, 0x24, 255);
        static readonly Color Ink = RepWarsLabelPresenter.Ink;

        PublicGameState gameState;
        AuthoredWorld world;
        RepWarsPropCatalog propCatalog;
        Sprite terrainFill;
        RepWarsWorldPresentationDefinition presentation;
        VisibleWorldSnapshot visibleWorld;
        string status = "Loading world...";
        TextMesh hud;
        TextMesh territoryInfo;
        RepWarsMapCamera mapCamera;
        GameObject mapRoot;
        RepWarsSelectionPresentation selection;
        RepWarsTerritoryView selected;
        public bool suppressMapInput;

        void Start()
        {
            var camera = Camera.main;
            if (camera != null)
            {
                camera.backgroundColor = Sea;
                camera.orthographic = true;
                camera.clearFlags = CameraClearFlags.SolidColor;
                BindWorldSort(camera);
            }
            EnsureHud();
            hud.text = status;
            Client = new RepWarsApiClient(baseUrl);
            GameplaySession = new RepWarsGameplaySession();
            if (GetComponent<RepWarsPlayLoop>() == null) gameObject.AddComponent<RepWarsPlayLoop>();
            StartCoroutine(Boot());
        }

        public RepWarsGameplaySession EnsureGameplaySession()
        {
            if (Client == null) Client = new RepWarsApiClient(baseUrl);
            if (GameplaySession == null) GameplaySession = new RepWarsGameplaySession();
            return GameplaySession;
        }

        public void EnsureHeartbeat()
        {
            EnsureGameplaySession();
            if (heartbeatStarted || quitting) return;
            heartbeatStarted = true;
            StartCoroutine(RepWarsSessionDriver.Heartbeat(Client, GameplaySession, playerId, () => quitting));
        }

        void OnApplicationPause(bool paused)
        {
            // Losing focus does not end the gameplay session. Heartbeats continue while the app is running.
            if (paused) return;
        }

        void OnApplicationFocus(bool hasFocus)
        {
            // Focus returning does not open or end a session.
            if (hasFocus) return;
        }

        void OnApplicationQuit()
        {
            quitting = true;
            RepWarsSessionDriver.EndBestEffort(Client, GameplaySession, playerId);
        }

        public string SelectedTerritoryId
        {
            get { return selected != null ? selected.territoryId : null; }
        }

        public PublicGameState LiveState
        {
            get { return gameState; }
        }

        public void ApplySnapshot(PublicGameState next)
        {
            if (next != null) gameState = next;
        }

        public void PresentAuthoritative(PublicGameState next, VisibleWorldSnapshot visible)
        {
            if (next == null) return;
            gameState = next;
            if (visible != null) visibleWorld = visible;
            if (!string.IsNullOrEmpty(next.definitionWorldId)
                && (presentation == null || presentation.WorldId != next.definitionWorldId))
            {
                try
                {
                    Adopt(RepWarsWorldPresentations.Resolve(next.definitionWorldId));
                }
                catch (System.Exception ex)
                {
                    ClearMap();
                    Fail(ex.Message);
                    return;
                }
            }
            ClearMap();
            if (territoryInfo != null) territoryInfo.text = "";
            BuildMap();
            FrameCamera();
            if (hud != null) hud.text = "";
        }

        void Update()
        {
            if (mapCamera == null || world == null || suppressMapInput) return;
            mapCamera.Tick();
            if (!mapCamera.TryPick(out var point)) return;
            PickWorldPoint(point);
        }

        public void PickWorldPoint(Vector2 point)
        {
            var hit = Physics2D.OverlapPoint(point);
            var view = hit != null ? hit.GetComponent<RepWarsTerritoryView>() : null;
            Select(view);
        }

        void Select(RepWarsTerritoryView view)
        {
            selected = view;
            if (selection != null)
            {
                if (view == null) selection.Hide();
                else selection.Show(view);
            }
            if (territoryInfo != null) territoryInfo.text = "";
            Debug.Log("[RepWars] select " + (selected == null ? "none" : selected.territoryId));
        }

        IEnumerator Boot()
        {
            if (Client == null) Client = new RepWarsApiClient(baseUrl);
            if (GameplaySession == null) GameplaySession = new RepWarsGameplaySession();
            RepWarsCommandResult stateResult = null;
            yield return Client.GetGameState(playerId, result => stateResult = result);
            if (stateResult == null || !stateResult.TransportOk || stateResult.Response.payload == null)
            {
                Fail(stateResult != null ? stateResult.Failure : "GET_GAME_STATE failed");
                yield break;
            }
            gameState = stateResult.Response.payload.gameState;
            yield return RepWarsSessionDriver.Open(Client, GameplaySession, playerId, false);
            EnsureHeartbeat();

            // The endpoint must answer before the map is shown. Its body is not the sprite-backed
            // presentation bundle; that bundle is selected from definitionWorldId.
            RepWarsCommandResult definitionResult = null;
            yield return Client.GetWorldDefinition(playerId, result => definitionResult = result);
            if (definitionResult == null || !definitionResult.TransportOk)
            {
                Fail(definitionResult != null ? definitionResult.Failure : "GET_WORLD_DEFINITION failed");
                yield break;
            }
            try
            {
                Adopt(RepWarsWorldPresentations.Resolve(gameState.definitionWorldId));
            }
            catch (System.Exception ex)
            {
                Fail(ex.Message);
                yield break;
            }

            VisibleWorldResult visibleResult = null;
            yield return Client.GetVisibleWorld(playerId, result => visibleResult = result);
            if (visibleResult != null && visibleResult.TransportOk) visibleWorld = visibleResult.World;

            BuildMap();
            FrameCamera();
            status = null;
            if (hud != null) hud.text = "";
            if (territoryInfo != null) territoryInfo.text = "";
            Debug.Log("[RepWars] map world=" + world.name
                + " level=" + world.level
                + " territories=" + world.territories.Count
                + " player=" + gameState.playerFactionId
                + " turn=" + gameState.turn);
        }

        /// <summary>
        /// Full rebuild of the resolved presentation. Drops the previous map root, which releases its runtime meshes
        /// and materials, then asks each presenter to build under one new root.
        /// </summary>
        void BuildMap()
        {
            ClearMap();
            mapRoot = new GameObject(MapRootName);
            var root = mapRoot.transform;
            var resources = RepWarsMapResources.Create(mapRoot);
            var territories = RepWarsTerritoryPresenter.Build(root, world, resources, terrainFill);
            RepWarsArmyPresenter.Build(territories.Pieces, gameState, world, OwnersById());
            selection = RepWarsSelectionPresentation.Create(root);
            RepWarsPropPresenter.Build(root, world, propCatalog, resources);
            RepWarsLabelPresenter.BuildLocationLabels(root, world);
            RepWarsLabelPresenter.BuildRegionLabels(root, world, territories.Bounds, territories.HasBounds);
            var bounds = territories.Bounds;
            if (territories.HasBounds)
            {
                var textSize = Mathf.Max(0.08f, bounds.size.y * 0.0075f);
                hud.transform.position = new Vector3(bounds.min.x - bounds.size.x * 0.46f, bounds.max.y, -1f);
                hud.characterSize = textSize;
                territoryInfo.transform.position = hud.transform.position + new Vector3(0f, -bounds.size.y * 0.34f, 0f);
                territoryInfo.characterSize = textSize;
                territoryInfo.text = "Select a territory";
            }
            mapBounds = bounds;
            hasMapBounds = territories.HasBounds;
        }

        void Adopt(RepWarsWorldPresentationDefinition definition)
        {
            presentation = definition;
            world = definition.World;
            propCatalog = definition.Catalog;
            terrainFill = definition.TerrainFill;
            RepWarsWorldPresentations.WarnOnSnapshotGaps(world, gameState);
        }

        /// <summary>The rebuild clears selection. Selection persistence across incremental updates is deferred.</summary>
        void ClearMap()
        {
            selected = null;
            selection = null;
            if (mapRoot != null) DestroyImmediate(mapRoot);
            mapRoot = null;
        }

        Bounds mapBounds;
        bool hasMapBounds;

        Dictionary<string, string> OwnersById()
        {
            var owners = new Dictionary<string, string>();
            var source = visibleWorld != null && visibleWorld.territories != null
                ? visibleWorld.territories
                : gameState.territories;
            if (source == null) return owners;
            foreach (var territory in source)
            {
                if (territory != null && !string.IsNullOrEmpty(territory.id)) owners[territory.id] = territory.owner;
            }
            return owners;
        }

        void FrameCamera()
        {
            var camera = Camera.main;
            if (camera == null || !hasMapBounds) return;
            var framed = mapBounds;
            var aspect = Mathf.Max(0.1f, camera.aspect);
            var size = Mathf.Max(framed.extents.y, framed.extents.x / aspect) * 1.22f;
            mapCamera = camera.GetComponent<RepWarsMapCamera>();
            if (mapCamera == null) mapCamera = camera.gameObject.AddComponent<RepWarsMapCamera>();
            BindWorldSort(camera);
            mapCamera.Frame(framed.center, size, aspect);
        }

        string FormatTerritory(string territoryId)
        {
            PublicTerritory match = null;
            var source = visibleWorld != null && visibleWorld.territories != null
                ? visibleWorld.territories
                : gameState.territories;
            if (source != null)
            {
                foreach (var territory in source)
                {
                    if (territory != null && territory.id == territoryId) match = territory;
                }
            }
            var owner = match != null ? match.owner : "unknown";
            var region = match != null && !string.IsNullOrEmpty(match.regionName) ? match.regionName : RegionName(territoryId);
            var yours = owner == gameState.playerFactionId ? "yes" : "no";
            var troops = "none";
            if (gameState.armies != null)
            {
                var total = 0;
                var found = false;
                foreach (var army in gameState.armies)
                {
                    if (army == null || army.location != territoryId) continue;
                    total += army.troops;
                    found = true;
                }
                if (found) troops = total + " troops";
            }
            return "Territory " + territoryId + "\n"
                + region + "\n"
                + "Owner " + owner + "\n"
                + "Yours " + yours + "\n"
                + troops;
        }

        string RegionName(string territoryId)
        {
            string regionId = null;
            foreach (var territory in world.territories)
            {
                if (territory.id == territoryId) regionId = territory.regionId;
            }
            foreach (var region in world.regions)
            {
                if (region.id == regionId && !string.IsNullOrEmpty(region.name)) return region.name;
            }
            return regionId ?? "";
        }

        string FormatEmpire()
        {
            var playerOwned = 0;
            var source = visibleWorld != null && visibleWorld.territories != null
                ? visibleWorld.territories
                : gameState.territories;
            if (source != null)
            {
                foreach (var territory in source)
                {
                    if (territory != null && territory.owner == gameState.playerFactionId) playerOwned++;
                }
            }
            var troops = 0;
            if (gameState.armies != null)
            {
                foreach (var army in gameState.armies)
                {
                    if (army != null && army.owner == gameState.playerFactionId) troops += army.troops;
                }
            }
            var yours = RegionNameForOwner(gameState.playerFactionId);
            return "REP WARS\n"
                + world.name + "\n"
                + "Turn " + gameState.turn + "\n\n"
                + "Your empire\n"
                + yours + "\n"
                + playerOwned + " territor" + (playerOwned == 1 ? "y" : "ies") + "\n"
                + troops + " troops";
        }

        string RegionNameForOwner(string factionId)
        {
            if (gameState.territories == null) return factionId;
            foreach (var territory in gameState.territories)
            {
                if (territory != null && territory.owner == factionId && !string.IsNullOrEmpty(territory.regionName))
                {
                    return territory.regionName;
                }
            }
            return factionId;
        }

        void EnsureHud()
        {
            var labelObject = new GameObject("EmpireHud");
            hud = labelObject.AddComponent<TextMesh>();
            hud.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            hud.fontSize = 48;
            hud.characterSize = 0.4f;
            hud.anchor = TextAnchor.UpperLeft;
            hud.alignment = TextAlignment.Left;
            hud.color = Ink;
            var infoObject = new GameObject("TerritoryInfo");
            territoryInfo = infoObject.AddComponent<TextMesh>();
            territoryInfo.font = hud.font;
            territoryInfo.fontSize = 48;
            territoryInfo.characterSize = 0.4f;
            territoryInfo.anchor = TextAnchor.UpperLeft;
            territoryInfo.alignment = TextAlignment.Left;
            territoryInfo.color = Ink;
            territoryInfo.text = "Select a territory";
        }

        void Fail(string message)
        {
            status = message;
            if (hud != null) hud.text = message;
            Debug.LogError("[RepWars] " + message);
        }

        static void BindWorldSort(Camera camera)
        {
            if (camera == null) return;
            if (camera.GetComponent<WorldSortingCameraBinding>() == null)
                camera.gameObject.AddComponent<WorldSortingCameraBinding>();
        }
    }
}
