using System.Collections.Generic;
using UnityEngine;

namespace RepWars
{
    /// <summary>
    /// Places one RepWarsArmyVisual per backend army under the territory it stands in.
    /// Troops, owner, and location come from the live snapshot. This class holds no army state.
    /// Soldier sorting and the troop-count overlay stay inside RepWarsArmyVisual.
    /// </summary>
    public static class RepWarsArmyPresenter
    {
        static readonly Color[] OwnerPalette =
        {
            new Color32(0xd9, 0x60, 0x60, 255),
            new Color32(0x5a, 0xa4, 0x6a, 255),
            new Color32(0x5a, 0x84, 0xc8, 255),
            new Color32(0xc8, 0xa0, 0x4a, 255),
        };

        static readonly Color Unowned = new Color32(0x6d, 0x7a, 0x55, 255);

        public static void Build(
            IList<RepWarsTerritoryPresenter.Piece> pieces,
            PublicGameState state,
            AuthoredWorld world,
            IDictionary<string, string> ownersByTerritory)
        {
            if (state == null || state.armies == null) return;
            for (var p = 0; p < pieces.Count; p++)
            {
                var piece = pieces[p];
                var territory = piece.Territory;
                var centroid = Vector2.zero;
                for (var i = 0; i < piece.Ring.Count; i++) centroid += piece.Ring[i];
                centroid /= piece.Ring.Count;
                var owner = ownersByTerritory.TryGetValue(territory.id, out var id) ? id : null;
                var tint = Color.Lerp(Color.white, ColorFor(owner, world, state), 0.28f);
                var placed = 0;
                foreach (var army in state.armies)
                {
                    if (army == null || army.location != territory.id) continue;
                    var view = RepWarsArmyVisual.Create(
                        piece.Transform,
                        centroid + new Vector2(0f, -1.15f - placed * 1.8f),
                        army.troops,
                        tint);
                    view.name = "Army_" + army.id;
                    placed++;
                    Debug.Log("[RepWars] army " + army.id + " at " + territory.id + " troops=" + army.troops
                        + " visible=" + RepWarsArmyVisual.VisibleCount(army.troops));
                }
            }
        }

        static Color ColorFor(string factionId, AuthoredWorld world, PublicGameState state)
        {
            if (string.IsNullOrEmpty(factionId)) return Unowned;
            var index = world.factionIds.IndexOf(factionId);
            if (index < 0) index = factionId == state.playerFactionId ? 0 : 1;
            return OwnerPalette[index % OwnerPalette.Length];
        }
    }
}
