/**
 * Level-anchor territories: the player's starting foothold in the current
 * world. Not capitals, not homes across every level, not AI land.
 *
 * Hard rule: an AI (or any conquest path) must not take a player-owned
 * anchor while the player still owns any non-anchor territory in this level.
 */
import { FactionId, TerritoryId } from '../types';
import { GameState, LevelDefeatState, emptyLevelDefeatState } from '../types/GameState';
import { WorldDefinition } from '../worldDefinition/types';
import { OrchestrationError, ErrorCode } from '../orchestration/errors';
import { GameEvent } from '../orchestration/protocol';

export const ANCHOR_PROTECTED_REASON = 'anchor_protected';
export const ANCHOR_PROTECTED_MESSAGE =
  'Player anchor territories cannot be conquered while the player still owns other territories in this level';

export interface AnchorWorldView {
  playerFactionId: FactionId | null;
  levelAnchorTerritoryIds: readonly TerritoryId[];
  territories: ReadonlyMap<TerritoryId, { owner: FactionId | null }>;
}

export function startingAnchorTerritoryIds(
  definition: WorldDefinition,
  playerFactionId: FactionId | null,
): TerritoryId[] {
  if (!playerFactionId) return [];
  return definition.territories
    .filter((t) => t.startingOwnerFactionId === playerFactionId)
    .map((t) => t.id)
    .sort();
}

export function currentPlayerOwnedTerritoryIds(view: AnchorWorldView): TerritoryId[] {
  if (!view.playerFactionId) return [];
  const ids: TerritoryId[] = [];
  for (const [id, t] of view.territories) {
    if (t.owner === view.playerFactionId) ids.push(id);
  }
  return ids.sort();
}

export function isPlayerAnchorTerritory(view: AnchorWorldView, territoryId: TerritoryId): boolean {
  return !!view.playerFactionId && view.levelAnchorTerritoryIds.includes(territoryId);
}

export function playerOwnedAnchorTerritoryIds(view: AnchorWorldView): TerritoryId[] {
  if (!view.playerFactionId) return [];
  return view.levelAnchorTerritoryIds
    .filter((id) => view.territories.get(id)?.owner === view.playerFactionId)
    .sort();
}

export function playerOwnedNonAnchorTerritoryIds(view: AnchorWorldView): TerritoryId[] {
  const anchors = new Set(view.levelAnchorTerritoryIds);
  return currentPlayerOwnedTerritoryIds(view).filter((id) => !anchors.has(id));
}

/**
 * True when the target is a player-owned current-level anchor and the
 * player still owns at least one non-anchor territory in this level.
 */
export function isPlayerAnchorProtected(view: AnchorWorldView, targetTerritoryId: TerritoryId): boolean {
  const tile = view.territories.get(targetTerritoryId);
  if (!tile || !view.playerFactionId) return false;
  if (tile.owner !== view.playerFactionId) return false;
  if (!isPlayerAnchorTerritory(view, targetTerritoryId)) return false;
  return playerOwnedNonAnchorTerritoryIds(view).length > 0;
}

export function isPlayerAnchorProtectedOnSnapshot(
  snapshot: {
    territories: ReadonlyMap<TerritoryId, { owner: FactionId | null }>;
    levelAnchorTerritoryIds?: readonly TerritoryId[];
    attackRestrictions?: { playerFactionId: FactionId | null };
    playerFactionId?: FactionId | null;
  },
  targetTerritoryId: TerritoryId,
): boolean {
  return isPlayerAnchorProtected({
    playerFactionId: snapshot.attackRestrictions?.playerFactionId
      ?? snapshot.playerFactionId
      ?? null,
    levelAnchorTerritoryIds: snapshot.levelAnchorTerritoryIds ?? [],
    territories: snapshot.territories,
  }, targetTerritoryId);
}

export function assertAnchorAttackAllowed(state: GameState, targetTerritoryId: TerritoryId): void {
  if (isPlayerAnchorProtected(state, targetTerritoryId)) {
    throw new OrchestrationError(
      ErrorCode.ACTION_NOT_ALLOWED,
      ANCHOR_PROTECTED_MESSAGE,
      { reason: ANCHOR_PROTECTED_REASON, territoryId: targetTerritoryId },
    );
  }
}

export function bindLevelAnchors(state: GameState, definition?: WorldDefinition): void {
  const playerId = state.playerFactionId;
  if (state.levelAnchorTerritoryIds.length === 0) {
    if (definition) {
      state.levelAnchorTerritoryIds = startingAnchorTerritoryIds(definition, playerId);
    } else if (playerId) {
      state.levelAnchorTerritoryIds = currentPlayerOwnedTerritoryIds(state);
    }
  }
  if (!state.levelDefeat) {
    state.levelDefeat = emptyLevelDefeatState();
  }
  if (definition && state.levelDefeat.previousWorldIds.length === 0) {
    state.levelDefeat.previousWorldIds = definition.containedWorlds.map((c) => c.worldId);
  }
}

function cloneDefeat(current: LevelDefeatState): LevelDefeatState {
  return {
    ...current,
    previousWorldIds: [...current.previousWorldIds],
  };
}

/**
 * Call AFTER ownership has already transferred away from the player.
 * Emits at most the became-attackable and level-defeated transitions.
 */
export function applyPlayerTerritoryLoss(state: GameState, lostTerritoryId: TerritoryId): GameEvent[] {
  if (!state.playerFactionId) return [];
  const events: GameEvent[] = [];
  const wasAnchor = isPlayerAnchorTerritory(state, lostTerritoryId);
  const remainingAnchors = playerOwnedAnchorTerritoryIds(state);
  const remainingNonAnchors = playerOwnedNonAnchorTerritoryIds(state);

  if (
    !wasAnchor
    && remainingNonAnchors.length === 0
    && remainingAnchors.length > 0
    && state.levelDefeat.status !== 'defeated'
  ) {
    events.push({
      kind: 'world',
      id: `anchor_exposed_${state.worldTick}_${lostTerritoryId}`,
      title: 'Anchors exposed',
      summary: 'Player non-anchor territories are gone; current-level anchors are now valid final targets',
      territoryId: lostTerritoryId,
      factionId: state.playerFactionId,
      data: {
        anchorProgression: 'became_attackable',
        remainingAnchorTerritoryIds: remainingAnchors,
      },
    });
  }

  if (remainingAnchors.length === 0 && state.levelDefeat.status !== 'defeated') {
    const next = cloneDefeat(state.levelDefeat);
    next.status = 'defeated';
    next.defeatedAtTick = state.worldTick;
    next.defeatedLevel = state.worldLevel;
    next.defeatedWorldId = state.definitionWorldId;
    next.lastLostAnchorTerritoryId = wasAnchor ? lostTerritoryId : next.lastLostAnchorTerritoryId;
    state.levelDefeat = next;
    events.push({
      kind: 'world',
      id: `level_defeated_${state.worldTick}_${lostTerritoryId}`,
      title: 'Level defeated',
      summary: `World level ${state.worldLevel ?? '?'} is defeated; previous-level return is not applied automatically`,
      territoryId: lostTerritoryId,
      factionId: state.playerFactionId,
      data: {
        anchorProgression: 'level_defeated',
        defeatedLevel: state.worldLevel,
        defeatedWorldId: state.definitionWorldId,
        lastLostAnchorTerritoryId: state.levelDefeat.lastLostAnchorTerritoryId,
        previousWorldIds: [...state.levelDefeat.previousWorldIds],
      },
    });
  }
  return events;
}
