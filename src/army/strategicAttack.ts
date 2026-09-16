import { BALANCE } from '../constants/balance';
import { BattleEngine, BattleInput } from '../battle/BattleEngine';
import { Army, FactionId, GameStateSnapshot, RelationshipState, StrategicAttackIntent, TerritoryId } from '../types';
import { GameState } from '../types/GameState';
import { applyBattleResultToGameState, applyUnopposedOccupationToGameState } from '../orchestration/applyBattle';
import { OrchestrationError, ErrorCode, type OrchestrationErrorBody } from '../orchestration/errors';
import { isOpenInvasion } from '../gameplay/invasion/deadlines';
import {
  armiesInTerritory,
  classifyFactionInteraction,
  deriveBattleSeed,
  factionArmies,
  isAdjacent,
  paramNumber,
  pushMemory,
  requireFactionSnapshot,
  requireTerritory,
} from '../orchestration/helpers';
import {
  ArmyChange,
  CommandRequest,
  DEFAULT_PRESENTATION_MS,
  GameEvent,
  HandlerResult,
  StateChange,
} from '../orchestration/protocol';
import { beginArmyMovement, calculateMovementDuration, isArmyMoving } from './movement';
import { withTerritoryCombatView } from '../gameplay/defense/territoryDefense';
import {
  ANCHOR_PROTECTED_MESSAGE,
  ANCHOR_PROTECTED_REASON,
  assertAnchorAttackAllowed,
  isPlayerAnchorProtected,
} from '../gameplay/anchors';

/** Same eligibility floor `executeAttack` / ActionScorer already used. Not combat math. */
export const MIN_ATTACKING_TROOPS = 100;

export interface StrategicAttackHost {
  req: CommandRequest;
  registry: { requireBattle(): BattleEngine };
}

export interface StrategicAttackParams {
  territoryId: TerritoryId;
  factionId: FactionId;
  commitmentId?: string | null;
  /** Restrict the operation to this army (banked troop commitment). */
  onlyArmyId?: string | null;
}

export interface DelayedAttackPlan {
  armyId: string;
  originTerritoryId: TerritoryId;
  stagingTerritoryId: TerritoryId;
  durationTicks: number;
}

export function cloneAttackIntent(
  intent: StrategicAttackIntent | null | undefined,
): StrategicAttackIntent | null | undefined {
  if (intent == null) return intent;
  return { ...intent };
}

export function isActiveAttackIntent(army: Army): boolean {
  const status = army.attackIntent?.status;
  return status === 'pending_movement' || status === 'ready';
}

export function armyHasActiveStrategicOperation(army: Army): boolean {
  return isArmyMoving(army) || isActiveAttackIntent(army);
}

export function findArmyForAttackCommitment(state: GameState, commitmentId: string): Army | undefined {
  const armies = [...state.armies.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return armies.find((a) => a.attackIntent?.commitmentId === commitmentId && isActiveAttackIntent(a));
}

export function isStrategicAttackInFlight(state: GameState, commitmentId: string): boolean {
  return !!findArmyForAttackCommitment(state, commitmentId);
}

/**
 * Legal staging: attacker-owned territory that borders the target and is
 * not the target itself. Armies do not stage on enemy (or unowned) land.
 *
 * Narrowed to `GameStateSnapshot` (AI RUNTIME INTEGRATION PASS): this only
 * ever reads `state.territories`, so `ActionScorer`'s feasibility layer
 * (which only has `ActionContext.gameState: GameStateSnapshot`, not a
 * full `GameState`) can call this exact function instead of a second
 * "is this a legal staging tile" formula. Every existing caller still
 * passes a full `GameState`, which structurally satisfies this type.
 */
export function isLegalStagingTerritory(
  state: GameStateSnapshot,
  attackerId: FactionId,
  stagingId: TerritoryId,
  targetId: TerritoryId,
): boolean {
  if (stagingId === targetId) return false;
  const staging = state.territories.get(stagingId);
  const target = state.territories.get(targetId);
  if (!staging || !target) return false;
  if (staging.owner !== attackerId) return false;
  return staging.neighboring.includes(targetId);
}

export function listLegalStagingTerritoryIds(
  state: GameStateSnapshot,
  attackerId: FactionId,
  targetId: TerritoryId,
): TerritoryId[] {
  const ids: TerritoryId[] = [];
  for (const t of state.territories.values()) {
    if (isLegalStagingTerritory(state, attackerId, t.id, targetId)) ids.push(t.id);
  }
  ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return ids;
}

function isEligibleAttackForce(army: Army): boolean {
  return army.soldiers + army.knights > MIN_ATTACKING_TROOPS;
}

function sortedFactionArmies(state: GameStateSnapshot, factionId: FactionId): Army[] {
  return factionArmies(state, factionId).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Narrowed to `GameStateSnapshot` — see `isLegalStagingTerritory`. This is
 * the exact "immediately attackable" half of attack feasibility that
 * `src/engine/feasibility.ts` exposes to `ActionScorer`.
 */
export function listImmediateAttackingArmies(
  state: GameStateSnapshot,
  attackerId: FactionId,
  targetId: TerritoryId,
): Army[] {
  return sortedFactionArmies(state, attackerId).filter((a) => {
    if (!isEligibleAttackForce(a)) return false;
    if (isArmyMoving(a)) return false;
    if (a.attackIntent && a.attackIntent.status === 'pending_movement') return false;
    return isLegalStagingTerritory(state, attackerId, a.location, targetId);
  });
}

/**
 * One adjacent hop onto a legal staging tile. Prefers shortest duration,
 * then staging id, then army id. Never selects the enemy target.
 *
 * Narrowed to `GameStateSnapshot` — see `isLegalStagingTerritory`. This is
 * the "reachable via one-hop staging" half of attack feasibility that
 * `src/engine/feasibility.ts` exposes to `ActionScorer`, so the scorer
 * and `startStrategicAttack` can never disagree about which one-hop plan
 * (if any) a target has.
 */
export function selectDelayedAttackPlan(
  state: GameStateSnapshot,
  attackerId: FactionId,
  targetId: TerritoryId,
): DelayedAttackPlan | null {
  const stagings = listLegalStagingTerritoryIds(state, attackerId, targetId);
  if (stagings.length === 0) return null;
  const candidates: DelayedAttackPlan[] = [];
  for (const army of sortedFactionArmies(state, attackerId)) {
    if (!isEligibleAttackForce(army)) continue;
    if (armyHasActiveStrategicOperation(army)) continue;
    const origin = state.territories.get(army.location);
    if (!origin) continue;
    for (const stagingId of stagings) {
      if (stagingId === army.location) continue;
      if (!isAdjacent(state, army.location, stagingId)) continue;
      const dest = state.territories.get(stagingId);
      if (!dest) continue;
      candidates.push({
        armyId: army.id,
        originTerritoryId: army.location,
        stagingTerritoryId: stagingId,
        durationTicks: calculateMovementDuration({ origin, destination: dest }),
      });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.durationTicks !== b.durationTicks) return a.durationTicks - b.durationTicks;
    if (a.stagingTerritoryId !== b.stagingTerritoryId) {
      return a.stagingTerritoryId < b.stagingTerritoryId ? -1 : 1;
    }
    return a.armyId < b.armyId ? -1 : a.armyId > b.armyId ? 1 : 0;
  });
  return candidates[0]!;
}

function emptyResult(): HandlerResult {
  return {
    stateChanges: [],
    events: [],
    notifications: [],
    presentation: null,
    resourcesChanged: [],
    territoriesChanged: [],
    armiesChanged: [],
    newlyAvailableActions: [],
    payload: {},
  };
}

export function clearAttackIntent(army: Army): void {
  army.attackIntent = null;
}

export interface StaleAttackInvalidation {
  armyId: string;
  owner: FactionId;
  commitmentId: string | null;
  reason: string;
}

/**
 * Fail-closed cleanup for intents that cannot legally continue against
 * CURRENT GameState (missing target, friendly/unowned target, illegal
 * staging). Stationary armies stay put; moving armies remain at origin.
 * ContinuousWorldEngine calls this before progressing marches so a
 * same-tick event deletion cannot leave dangling attackIntent at commit.
 */
export function invalidateStaleAttackIntents(state: GameState): StaleAttackInvalidation[] {
  const out: StaleAttackInvalidation[] = [];
  const armies = [...state.armies.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const army of armies) {
    if (!isActiveAttackIntent(army)) continue;
    const intent = army.attackIntent!;
    const target = state.territories.get(intent.targetTerritoryId);
    let reason: string | null = null;
    if (!target) {
      reason = 'attack target is no longer a known territory';
    } else if (!target.owner || target.owner === army.owner) {
      reason = 'attack target is no longer a foreign-owned territory';
    } else if (isPlayerAnchorProtected(state, intent.targetTerritoryId)) {
      reason = 'player anchor is protected while the player still owns other territories';
    } else if (!isLegalStagingTerritory(state, army.owner, intent.stagingTerritoryId, intent.targetTerritoryId)) {
      reason = 'staging territory is no longer a legal attack position';
    }
    if (!reason) continue;
    out.push({
      armyId: army.id,
      owner: army.owner,
      commitmentId: intent.commitmentId,
      reason,
    });
    clearAttackIntent(army);
    if (isArmyMoving(army)) {
      army.movement = null;
    }
  }
  return out;
}

function clearAttackIntentsForTarget(state: GameState, targetId: TerritoryId, factionId: FactionId): void {
  for (const army of state.armies.values()) {
    if (army.owner === factionId && army.attackIntent?.targetTerritoryId === targetId) {
      clearAttackIntent(army);
    }
  }
}

function resolveStrategicBattle(
  state: GameState,
  host: StrategicAttackHost,
  targetId: TerritoryId,
  attackerId: FactionId,
  attackingArmies: Army[],
  plannedBattleSeed?: number,
): HandlerResult {
  const target = requireTerritory(state, targetId);
  if (!target.owner || target.owner === attackerId) {
    throw new OrchestrationError(ErrorCode.INVALID_TARGET, 'Attack target must be a foreign-owned territory');
  }
  assertAnchorAttackAllowed(state, target.id);
  const defenderId = target.owner;
  const attackerSnap = requireFactionSnapshot(state, attackerId);
  const defenderSnap = requireFactionSnapshot(state, defenderId);
  const defendingArmies = armiesInTerritory(state, target.id).filter((a) => a.owner === defenderId);
  const defenderField = defendingArmies.reduce((sum, army) => sum + army.soldiers + army.knights, 0);
  const battleSeed = plannedBattleSeed
    ?? paramNumber(host.req, 'seed')
    ?? deriveBattleSeed(state.worldSeed, state.turn, attackerId, defenderId, target.id);

  pushMemory(attackerSnap, state.turn, 'attack_made', defenderId, target.id, 8, { target: target.id });
  pushMemory(defenderSnap, state.turn, 'attack_received', attackerId, target.id, 10, { attacker: attackerSnap.name });
  const rel = defenderSnap.diplomacy.get(attackerId);
  if (rel) {
    rel.opinion = Math.max(-100, rel.opinion + BALANCE.diplomacy.opinionAttackImpact);
    rel.state = (rel.state === 'allied' ? 'at_war' : rel.state === 'friendly' ? 'hostile' : rel.state === 'neutral' ? 'tense' : 'at_war') as RelationshipState;
  }
  const myRel = attackerSnap.diplomacy.get(defenderId);
  if (myRel) {
    myRel.opinion = Math.max(-100, myRel.opinion - 10);
    if (myRel.state !== 'at_war' && myRel.state !== 'hostile') myRel.state = 'tense';
  }

  if (defenderField + target.garrison <= 0) {
    const applied = applyUnopposedOccupationToGameState(state, target, attackerId, attackingArmies, state.turn);
    for (const a of attackingArmies) {
      const live = state.armies.get(a.id);
      if (live) {
        live.movement = null;
        clearAttackIntent(live);
      }
    }
    clearAttackIntentsForTarget(state, target.id, attackerId);
    const remainingSoldiers = attackingArmies.reduce((sum, army) => sum + army.soldiers, 0);
    const remainingKnights = attackingArmies.reduce((sum, army) => sum + army.knights, 0);
    const remainingSiege = attackingArmies.reduce((sum, army) => sum + army.siegeEngines, 0);
    const remainingTroops = remainingSoldiers + remainingKnights;
    return {
      ...emptyResult(),
      stateChanges: applied.stateChanges,
      territoriesChanged: applied.territoryChanges,
      armiesChanged: applied.armyChanges,
      events: [
        {
          kind: 'battle',
          id: `unopposed_${state.turn}_${target.id}`,
          title: 'Unopposed occupation',
          summary: `${attackerId} occupies undefended ${target.id}`,
          territoryId: target.id,
          factionId: attackerId,
          data: { winner: 'attacker', territoryOutcome: 'captured', seed: battleSeed, unopposed: true },
        },
        ...applied.events,
      ],
      presentation: {
        type: 'battle_report',
        durationMs: DEFAULT_PRESENTATION_MS,
        title: `Occupation of ${target.id}`,
        summary: `${attackerSnap.name} occupies undefended ${target.id} with no battle.`,
      },
      payload: {
        attackOutcome: 'battle_resolved',
        battleResult: {
          battleId: `unopposed_${state.turn}_${target.id}`,
          territoryId: target.id,
          winner: 'attacker',
          loser: 'defender',
          outcomeType: 'attacker_decisive_victory',
          territoryOutcome: 'captured',
          attacker: {
            remainingTroops,
            remaining: { soldiers: remainingSoldiers, knights: remainingKnights, siegeEngines: remainingSiege },
            casualties: { total: 0 },
          },
          defender: {
            remainingTroops: 0,
            remaining: { soldiers: 0, knights: 0, siegeEngines: 0, garrison: 0 },
            casualties: { total: 0 },
          },
        },
        battleSeed,
        unopposed: true,
        interactionKind: classifyFactionInteraction(state.playerFactionId, attackerId, defenderId),
      },
    };
  }

  const input: BattleInput = {
    turn: state.turn,
    seed: battleSeed,
    attackerFactionId: attackerId,
    attackerFactionName: attackerSnap.name,
    defenderFactionId: defenderId,
    defenderFactionName: defenderSnap.name,
    attackerArmies: attackingArmies,
    defenderArmies: defendingArmies,
    defenderGarrison: target.garrison,
    territory: withTerritoryCombatView(state, target),
  };
  const battle = host.registry.requireBattle();
  const validation = battle.validate(input);
  if (!validation.valid) {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, validation.errors.join('; '), { errors: validation.errors });
  }
  const result = battle.resolve(input);
  const applied = applyBattleResultToGameState(state, result, attackingArmies, defendingArmies, state.turn);
  for (const a of attackingArmies) {
    const live = state.armies.get(a.id);
    if (live) {
      live.movement = null;
      clearAttackIntent(live);
    }
  }
  clearAttackIntentsForTarget(state, target.id, attackerId);
  const events: GameEvent[] = [{
    kind: 'battle',
    id: `battle_${state.turn}_${target.id}`,
    title: result.outcomeType,
    summary: battle.formatResult(result, false).split('\n')[2] ?? result.outcomeType,
    territoryId: target.id,
    factionId: attackerId,
    data: { winner: result.winner, territoryOutcome: result.territoryOutcome, seed: battleSeed },
  }, ...applied.events];
  return {
    ...emptyResult(),
    stateChanges: applied.stateChanges,
    territoriesChanged: applied.territoryChanges,
    armiesChanged: applied.armyChanges,
    events,
    presentation: {
      type: 'battle_report',
      durationMs: DEFAULT_PRESENTATION_MS,
      title: `Battle at ${target.id}`,
      summary: result.summary,
    },
    payload: {
      attackOutcome: 'battle_resolved',
      battleResult: result,
      battleSeed,
      interactionKind: classifyFactionInteraction(state.playerFactionId, attackerId, defenderId),
    },
  };
}

/**
 * Shared player/AI operation: immediate BattleEngine resolve, or one-hop
 * march onto a legal staging tile with canonical `Army.attackIntent`.
 */
export function startStrategicAttack(
  state: GameState,
  host: StrategicAttackHost,
  params: StrategicAttackParams,
): HandlerResult {
  const attackerId = params.factionId;
  requireFactionSnapshot(state, attackerId);
  const target = requireTerritory(state, params.territoryId);
  if (!target.owner || target.owner === attackerId) {
    throw new OrchestrationError(ErrorCode.INVALID_TARGET, 'Attack target must be a foreign-owned territory');
  }
  assertAnchorAttackAllowed(state, target.id);
  const commitmentId = params.commitmentId ?? null;

  if (commitmentId && isStrategicAttackInFlight(state, commitmentId)) {
    const marching = findArmyForAttackCommitment(state, commitmentId)!;
    const intent = marching.attackIntent!;
    return {
      ...emptyResult(),
      payload: {
        attackOutcome: 'movement_started_for_attack',
        arrivalPending: true,
        armyId: marching.id,
        from: marching.location,
        to: intent.stagingTerritoryId,
        targetTerritoryId: intent.targetTerritoryId,
        stagingTerritoryId: intent.stagingTerritoryId,
        movementStatus: marching.movement?.status ?? 'moving',
        durationTicks: marching.movement?.durationTicks,
      },
    };
  }

  const alreadyPending = sortedFactionArmies(state, attackerId).find((a) => (
    isActiveAttackIntent(a) && a.attackIntent!.targetTerritoryId === target.id
  ));
  if (alreadyPending) {
    throw new OrchestrationError(
      ErrorCode.ACTION_NOT_ALLOWED,
      'A pending strategic attack on this target is already in progress',
    );
  }

  const immediate = listImmediateAttackingArmies(state, attackerId, target.id)
    .filter((a) => !params.onlyArmyId || a.id === params.onlyArmyId);
  if (immediate.length > 0) {
    return resolveStrategicBattle(state, host, target.id, attackerId, immediate);
  }

  const delayed = selectDelayedAttackPlan(state, attackerId, target.id);
  const delayedArmyOk = delayed && (!params.onlyArmyId || delayed.armyId === params.onlyArmyId);
  if (!delayedArmyOk) {
    const busyOnStaging = sortedFactionArmies(state, attackerId).some((a) => (
      isEligibleAttackForce(a)
      && isLegalStagingTerritory(state, attackerId, a.location, target.id)
      && armyHasActiveStrategicOperation(a)
    ));
    if (busyOnStaging) {
      throw new OrchestrationError(
        ErrorCode.ACTION_NOT_ALLOWED,
        'An army cannot ATTACK until it has arrived',
      );
    }
    throw new OrchestrationError(
      ErrorCode.INSUFFICIENT_TROOPS,
      'No legal immediate or one-hop staging position for this attack',
    );
  }

  const army = state.armies.get(delayed.armyId)!;
  const moved = beginArmyMovement(state, {
    armyId: delayed.armyId,
    destinationTerritoryId: delayed.stagingTerritoryId,
    factionId: attackerId,
    commitmentId,
  });
  const defenderId = target.owner;
  const battleSeed = paramNumber(host.req, 'seed')
    ?? deriveBattleSeed(state.worldSeed, state.turn, attackerId, defenderId, target.id);
  const intent: StrategicAttackIntent = {
    targetTerritoryId: target.id,
    stagingTerritoryId: delayed.stagingTerritoryId,
    createdAtTick: state.worldTick,
    status: 'pending_movement',
    commitmentId,
    battleSeed,
    onlyArmyId: params.onlyArmyId ?? delayed.armyId,
  };
  army.attackIntent = intent;
  const armyChanges: ArmyChange[] = [
    ...moved.armiesChanged,
    { armyId: army.id, field: 'attackIntent', from: null, to: { ...intent } },
  ];
  const stateChanges: StateChange[] = [
    ...moved.stateChanges,
    {
      entity: 'army',
      id: army.id,
      field: 'attackIntent',
      from: null,
      to: target.id,
      summary: `Army ${army.id} staging via ${delayed.stagingTerritoryId} to attack ${target.id}`,
    },
  ];
  return {
    ...emptyResult(),
    stateChanges,
    armiesChanged: armyChanges,
    payload: {
      ...moved.payload,
      attackOutcome: 'movement_started_for_attack',
      arrivalPending: true,
      targetTerritoryId: target.id,
      stagingTerritoryId: delayed.stagingTerritoryId,
      armyId: army.id,
    },
  };
}

function failedReadyAttack(
  message: string,
  code: ErrorCode,
  details?: Record<string, unknown>,
): HandlerResult {
  const errors: OrchestrationErrorBody[] = [{ code, message, details }];
  return {
    ...emptyResult(),
    commandSuccess: false,
    errors,
    payload: {
      attackOutcome: 'failed',
      arrivalPending: false,
    },
  };
}

/**
 * Called after a march arrives. Re-validates CURRENT GameState, then uses
 * the same BattleEngine path as an immediate attack. Does not throw:
 * stale plans fail closed so a world tick can continue.
 */
export function executeReadyStrategicAttack(
  state: GameState,
  host: StrategicAttackHost,
  armyId: string,
): HandlerResult {
  const army = state.armies.get(armyId);
  if (!army || !isActiveAttackIntent(army)) {
    return { ...emptyResult(), payload: { attackOutcome: 'skipped', skipped: true } };
  }
  const intent = army.attackIntent!;
  intent.status = 'ready';
  const fail = (code: ErrorCode, message: string, details?: Record<string, unknown>): HandlerResult => {
    clearAttackIntent(army);
    army.movement = null;
    return failedReadyAttack(message, code, details);
  };
  if (intent.holdForInvasionId) {
    const invasion = state.activeInvasions.get(intent.holdForInvasionId);
    if (invasion && isOpenInvasion(invasion)) {
      return { ...emptyResult(), payload: { attackOutcome: 'awaiting_defense', skipped: true, invasionId: invasion.id, arrivalPending: true } };
    }
  }
  if (isArmyMoving(army)) {
    return fail(ErrorCode.ACTION_NOT_ALLOWED, 'Pending attack cannot resolve while the army is still moving');
  }
  if (army.location !== intent.stagingTerritoryId) {
    return fail(ErrorCode.ACTION_NOT_ALLOWED, 'Army did not arrive at its attack staging territory');
  }
  const target = state.territories.get(intent.targetTerritoryId);
  if (!target) {
    return fail(ErrorCode.INVALID_TERRITORY, 'Attack target is no longer a known territory');
  }
  if (!target.owner || target.owner === army.owner) {
    return fail(ErrorCode.INVALID_TARGET, 'Attack target is no longer a foreign-owned territory');
  }
  if (!state.factions.has(army.owner)) {
    return fail(ErrorCode.INVALID_FACTION, 'Attacking faction no longer exists');
  }
  if (isPlayerAnchorProtected(state, intent.targetTerritoryId)) {
    return fail(ErrorCode.ACTION_NOT_ALLOWED, ANCHOR_PROTECTED_MESSAGE, {
      reason: ANCHOR_PROTECTED_REASON,
      territoryId: intent.targetTerritoryId,
    });
  }
  if (!isLegalStagingTerritory(state, army.owner, intent.stagingTerritoryId, intent.targetTerritoryId)) {
    return fail(ErrorCode.ACTION_NOT_ALLOWED, 'Staging territory is no longer a legal attack position');
  }
  if (!isEligibleAttackForce(army)) {
    return fail(ErrorCode.INSUFFICIENT_TROOPS, 'Arrived army is no longer an eligible attacking force');
  }
  try {
    const attackers = listImmediateAttackingArmies(state, army.owner, intent.targetTerritoryId);
    const restricted = intent.onlyArmyId
      ? (attackers.some((a) => a.id === intent.onlyArmyId) ? attackers.filter((a) => a.id === intent.onlyArmyId) : [army])
      : (attackers.some((a) => a.id === army.id) ? attackers : [army, ...attackers]);
    return resolveStrategicBattle(state, host, intent.targetTerritoryId, army.owner, restricted, intent.battleSeed);
  } catch (err) {
    clearAttackIntent(army);
    if (err instanceof OrchestrationError) {
      return failedReadyAttack(err.message, err.code, err.details);
    }
    throw err;
  }
}
