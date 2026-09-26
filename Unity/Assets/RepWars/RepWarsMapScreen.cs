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
        RepWarsPropCatalog propCatalog;
        Material propMaterial;
        VisibleWorldSnapshot visibleWorld;
        string status = "Loading Level 1...";
        TextMesh hud;
        TextMesh territoryInfo;
        RepWarsMapCamera mapCamera;
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
                camera.transparencySortMode = TransparencySortMode.CustomAxis;
                camera.transparencySortAxis = new Vector3(0f, 1f, -0.2f);
            }
            EnsureHud();
            hud.text = status;
            if (GetComponent<RepWarsPlayLoop>() == null) gameObject.AddComponent<RepWarsPlayLoop>();
            StartCoroutine(Boot());
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
            var existing = GameObject.Find("Level1Map");
            if (existing != null) DestroyImmediate(existing);
            selected = null;
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
            if (selected != null && selected != view) selected.SetSelected(false);
            selected = view;
            if (selected != null) selected.SetSelected(true);
            if (territoryInfo != null) territoryInfo.text = "";
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
            propCatalog = Resources.Load<RepWarsPropCatalog>("RepWarsPropCatalog");
            if (propCatalog == null || propCatalog.authoredWorld == null)
            {
                Fail("Level 1 prop catalog is missing");
                yield break;
            }
            try
            {
                world = WorldDefinitionReader.Read(propCatalog.authoredWorld.text);
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
            if (hud != null) hud.text = "";
            if (territoryInfo != null) territoryInfo.text = "";
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
                var groundMesh = TerritoryMeshBuilder.Build(ring);
                var plains = PlainsSprite();
                if (plains != null)
                {
                    TerritoryMeshBuilder.ApplyWorldUVs(groundMesh, plains.rect.width / plains.pixelsPerUnit);
                }
                groundFilter.sharedMesh = groundMesh;
                var groundRenderer = ground.AddComponent<MeshRenderer>();
                groundRenderer.sharedMaterial = plains != null
                    ? PlainsMaterial(plains)
                    : TerritoryMaterial(TerrainColor(territory.terrain));
                groundRenderer.sortingOrder = 0;
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
                PlaceArmies(piece.transform, territory, ring, owner);
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
            var characterSize = hasBounds ? Mathf.Max(0.07f, bounds.size.y * 0.0048f) : 0.09f;
            foreach (var region in world.regions)
            {
                if (string.IsNullOrEmpty(region.name) || !TryRegionLabelPoint(region.id, out var projected)) continue;
                var labelObject = new GameObject("Region_" + region.id);
                labelObject.transform.SetParent(parent, false);
                labelObject.transform.position = new Vector3(projected.x, projected.y, -0.5f);
                var label = labelObject.AddComponent<TextMesh>();
                label.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
                label.fontSize = 48;
                label.characterSize = characterSize;
                label.anchor = TextAnchor.MiddleCenter;
                label.alignment = TextAlignment.Center;
                label.color = new Color(Ink.r, Ink.g, Ink.b, 0.82f);
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
            var aspect = Mathf.Max(0.1f, camera.aspect);
            var size = Mathf.Max(framed.extents.y, framed.extents.x / aspect) * 1.22f;
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
            var rendered = 0;
            var skipped = 0;
            foreach (var prop in world.props)
            {
                if (!PlaceProp(parent, prop)) skipped++;
                else rendered++;
            }
            Debug.Log("[RepWars] authored props=" + world.props.Count
                + " rendered=" + rendered
                + " skipped=" + skipped
                + " locations=" + world.locations.Count);
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

        bool PlaceProp(Transform parent, AuthoredProp prop)
        {
            if (string.IsNullOrEmpty(prop.assetId)) return false;
            if (!prop.hasScale)
            {
                Debug.LogWarning("[RepWars] prop " + prop.instanceId + " has no authored scale");
                return false;
            }
            var sprite = propCatalog != null ? propCatalog.Find(prop.assetId) : null;
            if (sprite == null)
            {
                Debug.LogWarning("[RepWars] no sprite registered for " + prop.assetId);
                return false;
            }
            if (!RepWarsPropPlacement.UsesImportedPivot(prop.anchor))
            {
                Debug.LogWarning("[RepWars] prop " + prop.instanceId + " has unsupported anchor " + prop.anchor);
                return false;
            }
            var marker = new GameObject("Prop_" + (string.IsNullOrEmpty(prop.instanceId) ? prop.assetId : prop.instanceId));
            marker.transform.SetParent(parent, false);
            var rotation = Quaternion.Euler(0f, 0f, -prop.rotationDegrees);
            var projected = MapProjection.Project(prop.position);
            marker.transform.SetPositionAndRotation(new Vector3(projected.x, projected.y, 0f), rotation);
            marker.transform.localScale = new Vector3(prop.scale, prop.scale, 1f);
            var renderer = marker.AddComponent<SpriteRenderer>();
            renderer.sprite = sprite;
            renderer.sharedMaterial = PropMaterial();
            renderer.sortingOrder = RepWarsPropPlacement.SortingOrder(prop.depth);
            return true;
        }

        Material PropMaterial()
        {
            if (propMaterial != null) return propMaterial;
            var shader = Shader.Find("Universal Render Pipeline/2D/Sprite-Unlit-Default");
            if (shader == null) shader = Shader.Find("Sprites/Default");
            propMaterial = new Material(shader);
            return propMaterial;
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

        void PlaceArmies(Transform territoryTransform, AuthoredTerritory territory, List<Vector2> ring, string owner)
        {
            if (gameState.armies == null) return;
            var centroid = Vector2.zero;
            for (var i = 0; i < ring.Count; i++) centroid += ring[i];
            centroid /= ring.Count;
            var placed = 0;
            var tint = Color.Lerp(Color.white, ColorFor(owner), 0.28f);
            foreach (var army in gameState.armies)
            {
                if (army == null || army.location != territory.id) continue;
                var view = RepWarsArmyVisual.Create(
                    territoryTransform,
                    centroid + new Vector2(0f, -1.15f - placed * 1.8f),
                    army.troops,
                    tint);
                view.name = "Army_" + army.id;
                placed++;
                Debug.Log("[RepWars] army " + army.id + " at " + territory.id + " troops=" + army.troops
                    + " visible=" + RepWarsArmyVisual.VisibleCount(army.troops));
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

        bool TryRegionLabelPoint(string regionId, out Vector2 point)
        {
            var has = false;
            var min = Vector2.zero;
            var max = Vector2.zero;
            foreach (var territory in world.territories)
            {
                if (territory.regionId != regionId) continue;
                for (var i = 0; i < territory.ring.Count; i++)
                {
                    var projected = MapProjection.Project(territory.ring[i]);
                    if (!has)
                    {
                        min = max = projected;
                        has = true;
                    }
                    else
                    {
                        min = Vector2.Min(min, projected);
                        max = Vector2.Max(max, projected);
                    }
                }
            }
            point = has ? new Vector2((min.x + max.x) * 0.5f, max.y - (max.y - min.y) * 0.16f) : Vector2.zero;
            return has;
        }

        Sprite plainsSprite;

        Sprite PlainsSprite()
        {
            if (plainsSprite == null) plainsSprite = Resources.Load<Sprite>("Terrain/Plains 1");
            return plainsSprite;
        }

        Material PlainsMaterial(Sprite plains)
        {
            var material = TerritoryMaterial(Color.white);
            var texture = plains.texture;
            texture.wrapMode = TextureWrapMode.Repeat;
            material.SetTexture("_MainTex", texture);
            return material;
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
