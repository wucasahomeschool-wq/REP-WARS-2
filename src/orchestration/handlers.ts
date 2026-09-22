import { BALANCE } from '../constants/balance';
import { Army } from '../types';
import {
  buildWarlordStates,
  rebindWarlordRuntime,
  syncCommitmentsFromWarlordStates,
  toDecisionEngineSnapshot,
} from '../state/gameStateAdapters';
import { cloneGameState } from '../state/cloneGameState';
import { GameState } from '../types/GameState';
import { startConstruction } from '../gameplay/construction/consume';
import { handlerResultForConstructionStart } from '../gameplay/construction/handlerResult';
import { cloneResources } from '../gameplay/economy/config';
import { progressWorldEconomy } from '../gameplay/economy/worldProgress';
import { WarlordState, isActiveCommitmentStatus, validateCommitmentTarget } from '../engine/DecisionEngine';
import { isUnsupportedCommitmentAction } from '../engine/executableActions';
import { ANCHOR_PROTECTED_REASON } from '../gameplay/anchors';
import {
  applyWorldTransition,
  worldTransitionedEvent,
} from '../gameplay/worldTransition';
import {
  assertLevel1TutorialPlayerAttackAllowed,
  isLevel1TutorialAiSuppressed,
  syncLevel1Tutorial,
} from '../gameplay/tutorial/level1';
import { COMMAND_INDEX, commandIndexSummary } from './commandIndex';
import { EngineRegistry } from './engineRegistry';
import { OrchestrationError, ErrorCode } from './errors';
import type { OrchestrationErrorBody } from './errors';
import { applyCommitmentOutcomeFeedback } from '../engine/outcomeFeedback';
import {
  armiesInTerritory,
  factionArmies,
  isAdjacent,
  paramNumber,
  paramString,
  pushMemory,
  recordResourceChange,
  requireFactionSnapshot,
  requireString,
  requireTerritory,
  resolveActingFactionId,
  withRequestParameters,
} from './helpers';
import {
  CommandDefinition,
  CommandRequest,
  HandlerResult,
  ResourceChange,
  StateChange,
  TerritoryChange,
} from './protocol';
import { serializePublicGameState, serializeVisibleWorld } from './publicView';
import { resolveViewerFactionId } from './authorization';
import { formatWorldLoadFailure, isLegacyDefinitionWorldId, resolveWorldDefinition } from '../worldDefinition/catalog';
import { serializeWorldDefinitionForClient } from '../worldDefinition/clientView';
import { listExerciseDefinitions, listWorkoutDefinitions } from '../fitness/catalog';
import { listPurposeWorkoutSelections } from '../fitness/selection';
import { getAuthoredWorkoutCatalog, listAuthoredWorkoutDefinitions } from '../fitness/authoring/registry';
import { WORKOUT_PURPOSES } from '../fitness/types';
import { ContinuousWorldEngine, WorldAdvanceResult, WorldSimulationHost } from '../world/ContinuousWorldEngine';
import { parseElapsedTicks } from '../world/worldTime';
import { runEventEngineTurn } from '../world/eventTick';
import {
  beginArmyMovement,
  findMovingArmyForCommitment,
  isArmyMoving,
  isMovementCommitmentInFlight,
} from '../army/movement';
import {
  executeReadyStrategicAttack,
  listImmediateAttackingArmies,
  startStrategicAttack,
} from '../army/strategicAttack';
import { commitBankedTroopsAndAttack } from '../gameplay/attacks/commitBankedTroops';
import { maybeHoldAttackAsInvasion } from '../gameplay/invasion/create';
import { progressExpiredInvasions } from '../gameplay/invasion/progress';
import {
  handleAbandonWorkout,
  handleApplyConstructionAcceleration,
  handleCollectResources,
  handleFinalizeWorkout,
  handleGetWorkoutSelection,
  handlePauseWorkout,
  handleRecordExercise,
  handleRecordIntegrityFlag,
  handleResumeWorkout,
  handleSetPlayerPause,
  handleSkipRest,
  handleStartConstruction,
  handleStartWorkout,
  handleSubmitWorkoutFeedback,
} from './gameplayCommands';

export interface OrchestratorRuntime {
  aiWarlordStates: Map<string, WarlordState>;
}

export interface HandlerContext {
  req: CommandRequest;
  def: CommandDefinition;
  registry: EngineRegistry;
  runtime: OrchestratorRuntime;
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

export function handleGetCommandIndex(_state: GameState, _ctx: HandlerContext): HandlerResult {
  return {
    ...emptyResult(),
    payload: { summary: commandIndexSummary(), commands: COMMAND_INDEX },
  };
}

export function handleGetGameState(state: GameState, ctx: HandlerContext): HandlerResult {
  const viewer = resolveViewerFactionId(state, ctx.req);
  const snapshot = serializePublicGameState(cloneGameState(state), viewer);
  return { ...emptyResult(), payload: { gameState: snapshot } };
}

export function handleGetVisibleWorld(state: GameState, ctx: HandlerContext): HandlerResult {
  const viewer = resolveViewerFactionId(state, ctx.req);
  if (!viewer || !state.factions.has(viewer)) {
    throw new OrchestrationError(ErrorCode.INVALID_FACTION, 'Viewer faction required for GET_VISIBLE_WORLD');
  }
  return {
    ...emptyResult(),
    payload: { visibleWorld: serializeVisibleWorld(cloneGameState(state), viewer) },
  };
}

export function handleGetWorldDefinition(state: GameState, _ctx: HandlerContext): HandlerResult {
  const worldId = state.definitionWorldId;
  if (!worldId || isLegacyDefinitionWorldId(worldId)) {
    throw new OrchestrationError(ErrorCode.INVALID_GAME_STATE, 'No authored WorldDefinition for this instance');
  }
  const loaded = resolveWorldDefinition(worldId);
  if (!loaded.ok) {
    throw new OrchestrationError(ErrorCode.INVALID_GAME_STATE, formatWorldLoadFailure(worldId, loaded));
  }
  return {
    ...emptyResult(),
    payload: { worldDefinition: serializeWorldDefinitionForClient(loaded.definition) },
  };
}

export function handleTransitionToNextWorld(state: GameState, ctx: HandlerContext): HandlerResult {
  const outcome = applyWorldTransition(state);
  if (outcome.status === 'already_completed') {
    return {
      ...emptyResult(),
      payload: {
        alreadyCompleted: true,
        definitionWorldId: outcome.worldId,
        worldLevel: outcome.worldLevel,
      },
    };
  }
  return {
    ...emptyResult(),
    stateChanges: [{
      entity: 'world',
      id: outcome.toWorldId,
      field: 'definitionWorldId',
      from: outcome.fromWorldId,
      to: outcome.toWorldId,
      summary: `Transitioned from ${outcome.fromWorldId} to ${outcome.toWorldId}`,
    }],
    events: [
      worldTransitionedEvent(
        state,
        outcome.fromWorldId,
        outcome.fromWorldLevel,
        outcome.toWorldId,
        outcome.toWorldLevel,
        ctx.req.playerId,
      ),
    ],
    payload: {
      alreadyCompleted: false,
      fromWorldId: outcome.fromWorldId,
      fromWorldLevel: outcome.fromWorldLevel,
      toWorldId: outcome.toWorldId,
      toWorldLevel: outcome.toWorldLevel,
      definitionWorldId: state.definitionWorldId,
      worldLevel: state.worldLevel,
    },
  };
}

export function handleGetFitnessCatalog(_state: GameState, _ctx: HandlerContext): HandlerResult {
  const authored = getAuthoredWorkoutCatalog();
  return {
    ...emptyResult(),
    payload: {
      workouts: listWorkoutDefinitions(),
      exercises: listExerciseDefinitions(),
      purposes: [...WORKOUT_PURPOSES],
      purposeSelections: listPurposeWorkoutSelections(),
      authoredCatalog: authored
        ? {
          catalogId: authored.catalogId,
          catalogVersion: authored.catalogVersion,
          engineVersion: authored.engineVersion,
          workoutIds: Object.keys(authored.workouts),
          workouts: listAuthoredWorkoutDefinitions(),
        }
        : null,
    },
  };
}

/** Shared domain operation: player ATTACK and AI RESOLVE_COMMITMENT(ATTACK) both call this. */
export function executeAttack(state: GameState, ctx: HandlerContext, territoryId: string, factionId?: string): HandlerResult {
  const attackerId = factionId ?? resolveActingFactionId(state, ctx.req);
  const commitment = state.commitments.get(attackerId);
  const commitmentId = paramString(ctx.req, 'commitmentId')
    ?? (commitment && commitment.action === 'ATTACK' ? commitment.id : null);
  requireTerritory(state, territoryId);
  const commitAmount = paramNumber(ctx.req, 'commitAmount');
  assertLevel1TutorialPlayerAttackAllowed(state, attackerId, territoryId, commitAmount);

  if (state.playerFactionId && attackerId === state.playerFactionId) {
    if (commitAmount !== undefined) {
      return commitBankedTroopsAndAttack(state, ctx, {
        factionId: attackerId,
        territoryId,
        commitAmount,
        playerFactionId: state.playerFactionId,
      });
    }
  }

  const immediate = listImmediateAttackingArmies(state, attackerId, territoryId);
  const held = maybeHoldAttackAsInvasion(state, {
    attackerId,
    territoryId,
    armies: immediate,
    commitmentId,
    battleSeed: paramNumber(ctx.req, 'seed'),
  });
  if (held) return held;

  return startStrategicAttack(state, ctx, {
    territoryId,
    factionId: attackerId,
    commitmentId,
  });
}

export function executePendingStrategicAttack(state: GameState, ctx: HandlerContext, armyId: string): HandlerResult {
  const army = state.armies.get(armyId);
  const intent = army?.attackIntent;
  const factionId = army?.owner;
  const commitmentId = intent?.commitmentId ?? null;
  let inner: HandlerResult;
  if (army && intent && !isArmyMoving(army)) {
    try {
      const held = maybeHoldAttackAsInvasion(state, {
        attackerId: army.owner,
        territoryId: intent.targetTerritoryId,
        armies: [army],
        commitmentId: intent.commitmentId,
        battleSeed: intent.battleSeed,
      });
      if (held) {
        inner = held;
        return wrapPendingAttackCommitment(state, ctx, factionId, commitmentId, inner);
      }
    } catch (err) {
      if (err instanceof OrchestrationError) {
        inner = {
          ...emptyResult(),
          commandSuccess: false,
          errors: [err.toBody()],
          payload: { attackOutcome: 'failed', arrivalPending: false },
        };
        return wrapPendingAttackCommitment(state, ctx, factionId, commitmentId, inner);
      }
      throw err;
    }
  }
  inner = executeReadyStrategicAttack(state, ctx, armyId);
  return wrapPendingAttackCommitment(state, ctx, factionId, commitmentId, inner);
}

function wrapPendingAttackCommitment(
  state: GameState,
  ctx: HandlerContext,
  factionId: string | undefined,
  commitmentId: string | null,
  inner: HandlerResult,
): HandlerResult {
  if (!factionId || !commitmentId) return inner;
  const current = state.commitments.get(factionId);
  if (!current || current.id !== commitmentId || !isActiveCommitmentStatus(current.status)) return inner;
  if (inner.payload.attackOutcome === 'battle_resolved') {
    const term = applyCommitmentTerminal(state, ctx, factionId, 'completed', 'delayed attack resolved by BattleEngine');
    inner.stateChanges.push(...term.stateChanges);
    inner.payload = { ...inner.payload, ...term.payload };
    return inner;
  }
  if (inner.payload.attackOutcome === 'invasion_created' || inner.payload.attackOutcome === 'awaiting_defense') {
    inner.payload = { ...inner.payload, arrivalPending: true };
    return inner;
  }
  if (inner.commandSuccess === false || inner.payload.attackOutcome === 'failed') {
    const term = applyCommitmentTerminal(state, ctx, factionId, 'failed', String(inner.payload.attackOutcome ?? 'pending attack failed'));
    inner.stateChanges.push(...term.stateChanges);
    inner.payload = { ...inner.payload, ...term.payload, commitmentOutcome: 'failed' };
    return inner;
  }
  return inner;
}

export function handleAttack(state: GameState, ctx: HandlerContext): HandlerResult {
  const territoryId = requireString(ctx.req, 'territoryId');
  return executeAttack(state, ctx, territoryId);
}

export function handleMove(state: GameState, ctx: HandlerContext): HandlerResult {
  const factionId = resolveActingFactionId(state, ctx.req);
  const armyId = requireString(ctx.req, 'armyId');
  const destId = requireString(ctx.req, 'destinationTerritoryId');
  const commitmentId = paramString(ctx.req, 'commitmentId') ?? null;
  return beginArmyMovement(state, {
    armyId,
    destinationTerritoryId: destId,
    factionId,
    commitmentId,
  });
}

export function handleBuild(state: GameState, ctx: HandlerContext): HandlerResult {
  const factionId = resolveActingFactionId(state, ctx.req);
  const territoryId = requireString(ctx.req, 'territoryId');
  const faction = requireFactionSnapshot(state, factionId);
  const resourcesBefore = cloneResources(faction.resources);
  const project = startConstruction(state, {
    factionId,
    territoryId,
    projectType: 'FORTIFICATION',
  });
  return handlerResultForConstructionStart(
    project,
    territoryId,
    resourcesBefore,
    cloneResources(faction.resources),
    factionId,
  );
}

export function handleReinforce(state: GameState, ctx: HandlerContext): HandlerResult {
  const factionId = resolveActingFactionId(state, ctx.req);
  const territoryId = requireString(ctx.req, 'territoryId');
  const t = requireTerritory(state, territoryId);
  if (t.owner !== factionId) {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Can only reinforce owned territory');
  }
  const faction = requireFactionSnapshot(state, factionId);
  const { gold: costG, food: costF, garrisonGain } = BALANCE.economy.reinforcementCost;
  if (faction.resources.gold < costG || faction.resources.food < costF) {
    throw new OrchestrationError(ErrorCode.INSUFFICIENT_RESOURCES, `Need ${costG} gold and ${costF} food to reinforce`);
  }
  const resourcesChanged: ResourceChange[] = [];
  const goldFrom = faction.resources.gold;
  const foodFrom = faction.resources.food;
  faction.resources.gold -= costG;
  faction.resources.food -= costF;
  recordResourceChange(resourcesChanged, factionId, 'gold', goldFrom, faction.resources.gold);
  recordResourceChange(resourcesChanged, factionId, 'food', foodFrom, faction.resources.food);
  const garFrom = t.garrison;
  t.garrison += garrisonGain;
  return {
    ...emptyResult(),
    stateChanges: [{
      entity: 'territory',
      id: territoryId,
      field: 'garrison',
      from: garFrom,
      to: t.garrison,
      summary: `${territoryId} garrison ${garFrom} → ${t.garrison}`,
    }],
    resourcesChanged,
    territoriesChanged: [{ territoryId, field: 'garrison', from: garFrom, to: t.garrison }],
    payload: { territoryId, garrison: t.garrison },
  };
}

function inFlightMovementResult(army: Army): HandlerResult {
  const movement = army.movement!;
  return {
    ...emptyResult(),
    payload: {
      armyId: army.id,
      from: movement.originTerritoryId,
      to: movement.destinationTerritoryId,
      arrivalPending: true,
      movementStatus: 'moving',
      durationTicks: movement.durationTicks,
    },
  };
}

function executeMoveCommitment(state: GameState, ctx: HandlerContext, destId: string, factionId: string): HandlerResult {
  const commitment = state.commitments.get(factionId);
  if (commitment && isMovementCommitmentInFlight(state, commitment.id)) {
    return inFlightMovementResult(findMovingArmyForCommitment(state, commitment.id)!);
  }
  requireTerritory(state, destId);
  const candidates = factionArmies(state, factionId)
    .filter((a) => !isArmyMoving(a) && isAdjacent(state, a.location, destId))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (candidates.length === 0) {
    throw new OrchestrationError(ErrorCode.NOT_ADJACENT, 'No stationary army owned by this faction is adjacent to the destination');
  }
  ctx.req.parameters = {
    ...ctx.req.parameters,
    armyId: candidates[0]!.id,
    destinationTerritoryId: destId,
    factionId,
    commitmentId: commitment?.id ?? null,
  };
  return handleMove(state, ctx);
}

/** Strategic repositioning off non-owned ground. Uses handleMove. Not BattleEngine retreat. */
function executeStrategicRetreat(state: GameState, ctx: HandlerContext, fromTerritoryId: string, factionId: string): HandlerResult {
  const commitment = state.commitments.get(factionId);
  if (commitment && isMovementCommitmentInFlight(state, commitment.id)) {
    return inFlightMovementResult(findMovingArmyForCommitment(state, commitment.id)!);
  }
  const from = requireTerritory(state, fromTerritoryId);
  if (from.owner === factionId) {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'RETREAT only repositions armies standing on non-owned ground');
  }
  const armies = armiesInTerritory(state, fromTerritoryId, factionId)
    .filter((a) => !isArmyMoving(a))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (armies.length === 0) {
    throw new OrchestrationError(ErrorCode.INVALID_ARMY, 'No army of this faction occupies the retreat origin');
  }
  const ownedAdj = from.neighboring
    .filter((id) => state.territories.get(id)?.owner === factionId)
    .sort();
  if (ownedAdj.length === 0) {
    throw new OrchestrationError(ErrorCode.NOT_ADJACENT, 'No adjacent owned territory to reposition onto');
  }
  ctx.req.parameters = {
    ...ctx.req.parameters,
    armyId: armies[0]!.id,
    destinationTerritoryId: ownedAdj[0]!,
    factionId,
    commitmentId: state.commitments.get(factionId)?.id ?? null,
  };
  return handleMove(state, ctx);
}

export function handleDeclareWar(state: GameState, ctx: HandlerContext): HandlerResult {
  const factionId = resolveActingFactionId(state, ctx.req);
  const targetId = requireString(ctx.req, 'targetFactionId');
  if (targetId === factionId) {
    throw new OrchestrationError(ErrorCode.INVALID_TARGET, 'Cannot declare war on self');
  }
  requireFactionSnapshot(state, targetId);
  const self = requireFactionSnapshot(state, factionId);
  const target = requireFactionSnapshot(state, targetId);
  pushMemory(self, state.turn, 'war_declared', targetId, null, 10, { target: target.name });
  pushMemory(target, state.turn, 'war_declared', factionId, null, 12, { attacker: self.name });
  const rel = target.diplomacy.get(factionId);
  if (rel) {
    rel.state = 'at_war';
    rel.opinion = Math.max(-100, rel.opinion + BALANCE.diplomacy.warDeclarationOpinionHit);
  }
  const myRel = self.diplomacy.get(targetId);
  if (myRel) {
    myRel.state = 'at_war';
    myRel.opinion = Math.max(-100, myRel.opinion - 25);
  }
  return {
    ...emptyResult(),
    stateChanges: [{ entity: 'diplomacy', id: targetId, summary: `${self.name} declared war on ${target.name}` }],
    events: [{ kind: 'diplomacy', id: `war_${factionId}_${targetId}`, title: 'War declared', summary: `${self.name} → ${target.name}`, factionId, data: { targetFactionId: targetId } }],
    payload: { targetFactionId: targetId },
  };
}

export function handleNegotiate(state: GameState, ctx: HandlerContext): HandlerResult {
  const factionId = resolveActingFactionId(state, ctx.req);
  const targetId = requireString(ctx.req, 'targetFactionId');
  requireFactionSnapshot(state, targetId);
  const self = requireFactionSnapshot(state, factionId);
  const target = requireFactionSnapshot(state, targetId);
  const rel = self.diplomacy.get(targetId);
  if (rel) rel.opinion = Math.min(100, rel.opinion + 3);
  const tr = target.diplomacy.get(factionId);
  if (tr) tr.opinion = Math.min(100, tr.opinion + 2);
  return {
    ...emptyResult(),
    stateChanges: [{ entity: 'diplomacy', id: targetId, summary: 'Negotiation improved bilateral opinion' }],
    payload: { targetFactionId: targetId },
  };
}

function applyCommitmentTerminal(
  state: GameState,
  ctx: HandlerContext,
  factionId: string,
  kind: 'completed' | 'failed' | 'interrupted',
  reason: string,
): HandlerResult {
  const ai = ctx.registry.requireAi();
  if (!ctx.runtime.aiWarlordStates.size) {
    ctx.runtime.aiWarlordStates = buildWarlordStates(state);
  }
  const ws = ctx.runtime.aiWarlordStates.get(factionId);
  const current = state.commitments.get(factionId) ?? null;
  if (!ws || !current || !isActiveCommitmentStatus(current.status)) {
    return { ...emptyResult(), payload: { skipped: true } };
  }
  ws.activeCommitment = current;
  if (kind === 'completed') ai.completeCommitment(ws, reason);
  else if (kind === 'failed') ai.failCommitment(ws, reason);
  else ai.interruptCommitment(ws, reason);
  applyCommitmentOutcomeFeedback(state, factionId, current, kind);
  syncCommitmentsFromWarlordStates(state, ctx.runtime.aiWarlordStates);
  return {
    ...emptyResult(),
    stateChanges: [{
      entity: 'commitment',
      id: factionId,
      summary: `Commitment ${kind}: ${reason}`,
    }],
    payload: { commitmentOutcome: kind, reassessmentRequired: true, factionId },
  };
}

export function handleAdvanceWorld(state: GameState, ctx: HandlerContext): HandlerResult {
  const elapsedTicks = parseElapsedTicks(ctx.req.parameters);
  if (elapsedTicks === 0) {
    const time = { worldTick: state.worldTick, turn: state.turn };
    return {
      ...emptyResult(),
      payload: {
        turn: state.turn,
        worldTick: state.worldTick,
        worldAdvance: {
          previousWorldTime: time,
          newWorldTime: time,
          previousWorldTick: time.worldTick,
          newWorldTick: time.worldTick,
          ticksAdvanced: 0,
          aiDecisions: [],
          commitmentProgress: [],
          commitmentResolutions: [],
          eventResults: [],
          movementResults: [],
          stateChanges: [],
          notifications: [],
          errors: [],
          events: [],
        } satisfies WorldAdvanceResult,
      },
    };
  }

  ctx.registry.requireEvents();
  ctx.registry.requireAi();
  ctx.runtime.aiWarlordStates = rebindWarlordRuntime(state, ctx.runtime.aiWarlordStates);

  const host: WorldSimulationHost = {
    decide: (factionId) => withRequestParameters(ctx.req, { warlordId: factionId }, () => handleAiDecide(state, ctx)),
    resolve: (factionId) => withRequestParameters(ctx.req, { factionId }, () => handleResolveCommitment(state, ctx)),
    runEventTurn: () => runEventEngineTurn(state, ctx.registry.requireEvents()),
    rebindRuntime: (draft) => {
      ctx.runtime.aiWarlordStates = rebindWarlordRuntime(draft, ctx.runtime.aiWarlordStates);
    },
    completeCommitment: (factionId, reason) => applyCommitmentTerminal(state, ctx, factionId, 'completed', reason),
    failCommitment: (factionId, reason) => applyCommitmentTerminal(state, ctx, factionId, 'failed', reason),
    interruptCommitment: (factionId, reason) => applyCommitmentTerminal(state, ctx, factionId, 'interrupted', reason),
    executePendingAttack: (armyId) => executePendingStrategicAttack(state, ctx, armyId),
  };

  const compactInspectable = ctx.req.parameters?.catchUpCompact === true;
  const worldAdvance = new ContinuousWorldEngine().advance(state, elapsedTicks, host, {
    compactInspectable,
  });
  try {
    const expired = progressExpiredInvasions(state, ctx.registry.requireBattle());
    for (const extra of expired) {
      worldAdvance.stateChanges.push(...extra.stateChanges);
      worldAdvance.events.push(...extra.events);
      worldAdvance.notifications.push(...extra.notifications);
    }
  } catch (err) {
    if (!(err instanceof OrchestrationError)) throw err;
    worldAdvance.errors.push({ code: err.code, message: err.message });
  }
  const food = progressWorldEconomy(state);
  const resourcesChanged: HandlerResult['resourcesChanged'] = [];
  for (const row of food.factions) {
    recordResourceChange(resourcesChanged, row.factionId, 'food', row.foodBefore, row.foodAfter);
  }
  const tutorial = syncLevel1Tutorial(state);
  worldAdvance.stateChanges.push(...tutorial.stateChanges);
  worldAdvance.events.push(...tutorial.events);
  worldAdvance.notifications.push(...tutorial.notifications);
  return {
    ...emptyResult(),
    stateChanges: worldAdvance.stateChanges,
    events: worldAdvance.events,
    notifications: worldAdvance.notifications,
    resourcesChanged,
    payload: {
      turn: state.turn,
      worldTick: state.worldTick,
      ticksAdvanced: worldAdvance.ticksAdvanced,
      worldAdvance,
      foodConsumption: {
        cycles: food.cycles,
        gated: food.gated,
        fromTick: food.fromTick,
        toTick: food.toTick,
        factions: food.factions,
      },
      ...(tutorial.payload.tutorial ? { tutorial: tutorial.payload.tutorial } : {}),
      ...(typeof tutorial.payload.scriptedInvasionId === 'string'
        ? {
          scriptedInvasionId: tutorial.payload.scriptedInvasionId,
          scriptedInvasionTargetId: tutorial.payload.scriptedInvasionTargetId,
        }
        : {}),
    },
  };
}

export function handleAiDecide(state: GameState, ctx: HandlerContext): HandlerResult {
  const ai = ctx.registry.requireAi();
  const snapshot = toDecisionEngineSnapshot(state);
  const single = paramString(ctx.req, 'warlordId');
  if (single && state.playerFactionId && single === state.playerFactionId) {
    throw new OrchestrationError(
      ErrorCode.ACTION_NOT_ALLOWED,
      'AI_DECIDE does not run DecisionEngine for the player faction',
    );
  }
  if (single && isLevel1TutorialAiSuppressed(state, single)) {
    return {
      ...emptyResult(),
      payload: { commitments: [], tutorialAiSuppressed: true },
    };
  }
  const order = (single ? [single] : state.allFactionIds.filter((id) => id !== state.playerFactionId))
    .filter((id) => !isLevel1TutorialAiSuppressed(state, id));
  if (!ctx.runtime.aiWarlordStates.size) {
    ctx.runtime.aiWarlordStates = buildWarlordStates(state);
  }
  for (const id of order) {
    const ws = ctx.runtime.aiWarlordStates.get(id);
    if (!ws) continue;
    ai.decide(ws, snapshot, state.turn);
  }
  syncCommitmentsFromWarlordStates(state, ctx.runtime.aiWarlordStates);
  const commitments = [...state.commitments.entries()]
    .filter(([, c]) => c !== null)
    .map(([fid, c]) => ({ factionId: fid, commitment: c }));
  return {
    ...emptyResult(),
    stateChanges: commitments.map(({ factionId, commitment }) => ({
      entity: 'commitment',
      id: factionId,
      summary: `Commitment ${commitment!.action} (${commitment!.status})`,
    })),
    payload: { commitments },
  };
}

export function handleResolveCommitment(state: GameState, ctx: HandlerContext): HandlerResult {
  const factionId = resolveActingFactionId(state, ctx.req);
  const commitment = state.commitments.get(factionId);
  if (!commitment || !isActiveCommitmentStatus(commitment.status)) {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'No active commitment to resolve');
  }
  const ai = ctx.registry.requireAi();
  if (!ctx.runtime.aiWarlordStates.size) {
    ctx.runtime.aiWarlordStates = buildWarlordStates(state);
  }
  const ws = ctx.runtime.aiWarlordStates.get(factionId);
  if (!ws) {
    throw new OrchestrationError(ErrorCode.INVALID_FACTION, 'Warlord runtime missing for faction');
  }
  ws.activeCommitment = commitment;

  const fail = (code: ErrorCode, message: string, details?: Record<string, unknown>): HandlerResult => {
    ai.failCommitment(ws, message);
    applyCommitmentOutcomeFeedback(state, factionId, commitment, 'failed');
    syncCommitmentsFromWarlordStates(state, ctx.runtime.aiWarlordStates);
    const errors: OrchestrationErrorBody[] = [{ code, message, details }];
    return {
      ...emptyResult(),
      commandSuccess: false,
      errors,
      stateChanges: [{
        entity: 'commitment',
        id: factionId,
        summary: `Commitment ${commitment.action} failed: ${message}`,
      }],
      payload: {
        commitmentOutcome: 'failed',
        reassessmentRequired: true,
        action: commitment.action,
        targetId: commitment.targetId,
      },
    };
  };

  if (isUnsupportedCommitmentAction(commitment.action)) {
    return fail(
      ErrorCode.FEATURE_NOT_IMPLEMENTED,
      `Commitment action ${commitment.action} is not executable`,
    );
  }

  const validity = validateCommitmentTarget(commitment, toDecisionEngineSnapshot(state));
  if (!validity.valid) {
    const details = validity.reason.includes('anchor')
      ? { reason: ANCHOR_PROTECTED_REASON, territoryId: commitment.targetId }
      : undefined;
    return fail(ErrorCode.INVALID_TARGET, validity.reason, details);
  }

  ai.beginExecution(ws, 'orchestrator resolve');

  let inner: HandlerResult;
  try {
    switch (commitment.action) {
      case 'ATTACK':
        if (!commitment.targetId) return fail(ErrorCode.INVALID_TARGET, 'Commitment attack missing target');
        inner = executeAttack(state, ctx, commitment.targetId, factionId);
        break;
      case 'BUILD':
        ctx.req.parameters = { ...ctx.req.parameters, territoryId: commitment.targetId, factionId };
        inner = handleBuild(state, ctx);
        break;
      case 'REINFORCE':
        ctx.req.parameters = { ...ctx.req.parameters, territoryId: commitment.targetId, factionId };
        inner = handleReinforce(state, ctx);
        break;
      case 'DECLARE_WAR':
        ctx.req.parameters = { ...ctx.req.parameters, targetFactionId: commitment.targetId, factionId };
        inner = handleDeclareWar(state, ctx);
        break;
      case 'NEGOTIATE':
        ctx.req.parameters = { ...ctx.req.parameters, targetFactionId: commitment.targetId, factionId };
        inner = handleNegotiate(state, ctx);
        break;
      case 'MOVE':
        if (!commitment.targetId) return fail(ErrorCode.INVALID_TARGET, 'MOVE commitment missing destination');
        inner = executeMoveCommitment(state, ctx, commitment.targetId, factionId);
        break;
      case 'RETREAT':
        if (!commitment.targetId) return fail(ErrorCode.INVALID_TARGET, 'RETREAT commitment missing origin territory');
        inner = executeStrategicRetreat(state, ctx, commitment.targetId, factionId);
        break;
      case 'WAIT':
        inner = {
          ...emptyResult(),
          payload: { waited: true },
        };
        break;
      case 'DEFEND':
        if (commitment.targetId) {
          const hold = state.territories.get(commitment.targetId);
          if (!hold || hold.owner !== factionId) {
            return fail(ErrorCode.INVALID_TARGET, 'DEFEND target is no longer owned');
          }
        }
        inner = {
          ...emptyResult(),
          payload: {
            defendPosture: true,
            note: 'DEFEND has no separate world mutation; holding owned territory is the posture',
          },
        };
        break;
      default:
        return fail(
          ErrorCode.FEATURE_NOT_IMPLEMENTED,
          `Commitment action ${commitment.action} is not executable`,
        );
    }
  } catch (err) {
    if (err instanceof OrchestrationError) {
      return fail(err.code, err.message, err.details);
    }
    throw err;
  }

  if (inner.payload.arrivalPending === true
    || inner.payload.attackOutcome === 'invasion_created'
    || inner.payload.attackOutcome === 'awaiting_defense') {
    syncCommitmentsFromWarlordStates(state, ctx.runtime.aiWarlordStates);
    inner.stateChanges.push({
      entity: 'commitment',
      id: factionId,
      summary: `Commitment ${commitment.id} executing (army in transit)`,
    });
    inner.payload = {
      ...inner.payload,
      commitmentOutcome: 'executing',
      reassessmentRequired: false,
      action: commitment.action,
      targetId: commitment.targetId,
    };
    return inner;
  }

  ai.completeCommitment(ws, 'orchestrator executed commitment');
  applyCommitmentOutcomeFeedback(state, factionId, commitment, 'completed');
  syncCommitmentsFromWarlordStates(state, ctx.runtime.aiWarlordStates);
  inner.stateChanges.push({
    entity: 'commitment',
    id: factionId,
    summary: `Commitment ${commitment.id} completed`,
  });
  inner.payload = {
    ...inner.payload,
    commitmentOutcome: 'completed',
    reassessmentRequired: true,
    action: commitment.action,
    targetId: commitment.targetId,
  };
  return inner;
}

export type MutatingHandler = (state: GameState, ctx: HandlerContext) => HandlerResult;

export const MUTATING_HANDLERS: Record<string, MutatingHandler> = {
  ATTACK: handleAttack,
  MOVE: handleMove,
  BUILD: handleBuild,
  REINFORCE: handleReinforce,
  DECLARE_WAR: handleDeclareWar,
  NEGOTIATE: handleNegotiate,
  ADVANCE_WORLD: handleAdvanceWorld,
  TRANSITION_TO_NEXT_WORLD: handleTransitionToNextWorld,
  AI_DECIDE: handleAiDecide,
  RESOLVE_COMMITMENT: handleResolveCommitment,
  START_CONSTRUCTION: handleStartConstruction,
  APPLY_CONSTRUCTION_ACCELERATION: handleApplyConstructionAcceleration,
  COLLECT_RESOURCES: handleCollectResources,
  SET_PLAYER_PAUSE: handleSetPlayerPause,
  START_WORKOUT: handleStartWorkout,
  PAUSE_WORKOUT: handlePauseWorkout,
  RESUME_WORKOUT: handleResumeWorkout,
  RECORD_EXERCISE: handleRecordExercise,
  SKIP_REST: handleSkipRest,
  SUBMIT_WORKOUT_FEEDBACK: handleSubmitWorkoutFeedback,
  FINALIZE_WORKOUT: handleFinalizeWorkout,
  ABANDON_WORKOUT: handleAbandonWorkout,
  RECORD_INTEGRITY_FLAG: handleRecordIntegrityFlag,
};

export type ReadOnlyHandler = (state: GameState, ctx: HandlerContext) => HandlerResult;

export const READ_ONLY_HANDLERS: Record<string, ReadOnlyHandler> = {
  GET_COMMAND_INDEX: handleGetCommandIndex,
  GET_GAME_STATE: handleGetGameState,
  GET_VISIBLE_WORLD: handleGetVisibleWorld,
  GET_WORLD_DEFINITION: handleGetWorldDefinition,
  GET_FITNESS_CATALOG: handleGetFitnessCatalog,
  GET_WORKOUT_SELECTION: handleGetWorkoutSelection,
};
