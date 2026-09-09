import { CommandDefinition, CommandRequest } from './protocol';
import { OrchestrationError, ErrorCode } from './errors';

export function validateRequiredParameters(req: CommandRequest, def: CommandDefinition): void {
  for (const spec of def.requiredParameters) {
    const v = req.parameters?.[spec.name];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      throw new OrchestrationError(ErrorCode.MISSING_PARAMETER, `Missing required parameter: ${spec.name}`);
    }
  }
}

export function assertCommandKnown(commandId: string, def: CommandDefinition | undefined): CommandDefinition {
  if (!def) {
    throw new OrchestrationError(ErrorCode.INVALID_COMMAND, `Unknown command: ${commandId}`, { commandId });
  }
  return def;
}

export function assertCommandImplemented(def: CommandDefinition): void {
  if (def.status === 'unsupported') {
    throw new OrchestrationError(
      ErrorCode.FEATURE_NOT_IMPLEMENTED,
      `${def.commandId} is catalogued but not supported by the current game model`,
      { commandId: def.commandId },
    );
  }
}
