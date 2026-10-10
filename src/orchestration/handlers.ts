import {beginTradeProposal,processTradeBoundary,settleTradeProposal,acceptanceProblem} from '../gameplay/trade/trade';
import {TRADE_TIMING} from '../constants/trade';
import { REINFORCE_INITIATION as RECRUIT } from '../constants/recruitment';
import { PEACE_TIMING } from '../constants/peace';
import { beginPeaceProposal, offerPeaceProblem, processPeaceBoundary, settlePeaceProposal } from '../gameplay/diplomacy/peace';
import { reinforcementProblem } from '../gameplay/recruitment/reinforcement';
import { startProactiveTimer, timerRemaining, opportunity, invalidateProactiveInitiation } from '../engine/proactiveCognition';
import { derivePresenceSegments } from '../world/presenceLeases';
import { prepareProactiveDecision, selectWaitInitiation, nextProactiveBoundary, accrueProactiveClocks, authoritativePresence } from '../engine/proactiveCognition';
import { sourceConcretePlans } from '../engine/strategicPressure';
import { AIOperation } from '../types/AIOperation';
import { activeOperations, operationFromSelection, acquireOperationClaims, settleOperation } from '../engine/operations';
import { runStateTransaction } from './transaction';
import { adoptOwnedTransactionState } from '../state/cloneGameState';
import { AIConcretePlan, concretePlanProblem, planTargetId } from '../types/AIConcretePlan';
import { assessConcretePlanFeasibility } from '../engine/concretePlans';
import { acquireAttention } from '../engine/strategicAttention';
import { attachDecisionInitiation, finishDecisionInitiation } from '../engine/decisionOpportunities';
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
import { cloneResources, ECONOMY_CONFIG } from '../gameplay/economy/config';
import { progressWorldEconomy } from '../gameplay/economy/worldProgress';
import type { FoodConsumptionResult } from '../gameplay/economy/foodConsumption';
import { makeCommitmentId, WarlordState, isActiveCommitmentStatus, validateCommitmentTarget } from '../engine/DecisionEngine';
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
import {recordConflictFact} from '../conflict/ledger';
import {relationshipBetween} from '../gameplay/diplomacy/relationships';
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
import { progressExpiredInvasions, processInvalidatedInvasions } from '../gameplay/invasion/progress';
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
  const commitmentId = paramString(ctx.req, 'commitmentId') ?? null;
  if (commitmentId) {
    const op = state.operations.get(commitmentId);
    if (!op || op.phase !== 'physical' || op.plan?.action !== 'ATTACK' || op.warlordId !== attackerId
      || op.plan.targetTerritoryId !== territoryId || op.plan.armyId !== paramString(ctx.req, 'onlyArmyId')
      || op.plan.stagingTerritoryId !== paramString(ctx.req, 'stagingTerritoryId')) {
      throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Attack operation linkage differs from its exact plan');
    }
  }
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

  const exactArmyId = paramString(ctx.req, 'onlyArmyId');
  const exactStagingId = paramString(ctx.req, 'stagingTerritoryId');
  const immediate = listImmediateAttackingArmies(state, attackerId, territoryId)
    .filter(a => (!exactArmyId || a.id === exactArmyId) && (!exactStagingId || a.location === exactStagingId));
  const held = maybeHoldAttackAsInvasion(state, {
    attackerId,
    territoryId,
    armies: immediate,
    commitmentId,
    requestId: ctx.req.requestId,
    battleSeed: paramNumber(ctx.req, 'seed'),
  });
  if (held) return held;

  return startStrategicAttack(state, ctx, {
    territoryId,
    factionId: attackerId,
    commitmentId,
    onlyArmyId: exactArmyId,
    stagingTerritoryId: exactStagingId,
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
        requestId: ctx.req.requestId,
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
  const current = state.operations.get(commitmentId);
  if (!current || current.id !== commitmentId || !isActiveCommitmentStatus(current.status)) return inner;
  if (inner.payload.attackOutcome === 'battle_resolved') {
    const result = inner.payload.battleResult as { winner?: string } | undefined;
    const term = applyCommitmentTerminal(state, ctx, commitmentId, result?.winner === 'attacker' ? 'completed' : 'failed', `attacker result: ${result?.winner ?? 'unknown'}`);
    inner.stateChanges.push(...term.stateChanges);
    inner.payload = { ...inner.payload, ...term.payload };
    return inner;
  }
  if (inner.payload.attackOutcome === 'invasion_created' || inner.payload.attackOutcome === 'awaiting_defense') {
    inner.payload = { ...inner.payload, arrivalPending: true };
    return inner;
  }
  if (inner.commandSuccess === false || inner.payload.attackOutcome === 'failed') {
    const term = applyCommitmentTerminal(state, ctx, commitmentId, 'failed', String(inner.payload.attackOutcome ?? 'pending attack failed'));
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
  // The legacy resource purchase path is gone. Explicit local quantities use
  // exactly the same canonical timed operation boundary as AI cognition.
  if(!ctx.req.parameters?.plan)throw new OrchestrationError(ErrorCode.INVALID_PARAMETER,'REINFORCE requires an exact local-pool plan');
  if((ctx.req.parameters.plan as AIConcretePlan).action!=='REINFORCE')throw new OrchestrationError(ErrorCode.INVALID_PARAMETER,'Expected REINFORCE plan');
  return handleStartAiOperation(state,ctx);
}

export function handleOfferPeace(state:GameState,ctx:HandlerContext):HandlerResult {
  const plan=ctx.req.parameters?.plan as AIConcretePlan;
  if(concretePlanProblem(plan)||plan.action!=='OFFER_PEACE')throw new OrchestrationError(ErrorCode.INVALID_PARAMETER,'OFFER_PEACE requires an exact counterparty plan');
  if(resolveActingFactionId(state,ctx.req)!==plan.factionId)throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED,'Peace proposer does not match acting faction');
  return handleStartAiOperation(state,ctx);
}
export function handleRespondPeace(state:GameState,ctx:HandlerContext):HandlerResult {
  const id=requireString(ctx.req,'proposalId'),response=requireString(ctx.req,'response');
  const p=state.peaceProposals.get(id);
  if(!p||p.recipient!==resolveActingFactionId(state,ctx.req))throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED,'Only the exact Peace recipient may respond');
  if(!['ACCEPT_PEACE','DECLINE_PEACE'].includes(response))throw new OrchestrationError(ErrorCode.INVALID_PARAMETER,'Invalid Peace response');
  processPeaceBoundary(state); // Earned deadline/finalization boundaries precede new input.
  const wanted=response==='ACCEPT_PEACE'?'accepted':'declined';
  if(p.status===wanted)return {...emptyResult(),payload:{proposalId:id,status:p.status,replayed:true}};
  if(p.status!=='pending')throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED,'Peace offer is not awaiting response');
  settlePeaceProposal(state,id,wanted);processPeaceBoundary(state);
  return {...emptyResult(),payload:{proposalId:id,status:p.status}};
}
export function handleWithdrawPeace(state:GameState,ctx:HandlerContext):HandlerResult {
  const id=requireString(ctx.req,'proposalId'),p=state.peaceProposals.get(id),actor=resolveActingFactionId(state,ctx.req);
  if(!p||actor!==state.playerFactionId||p.proposer!==actor)throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED,'Only a player may withdraw their own Peace offer');
  if(p.status==='withdrawn')return {...emptyResult(),payload:{proposalId:id,status:p.status,replayed:true}};
  if(p.status!=='pending')throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED,'No pending Peace offer to withdraw');
  settlePeaceProposal(state,id,'withdrawn');return {...emptyResult(),payload:{proposalId:id,status:p.status}};
}

export function handleTrade(state:GameState,ctx:HandlerContext):HandlerResult {
  const plan=ctx.req.parameters?.plan as AIConcretePlan;
  if(concretePlanProblem(plan)||plan.action!=='TRADE')throw new OrchestrationError(ErrorCode.INVALID_PARAMETER,'TRADE requires an exact source/terms/endpoint plan');
  if(resolveActingFactionId(state,ctx.req)!==plan.factionId)throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED,'Trade proposer must be acting faction');
  return handleStartAiOperation(state,ctx);
}
export function handleRespondTrade(state:GameState,ctx:HandlerContext):HandlerResult {
  processTradeBoundary(state);
  const id=requireString(ctx.req,'proposalId'),response=requireString(ctx.req,'response'),p=state.tradeProposals.get(id);
  if(!p||p.recipient!==resolveActingFactionId(state,ctx.req))throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED,'Only exact recipient may respond');
  if(!['ACCEPT_TRADE','DECLINE_TRADE'].includes(response))throw new OrchestrationError(ErrorCode.INVALID_PARAMETER,'Invalid required Trade response');
  const wanted=response==='ACCEPT_TRADE'?'accepted':'declined';
  if(p.status===wanted)return {...emptyResult(),payload:{proposalId:id,status:p.status,replayed:true}};
  if(p.status!=='pending')throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED,'Trade is not pending');
  if(wanted==='accepted'){const problem=acceptanceProblem(state,p);if(problem)throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED,problem);}
  settleTradeProposal(state,id,wanted);
  return {...emptyResult(),payload:{proposalId:id,status:p.status,shipmentIds:[...p.shipmentIds]}};
}
export function handleWithdrawTrade(state:GameState,ctx:HandlerContext):HandlerResult {
  const id=requireString(ctx.req,'proposalId'),p=state.tradeProposals.get(id),actor=resolveActingFactionId(state,ctx.req);
  if(!p||actor!==state.playerFactionId||p.proposer!==actor)throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED,'Only player may withdraw own offer');
  if(p.status==='withdrawn')return {...emptyResult(),payload:{proposalId:id,status:p.status,replayed:true}};
  if(p.status!=='pending')throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED,'No pending offer');
  settleTradeProposal(state,id,'withdrawn');return {...emptyResult(),payload:{proposalId:id,status:p.status}};
}
export function handleCounterofferTrade(state:GameState,ctx:HandlerContext):HandlerResult {
  const id=requireString(ctx.req,'proposalId'),plan=ctx.req.parameters?.plan as AIConcretePlan;
  const tx=runStateTransaction(state,draft=>{
    const p=draft.tradeProposals.get(id),actor=resolveActingFactionId(draft,ctx.req);
    if(!p||p.status!=='pending'||p.recipient!==actor||concretePlanProblem(plan)||plan.action!=='TRADE'||plan.factionId!==actor||plan.counterpartyId!==p.proposer)
      throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED,'Counteroffer requires exact reverse participants and pending original');
    settleTradeProposal(draft,id,'counteroffered');
    const result=handleTrade(draft,ctx),operationId=result.payload.operationId as string;
    const replacement=draft.tradeProposals.get(draft.operations.get(operationId)!.links.tradeProposalId!)!;
    replacement.replacesProposalId=id;return result;
  });
  adoptOwnedTransactionState(state,tx.state);return tx.result;
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

/** Historical API symbol only: WAR is default and declarations cannot end Peace. */
export function handleDeclareWar(_state: GameState, _ctx: HandlerContext): HandlerResult {
  throw new OrchestrationError(ErrorCode.FEATURE_NOT_IMPLEMENTED, 'DECLARE_WAR is obsolete; relationships follow the canonical Peace lifecycle');
}

/** Historical command only. Counteroffers use their exact Trade response lifecycle. */
export function handleNegotiate(_state: GameState, _ctx: HandlerContext): HandlerResult {
  throw new OrchestrationError(ErrorCode.FEATURE_NOT_IMPLEMENTED,'Generalized NEGOTIATE is obsolete; use an exact Trade counteroffer response');
}

function applyCommitmentTerminal(state: GameState, _ctx: HandlerContext, operationId: string,
  kind: 'completed' | 'failed' | 'interrupted', reason: string): HandlerResult {
  const op = state.operations.get(operationId);
  if (!op) return { ...emptyResult(), payload: { skipped: true } };
  const changed = settleOperation(state, operationId, kind, reason);
  return { ...emptyResult(), payload: { operationId, commitmentId: operationId,
    commitmentOutcome: op.phase === 'recovery' ? 'recovering' : op.status,
    reassessmentRequired: changed, factionId: op.warlordId, skipped: !changed } };
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

  const foodFromTick=state.lastFoodConsumptionTick;
  const foodBoundaries:FoodConsumptionResult[]=[];
  const host: WorldSimulationHost = {
    progressProactive: (atMs, allowDecision) => progressProactiveThrough(state,ctx,atMs,allowDecision),
    decide: (factionId) => withRequestParameters(ctx.req, { warlordId: factionId }, () => handleAiDecide(state, ctx)),
    resolve: (factionId, operationId) => withRequestParameters(ctx.req, { factionId, operationId }, () => handleResolveCommitment(state, ctx)),
    runEventTurn: () => runEventEngineTurn(state, ctx.registry.requireEvents()),
    rebindRuntime: (draft) => {
      ctx.runtime.aiWarlordStates = rebindWarlordRuntime(draft, ctx.runtime.aiWarlordStates);
    },
    completeCommitment: (operationId, reason) => applyCommitmentTerminal(state, ctx, operationId, 'completed', reason),
    failCommitment: (operationId, reason) => applyCommitmentTerminal(state, ctx, operationId, 'failed', reason),
    interruptCommitment: (operationId, reason) => applyCommitmentTerminal(state, ctx, operationId, 'interrupted', reason),
    executePendingAttack: (armyId) => executePendingStrategicAttack(state, ctx, armyId),
    resolveInvalidatedInvasions: () => processInvalidatedInvasions(state, ctx.registry.requireBattle()),
    resolveDeadlineGates: () => progressExpiredInvasions(state, ctx.registry.requireBattle()),
    // Reuse the economy reducer at its authored cycle boundary, before cognition.
    // No new production/upkeep rule or per-tick economy simulation is introduced.
    refreshWorldFacts: () => {if(state.worldTick % ECONOMY_CONFIG.ticksPerProductionCycle===0)
      foodBoundaries.push(progressWorldEconomy(state));},
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
  foodBoundaries.push(food);
  const totalFood:FoodConsumptionResult={fromTick:foodFromTick,toTick:food.toTick,cycles:0,gated:true,factions:[]};
  for(const boundary of foodBoundaries) {
    totalFood.cycles+=boundary.cycles;totalFood.gated=totalFood.gated&&boundary.gated;
    for(const row of boundary.factions) {
      const previous=totalFood.factions.find(p=>p.factionId===row.factionId);
      if(!previous)totalFood.factions.push({...row});
      else {previous.demandPerCycle=row.demandPerCycle;previous.cycles+=row.cycles;previous.demand+=row.demand;
        previous.paid+=row.paid;previous.failedCycles+=row.failedCycles;previous.foodAfter=row.foodAfter;previous.stabilityAfter=row.stabilityAfter;}
    }
  }
  const resourcesChanged: HandlerResult['resourcesChanged'] = [];
  for (const row of totalFood.factions) {
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
        cycles: totalFood.cycles,
        gated: totalFood.gated,
        fromTick: totalFood.fromTick,
        toTick: totalFood.toTick,
        factions: totalFood.factions,
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

/** Event/boundary-driven Temporal V2 progression, including sub-world-tick work.
 * Exact timers finish before the next physical boundary; full selection uses the
 * authoritative state at its decision boundary. No per-second polling. */
export function progressProactiveThrough(state: GameState, ctx: HandlerContext, horizon: number, allowEndpointDecision = true): HandlerResult {
  const result=emptyResult();
  const decisions: WorldAdvanceResult['aiDecisions']=[];
  const resolutions: WorldAdvanceResult['commitmentResolutions']=[];
  result.payload={proactiveDecisions:decisions,proactiveResolutions:resolutions};
  const process = (allowDecisions:boolean) => {
    // At a physical boundary, first earn timer work, then let domain arrivals/
    // completions apply. WAIT's feasibility revalidation must see those effects
    // just like ordinary cognition; it is not an exception to boundary ordering.
    if(!allowDecisions)return;
    processTradeBoundary(state);
    processPeaceBoundary(state); // Required responses and diplomacy gates precede proactive thought.
    for(const op of activeOperations(state).filter(o=>o.action==='REINFORCE'&&o.phase==='physical')) {
      const plan=op.plan;
      if(plan?.action!=='REINFORCE')throw new Error('Reinforcement operation lost exact plan');
      const problem=reinforcementProblem(state,plan,op.id);
      if(problem || !op.initiationTimer) {
        settleOperation(state,op.id,'failed',problem??'Missing reinforcement timer');
        invalidateProactiveInitiation(state,op.warlordId);
        continue;
      }
      if(timerRemaining(state,op.initiationTimer)>0)continue;
      if(!settleOperation(state,op.id,'completed','Exact local troop allocation completed'))throw new OrchestrationError(ErrorCode.INVALID_GAME_STATE,'Timed allocation lost exact claim ownership');
      resolutions.push({factionId:op.warlordId,commitmentId:op.id,action:op.action,outcome:'completed',success:true,worldTick:state.worldTick});
    }
    for(const id of [...state.allFactionIds].sort()) {
      if(id===state.playerFactionId || isLevel1TutorialAiSuppressed(state,id))continue;
      const inner=withRequestParameters(ctx.req,{warlordId:id},()=>handleAiDecide(state,ctx));
      result.stateChanges.push(...inner.stateChanges);result.events.push(...inner.events);
      const ids=inner.payload.selectedOperationIds;
      if(Array.isArray(ids))for(const operationId of ids) {
        const selected=state.operations.get(operationId)!;
        decisions.push({factionId:id,commitmentId:operationId,action:selected.action,targetId:selected.targetId,worldTick:state.worldTick});
        const resolved=withRequestParameters(ctx.req,{factionId:id,operationId},()=>handleResolveCommitment(state,ctx));
        result.stateChanges.push(...resolved.stateChanges);result.events.push(...resolved.events);
        const current=state.operations.get(operationId)!;
        resolutions.push({factionId:id,commitmentId:operationId,action:current.action,
          outcome:current.terminal?.outcome??current.status,success:resolved.errors?.length?false:current.terminal?.outcome!=='failed',worldTick:state.worldTick});
        result.notifications.push(...resolved.notifications);
        result.resourcesChanged.push(...resolved.resourcesChanged);
        if(resolved.errors)result.errors=[...(result.errors??[]),...resolved.errors];
      }
    }
  };
  if(horizon<state.aiClock.nowMs)return result;
  accrueProactiveClocks(state,state.aiClock.nowMs,authoritativePresence(state));
  // Observe current state before accruing newly born sources.
  process(horizon>state.aiClock.nowMs||allowEndpointDecision);
  const segments=derivePresenceSegments(state.gameplaySessionLeases,state.aiClock.nowMs,horizon);
  for(const segment of segments) {
    accrueProactiveClocks(state,state.aiClock.nowMs,segment.presence); // promotion at lease boundary
    while(state.aiClock.nowMs<segment.endMs) {
      const next=nextProactiveBoundary(state,segment.endMs,segment.presence);
      accrueProactiveClocks(state,next,segment.presence);
      process(next<horizon||allowEndpointDecision);
    }
  }
  return result;
}

export function handleAiDecide(state: GameState, ctx: HandlerContext): HandlerResult {
  const ai = ctx.registry.requireAi();
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
    .filter((id) => !isLevel1TutorialAiSuppressed(state, id)).sort((a,b) => a < b ? -1 : a > b ? 1 : 0);
  const selectedOperationIds: string[] = [];
  const skippedOpportunities: { factionId: string; reason: string }[] = [];
  for (const id of order) {
    const source = prepareProactiveDecision(state, id);
    if (!source) { skippedOpportunities.push({factionId:id,reason:'NO_READY_CONTEXT'});continue; }
    ctx.runtime.aiWarlordStates=buildWarlordStates(state);
    const ws=ctx.runtime.aiWarlordStates.get(id)!;
    const plans = sourceConcretePlans(state, source);
    const decision = ai.decideForSource(ws, toDecisionEngineSnapshot(state), source, plans,state.aiDecisionOpportunities.get(id)!.primary!.opportunityId);
    if (decision.isNewCommitment && decision.commitment) {
      if (decision.commitment.action === 'WAIT') {
        // A WAIT owns only the primary initiation timer, never a physical operation.
        selectWaitInitiation(state,id);
        ws.activeCommitment=null;
      } else {
        selectedOperationIds.push(decision.commitment.id);
        syncCommitmentsFromWarlordStates(state, ctx.runtime.aiWarlordStates, [id]);
        state.operations.get(decision.commitment.id)!.sourceContextId=source.id;
        attachDecisionInitiation(state,id,decision.commitment.id);
      }
    }
  }
  const commitments = activeOperations(state).map(c => ({ factionId: c.warlordId, commitment: c }));
  return {
    ...emptyResult(),
    stateChanges: commitments.map(({ factionId, commitment }) => ({
      entity: 'commitment',
      id: commitment.id,
      summary: `Commitment ${commitment!.action} (${commitment!.status})`,
    })),
    payload: { commitments, selectedOperationIds, skippedOpportunities },
  };
}

/** Concrete bridge: only physical domain commands, never strategic re-selection. */
function executeConcreteCommitment(state: GameState, ctx: HandlerContext, plan: AIConcretePlan, commitmentId: string): HandlerResult {
  ctx.req.parameters = { ...ctx.req.parameters, factionId: plan.factionId, commitmentId };
  switch (plan.action) {
    case 'ATTACK':
      ctx.req.parameters = { ...ctx.req.parameters, onlyArmyId: plan.armyId, stagingTerritoryId: plan.stagingTerritoryId };
      return executeAttack(state, ctx, plan.targetTerritoryId, plan.factionId);
    case 'MOVE': case 'RETREAT': {
      const army = state.armies.get(plan.armyId)!;
      if (army.movement?.status === 'moving' && army.movement.commitmentId === commitmentId) return inFlightMovementResult(army);
      ctx.req.parameters = { ...ctx.req.parameters, armyId: plan.armyId,
        destinationTerritoryId: plan.action === 'MOVE' ? plan.destinationTerritoryId : plan.fallbackTerritoryId };
      return handleMove(state, ctx);
    }
    case 'BUILD': {
      const faction = requireFactionSnapshot(state, plan.factionId);
      const before = cloneResources(faction.resources);
      const project = startConstruction(state, { factionId: plan.factionId, territoryId: plan.territoryId, projectType: plan.projectType, operationId: commitmentId });
      return handlerResultForConstructionStart(project, plan.territoryId, before, cloneResources(faction.resources), plan.factionId);
    }
    case 'REINFORCE': return { ...emptyResult(), payload: { initiationPending: true } };
    case 'TRADE': {const proposal=beginTradeProposal(state,plan,commitmentId);state.operations.get(commitmentId)!.links.tradeProposalId=proposal.id;return {...emptyResult(),payload:{initiationPending:true}};}
    case 'OFFER_PEACE': {
      const proposal=beginPeaceProposal(state,plan,commitmentId);
      state.operations.get(commitmentId)!.links.peaceProposalId=proposal.id;
      return {...emptyResult(),payload:{initiationPending:true}};
    }
    case 'WAIT': return { ...emptyResult(), payload: { waited: true } };
    default: throw new OrchestrationError(ErrorCode.FEATURE_NOT_IMPLEMENTED, 'Unexpected concrete action lifecycle');
  }
}

/** Nested transaction prevents failed starts from leaking partial claims into ADVANCE_WORLD. */
function startOperation(state: GameState, ctx: HandlerContext, selected: AIOperation, allocateSequence = false): HandlerResult {
  const transaction = runStateTransaction(state, draft => {
    if (allocateSequence) draft.factions.get(selected.warlordId)!.nextAiCommitmentSequence++;
    const op = draft.operations.get(selected.id) ?? operationFromSelection(selected, draft.worldTick);
    if (op.plan?.action==='WAIT') throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED,'Legacy WAIT operations cannot execute; WAIT requires a source-bound primary timer');
    if (!op.plan) throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Incomplete legacy reasoning cannot execute');
    const feasibility = assessConcretePlanFeasibility(op.plan, toDecisionEngineSnapshot(draft), op.id);
    if (!feasibility.feasible) {
      const rejection = feasibility.rejections[0]!;
      throw new OrchestrationError(rejection.kind === 'LEGALITY' ? ErrorCode.INVALID_TARGET : ErrorCode.ACTION_NOT_ALLOWED,
        rejection.reason, { feasibility: feasibility.rejections,
          ...(rejection.reason.includes('anchor') ? { reason: ANCHOR_PROTECTED_REASON, territoryId: planTargetId(op.plan) } : {}) });
    }
    if(op.action==='REINFORCE'||op.action==='OFFER_PEACE'||op.action==='TRADE') {
      const primary=opportunity(draft,op.warlordId);
      if(primary.primaryOperationId && primary.primaryOperationId!==op.id || primary.primary && primary.primaryOperationId!==op.id)
        throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED,'Primary proactive initiation busy');
    }
    acquireOperationClaims(draft, op);
    acquireAttention(draft, op);
    draft.operations.set(op.id, op);
    op.status = 'executing'; op.phase = 'physical'; op.startedAtTick = draft.worldTick;
    // The provisional selection delay is not a duplicate physical timer.
    delete op.durationTicks; delete op.completionCondition;
    if ('armyId' in op.plan) op.links.armyId = op.plan.armyId;
    if(op.plan.action==='ATTACK'){
      op.hostileCounterpartyId=draft.territories.get(op.plan.targetTerritoryId)!.owner!;
      recordConflictFact(draft,op.id,{kind:'ATTACK_COMMITTED',actor:op.warlordId,target:op.hostileCounterpartyId,territoryId:op.plan.targetTerritoryId});
    }
    if(op.plan.action==='RETREAT'){
      const other=draft.territories.get(op.plan.originTerritoryId)?.owner;
      // Physical withdrawal remains legal during Peace. It is not a new
      // conflict consequence and must not change the closed war episode.
      if(other&&other!==op.warlordId&&relationshipBetween(draft,op.warlordId,other)!=='PEACE')recordConflictFact(draft,op.id,{kind:'RETREAT',actor:op.warlordId,target:other,territoryId:op.plan.originTerritoryId});
    }
    const inner = executeConcreteCommitment(draft, ctx, op.plan, op.id);
    if (op.action === 'BUILD') {
      const project = [...draft.constructions.values()].find(p => p.aiOperationId === op.id);
      if (!project) throw new OrchestrationError(ErrorCode.ENGINE_ERROR, 'BUILD lacks its project link');
      op.links.constructionId = project.id;
    }
    if (typeof inner.payload.invasionId === 'string') op.links.invasionId = inner.payload.invasionId;
    if(op.action==='REINFORCE'||op.action==='OFFER_PEACE'||op.action==='TRADE') {
      const primary=opportunity(draft,op.warlordId);
      primary.primaryOperationId=op.id;
      const timing=op.action==='REINFORCE'?RECRUIT:op.action==='TRADE'?TRADE_TIMING:{initiationOnlineMs:PEACE_TIMING.initiationOnlineMs,initiationOfflineMs:PEACE_TIMING.initiationOfflineMs};
      op.initiationTimer=startProactiveTimer(draft,op.warlordId,op.action.toLowerCase(),timing.initiationOnlineMs,timing.initiationOnlineMs,timing.initiationOfflineMs/timing.initiationOnlineMs);
    } else finishDecisionInitiation(draft, op.id, true);
    if (op.action === 'WAIT') settleOperation(draft, op.id, 'completed', 'no new physical operation');
    else if (op.action === 'ATTACK' && inner.payload.attackOutcome === 'battle_resolved') {
      const battle = inner.payload.battleResult as { winner?: string } | undefined;
      settleOperation(draft, op.id, battle?.winner === 'attacker' ? 'completed' : 'failed', `attacker result: ${battle?.winner ?? 'unknown'}`);
    }
    inner.payload = { ...inner.payload, operationId: op.id, commitmentId: op.id,
      commitmentOutcome: op.status, reassessmentRequired: op.terminal !== null };
    return inner;
  });
  adoptOwnedTransactionState(state, transaction.state);
  return transaction.result;
}

/** Explicit exact-plan domain boundary; claims, compatibility and Attention apply.
 * This is not an additional autonomous deliberation thread.
 */
export function handleStartAiOperation(state: GameState, ctx: HandlerContext): HandlerResult {
  const plan = ctx.req.parameters?.plan as AIConcretePlan;
  const problem = concretePlanProblem(plan);
  if (problem) throw new OrchestrationError(ErrorCode.INVALID_PARAMETER, problem);
  if (state.playerFactionId === plan.factionId && !((plan.action==='OFFER_PEACE'&&ctx.req.commandId==='OFFER_PEACE')||(plan.action==='TRADE'&&['TRADE','COUNTEROFFER_TRADE'].includes(ctx.req.commandId)))) throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'AI cannot control player forces');
  if (plan.action === 'WAIT') throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'WAIT is a source-bound initiation timer, not a physical operation');
  const faction = requireFactionSnapshot(state, plan.factionId);
  const sequence = faction.nextAiCommitmentSequence;
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence >= Number.MAX_SAFE_INTEGER) throw new OrchestrationError(ErrorCode.INVALID_GAME_STATE, 'Operation sequence exhausted');
  const id = makeCommitmentId(state.worldSeed, plan.factionId, state.turn, sequence, plan.action, planTargetId(plan));
  if (state.operations.has(id)) throw new OrchestrationError(ErrorCode.INVALID_GAME_STATE, 'Operation sequence would reuse an existing ID');
  const selected = operationFromSelection({ id, plan, warlordId: plan.factionId, action: plan.action,
    targetId: planTargetId(plan), targetName: planTargetId(plan), status: 'committed', createdTurn: state.turn,
    originatingGoalId: null, reason: ['exact integration plan'], priority: 0, score: 0,
    confidence: 1, personalityBias: 0, ambitionInfluence: 0, factorBreakdown: [], statusReason: null }, state.worldTick);
  // The increment is rolled back with the outer command on failure. It must
  // precede nested invariant validation of the newly recorded ID.
  return startOperation(state, ctx, selected, true);
}

export function handleResolveCommitment(state: GameState, ctx: HandlerContext): HandlerResult {
  const factionId = resolveActingFactionId(state, ctx.req);
  const id = paramString(ctx.req, 'operationId');
  const candidates = activeOperations(state, factionId);
  const op = id ? state.operations.get(id) : candidates.length === 1 ? candidates[0] : undefined;
  if (!op || op.warlordId !== factionId) throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Specify an operation ID; faction selection is ambiguous or empty');
  if (op.phase === 'terminal') return { ...emptyResult(), payload: { operationId: op.id, commitmentOutcome: op.status, skipped: true } };
  if (op.phase !== 'selected') return { ...emptyResult(), payload: { operationId: op.id, commitmentOutcome: op.phase === 'recovery' ? 'recovering' : op.status, arrivalPending: true, armyId: op.links.armyId } };
  if (op.plan !== undefined) {
    const problem = concretePlanProblem(op.plan);
    if (problem || op.plan.action !== op.action || op.plan.factionId !== factionId || planTargetId(op.plan) !== op.targetId)
      throw new OrchestrationError(ErrorCode.INVALID_TARGET, problem ?? 'operation/plan binding mismatch');
  }
  if (!op.plan || !['ATTACK','MOVE','RETREAT','BUILD','REINFORCE','OFFER_PEACE','TRADE','WAIT'].includes(op.action)) {
    settleOperation(state, op.id, 'failed', 'Final lifecycle unavailable or incomplete legacy reasoning');
    return { ...emptyResult(), commandSuccess: false, errors: [{ code: ErrorCode.FEATURE_NOT_IMPLEMENTED, message: 'Operation lifecycle unavailable' }],
      payload: { operationId: op.id, commitmentOutcome: 'failed', reassessmentRequired: true } };
  }
  try { return startOperation(state, ctx, op); }
  catch (err) {
    if (!(err instanceof OrchestrationError)) throw err;
    settleOperation(state, op.id, 'failed', err.message);
    return { ...emptyResult(), commandSuccess: false, errors: [err.toBody()],
      payload: { operationId: op.id, commitmentOutcome: 'failed', reassessmentRequired: true } };
  }
}

export type MutatingHandler = (state: GameState, ctx: HandlerContext) => HandlerResult;

export const MUTATING_HANDLERS: Record<string, MutatingHandler> = {
  ATTACK: handleAttack,
  MOVE: handleMove,
  BUILD: handleBuild,
  REINFORCE: handleReinforce,
  OFFER_PEACE: handleOfferPeace,
  TRADE:handleTrade, RESPOND_TRADE:handleRespondTrade, WITHDRAW_TRADE:handleWithdrawTrade, COUNTEROFFER_TRADE:handleCounterofferTrade,
  RESPOND_PEACE: handleRespondPeace,
  WITHDRAW_PEACE: handleWithdrawPeace,
  ADVANCE_WORLD: handleAdvanceWorld,
  TRANSITION_TO_NEXT_WORLD: handleTransitionToNextWorld,
  AI_DECIDE: handleAiDecide,
  START_AI_OPERATION: handleStartAiOperation,
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
