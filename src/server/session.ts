import { getCommandDefinition } from '../orchestration/commandIndex';
import { createDefaultRegistry, Orchestrator } from '../orchestration';
import { CommandRequest, CommandResponse } from '../orchestration/protocol';
import { FixedWorldTimeAuthority } from '../persistence/timeAuthority';
import { isCommandExposed } from './allowlist';
import { aiInvasionFixtureMode, arrangeLevel1SoAiAttacks, openAiInvasionFromDecision } from './aiInvasionFixture';
import { isRoutingHistoryStore } from '../persistence/supabase/commandHistoryBuffer';
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
  const registry = createDefaultRegistry();
  registry.workoutHistory = persistence.history;
  registry.timeAuthority = new FixedWorldTimeAuthority(0);
  const sessions = new Map<string, PlayerSession>();

  function boot(playerId: string): PlayerSession {
    const ensured = persistence.ensure(playerId);
    const mode = aiInvasionFixtureMode();
    const awaitingTutorial = ensured.state.level1Tutorial?.beat === 'FIRST_WORKOUT_PENDING';
    if (mode && awaitingTutorial) {
      arrangeLevel1SoAiAttacks(ensured.state, mode);
    }
    const orchestrator = new Orchestrator(ensured.state, registry);
    let expectedVersion = ensured.record.stateVersion;
    if (mode && awaitingTutorial) {
      const opened = openAiInvasionFromDecision(orchestrator, playerId);
      const saved = persistence.save(playerId, orchestrator.getState(), expectedVersion);
      if (!saved.ok) {
        throw new PersistenceFailedError(saved.code, saved.message);
      }
      expectedVersion = saved.record.stateVersion;
      console.log(`AI invasion fixture ${mode}: ${opened.invasionId} on ${opened.targetId} (${opened.attackerSoldiers} troops)`);
    }
    return {
      orchestrator,
      expectedVersion,
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
      const atomic = definition?.changesState
        && persistence.commitWorld
        && isRoutingHistoryStore(persistence.history);
      if (atomic && persistence.commitWorld && isRoutingHistoryStore(persistence.history)) {
        const history = persistence.history;
        history.begin(request.playerId);
        let response: CommandResponse;
        try {
          response = current.orchestrator.execute(request);
          const saved = persistence.commitWorld(
            request.playerId,
            current.orchestrator.getState(),
            current.expectedVersion,
            history.drain(request.playerId),
          );
          if (!saved.ok) {
            reload(request.playerId, current);
            throw new PersistenceFailedError(saved.code, saved.message);
          }
          current.expectedVersion = saved.record.stateVersion;
          return response;
        } finally {
          history.end(request.playerId);
        }
      }
      const historyBackup = definition?.changesState
        ? persistence.history.clonePlayer(request.playerId)
        : null;
      let response: CommandResponse;
      try {
        response = current.orchestrator.execute(request);
      } catch (err) {
        if (historyBackup) persistence.history.replacePlayer(request.playerId, historyBackup);
        throw err;
      }
      if (definition?.changesState) {
        const saved = persistence.save(request.playerId, current.orchestrator.getState(), current.expectedVersion);
        if (!saved.ok) {
          let message = saved.message;
          try {
            if (historyBackup) persistence.history.replacePlayer(request.playerId, historyBackup);
          } catch (rollbackErr) {
            const rollbackMessage = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
            message = `${message} Rollback failed: ${rollbackMessage}`;
          }
          reload(request.playerId, current);
          throw new PersistenceFailedError(saved.code, message);
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
