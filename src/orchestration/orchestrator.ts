import { GameState } from '../types/GameState';
import { buildWarlordStates, rebindWarlordRuntime } from '../state/gameStateAdapters';
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
import { assertCommandImplemented, assertCommandKnown, validateRequiredParameters } from './router';
import { runStateTransaction } from './transaction';

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

  constructor(initialState: GameState, registry?: EngineRegistry) {
    this.state = initialState;
    this.registry = registry ?? createDefaultRegistry();
    this.runtime = { aiWarlordStates: buildWarlordStates(this.state) };
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
    try {
      const def = assertCommandKnown(req.commandId, getCommandDefinition(req.commandId));
      assertCommandImplemented(def);
      validateRequiredParameters(req, def);

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
        return successResponse(req, requestId, result);
      }

      const mutHandler = MUTATING_HANDLERS[req.commandId];
      if (!mutHandler) {
        throw new OrchestrationError(ErrorCode.INVALID_COMMAND, `No mutating handler for ${req.commandId}`);
      }

      const { state: next, result } = runStateTransaction(this.state, (draft) => mutHandler(draft, ctx));
      this.state = next;
      this.runtime.aiWarlordStates = rebindWarlordRuntime(this.state, this.runtime.aiWarlordStates);
      if (result.commandSuccess === false) {
        return failureResponse(
          req,
          requestId,
          result.errors ?? [{ code: ErrorCode.ENGINE_ERROR, message: 'Command failed' }],
          result,
        );
      }
      return successResponse(req, requestId, result);
    } catch (err) {
      this.runtime = { aiWarlordStates: buildWarlordStates(this.state) };
      if (err instanceof OrchestrationError) {
        return failureResponse(req, requestId, [err.toBody()]);
      }
      const message = err instanceof Error ? err.message : String(err);
      return failureResponse(req, requestId, [{
        code: ErrorCode.ENGINE_ERROR,
        message,
      }]);
    }
  }
}
