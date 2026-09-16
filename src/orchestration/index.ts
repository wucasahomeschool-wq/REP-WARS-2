export { Orchestrator } from './orchestrator';
export { EngineRegistry, createDefaultRegistry } from './engineRegistry';
export { COMMAND_INDEX, getCommandDefinition, commandIndexSummary } from './commandIndex';
export { MUTATING_HANDLERS, READ_ONLY_HANDLERS } from './handlers';
export { ErrorCode, OrchestrationError, ERROR_CATALOG } from './errors';
export type { OrchestrationErrorBody } from './errors';
export type {
  CommandRequest,
  CommandResponse,
  CommandDefinition,
  StateChange,
  GameEvent,
  ResourceChange,
  TerritoryChange,
  ArmyChange,
} from './protocol';
export { applyBattleResultToGameState, applyUnopposedOccupationToGameState } from './applyBattle';
export { mergeEventStepOntoGameState } from './applyEvents';
export { serializePublicGameState, serializeVisibleWorld, playerFacingTroopCount } from './publicView';
export { classifyFactionInteraction } from './helpers';
export type { InteractionKind } from './helpers';
export { authorizeCommand, resolveViewerFactionId } from './authorization';
export { EXECUTABLE_COMMITMENT_ACTIONS, UNSUPPORTED_COMMITMENT_ACTIONS, isExecutableCommitmentAction } from '../engine/executableActions';
