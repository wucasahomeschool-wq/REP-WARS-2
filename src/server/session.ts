import { InMemoryWorkoutHistoryStore } from '../fitness/history/inMemoryStore';
import { getCommandDefinition } from '../orchestration/commandIndex';
import { createDefaultRegistry, Orchestrator } from '../orchestration';
import { CommandRequest, CommandResponse } from '../orchestration/protocol';
import { FixedWorldTimeAuthority } from '../persistence/timeAuthority';
import { isCommandExposed } from './allowlist';
import { PlayerWorldPersistence } from './persistencePort';

export class CommandNotExposedError extends Error {
  constructor(commandId: string) {
    super(`Command is not exposed over HTTP: ${commandId}`);
    this.name = 'CommandNotExposedError';
  }
}

export class PersistenceFailedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PersistenceFailedError';
    this.code = code;
  }
}

interface PlayerSession {
  orchestrator: Orchestrator;
  expectedVersion: number;
  chain: Promise<void>;
}

export interface CommandSessionHost {
  readonly persistenceName: PlayerWorldPersistence['name'];
  execute(request: CommandRequest): Promise<CommandResponse>;
}

export function createSessionHost(persistence: PlayerWorldPersistence): CommandSessionHost {
  const historyStore = new InMemoryWorkoutHistoryStore();
  const registry = createDefaultRegistry();
  registry.workoutHistory = historyStore;
  registry.timeAuthority = new FixedWorldTimeAuthority(0);
  const sessions = new Map<string, PlayerSession>();

  function boot(playerId: string): PlayerSession {
    const ensured = persistence.ensure(playerId);
    return {
      orchestrator: new Orchestrator(ensured.state, registry),
      expectedVersion: ensured.record.stateVersion,
      chain: Promise.resolve(),
    };
  }

  function reload(playerId: string, session: PlayerSession): void {
    const ensured = persistence.ensure(playerId);
    session.orchestrator.replaceState(ensured.state);
    session.expectedVersion = ensured.record.stateVersion;
  }

  function execute(request: CommandRequest): Promise<CommandResponse> {
    if (!isCommandExposed(request.commandId)) {
      return Promise.reject(new CommandNotExposedError(request.commandId));
    }
    let session = sessions.get(request.playerId);
    if (!session) {
      session = boot(request.playerId);
      sessions.set(request.playerId, session);
    }
    const current = session;
    const run = current.chain.then(() => {
      const definition = getCommandDefinition(request.commandId);
      const response = current.orchestrator.execute(request);
      if (definition?.changesState) {
        const saved = persistence.save(request.playerId, current.orchestrator.getState(), current.expectedVersion);
        if (!saved.ok) {
          reload(request.playerId, current);
          throw new PersistenceFailedError(saved.code, saved.message);
        }
        current.expectedVersion = saved.record.stateVersion;
      }
      return response;
    });
    current.chain = run.then(() => undefined, () => undefined);
    return run;
  }

  return { persistenceName: persistence.name, execute };
}
