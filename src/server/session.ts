import { getCommandDefinition } from '../orchestration/commandIndex';
import { createDefaultRegistry, Orchestrator } from '../orchestration';
import { ErrorCode } from '../orchestration/errors';
import { CommandRequest, CommandResponse } from '../orchestration/protocol';
import { FixedWorldTimeAuthority } from '../persistence/timeAuthority';
import { GameState } from '../types/GameState';
import { currentUtcNowMs } from '../world/realtimeClock';
import { replaceGameplaySessionLease } from '../state/gameplaySessionLeases';
import {
  renewGameplaySessionLeaseAtSequence,
  validateGameplaySessionLease,
  type GameplayCommandReceipt,
  type GameplaySessionLease,
} from '../world/presenceLeases';
import { isCommandExposed } from './allowlist';
import { aiInvasionFixtureMode, arrangeLevel1SoAiAttacks, openAiInvasionFromDecision } from './aiInvasionFixture';
import { BadRequestError } from './identity';
import {
  applyGameplaySessionEnd,
  applyGameplaySessionHeartbeat,
  applyGameplaySessionOpen,
  commitGameplaySession,
  issueGameplaySessionId,
  type GameplaySessionChange,
  type GameplaySessionView,
} from './gameplaySessionLifecycle';
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

export interface SessionHostOptions {
  /** Captured once per accepted request. Defaults to the server UTC clock. */
  nowMs?: () => number;
}

export interface CommandSessionHost {
  readonly persistenceName: PlayerWorldPersistence['name'];
  execute(request: CommandRequest): Promise<CommandResponse>;
  openGameplaySession(playerId: string, requestId: string): Promise<GameplaySessionView>;
  heartbeatGameplaySession(
    playerId: string,
    requestId: string,
    gameplaySessionId: string,
    renewalSequence: number,
  ): Promise<GameplaySessionView>;
  endGameplaySession(playerId: string, requestId: string, gameplaySessionId: string): Promise<GameplaySessionView>;
}

/**
 * Accepted gameplay-command renewal:
 * an HTTP command renews the presented server-issued session only when the
 * command is on the public allowlist, it changes GameState, the session
 * belongs to the resolved player's loaded world and is renewable at the
 * receipt captured for this request, and the orchestrator returns success.
 * Read-only commands, rejected commands, unexposed commands, and commands
 * with no gameplaySessionId do not renew. Renewal is applied to the
 * post-command state and stored in that command's single compare-and-swap
 * write. A conflict reloads and surfaces persistence.conflict. The command
 * path does not retry, so it does not sample the clock again.
 * A renewal sequence equal to the committed sequence does not extend the
 * lease. A lower sequence does not extend it either. Gameplay commands can
 * still apply again; only the lease renewal is replay-protected.
 */
export function createSessionHost(
  persistence: PlayerWorldPersistence,
  options: SessionHostOptions = {},
): CommandSessionHost {
  const nowMs = options.nowMs ?? currentUtcNowMs;
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

  function remember(session: PlayerSession, state: GameState, stateVersion: number): void {
    session.orchestrator.replaceState(state);
    session.expectedVersion = stateVersion;
  }

  function withPlayer<T>(playerId: string, work: (session: PlayerSession) => T): Promise<T> {
    let session = sessions.get(playerId);
    if (!session) {
      session = boot(playerId);
      sessions.set(playerId, session);
    }
    const current = session;
    const run = current.chain.then(() => work(current));
    current.chain = run.then(() => undefined, () => undefined);
    return run;
  }

  function commitSession(
    playerId: string,
    session: PlayerSession,
    apply: (state: GameState) => GameplaySessionChange,
  ): GameplaySessionView {
    const committed = commitGameplaySession(persistence, playerId, apply);
    if (!committed.ok) throw new PersistenceFailedError(committed.code, committed.message);
    remember(session, committed.state, committed.stateVersion);
    return committed.view;
  }

  function openGameplaySession(playerId: string, requestId: string): Promise<GameplaySessionView> {
    assertRequestKey(requestId);
    const receiptMs = nowMs();
    const sessionId = issueGameplaySessionId();
    return withPlayer(playerId, (session) => commitSession(
      playerId,
      session,
      (state) => applyGameplaySessionOpen(state, { sessionId, requestId, receiptMs }),
    ));
  }

  function heartbeatGameplaySession(
    playerId: string,
    requestId: string,
    gameplaySessionId: string,
    renewalSequence: number,
  ): Promise<GameplaySessionView> {
    assertRequestKey(requestId);
    assertSessionKey(gameplaySessionId);
    assertRenewalSequence(renewalSequence);
    const receiptMs = nowMs();
    return withPlayer(playerId, (session) => commitSession(
      playerId,
      session,
      (state) => applyGameplaySessionHeartbeat(state, {
        sessionId: gameplaySessionId,
        requestId,
        receiptMs,
        renewalSequence,
      }),
    ));
  }

  function endGameplaySession(
    playerId: string,
    requestId: string,
    gameplaySessionId: string,
  ): Promise<GameplaySessionView> {
    assertRequestKey(requestId);
    assertSessionKey(gameplaySessionId);
    const receiptMs = nowMs();
    return withPlayer(playerId, (session) => commitSession(
      playerId,
      session,
      (state) => applyGameplaySessionEnd(state, { sessionId: gameplaySessionId, receiptMs }),
    ));
  }

  function execute(request: CommandRequest): Promise<CommandResponse> {
    if (!isCommandExposed(request.commandId)) {
      return Promise.reject(new CommandNotExposedError(request.commandId));
    }
    const receiptMs = nowMs();
    return withPlayer(request.playerId, (current) => {
      const definition = getCommandDefinition(request.commandId);
      const sessionCommand = definition?.changesState === true && hasGameplaySession(request);
      if (sessionCommand) {
        const replay = committedCommandReplay(current.orchestrator.getState(), request);
        if (replay) return replay;
      }
      const renewal = sessionCommand
        ? gateCommandRenewal(current.orchestrator.getState(), request, receiptMs)
        : null;
      if (renewal && 'response' in renewal) return renewal.response;

      const before = current.orchestrator.getState();
      const atomic = definition?.changesState
        && persistence.commitWorld
        && isRoutingHistoryStore(persistence.history);
      let response: CommandResponse;
      if (atomic && persistence.commitWorld && isRoutingHistoryStore(persistence.history)) {
        const history = persistence.history;
        history.begin(request.playerId);
        try {
          response = current.orchestrator.execute(request);
          finishCommandCommit(current, request, before, response, renewal);
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
      try {
        response = current.orchestrator.execute(request);
      } catch (err) {
        if (historyBackup) persistence.history.replacePlayer(request.playerId, historyBackup);
        throw err;
      }
      finishCommandCommit(current, request, before, response, renewal);
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
  }

  return {
    persistenceName: persistence.name,
    execute,
    openGameplaySession,
    heartbeatGameplaySession,
    endGameplaySession,
  };
}

function hasGameplaySession(request: CommandRequest): boolean {
  return typeof request.gameplaySessionId === 'string' && request.gameplaySessionId.trim() !== '';
}

/**
 * Command identity is `commandSequence` on one gameplay session.
 * Renewal identity is `renewalSequence`. HTTP `requestId` names the attempt.
 * A committed sequence is returned from its receipt and is not executed again.
 * A lower sequence is stale. Renewal is applied only for a command that runs.
 */
function committedCommandReplay(state: GameState, request: CommandRequest): CommandResponse | null {
  if (!isRenewalSequence(request.commandSequence)) {
    return rejectedCommand(request, 'Gameplay command requires a command sequence');
  }
  const requestId = request.requestId;
  if (typeof requestId !== 'string' || requestId.trim() === '' || requestId !== requestId.trim()) {
    return rejectedCommand(request, 'Gameplay command requires a request id');
  }
  const sessionId = request.gameplaySessionId ?? '';
  const current = state.gameplaySessionLeases.find((lease) => lease.sessionId === sessionId);
  if (!current) return rejectedCommand(request, 'Gameplay session is unknown');
  const last = current.lastCommandSequence ?? null;
  const sequence = request.commandSequence;
  if (last !== null && sequence === last) {
    const receipt = current.lastCommandReceipt;
    if (!receipt || receipt.requestId !== requestId) {
      return rejectedCommand(request, 'Gameplay command sequence was already committed', ErrorCode.COMMAND_SEQUENCE_CONFLICT);
    }
    return responseFromReceipt(request, receipt);
  }
  if (last !== null && sequence < last) {
    return rejectedCommand(request, 'Gameplay command sequence is stale', ErrorCode.COMMAND_STALE);
  }
  return null;
}

function finishCommandCommit(
  current: PlayerSession,
  request: CommandRequest,
  before: GameState,
  response: CommandResponse,
  renewal: { lease: GameplaySessionLease } | { unchanged: true } | null,
): void {
  const mutated = current.orchestrator.getState() !== before;
  if (response.success && renewal && 'lease' in renewal) {
    current.orchestrator.replaceState(replaceGameplaySessionLease(current.orchestrator.getState(), renewal.lease));
  }
  if (!mutated || !isRenewalSequence(request.commandSequence) || !hasGameplaySession(request)) return;
  const state = current.orchestrator.getState();
  const sessionId = request.gameplaySessionId ?? '';
  const lease = state.gameplaySessionLeases.find((item) => item.sessionId === sessionId);
  if (!lease) return;
  const receipt: GameplayCommandReceipt = {
    sequence: request.commandSequence,
    requestId: response.requestId,
    commandId: response.commandId,
    success: response.success,
    payload: JSON.parse(JSON.stringify(response.payload)) as Record<string, unknown>,
    errors: response.errors.map((error) => ({ code: error.code, message: error.message })),
  };
  current.orchestrator.replaceState(replaceGameplaySessionLease(state, validateGameplaySessionLease({
    ...lease,
    lastCommandSequence: request.commandSequence,
    lastCommandReceipt: receipt,
  })));
}

function responseFromReceipt(request: CommandRequest, receipt: GameplayCommandReceipt): CommandResponse {
  return {
    success: receipt.success,
    commandId: receipt.commandId,
    requestId: receipt.requestId,
    playerId: request.playerId,
    stateChanges: [],
    events: [],
    notifications: [],
    presentation: null,
    resourcesChanged: [],
    territoriesChanged: [],
    armiesChanged: [],
    newlyAvailableActions: [],
    errors: receipt.errors.map((error) => ({
      code: error.code as CommandResponse['errors'][number]['code'],
      message: error.message,
    })),
    payload: JSON.parse(JSON.stringify(receipt.payload)) as Record<string, unknown>,
    idempotentReplay: true,
  };
}

function gateCommandRenewal(
  state: GameState,
  request: CommandRequest,
  receiptMs: number,
): { lease: GameplaySessionLease } | { unchanged: true } | { response: CommandResponse } {
  const requestId = request.requestId;
  if (typeof requestId !== 'string' || requestId.trim() === '' || requestId !== requestId.trim()) {
    return { response: rejectedCommand(request, 'Gameplay session renewal requires a request id') };
  }
  if (!isRenewalSequence(request.renewalSequence)) {
    return { response: rejectedCommand(request, 'Gameplay session renewal requires a renewal sequence') };
  }
  const sessionId = request.gameplaySessionId ?? '';
  const current = state.gameplaySessionLeases.find((lease) => lease.sessionId === sessionId);
  if (!current) return { response: rejectedCommand(request, 'Gameplay session is unknown') };
  try {
    const result = renewGameplaySessionLeaseAtSequence(current, receiptMs, requestId, request.renewalSequence);
    if (result.outcome === 'expired') return { response: rejectedCommand(request, 'Gameplay session is expired') };
    if (result.outcome === 'ended') return { response: rejectedCommand(request, 'Gameplay session has ended') };
    if (result.outcome === 'idempotent_replay' || result.outcome === 'stale') return { unchanged: true };
    return { lease: result.lease };
  } catch {
    return { response: rejectedCommand(request, 'Gameplay session receipt is behind authoritative state') };
  }
}

function isRenewalSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function rejectedCommand(
  request: CommandRequest,
  message: string,
  code: CommandResponse['errors'][number]['code'] = ErrorCode.GAMEPLAY_SESSION_INVALID,
): CommandResponse {
  return {
    success: false,
    commandId: request.commandId,
    requestId: request.requestId ?? request.commandId,
    playerId: request.playerId,
    stateChanges: [],
    events: [],
    notifications: [],
    presentation: null,
    resourcesChanged: [],
    territoriesChanged: [],
    armiesChanged: [],
    newlyAvailableActions: [],
    errors: [{ code, message }],
    payload: {},
  };
}

function assertRequestKey(requestId: string): void {
  if (typeof requestId !== 'string' || requestId.trim() === '' || requestId !== requestId.trim()) {
    throw new BadRequestError('requestId must be a non-empty string');
  }
}

function assertSessionKey(sessionId: string): void {
  if (typeof sessionId !== 'string' || sessionId.trim() === '' || sessionId !== sessionId.trim()) {
    throw new BadRequestError('gameplaySessionId must be a non-empty string');
  }
}

function assertRenewalSequence(renewalSequence: number): void {
  if (!isRenewalSequence(renewalSequence)) {
    throw new BadRequestError('renewalSequence must be a positive safe integer');
  }
}
