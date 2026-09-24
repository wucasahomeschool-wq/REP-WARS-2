using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace RepWars
{
    /// <summary>
    /// First playable map screen. Geometry comes from the authored world definition.
    /// Ownership, armies, and turn come from the live public snapshot.
    /// </summary>
    public class RepWarsMapScreen : MonoBehaviour
    {
        public string baseUrl = RepWarsApiClient.DefaultBaseUrl;
        public string playerId = "player_local";

        static readonly Color[] OwnerPalette =
        {
            Hex(0xd9, 0x60, 0x60),
            Hex(0x5a, 0xa4, 0x6a),
            Hex(0x5a, 0x84, 0xc8),
            Hex(0xc8, 0xa0, 0x4a),
        };

        static readonly Color Sea = Hex(0x1b, 0x1f, 0x24);
        static readonly Color Border = Hex(0x2a, 0x30, 0x38);
        static readonly Color Ink = Hex(0xf0, 0xe6, 0xc8);
        static readonly Color Highlight = Hex(0xf0, 0xe6, 0xc8);

        PublicGameState gameState;
        AuthoredWorld world;
        VisibleWorldSnapshot visibleWorld;
        string status = "Loading Level 1...";
        TextMesh hud;
        TextMesh territoryInfo;
        RepWarsMapCamera mapCamera;
        RepWarsTerritoryView selected;

        void Start()
        {
            var camera = Camera.main;
            if (camera != null)
            {
                camera.backgroundColor = Sea;
                camera.orthographic = true;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.transparencySortMode = TransparencySortMode.CustomAxis;
                camera.transparencySortAxis = new Vector3(0f, 1f, -0.2f);
            }
            EnsureHud();
            hud.text = status;
            StartCoroutine(Boot());
        }

        void Update()
        {
            if (mapCamera == null || world == null) return;
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
            if (selected != null && selected != view) selected.SetSelected(false);
            selected = view;
            if (selected != null) selected.SetSelected(true);
            if (territoryInfo != null) territoryInfo.text = selected == null ? "Select a territory" : FormatTerritory(selected.territoryId);
            Debug.Log("[RepWars] select " + (selected == null ? "none" : selected.territoryId));
        }

        IEnumerator Boot()
        {
            var client = new RepWarsApiClient(baseUrl);
            RepWarsCommandResult stateResult = null;
            yield return client.GetGameState(playerId, result => stateResult = result);
            if (stateResult == null || !stateResult.TransportOk || stateResult.Response.payload == null)
            {
                Fail(stateResult != null ? stateResult.Failure : "GET_GAME_STATE failed");
                yield break;
            }
            gameState = stateResult.Response.payload.gameState;

            RepWarsCommandResult definitionResult = null;
            yield return client.GetWorldDefinition(playerId, result => definitionResult = result);
            if (definitionResult == null || !definitionResult.TransportOk)
            {
                Fail(definitionResult != null ? definitionResult.Failure : "GET_WORLD_DEFINITION failed");
                yield break;
            }
            try
            {
                world = WorldDefinitionReader.Read(definitionResult.RawJson);
            }
            catch (System.Exception ex)
            {
                Fail("World definition could not be read: " + ex.Message);
                yield break;
            }
            if (world.territories.Count == 0)
            {
                Fail("World definition contained no territories");
                yield break;
            }

            VisibleWorldResult visibleResult = null;
            yield return client.GetVisibleWorld(playerId, result => visibleResult = result);
            if (visibleResult != null && visibleResult.TransportOk) visibleWorld = visibleResult.World;

            BuildMap();
            FrameCamera();
            status = null;
            hud.text = FormatEmpire();
            Debug.Log("[RepWars] map world=" + world.name
                + " level=" + world.level
                + " territories=" + world.territories.Count
                + " player=" + gameState.playerFactionId
                + " turn=" + gameState.turn);
        }

        void BuildMap()
        {
            var root = new GameObject("Level1Map");
            var owners = OwnersById();
            var bounds = new Bounds();
            var hasBounds = false;
            Bounds mapBounds = default;
            foreach (var territory in world.territories)
            {
                if (territory.ring.Count < 3) continue;
                var owner = owners.TryGetValue(territory.id, out var id) ? id : null;
                var ring = MapProjection.Project(territory.ring);
                var piece = new GameObject("Territory_" + territory.id);
                piece.transform.SetParent(root.transform, false);
                var ground = new GameObject("Terrain_" + territory.id);
                ground.transform.SetParent(piece.transform, false);
                var groundFilter = ground.AddComponent<MeshFilter>();
                groundFilter.sharedMesh = TerritoryMeshBuilder.Build(ring);
                var groundRenderer = ground.AddComponent<MeshRenderer>();
                groundRenderer.sharedMaterial = TerritoryMaterial(TerrainColor(territory.terrain));
                groundRenderer.sortingOrder = 0;
                var filter = piece.AddComponent<MeshFilter>();
                filter.sharedMesh = TerritoryMeshBuilder.Build(ring);
                var renderer = piece.AddComponent<MeshRenderer>();
                var ownerColor = ColorFor(owner);
                ownerColor.a = 0.72f;
                renderer.sharedMaterial = TerritoryMaterial(ownerColor);
                renderer.sortingOrder = 1;
                var outline = piece.AddComponent<LineRenderer>();
                outline.positionCount = territory.ring.Count;
                outline.loop = true;
                outline.widthMultiplier = 0.35f;
                outline.material = TerritoryMaterial(Border);
                outline.startColor = Border;
                outline.endColor = Border;
                outline.useWorldSpace = false;
                outline.sortingOrder = 4;
                var view = piece.AddComponent<RepWarsTerritoryView>();
                view.territoryId = territory.id;
                view.outline = outline;
                view.normalColor = Border;
                view.selectedColor = Highlight;
                var collider = piece.AddComponent<PolygonCollider2D>();
                collider.SetPath(0, OpenRing(ring));
                PlaceArmies(piece.transform, territory, ring);
                for (var i = 0; i < ring.Count; i++)
                {
                    outline.SetPosition(i, ring[i]);
                    if (!hasBounds)
                    {
                        bounds = new Bounds(ring[i], Vector3.zero);
                        hasBounds = true;
                    }
                    else bounds.Encapsulate(ring[i]);
                }
            }
            PlaceAuthoredVisuals(root.transform);
            LabelRegions(root.transform, bounds, hasBounds);
            if (hasBounds)
            {
                mapBounds = bounds;
                var textSize = Mathf.Max(0.08f, bounds.size.y * 0.0075f);
                hud.transform.position = new Vector3(bounds.min.x - bounds.size.x * 0.46f, bounds.max.y, -1f);
                hud.characterSize = textSize;
                territoryInfo.transform.position = hud.transform.position + new Vector3(0f, -bounds.size.y * 0.34f, 0f);
                territoryInfo.characterSize = textSize;
                territoryInfo.text = "Select a territory";
            }
            this.mapBounds = mapBounds;
            hasMapBounds = hasBounds;
        }

        Bounds mapBounds;
        bool hasMapBounds;

        void LabelRegions(Transform parent, Bounds bounds, bool hasBounds)
        {
            var characterSize = hasBounds ? Mathf.Max(0.12f, bounds.size.y * 0.0065f) : 0.2f;
            foreach (var region in world.regions)
            {
                Vector2 sum = Vector2.zero;
                var count = 0;
                foreach (var territory in world.territories)
                {
                    if (territory.regionId != region.id || territory.ring.Count == 0) continue;
                    foreach (var point in territory.ring)
                    {
                        sum += point;
                        count++;
                    }
                }
                if (count == 0 || string.IsNullOrEmpty(region.name)) continue;
                var labelObject = new GameObject("Region_" + region.id);
                labelObject.transform.SetParent(parent, false);
                var projected = MapProjection.Project(new Vector2(sum.x / count, sum.y / count));
                labelObject.transform.position = new Vector3(projected.x, projected.y, -0.5f);
                var label = labelObject.AddComponent<TextMesh>();
                label.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
                label.fontSize = 48;
                label.characterSize = characterSize;
                label.anchor = TextAnchor.MiddleCenter;
                label.alignment = TextAlignment.Center;
                label.color = Ink;
                label.text = region.name;
                var labelRenderer = label.GetComponent<MeshRenderer>();
                labelRenderer.sortingOrder = 30;
            }
        }

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

        Color ColorFor(string factionId)
        {
            if (string.IsNullOrEmpty(factionId)) return Hex(0x6d, 0x7a, 0x55);
            var index = world.factionIds.IndexOf(factionId);
            if (index < 0) index = factionId == gameState.playerFactionId ? 0 : 1;
            return OwnerPalette[index % OwnerPalette.Length];
        }

        void FrameCamera()
        {
            var camera = Camera.main;
            if (camera == null || !hasMapBounds) return;
            var framed = mapBounds;
            framed.Encapsulate(new Vector3(mapBounds.min.x - mapBounds.size.x * 0.5f, mapBounds.center.y, 0f));
            var aspect = Mathf.Max(0.1f, camera.aspect);
            var size = Mathf.Max(framed.extents.y, framed.extents.x / aspect) * 1.08f;
            mapCamera = camera.GetComponent<RepWarsMapCamera>();
            if (mapCamera == null) mapCamera = camera.gameObject.AddComponent<RepWarsMapCamera>();
            mapCamera.Frame(framed.center, size, aspect);
        }

        static Vector2[] OpenRing(System.Collections.Generic.List<Vector2> ring)
        {
            var count = ring.Count;
            if (count > 1 && (ring[0] - ring[count - 1]).sqrMagnitude < 0.000001f) count--;
            var path = new Vector2[count];
            for (var i = 0; i < count; i++) path[i] = ring[i];
            return path;
        }

        void PlaceAuthoredVisuals(Transform parent)
        {
            Debug.Log("[RepWars] authored props=" + world.props.Count + " locations=" + world.locations.Count);
            foreach (var prop in world.props)
            {
                if (string.IsNullOrEmpty(prop.assetId)) continue;
                var marker = new GameObject("Prop_" + prop.assetId);
                marker.transform.SetParent(parent, false);
                var projected = MapProjection.Project(prop.position);
                marker.transform.position = new Vector3(projected.x, projected.y, 0f);
                marker.transform.rotation = Quaternion.Euler(0f, 0f, -prop.rotationDegrees);
                var label = marker.AddComponent<TextMesh>();
                label.text = prop.assetId;
                label.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
                label.fontSize = 32;
                label.characterSize = 0.8f;
                label.anchor = TextAnchor.MiddleCenter;
                label.color = new Color(0.85f, 0.75f, 0.45f);
                label.GetComponent<MeshRenderer>().sortingOrder = 12;
            }
            foreach (var location in world.locations)
            {
                if (!location.hasPosition && string.IsNullOrEmpty(location.name)) continue;
                var marker = new GameObject("Location_" + (location.name ?? location.territoryId));
                marker.transform.SetParent(parent, false);
                var projected = MapProjection.Project(location.position);
                marker.transform.position = new Vector3(projected.x, projected.y, -0.2f);
                var label = marker.AddComponent<TextMesh>();
                label.text = string.IsNullOrEmpty(location.visualAssetId) ? location.name : location.visualAssetId;
                label.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
                label.fontSize = 32;
                label.characterSize = 0.7f;
                label.anchor = TextAnchor.MiddleCenter;
                label.color = Ink;
                label.GetComponent<MeshRenderer>().sortingOrder = 14;
            }
        }

        static Color TerrainColor(string terrain)
        {
            switch (terrain)
            {
                case "forest": return Hex(0x5f, 0x8f, 0x5a);
                case "hills": return Hex(0xb8, 0xa5, 0x6a);
                case "mountain": return Hex(0x8b, 0x86, 0x80);
                case "coastal": return Hex(0x8e, 0xc4, 0xc0);
                case "desert": return Hex(0xd2, 0xc0, 0x7a);
                case "river": return Hex(0x5a, 0x9e, 0xc8);
                default: return Hex(0xc9, 0xd4, 0x8a);
            }
        }

        void PlaceArmies(Transform territoryTransform, AuthoredTerritory territory, List<Vector2> ring)
        {
            if (gameState.armies == null) return;
            var centroid = Vector2.zero;
            for (var i = 0; i < ring.Count; i++) centroid += ring[i];
            centroid /= ring.Count;
            var placed = 0;
            foreach (var army in gameState.armies)
            {
                if (army == null || army.location != territory.id) continue;
                var marker = new GameObject("Army_" + army.id);
                marker.transform.SetParent(territoryTransform, false);
                marker.transform.position = new Vector3(centroid.x, centroid.y - placed * 1.6f, -0.8f);
                var token = marker.AddComponent<TextMesh>();
                token.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
                token.fontSize = 48;
                token.characterSize = 0.55f;
                token.anchor = TextAnchor.MiddleCenter;
                token.alignment = TextAlignment.Center;
                token.color = Color.white;
                token.text = army.troops + " troops";
                token.GetComponent<MeshRenderer>().sortingOrder = 20;
                placed++;
                Debug.Log("[RepWars] army " + army.id + " at " + territory.id + " troops=" + army.troops);
            }
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

        static Material TerritoryMaterial(Color color)
        {
            var shader = Shader.Find("Universal Render Pipeline/2D/Sprite-Unlit-Default");
            if (shader == null) shader = Shader.Find("Sprites/Default");
            var material = new Material(shader);
            material.color = color;
            return material;
        }

        static Color Hex(byte r, byte g, byte b)
        {
            return new Color32(r, g, b, 255);
        }
    }
}
