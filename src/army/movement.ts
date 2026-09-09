import { BALANCE } from '../constants/balance';
import { Army, ArmyMovement, ArmyMovementStatus, FactionId, Territory, TerritoryId } from '../types';
import { GameState } from '../types/GameState';
import { OrchestrationError, ErrorCode } from '../orchestration/errors';
import { ArmyChange, HandlerResult, StateChange } from '../orchestration/protocol';
import { isAdjacent, requireArmy, requireFactionSnapshot, requireTerritory } from '../orchestration/helpers';

export interface MovementDurationInput {
  origin: Territory;
  destination: Territory;
}

export interface BeginArmyMovementParams {
  armyId: string;
  destinationTerritoryId: TerritoryId;
  factionId: FactionId;
  commitmentId?: string | null;
}

export interface MovementTickResult {
  armyId: string;
  owner: FactionId;
  status: ArmyMovementStatus;
  originTerritoryId: TerritoryId;
  destinationTerritoryId: TerritoryId;
  worldTick: number;
  commitmentId: string | null;
  reason?: string;
}

export function cloneArmyMovement(movement: ArmyMovement | null | undefined): ArmyMovement | null | undefined {
  if (movement == null) return movement;
  return { ...movement };
}

export function isArmyMoving(army: Army): boolean {
  return army.movement?.status === 'moving';
}

export function movementTicksRemaining(movement: ArmyMovement, worldTick: number): number {
  return Math.max(0, movement.startedAtTick + movement.durationTicks - worldTick);
}

/**
 * Deterministic adjacent-hop duration in world ticks.
 * `duration = max(minTicks, adjacentBaseTicks + destinationTerrainTicks[terrain])`
 * Origin is accepted for a stable API; this phase does not add origin-terrain
 * or multi-hop pathing.
 */
export function calculateMovementDuration(input: MovementDurationInput): number {
  const cfg = BALANCE.movement;
  const terrainExtra = cfg.destinationTerrainTicks[input.destination.terrain] ?? 0;
  return Math.max(cfg.minTicks, cfg.adjacentBaseTicks + terrainExtra);
}

export function findMovingArmyForCommitment(state: GameState, commitmentId: string): Army | undefined {
  const armies = [...state.armies.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return armies.find((a) => a.movement?.status === 'moving' && a.movement.commitmentId === commitmentId);
}

export function isMovementCommitmentInFlight(state: GameState, commitmentId: string): boolean {
  return !!findMovingArmyForCommitment(state, commitmentId);
}

/**
 * Shared player/AI domain operation: start a march. Does not wait for arrival
 * and does not change territory ownership.
 */
export function beginArmyMovement(state: GameState, params: BeginArmyMovementParams): HandlerResult {
  const army = requireArmy(state, params.armyId);
  requireFactionSnapshot(state, params.factionId);
  if (army.owner !== params.factionId) {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Army does not belong to acting faction');
  }
  const dest = requireTerritory(state, params.destinationTerritoryId);
  const origin = requireTerritory(state, army.location);
  if (dest.id === army.location) {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Destination must differ from current army location');
  }
  if (!isAdjacent(state, army.location, dest.id)) {
    throw new OrchestrationError(ErrorCode.NOT_ADJACENT, 'Destination must be adjacent to army location');
  }
  if (isArmyMoving(army)) {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Army is already moving');
  }
  if (army.attackIntent && (army.attackIntent.status === 'pending_movement' || army.attackIntent.status === 'ready')) {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Army has a pending strategic attack');
  }

  const durationTicks = calculateMovementDuration({ origin, destination: dest });
  const movement: ArmyMovement = {
    originTerritoryId: origin.id,
    destinationTerritoryId: dest.id,
    startedAtTick: state.worldTick,
    durationTicks,
    status: 'moving',
    commitmentId: params.commitmentId ?? null,
  };
  army.movement = movement;
  const armyChanges: ArmyChange[] = [{
    armyId: army.id,
    field: 'movement',
    from: null,
    to: { ...movement },
  }];
  const stateChanges: StateChange[] = [{
    entity: 'army',
    id: army.id,
    field: 'movement',
    from: army.location,
    to: dest.id,
    summary: `Army ${army.id} began moving ${origin.id} → ${dest.id} (${durationTicks} ticks)`,
  }];
  return {
    stateChanges,
    events: [],
    notifications: [],
    presentation: null,
    resourcesChanged: [],
    territoriesChanged: [],
    armiesChanged: armyChanges,
    newlyAvailableActions: [],
    payload: {
      armyId: army.id,
      from: origin.id,
      to: dest.id,
      durationTicks,
      startedAtTick: movement.startedAtTick,
      arrivalTick: movement.startedAtTick + durationTicks,
      arrivalPending: true,
      movementStatus: 'moving',
    },
  };
}

function interruptArmy(army: Army, worldTick: number, reason: string): MovementTickResult {
  const movement = army.movement!;
  const result: MovementTickResult = {
    armyId: army.id,
    owner: army.owner,
    status: 'interrupted',
    originTerritoryId: movement.originTerritoryId,
    destinationTerritoryId: movement.destinationTerritoryId,
    worldTick,
    commitmentId: movement.commitmentId,
    reason,
  };
  army.movement = null;
  army.attackIntent = null;
  return result;
}

/**
 * Advance all in-flight marches for this worldTick. Deterministic army-id order.
 * Arrival updates `Army.location` and clears `movement`. Does not complete
 * AI commitments — the Continuous World Engine does that from the results.
 */
export function progressArmyMovements(state: GameState, worldTick: number): MovementTickResult[] {
  const results: MovementTickResult[] = [];
  const moving = [...state.armies.values()]
    .filter((a) => isArmyMoving(a))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const army of moving) {
    const movement = army.movement!;
    if (!state.factions.has(army.owner)) {
      results.push(interruptArmy(army, worldTick, 'owning faction no longer exists'));
      continue;
    }
    const origin = state.territories.get(movement.originTerritoryId);
    const dest = state.territories.get(movement.destinationTerritoryId);
    if (!origin || !dest) {
      results.push(interruptArmy(army, worldTick, 'movement origin or destination is no longer a known territory'));
      continue;
    }
    if (army.location !== movement.originTerritoryId) {
      results.push(interruptArmy(army, worldTick, 'army left origin while still marked moving'));
      continue;
    }
    if (!origin.neighboring.includes(dest.id)) {
      results.push(interruptArmy(army, worldTick, 'destination is no longer adjacent to origin'));
      continue;
    }
    if (movementTicksRemaining(movement, worldTick) > 0) {
      continue;
    }
    const from = army.location;
    army.location = dest.id;
    army.movement = null;
    results.push({
      armyId: army.id,
      owner: army.owner,
      status: 'arrived',
      originTerritoryId: from,
      destinationTerritoryId: dest.id,
      worldTick,
      commitmentId: movement.commitmentId,
    });
  }
  return results;
}

export function movementResultsToHandlerBits(results: MovementTickResult[]): {
  stateChanges: StateChange[];
  armiesChanged: ArmyChange[];
} {
  const stateChanges: StateChange[] = [];
  const armiesChanged: ArmyChange[] = [];
  for (const r of results) {
    stateChanges.push({
      entity: 'army',
      id: r.armyId,
      field: r.status === 'arrived' ? 'location' : 'movement',
      from: r.originTerritoryId,
      to: r.destinationTerritoryId,
      summary: r.status === 'arrived'
        ? `Army ${r.armyId} arrived ${r.originTerritoryId} → ${r.destinationTerritoryId}`
        : `Army ${r.armyId} movement ${r.status}: ${r.reason ?? r.status}`,
    });
    armiesChanged.push({
      armyId: r.armyId,
      field: r.status === 'arrived' ? 'location' : 'movement',
      from: r.originTerritoryId,
      to: r.status === 'arrived' ? r.destinationTerritoryId : r.status,
    });
  }
  return { stateChanges, armiesChanged };
}
