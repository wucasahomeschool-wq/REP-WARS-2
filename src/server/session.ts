import {mutationIntent, validMutationId, validWorldAttempt, type MutationReceipt} from '../world/mutationReceipts';
import {authorizeCommandActor} from '../orchestration/authorization';
import {OrchestrationError} from '../orchestration/errors';
import {cloneGameState} from '../state/cloneGameState';
import { progressProactiveThrough } from '../orchestration/handlers';
import { liveResponseContexts } from '../engine/responseRecords';
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

/** Transient process capacity, with no player data or gameplay mutation. */
export class RequestCapacityError extends Error {
  constructor() {
    super('Server is busy. Please retry this request.');
    this.name = 'RequestCapacityError';
  }
}

interface PlayerSession {
  orchestrator: Orchestrator;
  expectedVersion: number;
  chain: Promise<void>;
  pending: number;
  needsReload: boolean;
}

/** Process-memory policy only; never a gameplay time or player capacity limit. */
export const DEFAULT_MAX_CACHED_PLAYERS = 128;
export const DEFAULT_MAX_PENDING_REQUESTS = 256;
export const DEFAULT_MAX_PENDING_REQUESTS_PER_PLAYER = 16;
/** Work bound, not an earned-time cap; each existing chunk is at most 64 ticks. */
export const DEFAULT_MAX_CATCH_UP_CHUNKS = 4;

export interface SessionHostOptions {
  /** Captured once per accepted request. Defaults to the server UTC clock. */
  nowMs?: () => number;
  /** Maximum retained worlds after requests settle. Pending work is pinned and
   * can temporarily exceed this bound. Zero disables idle retention. */
  maxCachedPlayers?: number;
  /** Running plus queued requests per host. Positive safe integer. */
  maxPendingRequests?: number;
  /** Running plus queued requests for one player. Positive safe integer. */
  maxPendingRequestsPerPlayer?: number;
  /** Maximum historical simulation chunks per mutating request. */
  maxCatchUpChunks?: number;
}

export interface CommandSessionHost {
  readonly persistenceName: PlayerWorldPersistence['name'];
  execute(request: CommandRequest): Promise<CommandResponse>;
  openGameplaySession(playerId: string, requestId: string, worldAttempt?: number): Promise<GameplaySessionView>;
  heartbeatGameplaySession(
    playerId: string,
    requestId: string,
    gameplaySessionId: string,
    renewalSequence: number,
    worldAttempt?: number,
  ): Promise<GameplaySessionView>;
  endGameplaySession(playerId: string, requestId: string, gameplaySessionId: string, worldAttempt?: number): Promise<GameplaySessionView>;
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
 * use the retained logical receipt before sequencing or lease renewal.
 */
export function createSessionHost(
  persistence: PlayerWorldPersistence,
  options: SessionHostOptions = {},
): CommandSessionHost {
  if (process.env.NODE_ENV === 'production' && persistence.name === 'supabase'
    && (!persistence.commitWorld || !isRoutingHistoryStore(persistence.history))) {
    throw new Error('Production requires atomic world and history persistence');
  }
  if (process.env.NODE_ENV === 'production' && aiInvasionFixtureMode()) throw new Error('AI invasion fixtures are forbidden in production');
  const maxCachedPlayers = options.maxCachedPlayers === undefined ? DEFAULT_MAX_CACHED_PLAYERS : options.maxCachedPlayers;
  if (!Number.isSafeInteger(maxCachedPlayers) || maxCachedPlayers < 0) {
    throw new Error('maxCachedPlayers must be a non-negative safe integer');
  }
  const maxPendingRequests = options.maxPendingRequests === undefined ? DEFAULT_MAX_PENDING_REQUESTS : options.maxPendingRequests;
  const maxPendingRequestsPerPlayer = options.maxPendingRequestsPerPlayer === undefined
    ? DEFAULT_MAX_PENDING_REQUESTS_PER_PLAYER : options.maxPendingRequestsPerPlayer;
  const maxCatchUpChunks = options.maxCatchUpChunks === undefined ? DEFAULT_MAX_CATCH_UP_CHUNKS : options.maxCatchUpChunks;
  for (const [name, value] of Object.entries({ maxPendingRequests, maxPendingRequestsPerPlayer, maxCatchUpChunks })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`);
  }
  const nowMs = options.nowMs ?? currentUtcNowMs;
  const registry = createDefaultRegistry();
  registry.workoutHistory = persistence.history;
  registry.timeAuthority = new FixedWorldTimeAuthority(0);
  const sessions = new Map<string, PlayerSession>();
  let pendingRequests = 0;

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
      pending: 0,
      needsReload: false,
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
    // Reject before loading a world, joining a chain or touching persistence.
    // Receipts remain unconsumed: the same logical request can be retried.
    if (pendingRequests >= maxPendingRequests || (session?.pending ?? 0) >= maxPendingRequestsPerPlayer) {
      return Promise.reject(new RequestCapacityError());
    }
    pendingRequests++;
    try {
      if (!session) session = boot(playerId);
    } catch (error) {
      pendingRequests--;
      return Promise.reject(error);
    }
    // Map order is LRU request order. A queued player must keep one chain even
    // when requests for other players put the cache over its retention limit.
    sessions.delete(playerId);
    sessions.set(playerId, session);
    const current = session;
    current.pending++;
    trimCache();
    const run = current.chain.then(() => {
      if (current.needsReload) {
        reload(playerId, current);
        current.needsReload = false;
      }
      return work(current);
    }).catch((error: unknown) => {
      // A transport exception may mean an aborted write OR a lost committed
      // response. Persistence/receipts decide; the cached draft cannot decide.
      current.needsReload = true;
      throw error;
    }).finally(() => {
      current.pending--;
      pendingRequests--;
      if (current.pending === 0 && current.needsReload) sessions.delete(playerId);
      trimCache();
    });
    current.chain = run.then(() => undefined, () => undefined);
    return run;
  }

  function trimCache(): void {
    for (const [id, session] of sessions) {
      if (sessions.size <= maxCachedPlayers) break;
      if (session.pending === 0) sessions.delete(id);
    }
  }

  function commitSession(
    playerId: string,
    session: PlayerSession,
    request: CommandRequest,
    apply: (state: GameState) => GameplaySessionChange,
  ): GameplaySessionView {
    const hash = mutationIntent(request.commandId, request.parameters);
    const committed = commitGameplaySession(persistence, playerId, state => {
      const replay = retainedCommandReplay(state, request, hash);
      if (replay) {
        const view: GameplaySessionView = replay.idempotentReplay
          ? {...replay.payload as unknown as GameplaySessionView, replayedOutcome: (replay.payload as unknown as GameplaySessionView).outcome,
            outcome: 'idempotent_replay', worldAttempt: state.worldAttempt}
          : {sessionId: '', outcome: 'rejected', receiptMs: null, openedAtMs: null, expiresAtMs: null,
            endedAtMs: null, lastRenewalSequence: null, worldAttempt: state.worldAttempt, error: replay.errors[0]!.code};
        return {state, changed: false, view};
      }
      const changed=apply(state);
      // Lease receipts may finish sub-tick cognition/WAIT. A physical backlog
      // must be ordered by the existing SYNC/catch-up path first.
      if(changed.state.lastAccrualAtMs!==null && changed.state.worldTick===changed.state.accruedTargetWorldTick) {
        // Terminal records are immutable. Comparing live records also detects
        // their terminal removal; no history scan is needed for this save gate.
        const cognitionSnapshot=()=>JSON.stringify([changed.state.aiClock,[...changed.state.aiPressure],[...changed.state.aiDecisionOpportunities],
          liveResponseContexts(changed.state),{...changed.state.aiResponseScheduler,
            primaryByFaction:[...changed.state.aiResponseScheduler.primaryByFaction],
            lastBoundaryByFaction:[...changed.state.aiResponseScheduler.lastBoundaryByFaction]}]);
        const before=cognitionSnapshot();
        const req:CommandRequest={commandId:'ADVANCE_WORLD',playerId,parameters:{elapsedTicks:0}};
        progressProactiveThrough(changed.state,{req,def:getCommandDefinition('ADVANCE_WORLD')!,registry,runtime:{aiWarlordStates:new Map()}},changed.state.lastAccrualAtMs);
        changed.changed=changed.changed || before!==cognitionSnapshot();
      }
      changed.view.worldAttempt = changed.state.worldAttempt;
      changed.state.commandReceipts.set(request.requestId!, {
        requestId: request.requestId!, commandId: request.commandId, sequence: 0,
        worldAttempt: request.worldAttempt!, intentHash: hash, success: true,
        payload: {...changed.view}, errors: [],
      });
      changed.changed = true;
      return changed;
    });
    if (!committed.ok) throw new PersistenceFailedError(committed.code, committed.message);
    remember(session, committed.state, committed.stateVersion);
    return committed.view;
  }

  function openGameplaySession(playerId: string, requestId: string, worldAttempt?: number): Promise<GameplaySessionView> {
    assertRequestKey(requestId);
    if (!validWorldAttempt(worldAttempt)) throw new BadRequestError('worldAttempt must be a nonnegative safe integer');
    const receiptMs = nowMs();
    const sessionId = issueGameplaySessionId();
    return withPlayer(playerId, (session) => commitSession(
      playerId,
      session,
      {playerId, requestId, worldAttempt, commandId: 'SESSION_OPEN', parameters: {}},
      (state) => applyGameplaySessionOpen(state, { sessionId, requestId, receiptMs }),
    ));
  }

  function heartbeatGameplaySession(
    playerId: string,
    requestId: string,
    gameplaySessionId: string,
    renewalSequence: number,
    worldAttempt?: number,
  ): Promise<GameplaySessionView> {
    assertRequestKey(requestId);
    if (!validWorldAttempt(worldAttempt)) throw new BadRequestError('worldAttempt must be a nonnegative safe integer');
    assertSessionKey(gameplaySessionId);
    assertRenewalSequence(renewalSequence);
    const receiptMs = nowMs();
    return withPlayer(playerId, (session) => commitSession(
      playerId,
      session,
      {playerId, requestId, worldAttempt, commandId: 'SESSION_HEARTBEAT', parameters: {gameplaySessionId, renewalSequence}},
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
    worldAttempt?: number,
  ): Promise<GameplaySessionView> {
    assertRequestKey(requestId);
    if (!validWorldAttempt(worldAttempt)) throw new BadRequestError('worldAttempt must be a nonnegative safe integer');
    assertSessionKey(gameplaySessionId);
    const receiptMs = nowMs();
    return withPlayer(playerId, (session) => commitSession(
      playerId,
      session,
      {playerId, requestId, worldAttempt, commandId: 'SESSION_END', parameters: {gameplaySessionId}},
      (state) => applyGameplaySessionEnd(state, { sessionId: gameplaySessionId, receiptMs }),
    ));
  }

  function execute(request: CommandRequest): Promise<CommandResponse> {
    if (!isCommandExposed(request.commandId)) {
      return Promise.reject(new CommandNotExposedError(request.commandId));
    }
    const definition = getCommandDefinition(request.commandId);
    let intentHash: string | null = null;
    if (definition?.changesState) {
      const invalid = invalidMutationIdentity(request);
      if (invalid) return Promise.resolve(invalid);
      try { intentHash = mutationIntent(request.commandId, request.parameters); }
      catch { return Promise.resolve(rejectedCommand(request, 'Command intent must be bounded JSON', ErrorCode.COMMAND_IDENTITY_INVALID)); }
    }
    const receiptMs = nowMs();
    return withPlayer(request.playerId, (current) => {
      if (definition?.changesState) {
        try { authorizeCommandActor(current.orchestrator.getState(), request, definition); }
        catch (e) { if (e instanceof OrchestrationError) return rejectedCommand(request, e.message, e.code); throw e; }
        // A presented lease must belong to this authenticated player's world,
        // even on replay. Ended leases may still name a committed command.
        if (hasGameplaySession(request) && !current.orchestrator.getState().gameplaySessionLeases.some(l=>l.sessionId===request.gameplaySessionId))
          return rejectedCommand(request, 'Gameplay session is unknown');
        const replay = retainedCommandReplay(current.orchestrator.getState(), request, intentHash!);
        if (replay) return replay;
      }
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
          response = current.orchestrator.executeAtAuthoritativeReceipt(request,receiptMs,maxCatchUpChunks);
          finishCommandCommit(current, request, before, response, renewal, intentHash);
          const saved = persistence.commitWorld(
            request.playerId,
            current.orchestrator.getState(),
            current.expectedVersion,
            history.drain(request.playerId),
          );
          if (!saved.ok) throw new PersistenceFailedError(saved.code, saved.message);
          current.expectedVersion = saved.record.stateVersion;
          return response;
        } catch (error) {
          try { reload(request.playerId, current); } catch { throw error; }
          const replay = retainedCommandReplay(current.orchestrator.getState(), request, intentHash!, false);
          if (replay) return replay;
          throw error;
        } finally {
          history.end(request.playerId);
        }
      }
      const historyBackup = definition?.changesState
        ? persistence.history.clonePlayer(request.playerId)
        : null;
      try {
        response = current.orchestrator.executeAtAuthoritativeReceipt(request,receiptMs,maxCatchUpChunks);
      } catch (err) {
        if (historyBackup) persistence.history.replacePlayer(request.playerId, historyBackup);
        throw err;
      }
      finishCommandCommit(current, request, before, response, renewal, intentHash);
      if (definition?.changesState) {
        try {
          const saved = persistence.save(request.playerId, current.orchestrator.getState(), current.expectedVersion);
          if (!saved.ok) throw new PersistenceFailedError(saved.code, saved.message);
          current.expectedVersion = saved.record.stateVersion;
        } catch (error) {
          const expectedVersion = current.expectedVersion;
          try { reload(request.playerId, current); } catch { throw error; }
          const replay = retainedCommandReplay(current.orchestrator.getState(), request, intentHash!, false);
          // Do not roll back history after a successful write with a lost reply.
          if (replay) return replay;
          // The memory/test fallback has no RPC. Roll back its synchronous
          // history effects only when the authoritative world did not advance.
          // Production uses the atomic commitWorld + buffered-history path.
          if (historyBackup && current.expectedVersion === expectedVersion)
            persistence.history.replacePlayer(request.playerId, historyBackup);
          throw error;
        }
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
 * Ordering is commandSequence within a lease; renewal has its own sequence.
 * Logical requestId replay is checked first, independently of both sequences.
 * A new ID cannot reuse a consumed sequence. Renewal applies only on execution.
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
    return rejectedCommand(request, 'Gameplay command sequence was already committed', ErrorCode.COMMAND_SEQUENCE_CONFLICT);
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
  intentHash: string | null,
): void {
  // A slice may have committed historical world/history progress, but the
  // requested gameplay handler has not run. Preserve its sequence for retry.
  const pending = response.errors.some(error => error.code === ErrorCode.WORLD_CATCHUP_PENDING);
  // Read-only calls do not acquire an identity. Operational/configuration
  // failures and catch-up continuations are not finalized gameplay outcomes.
  if (intentHash === null || response.errors.some(e => [ErrorCode.ENGINE_ERROR, ErrorCode.ENGINE_UNAVAILABLE,
    ErrorCode.INVALID_GAME_STATE, ErrorCode.WORKOUT_CONFIGURATION_UNAVAILABLE].includes(e.code as never))) return;
  const handlerMutated = current.orchestrator.getState() !== before;
  if (!handlerMutated) current.orchestrator.replaceState(cloneGameState(before));
  const retainedState = current.orchestrator.getState();
  const retained: MutationReceipt = {
    sequence: isRenewalSequence(request.commandSequence) ? request.commandSequence : 0, requestId: request.requestId!, commandId: request.commandId,
    success: response.success, payload: JSON.parse(JSON.stringify(response.payload)),
    errors: response.errors.map(e=>({code:e.code,message:e.message})), worldAttempt: request.worldAttempt!, intentHash,
  };
  retainedState.commandReceipts.set(retained.requestId, retained);
  response.mutationOutcome = pending ? 'pending' : response.success ? 'committed' : 'rejected';
  if (pending) { response.worldAttempt = retainedState.worldAttempt; return; }
  response.worldAttempt = retainedState.worldAttempt;
  if (response.success && renewal && 'lease' in renewal) {
    current.orchestrator.replaceState(replaceGameplaySessionLease(current.orchestrator.getState(), renewal.lease));
  }
  // Final rejection is retained, but preserves existing command sequencing:
  // only successful/previously-mutating responses consume the lease sequence.
  if ((!response.success && !handlerMutated) || !isRenewalSequence(request.commandSequence) || !hasGameplaySession(request)) return;
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
    mutationOutcome: receipt.success ? 'replayed' : 'rejected',
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
  if (!validMutationId(requestId)) {
    throw new BadRequestError('requestId must contain 1-128 ASCII letters/digits/._:- and start with a letter/digit');
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

/** Both commands and session lifecycle routes reuse the canonical receipt form. */
function invalidMutationIdentity(request: CommandRequest): CommandResponse | null {
  return validMutationId(request.requestId) && validWorldAttempt(request.worldAttempt) ? null
    : rejectedCommand(request, 'Mutation requires requestId (1-128 ASCII letters/digits/._:-) and nonnegative safe-integer worldAttempt', ErrorCode.COMMAND_IDENTITY_INVALID);
}
function retainedCommandReplay(state: GameState, request: CommandRequest, hash: string, checkAttempt = true): CommandResponse | null {
  const receipt = state.commandReceipts.get(request.requestId!);
  if (receipt) {
    if (receipt.intentHash !== hash || receipt.worldAttempt !== request.worldAttempt)
      return rejectedCommand(request, 'Logical requestId is already bound to different or unverifiable legacy intent', ErrorCode.COMMAND_IDENTITY_CONFLICT);
    if (!receipt.errors.some(e=>e.code===ErrorCode.WORLD_CATCHUP_PENDING))
      return { ...responseFromReceipt(request, receipt), worldAttempt: state.worldAttempt };
  }
  if (checkAttempt && request.worldAttempt !== state.worldAttempt)
    return rejectedCommand(request, 'Mutation belongs to a different world attempt', ErrorCode.COMMAND_ATTEMPT_STALE);
  return null;
}
