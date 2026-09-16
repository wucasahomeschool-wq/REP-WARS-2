import { GameState } from '../types/GameState';
import { buildWarlordStates, rebindWarlordRuntime } from '../state/gameStateAdapters';
import { handleSyncPlayerWorld } from '../world/catchup';
import { getCommandDefinition } from './commandIndex';
import { createDefaultRegistry, EngineRegistry } from './engineRegistry';
import { OrchestrationError, ErrorCode, OrchestrationErrorBody } from './errors';
import {
  HandlerContext,
  MUTATING_HANDLERS,
  OrchestratorRuntime,
  READ_ONLY_HANDLERS,
} from './handlers';
import { CommandRequest, CommandResponse, HandlerResult } from './protocol';
import { authorizeCommand } from './authorization';
import { assertCommandImplemented, assertCommandKnown, validateRequiredParameters } from './router';
import { runStateTransaction } from './transaction';
import { safeObserveCommand } from '../analytics/recorder';
import type { TelemetryRecorder } from '../analytics/types';
import { applyLevel1TutorialToHandlerResult } from '../gameplay/tutorial/level1';

function makeRequestId(req: CommandRequest): string {
  return req.requestId ?? `${req.commandId}_${req.playerId}_${req.timestamp ?? 0}`;
}

function failureResponse(
  req: CommandRequest,
  requestId: string,
  errors: OrchestrationErrorBody[],
  partial?: HandlerResult,
): CommandResponse {
  return {
    success: false,
    commandId: req.commandId,
    requestId,
    playerId: req.playerId,
    stateChanges: partial?.stateChanges ?? [],
    events: partial?.events ?? [],
    notifications: partial?.notifications ?? [],
    presentation: partial?.presentation ?? null,
    resourcesChanged: partial?.resourcesChanged ?? [],
    territoriesChanged: partial?.territoriesChanged ?? [],
    armiesChanged: partial?.armiesChanged ?? [],
    newlyAvailableActions: partial?.newlyAvailableActions ?? [],
    errors,
    payload: partial?.payload ?? {},
  };
}

function successResponse(req: CommandRequest, requestId: string, result: HandlerResult): CommandResponse {
  return {
    success: true,
    commandId: req.commandId,
    requestId,
    playerId: req.playerId,
    stateChanges: result.stateChanges,
    events: result.events,
    notifications: result.notifications,
    presentation: result.presentation,
    resourcesChanged: result.resourcesChanged,
    territoriesChanged: result.territoriesChanged,
    armiesChanged: result.armiesChanged,
    newlyAvailableActions: result.newlyAvailableActions,
    errors: [],
    payload: result.payload,
  };
}

/**
 * Coordinates command validation, routing, engine calls, and GameState updates.
 * Does not embed battle/event/map/AI formulas — those stay in their engines.
 */
export class Orchestrator {
  private state: GameState;
  private readonly registry: EngineRegistry;
  private runtime: OrchestratorRuntime;
  private readonly telemetry: TelemetryRecorder | null;

  constructor(initialState: GameState, registry?: EngineRegistry, telemetry?: TelemetryRecorder | null) {
    this.state = initialState;
    this.registry = registry ?? createDefaultRegistry();
    this.runtime = { aiWarlordStates: buildWarlordStates(this.state) };
    this.telemetry = telemetry ?? null;
  }

  getState(): GameState {
    return this.state;
  }

  replaceState(next: GameState): void {
    this.state = next;
    this.runtime = { aiWarlordStates: buildWarlordStates(this.state) };
  }

  execute(req: CommandRequest): CommandResponse {
    const requestId = makeRequestId(req);
    const respond = (response: CommandResponse): CommandResponse => {
      safeObserveCommand(this.telemetry, {
        request: req,
        response,
        state: this.state,
      });
      return response;
    };
    try {
      const def = assertCommandKnown(req.commandId, getCommandDefinition(req.commandId));
      assertCommandImplemented(def);
      validateRequiredParameters(req, def);
      authorizeCommand(this.state, req, def);

      const ctx: HandlerContext = {
        req,
        def,
        registry: this.registry,
        runtime: this.runtime,
      };

      if (!def.changesState) {
        const readHandler = READ_ONLY_HANDLERS[req.commandId];
        if (!readHandler) {
          throw new OrchestrationError(ErrorCode.INVALID_COMMAND, `No read handler for ${req.commandId}`);
        }
        const result = readHandler(this.state, ctx);
        return respond(successResponse(req, requestId, result));
      }

      const mutHandler = req.commandId === 'SYNC_PLAYER_WORLD'
        ? handleSyncPlayerWorld
        : MUTATING_HANDLERS[req.commandId];
      if (!mutHandler) {
        throw new OrchestrationError(ErrorCode.INVALID_COMMAND, `No mutating handler for ${req.commandId}`);
      }

      const { state: next, result } = runStateTransaction(this.state, (draft) => {
        const inner = mutHandler(draft, ctx);
        return applyLevel1TutorialToHandlerResult(draft, inner);
      });
      this.state = next;
      this.runtime.aiWarlordStates = rebindWarlordRuntime(this.state, this.runtime.aiWarlordStates);
      if (result.commandSuccess === false) {
        return respond(failureResponse(
          req,
          requestId,
          result.errors ?? [{ code: ErrorCode.ENGINE_ERROR, message: 'Command failed' }],
          result,
        ));
      }
      return respond(successResponse(req, requestId, result));
    } catch (err) {
      this.runtime = { aiWarlordStates: buildWarlordStates(this.state) };
      if (err instanceof OrchestrationError) {
        return respond(failureResponse(req, requestId, [err.toBody()]));
      }
      const message = err instanceof Error ? err.message : String(err);
      return respond(failureResponse(req, requestId, [{
        code: ErrorCode.ENGINE_ERROR,
        message,
      }]));
    }
  }
}
